// Общий код серверных функций портала /os/.
// Здесь живут: проверка подписи Cloudflare Access, проверка токена чтения,
// сборка ответа JSON, помощники по датам и постраничный обход KV.
//
// Имя файла начинается с подчеркивания, поэтому Pages Functions не делает из него
// маршрут: это модуль для импорта соседними функциями (относительный путь, ESM).
//
// Требуется на проекте Pages:
//   - KV-биндинг FISHOK_BOARD
//   - переменная BOARD_READ_TOKEN (секрет)
// Секретов в этом репозитории нет.

export const TEAM_DOMAIN = 'sychinnikov.cloudflareaccess.com';
const CERTS_URL = `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`;

// Идентификатор приложения Access для sychinnikov.com (поле aud в токене).
// Cloudflare подписывает ОДНИМ набором ключей команды токены ВСЕХ приложений
// домена. Без сверки aud сюда прошел бы валидный токен любого другого
// приложения (доска Fishok, будущая страница для партнера, приложение с
// политикой bypass) и получил бы право писать в систему.
// Значение не секрет: отдается анонимно в редиректе Access (параметр kid).
const ACCESS_AUD = 'fdf75979cf2a1a7806b852800a990cb9ccc4d4ce448a961dec72821a6b498c97';

// Запас на расхождение часов между Cloudflare и воркером.
const CLOCK_SKEW = 60;

// Схема ключей KV (раздел 6.2 спецификации).
export const KEY_EVENT_PREFIX = 'os:ev:';
export const KEY_CURSOR = 'os:cursor';
export const KEY_REQUEST = 'os:request';

// Часовой пояс Андрея. Нужен только как запасной вариант, когда браузер
// не прислал дату события: сутки не должны переезжать на прошлые по Гринвичу.
const TIME_ZONE = 'Europe/Madrid';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let CERTS = null; // кэш ключей Access на изолят

