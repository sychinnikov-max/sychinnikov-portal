// Карта разведки Founder Finance — комнаты, люди, связи. Хранится в KV, НЕ в репозитории.
//
// Причина та же, что у снимка дня /os/api/data: репозиторий портала публичный на
// GitHub, а здесь имена, телеграм-ники и дословные цитаты живых людей из закрытых
// чатов сообщества. Такому файлу в открытом репозитории не место, даже если
// HTTP-путь закрыт Cloudflare Access.
//
//   PUT /founder-finance/api/scout    — публикация карты. Только Bearer BOARD_READ_TOKEN
//                                       (ходит publish.py с Мака через pages.dev, вне гейта).
//   GET /founder-finance/api/scout    — чтение. Access JWT (браузер) ИЛИ Bearer (Клод).
//
// Ключ KV: ff:scout:latest.

import { json, authOk, bearerOk } from '../../os/api/_shared.js';

const KEY = 'ff:scout:latest';
// Карта за две недели весит сотни килобайт: людей около шестисот, у каждого
// цитаты. Потолок держим с запасом, но не бесконечным — от заливки мусора.
const MAX_BYTES = 4 * 1024 * 1024;

export async function onRequestGet({ request, env }) {
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);
  if (!(await authOk(request, env))) {
    return json({ error: 'нет доступа', hint: 'вход через Cloudflare Access либо Authorization: Bearer' }, 401);
  }

  const raw = await env.FISHOK_BOARD.get(KEY);
  if (!raw) {
    return json({
      error: 'карта не опубликована',
      hint: 'запусти .scripts/telegram-scout/run.sh на Маке — он собирает и публикует карту',
    }, 404);
  }

  return new Response(raw, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPut({ request, env }) {
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);
  // Публикует только сборщик с Мака: сессия браузера сюда писать не должна.
  if (!bearerOk(request, env)) {
    return json({ error: 'нет доступа', hint: 'публикация только по Authorization: Bearer' }, 401);
  }

  let body;
  try {
    body = await request.text();
  } catch (e) {
    return json({ error: 'тело не прочиталось' }, 400);
  }
  if (!body || body.length > MAX_BYTES) {
    return json({ error: 'пустое или слишком большое тело', max_bytes: MAX_BYTES, got: body ? body.length : 0 }, 400);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return json({ error: 'тело не является корректным JSON' }, 400);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.people) || !Array.isArray(parsed.rooms)) {
    return json({ error: 'в теле нет массивов people и rooms, это не карта разведки' }, 400);
  }

  await env.FISHOK_BOARD.put(KEY, body);

  return json({
    ok: true,
    key: KEY,
    rooms: parsed.rooms.length,
    people: parsed.people.length,
    bytes: body.length,
    published_at: new Date().toISOString(),
  });
}
