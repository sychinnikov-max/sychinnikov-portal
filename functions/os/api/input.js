// Прием ввода с портала /os/.
//
//   PUT  /os/api/input   тело: { "events": [ {...}, ... ] }
//
// Только PUT: он требует предварительного запроса CORS, поэтому чужая страница
// с живой сессией Access записать событие не может. Дополнительно сверяется
// источник запроса (Sec-Fetch-Site и Origin).
//
// Авторизация: подпись Cloudflare Access JWT. Заголовок Cf-Access-Jwt-Assertion
// ставит сам Cloudflare, потому что путь /os/* закрыт приложением Access.
// Секрета в клиентском коде нет. Запрос с pages.dev (вне гейта) валидного JWT
// не имеет и получает 401.
//
// Одно событие, один ключ KV: os:ev:<дата>:<мс>-<порядок в пачке><случайный хвост>.
// Никакого чтения-изменения-записи: два быстрых нажатия и два устройства
// не затирают друг друга.

import {
  json, accessOk, sameOriginOk, isRealDate, dayGap, todayLocal, rnd, cut,
  KEY_EVENT_PREFIX, KEY_REQUEST,
} from './_shared.js';

// Белый список видов события (раздел 6.4 спецификации).
const KINDS = new Set([
  'main.done',
  'move.done',
  'move.postpone',
  'air.answered',
  'day.close',
  'note',
  'question.answer',
  'request',
  'debt.dismiss',
]);

// Виды, у которых событие без ссылки на объект бессмысленно.
const KINDS_NEED_REF = new Set([
  'main.done', 'move.done', 'move.postpone', 'air.answered', 'question.answer', 'debt.dismiss',
]);

// Виды, у которых событие без текста бессмысленно.
const KINDS_NEED_TEXT = new Set(['note', 'question.answer']);

const AIR_VALUES = new Set(['yes', 'no', 'reminded']);
const MARKERS = ['energy', 'p1', 'money'];

const MAX_EVENTS = 50;
const MAX_TEXT = 4000;
const MAX_REF = 200;
// Срок жизни 120 дней: события переезжают в файлы системы, KV не архив.
const TTL_SECONDS = 60 * 60 * 24 * 120;

// Приведение значения к виду, который Клод сможет применить без догадок.
// Правило: чинить очевидное, остальное пропускать как есть, ничего не выдумывать.
function normalizeValue(kind, value) {
  if (kind === 'main.done') {
    if (value === true || value === 'true' || value === 'yes') return true;
    if (value === false || value === 'false' || value === 'no') return false;
    return value === undefined ? null : value;
  }
  if (kind === 'move.postpone') {
    return typeof value === 'string' && value ? value : 'tomorrow';
  }
  if (kind === 'air.answered') {
    if (typeof value === 'string' && AIR_VALUES.has(value.toLowerCase())) return value.toLowerCase();
    return value === undefined ? null : value;
  }
  if (kind === 'day.close') {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const out = {};
      for (const name of MARKERS) {
        const raw = Number(value[name]);
        if (Number.isFinite(raw)) out[name] = Math.min(5, Math.max(1, Math.round(raw)));
      }
      return out;
    }
    return value === undefined ? null : value;
  }
  if (kind === 'request') {
    return cut(typeof value === 'string' ? value : '', 64) || null;
  }
  return value === undefined ? null : value;
}

// Дата события решает, в какой ключ оно ляжет, а ключ это единственный механизм
// курсора разбора. Поэтому дату с клиента принимаем только если она настоящая и
// отстоит от сегодняшней не больше чем на сутки в любую сторону: телефон со
// сбитыми часами иначе загнал бы курсор в будущее и навсегда обнулил разбор.
function safeDate(raw) {
  const today = todayLocal();
  if (!isRealDate(raw)) return { date: today, client_date: raw === undefined ? null : raw };
  const gap = dayGap(raw, today);
  if (gap === null || gap > 1 || gap < -1) return { date: today, client_date: raw };
  return { date: raw, client_date: null };
}

// Разбор одного события. Возвращает либо запись для KV, либо причину отказа.
function normalizeEvent(ev, nowIso) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) return { reason: 'не объект' };
  if (!KINDS.has(ev.kind)) return { reason: 'неизвестный вид: ' + String(ev.kind) };

  const ref = cut(ev.ref, MAX_REF);
  if (KINDS_NEED_REF.has(ev.kind) && !ref) return { reason: 'нет ссылки на объект' };

  const rawText = typeof ev.text === 'string' ? ev.text : null;
  const text = rawText === null ? null : cut(rawText, MAX_TEXT);
  if (KINDS_NEED_TEXT.has(ev.kind) && (!text || !text.trim())) return { reason: 'пустой текст' };

  const value = normalizeValue(ev.kind, ev.value);
  if (ev.kind === 'request' && !value) return { reason: 'заявка без имени ритуала' };

  const stamped = safeDate(ev.date);

  const record = {
    id: null, // проставляется ключом KV ниже
    client_id: cut(ev.id, 64),
    ts: cut(ev.ts, 40) || nowIso,
    date: stamped.date,
    kind: ev.kind,
    ref: ref,
    value: value,
    text: text,
    ua: cut(ev.ua, 40),
    received_at: nowIso,
  };
  // Честная пометка обрезки: Клод увидит, что текст пришел длиннее лимита.
  if (rawText !== null && text !== null && rawText.length > text.length) record.truncated = true;
  // Дату с клиента не выбрасываем молча: видно, что часы устройства врут.
  if (stamped.client_date !== null) record.client_date = cut(String(stamped.client_date), 40);

  return { record };
}

