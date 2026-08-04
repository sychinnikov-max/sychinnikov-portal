// Возврат событий дня обратно в браузер.
//
//   GET /os/api/state?d=ГГГГ-ММ-ДД
//
// Зачем: отметка должна пережить перезагрузку страницы и смену устройства.
// Экран грузит снимок /os/data/os.json, поверх накладывает эти события
// по правилу «последнее по ts на один ref побеждает» и только потом рисует.
//
// Двойная авторизация: подпись Cloudflare Access JWT (браузер Андрея)
// ЛИБО Authorization: Bearer <BOARD_READ_TOKEN> (Клод через pages.dev).

import {
  json, authOk, isDate, todayLocal, listKeys, readRecords,
  KEY_EVENT_PREFIX,
} from './_shared.js';

// Потолок чтения за один запрос. День с таким числом отметок невозможен,
// потолок стоит только чтобы функция не уперлась в лимит подзапросов молча.
const MAX_READ = 400;

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    if (!env.FISHOK_BOARD) return json({ error: 'kv-not-bound' }, 500);
    if (!(await authOk(request, env))) return json({ error: 'unauthorized' }, 401);

    const url = new URL(request.url);
    const asked = url.searchParams.get('d');
    if (asked !== null && !isDate(asked)) {
      return json({ error: 'bad-date', hint: 'ожидается d=ГГГГ-ММ-ДД' }, 400);
    }
    const date = asked || todayLocal();

    // Ключи одного дня лежат под общим префиксом, поэтому лишнего не читаем.
    const prefix = `${KEY_EVENT_PREFIX}${date}:`;
    let names;
    try {
      names = await listKeys(env.FISHOK_BOARD, prefix);
    } catch (e) {
      return json({ error: 'kv-list-failed', detail: String((e && e.message) || e) }, 502);
    }
    names.sort();

    const overflow = names.length > MAX_READ;
    const wanted = overflow ? names.slice(names.length - MAX_READ) : names;

    const read = await readRecords(env.FISHOK_BOARD, wanted);
    // Порядок по ключу: ключ начинается с миллисекунд, значит это порядок нажатий.
    read.events.sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

    return json({
      ok: true,
      date,
      server_today: todayLocal(),
      keys_total: names.length,
      count: read.events.length,
      broken: read.broken,
      partial: read.partial || overflow,
      partial_reason: read.partial ? read.reason : (overflow ? `показаны последние ${MAX_READ}` : null),
      last_key: read.events.length ? read.events[read.events.length - 1].id : null,
      events: read.events,
    });
  } catch (e) {
    return json({ error: 'internal', detail: String((e && e.message) || e) }, 500);
  }
}
