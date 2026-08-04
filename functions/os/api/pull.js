// Забор накопленного ввода Клодом.
//
//   GET  /os/api/pull                            отдает все события после курсора плюс сам курсор и заявку.
//   POST /os/api/pull  { "ack_until": "<ключ>" }  двигает курсор и удаляет подтвержденные ключи.
//   POST /os/api/pull  { "reset_cursor": true }   аварийно стирает курсор, ключи событий не трогает.
//
// Идет через pages.dev, то есть вне гейта Cloudflare Access, поэтому вход только
// по токену: Authorization: Bearer <BOARD_READ_TOKEN>.
//
// Порядок разбора на day-close: GET, применение событий к файлам системы,
// копия событий в os-events/ГГГГ-ММ-ДД.json, и только потом POST с ack_until.
// Пока ack не пришел, события никуда не деваются: повторный GET отдаст их снова.

import {
  json, bearerOk, cut, listKeys, readRecords, todayLocal, dayGap, EVENT_KEY_RE,
  KEY_EVENT_PREFIX, KEY_CURSOR, KEY_REQUEST,
} from './_shared.js';

// Потолок за один заход. Остаток заберется следующим GET после ack.
const MAX_READ = 500;
const EMPTY_CURSOR = { applied_until: '', applied_at: null, by: null };

async function readCursor(kv) {
  const raw = await kv.get(KEY_CURSOR);
  if (!raw) return Object.assign({}, EMPTY_CURSOR);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return Object.assign({}, EMPTY_CURSOR, parsed);
    }
  } catch (e) { /* курсор битый, считаем, что разбора не было */ }
  return Object.assign({}, EMPTY_CURSOR);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    if (!env.FISHOK_BOARD) return json({ error: 'kv-not-bound' }, 500);
    if (!bearerOk(request, env)) return json({ error: 'unauthorized' }, 401);

    const cursor = await readCursor(env.FISHOK_BOARD);

    let names;
    try {
      names = await listKeys(env.FISHOK_BOARD, KEY_EVENT_PREFIX);
    } catch (e) {
      return json({ error: 'kv-list-failed', detail: String((e && e.message) || e) }, 502);
    }
    names.sort();

    // Ключ вида os:ev:<дата>:<мс>-<хвост> сортируется как время, поэтому
    // сравнение строк с курсором дает ровно «все, что позже разобранного».
    const fresh = cursor.applied_until
      ? names.filter((n) => n > cursor.applied_until)
      : names;

    // Берем самые старые: ack должен двигаться по порядку, без дыр.
    const overflow = fresh.length > MAX_READ;
    const wanted = overflow ? fresh.slice(0, MAX_READ) : fresh;

    const read = await readRecords(env.FISHOK_BOARD, wanted);
    read.events.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

    let requestRaw = null;
    try { requestRaw = await env.FISHOK_BOARD.get(KEY_REQUEST); } catch (e) { requestRaw = null; }
    let requestParsed = null;
    if (requestRaw) {
      try { requestParsed = JSON.parse(requestRaw); } catch (e) { requestParsed = { kind: null, error: 'битая заявка' }; }
    }

    // last_key считается по реально отданным событиям: подтверждать можно
    // только то, что Клод увидел своими глазами.
    const lastKey = read.events.length
      ? read.events[read.events.length - 1].id
      : (cursor.applied_until || null);

    return json({
      ok: true,
      cursor,
      request: requestParsed,
      keys_total: names.length,
      pending_total: fresh.length,
      count: read.events.length,
      broken: read.broken,
      partial: read.partial || overflow,
      partial_reason: read.partial ? read.reason : (overflow ? `отдано первые ${MAX_READ} из ${fresh.length}` : null),
      last_key: lastKey,
      events: read.events,
    }, 200, 1);
  } catch (e) {
    return json({ error: 'internal', detail: String((e && e.message) || e) }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.FISHOK_BOARD) return json({ error: 'kv-not-bound' }, 500);
    if (!bearerOk(request, env)) return json({ error: 'unauthorized' }, 401);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad-json' }, 400); }

    // Аварийный выход: стереть курсор. Нужен, если курсор все-таки уехал вперед
    // и разбор перестал что-либо отдавать. Ключи событий при этом не трогаются.
    if (body && body.reset_cursor === true) {
      const was = await readCursor(env.FISHOK_BOARD);
      await env.FISHOK_BOARD.delete(KEY_CURSOR);
      return json({ ok: true, reset: true, was, cursor: Object.assign({}, EMPTY_CURSOR) }, 200, 1);
    }

    const ack = body && typeof body.ack_until === 'string' ? body.ack_until.trim() : '';
    if (!ack) return json({ error: 'no-ack', hint: 'нужно тело {"ack_until":"<ключ последнего разобранного события>"}' }, 400);

    // Подтверждение удаляет ВСЕ ключи не выше названного, поэтому обрезок вроде
    // os:ev:9 стер бы очередь целиком и загнал курсор выше любого будущего дня.
    const parts = EVENT_KEY_RE.exec(ack);
    if (!parts) {
      return json({
        error: 'bad-ack',
        hint: `ключ обязан иметь вид ${KEY_EVENT_PREFIX}ГГГГ-ММ-ДД:<мс>-<хвост>, возьми last_key из ответа GET`,
      }, 400);
    }
    const gap = dayGap(parts[1], todayLocal());
    if (gap === null || gap > 0) {
      return json({ error: 'bad-ack-date', hint: 'дата в ключе позже сегодняшней: такой ключ подтверждать нечем' }, 400);
    }

    let names;
    try {
      names = await listKeys(env.FISHOK_BOARD, KEY_EVENT_PREFIX);
    } catch (e) {
      return json({ error: 'kv-list-failed', detail: String((e && e.message) || e) }, 502);
    }
    if (names.indexOf(ack) === -1) {
      return json({
        error: 'ack-not-found',
        hint: 'такого ключа в KV нет: подтверждать можно только ключ из ответа GET (поле last_key)',
      }, 400);
    }
    const doomed = names.filter((n) => n <= ack);

    let deleted = 0;
    let partial = false;
    let reason = null;
    const CHUNK = 10;
    for (let i = 0; i < doomed.length; i += CHUNK) {
      const slice = doomed.slice(i, i + CHUNK);
      try {
        await Promise.all(slice.map((n) => env.FISHOK_BOARD.delete(n)));
        deleted += slice.length;
      } catch (e) {
        partial = true;
        reason = String((e && e.message) || e);
        break;
      }
    }

    // Курсор двигается в любом случае: неудаленные ключи отсеет то же сравнение
    // на следующем GET, а сами они уйдут по сроку жизни. Двойного разбора не будет.
    const cursor = {
      applied_until: ack,
      applied_at: new Date().toISOString(),
      by: cut(body.by, 64) || 'day-close',
    };
    await env.FISHOK_BOARD.put(KEY_CURSOR, JSON.stringify(cursor));

    // Заявка снимается: ритуал, ради которого ее клали, только что разобран.
    try { await env.FISHOK_BOARD.delete(KEY_REQUEST); } catch (e) { /* не критично */ }

    return json({
      ok: true,
      deleted,
      requested_delete: doomed.length,
      partial,
      partial_reason: reason,
      cursor,
    }, 200, 1);
  } catch (e) {
    return json({ error: 'internal', detail: String((e && e.message) || e) }, 500);
  }
}
