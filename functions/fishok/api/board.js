// Cloudflare Pages Function — синхронизация доски задач Fishok через KV.
// Маршрут: /fishok/api/board
//
//   PUT  — доска мирроит снимок доски наверх.
//          Аутентификация: сам Cloudflare Access. Доска открыта на sychinnikov.com (за Access-гейтом),
//          браузер шлёт куку CF_Authorization, Cloudflare добавляет к запросу заголовок
//          Cf-Access-Jwt-Assertion. Функция проверяет ПОДПИСЬ этого JWT сертификатами Access.
//          Секрета в клиентском коде нет. Запросы с pages.dev (вне Access) не имеют валидного JWT → 401.
//
//   GET  — Claude тянет последний снимок на /day-close.
//          Аутентификация: Bearer <BOARD_READ_TOKEN> (env-переменная Pages, у Claude — локальный файл).
//          Идёт по pages.dev (вне Access), поэтому нужен свой токен.
//
// Требуется на Pages-проекте:
//   - KV binding FISHOK_BOARD
//   - env BOARD_READ_TOKEN (secret)
// Никаких секретов в этом репозитории нет.

const KEY = 'latest';
const TEAM_DOMAIN = 'sychinnikov.cloudflareaccess.com';
const CERTS_URL = `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`;

let CERTS = null; // кэш ключей на изолят

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeSegment(seg) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

async function getCerts() {
  if (!CERTS) CERTS = await fetch(CERTS_URL).then((r) => r.json());
  return CERTS;
}

// Проверка JWT Cloudflare Access: подпись RS256 + издатель + срок.
async function verifyAccessJwt(jwt) {
  if (!jwt || jwt.split('.').length !== 3) return false;
  const [h, p, sig] = jwt.split('.');
  let header, payload;
  try { header = decodeSegment(h); payload = decodeSegment(p); } catch (e) { return false; }
  if (payload.iss !== `https://${TEAM_DOMAIN}`) return false;
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) return false;
  let certs;
  try { certs = await getCerts(); } catch (e) { return false; }
  const jwk = (certs.keys || []).find((k) => k.kid === header.kid);
  if (!jwk) return false;
  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch (e) { return false; }
  const data = new TextEncoder().encode(`${h}.${p}`);
  try {
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), data);
  } catch (e) { return false; }
}

// PUT — приём снимка от доски (аутентификация через Cloudflare Access)
export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.FISHOK_BOARD) return json({ error: 'kv-not-bound' }, 500);
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!(await verifyAccessJwt(jwt))) return json({ error: 'unauthorized' }, 401);
  let payload;
  try { payload = await request.json(); } catch (e) { return json({ error: 'bad-json' }, 400); }
  const record = Object.assign({}, payload, { receivedAt: new Date().toISOString() });
  await env.FISHOK_BOARD.put(KEY, JSON.stringify(record));
  return json({ ok: true, receivedAt: record.receivedAt, cards: (payload.cards || []).length });
}

// GET — отдача последнего снимка Claude (Bearer read-token)
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.FISHOK_BOARD) return json({ error: 'kv-not-bound' }, 500);
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  const tok = m ? m[1].trim() : '';
  if (!env.BOARD_READ_TOKEN || tok !== env.BOARD_READ_TOKEN) return json({ error: 'unauthorized' }, 401);
  const raw = await env.FISHOK_BOARD.get(KEY);
  if (!raw) return json({ error: 'empty', cards: [] }, 404);
  return new Response(raw, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