async function handleWrite(context) {
  const { request, env } = context;
  try {
    if (!env.FISHOK_BOARD) return json({ error: 'kv-not-bound' }, 500);

    if (!(await accessOk(request))) return json({ error: 'unauthorized' }, 401);

    // Сессия Access живет в куке, поэтому чужая страница, открытая в том же
    // браузере, могла бы писать события от имени Андрея. Отсекаем по источнику.
    if (!sameOriginOk(request)) return json({ error: 'foreign-origin' }, 403);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad-json' }, 400); }

    const events = Array.isArray(body && body.events) ? body.events : [];
    if (!events.length) return json({ error: 'no-events' }, 400);
    if (events.length > MAX_EVENTS) return json({ error: 'too-many', limit: MAX_EVENTS }, 400);

    const nowIso = new Date().toISOString();
    const written = [];
    const accepted = [];   // client_id событий, которые в KV легли
    const skipped = [];    // отбиты разбором: повторять бессмысленно
    const retry = [];      // запись в KV не прошла: повторить обязательно
    const taken = new Set();
    let requestKind = null;

    for (let i = 0; i < events.length; i++) {
      const clientId = events[i] && typeof events[i] === 'object'
        ? cut(events[i].id, 64) : null;
      const parsed = normalizeEvent(events[i], nowIso);
      if (!parsed.record) {
        skipped.push({ index: i, client_id: clientId, reason: parsed.reason });
        continue;
      }
      const record = parsed.record;

      // Ключ: os:ev:<дата>:<мс>-<два символа порядка><четыре случайных>.
      // Порядковый номер внутри пачки нужен потому, что вся пачка обычно
      // ложится в одну миллисекунду: без него события вернулись бы в порядке
      // случайного хвоста, а не в порядке нажатий.
      // Саму миллисекунду не подкручиваем: ключ, забежавший вперед реального
      // времени, ушел бы ниже курсора при ближайшем ack и пропал бы из разбора.
      const seq = i.toString(36).padStart(2, '0');
      let key = '';
      for (let attempt = 0; attempt < 8; attempt++) {
        key = `${KEY_EVENT_PREFIX}${record.date}:${Date.now()}-${seq}${rnd()}`;
        if (!taken.has(key)) break;
      }
      if (taken.has(key)) {
        retry.push({ index: i, client_id: clientId, reason: 'не удалось выдать уникальный ключ' });
        continue;
      }
      taken.add(key);
      record.id = key;

      try {
        await env.FISHOK_BOARD.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
      } catch (e) {
        // Сбой хранилища, а не ошибка ввода: событие обязано остаться в очереди
        // браузера и уехать следующей попыткой, иначе нажатие исчезает молча.
        retry.push({ index: i, client_id: clientId, reason: 'запись в KV не прошла: ' + String((e && e.message) || e) });
        continue;
      }

      // Заявка на ритуал дублируется отдельным ключом, чтобы Клод видел ее
      // одним чтением в начале сессии, не разбирая всю пачку событий.
      if (record.kind === 'request') {
        try {
          await env.FISHOK_BOARD.put(KEY_REQUEST, JSON.stringify({ kind: record.value, at: record.ts }));
          requestKind = record.value;
        } catch (e) { /* само событие уже записано, заявка не критична */ }
      }

      written.push(key);
      if (clientId) accepted.push(clientId);
    }

    // Очередь браузера чистится по спискам accepted и skipped, а не по длине
    // пачки. Если хоть одна запись не прошла, ответ 503: клиент повторит
    // остаток, ничего не потеряв и ничего не задвоив.
    return json({
      ok: retry.length === 0,
      count: written.length,
      keys: written,
      accepted,
      skipped,
      retry,
      request: requestKind,
      received_at: nowIso,
    }, retry.length ? 503 : 200);
  } catch (e) {
    return json({ error: 'internal', detail: String((e && e.message) || e) }, 500);
  }
}

// Только PUT. Метод POST не экспортируется намеренно: простой POST уходит из
// чужой страницы без предварительного запроса CORS, а браузер Андрея шлет PUT.
export const onRequestPut = handleWrite;
