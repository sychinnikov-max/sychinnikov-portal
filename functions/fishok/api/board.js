// Cloudflare Pages Function — синхронизация доски задач Fishok через KV.
// Маршрут: /fishok/api/board
//   PUT (Authorization: Bearer <BOARD_WRITE_TOKEN>) — сохранить снимок доски в KV
//   GET (Authorization: Bearer <BOARD_READ_TOKEN>)  — отдать последний снимок (это делает Claude на /day-close)
//
// Разовая настройка в Cloudflare Dashboard (делает Андрей, у Claude нет доступа к аккаунту):
//   1. Workers & Pages → KV → Create namespace, напр. "fishok-board".
//   2. Pages проект (sychinnikov-portal) → Settings → Functions → KV namespace bindings:
//        Variable name: FISHOK_BOARD  →  выбрать созданный namespace.
//   3. Pages проект → Settings → Environment variables (Production и Preview):
//        BOARD_WRITE_TOKEN = <длинная случайная строка; попадет в клиентский JS доски>
//        BOARD_READ_TOKEN  = <другая длинная случайная строка; хранит только Claude локально>
//   4. В fishok/tasks/index.html выставить WRITE_TOKEN = значение BOARD_WRITE_TOKEN, задеплоить.
//
// Модель безопасности: URL публичный (noindex). В странице лежит только write-token
// (утечка = максимум кто-то перезапишет снимок, не утечка данных: Claude сверяет и версионирует,
// git = источник правды, localStorage браузера цел). Чтение данных закрыто отдельным read-token.

const KEY = 'latest';

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// PUT — доска мирроит снимок наверх
export async function onRequestPut(context) {
  const { request, env } = context;
  if (!env.FISHOK_BOARD) return json({ error: 'kv-not-bound' }, 500);
  if (!env.BOARD_WRITE_TOKEN || bearer(request) !== env.BOARD_WRITE_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }
  let payload;
  try { payload = await request.json(); } catch (e) { return json({ error: 'bad-json' }, 400); }
  const record = Object.assign({}, payload, { receivedAt: new Date().toISOString() });
  await env.FISHOK_BOARD.put(KEY, JSON.stringify(record));
  return json({ ok: true, receivedAt: record.receivedAt, cards: (payload.cards || []).length });
}

// GET — Claude тянет последний снимок
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.FISHOK_BOARD) return json({ error: 'kv-not-bound' }, 500);
  if (!env.BOARD_READ_TOKEN || bearer(request) !== env.BOARD_READ_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }
  const raw = await env.FISHOK_BOARD.get(KEY);
  if (!raw) return json({ error: 'empty', cards: [] }, 404);
  return new Response(raw, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