// Ответ JSON. Русский текст не экранируется: JSON.stringify отдает символы как есть,
// заголовок объявляет utf-8. Кэширование запрещено везде.
export function json(body, status, space) {
  return new Response(JSON.stringify(body, null, space || 0), {
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

async function getCerts(force) {
  if (force || !CERTS) CERTS = await fetch(CERTS_URL).then((r) => r.json());
  return CERTS;
}

// Ключ подписи по kid. Кэш живет на изолят, поэтому при ротации ключей Access
// в кэше может не оказаться нужного: тогда перечитываем сертификаты один раз.
// Без этого долгоживущий изолят отбивал бы валидные токены до своей переработки.
async function findKey(kid) {
  let certs = await getCerts(false);
  let jwk = (certs.keys || []).find((k) => k.kid === kid);
  if (jwk) return jwk;
  certs = await getCerts(true);
  return (certs.keys || []).find((k) => k.kid === kid) || null;
}

// Проверка JWT Cloudflare Access: подпись RS256 + издатель + получатель + срок.
// Основа перенесена из functions/fishok/api/board.js, добавлены обязательные
// проверки aud, exp и nbf (в исходнике их не было).
export async function verifyAccessJwt(jwt) {
  if (!jwt || jwt.split('.').length !== 3) return false;
  const [h, p, sig] = jwt.split('.');
  let header, payload;
  try { header = decodeSegment(h); payload = decodeSegment(p); } catch (e) { return false; }
  if (!header || !payload) return false;
  if (payload.iss !== `https://${TEAM_DOMAIN}`) return false;

  // Получатель: токен обязан быть выписан именно на приложение портала.
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(ACCESS_AUD)) return false;

  // Срок годности обязателен: токен без exp не принимается.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || now >= payload.exp + CLOCK_SKEW) return false;
  if (typeof payload.nbf === 'number' && now + CLOCK_SKEW < payload.nbf) return false;

  let jwk;
  try { jwk = await findKey(header.kid); } catch (e) { return false; }
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

// Вход из браузера Андрея: заголовок ставит сам Cloudflare Access.
export async function accessOk(request) {
  return await verifyAccessJwt(request.headers.get('Cf-Access-Jwt-Assertion'));
}

// Вход Клода с Мака: токен чтения, тот же, что у доски Fishok.
export function bearerOk(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  const tok = m ? m[1].trim() : '';
  return Boolean(env && env.BOARD_READ_TOKEN) && tok === env.BOARD_READ_TOKEN;
}

// Двойная авторизация: сначала дешевая проверка токена, потом подпись Access.
export async function authOk(request, env) {
  if (bearerOk(request, env)) return true;
  try {
    return await accessOk(request);
  } catch (e) {
    return false;
  }
}

export function isDate(s) {
  return typeof s === 'string' && DATE_RE.test(s);
}

// Настоящий календарный день, а не просто строка нужного вида:
// 2026-02-31 и 9999-99-99 проходят регулярку, но днями не являются.
export function isRealDate(s) {
  if (!isDate(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
}

// Расстояние в сутках между двумя календарными днями (a минус b).
export function dayGap(a, b) {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (isNaN(ta) || isNaN(tb)) return null;
  return Math.round((ta - tb) / 86400000);
}

// Полный вид ключа события: os:ev:<дата>:<мс>-<хвост>.
export const EVENT_KEY_RE = /^os:ev:(\d{4}-\d{2}-\d{2}):(\d{10,16})-([0-9a-z]{2,16})$/;

// Защита от чужой страницы, открытой в браузере Андрея с живой сессией Access.
// Заголовки Sec-Fetch-Site и Origin браузер ставит сам и подделать их со
// страницы нельзя. Не-браузерный клиент (curl с валидным токеном) не шлет ни
// того, ни другого и вектором подделки запроса не является.
export function sameOriginOk(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch (e) {
    return false;
  }
}

// Сегодняшняя дата по часам Андрея. При отсутствии данных о поясах берется Гринвич.
export function todayLocal() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const pick = (type) => {
      const found = parts.find((p) => p.type === type);
      return found ? found.value : null;
    };
    const y = pick('year'), m = pick('month'), d = pick('day');
    if (y && m && d) {
      const out = `${y}-${m}-${d}`;
      if (DATE_RE.test(out)) return out;
    }
  } catch (e) { /* пояса недоступны, падаем на Гринвич */ }
  return new Date().toISOString().slice(0, 10);
}

export function rnd() {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

// Ограничение длины строки. Возвращает null для не-строк.
export function cut(value, max) {
  if (typeof value !== 'string') return null;
  return value.length > max ? value.slice(0, max) : value;
}

// Постраничный обход KV: отдает имена ключей по префиксу.
// Предел в 50 страниц (до 50 000 ключей) стоит как страховка от вечного цикла.
export async function listKeys(kv, prefix) {
  const names = [];
  let cursor;
  for (let page = 0; page < 50; page++) {
    const res = await kv.list({ prefix, cursor, limit: 1000 });
    for (const k of (res.keys || [])) names.push(k.name);
    if (res.list_complete || !res.cursor) return names;
    cursor = res.cursor;
  }
  return names;
}

// Чтение записей событий пачками. Никогда не роняет функцию:
// если платформа обрывает по числу подзапросов, возвращает прочитанное с пометкой partial.
export async function readRecords(kv, names) {
  const events = [];
  let broken = 0;
  let partial = false;
  let reason = null;
  const CHUNK = 10;
  for (let i = 0; i < names.length; i += CHUNK) {
    const slice = names.slice(i, i + CHUNK);
    let raws;
    try {
      raws = await Promise.all(slice.map((n) => kv.get(n)));
    } catch (e) {
      partial = true;
      reason = String((e && e.message) || e);
      break;
    }
    for (let j = 0; j < slice.length; j++) {
      const raw = raws[j];
      if (!raw) { broken++; continue; }
      try {
        events.push(JSON.parse(raw));
      } catch (e) {
        broken++;
      }
    }
  }
  return { events, broken, partial, reason };
}
