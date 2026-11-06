// Отметки скаута: кому написали, кто ответил, кто «не то». Хранится в KV, НЕ в репозитории.
//
// Зачем (06.11.2026). Андрей нажимает «Отправить» у человека в скауте, и
// сообщение должно уйти из Telegram само. Отправляет Мак (сессия аккаунта Work
// живет только там), поэтому страница не шлет сама, а ставит заявку сюда.
// Скрипт .scripts/telegram-scout/send.py раз в минуту забирает заявки,
// отправляет и пишет статус обратно. Страница видит статус и показывает
// «Отправлено».
//
// ОДНА ЗАПИСЬ KV НА ЧЕЛОВЕКА: ff:scout:o:<id>. Первая версия держала все
// отметки одним документом, и в первый же час он поломался: Андрей ставил
// людей в очередь пачкой, браузер читал документ чуть устаревшим (KV читается
// с задержкой) и записывал его целиком поверх отчета Мака. «Отправлено»
// откатывалось в «в очереди», Мак брал человека второй раз. Дубля не случилось
// только потому, что send.py проверяет переписку перед отправкой. Теперь
// браузер и Мак пишут каждый в запись своего человека и друг друга не затирают.
//
//   GET  /founder-finance/api/scout-outreach  — все отметки {items: {id: item}}. Access JWT или Bearer.
//   POST /founder-finance/api/scout-outreach  — одно действие над одним человеком:
//        {id, action: 'send', text, name, username}   поставить в очередь (браузер)
//        {id, action: 'cancel'}                       снять из очереди, пока не ушло
//        {id, action: 'manual' | 'skip' | 'reset'}    «написал сам», «не то», сброс
//        {id, action: 'status', status, ...}          отчет отправщика (только Bearer)
//        {id, action: 'call' | 'lost' | 'takeover'}   «созвон назначен», «не интересно», «веду сам» (браузер)
//        {action: 'settings', autopilot: true|false}  выключатель автопилота диалогов
//
// Автопилот (06.11 вечером, просьба Андрея): когда человек ответил, send.py
// сам ведет разговор от имени Андрея до квалификации (не больше 3 реплик) и
// передает Андрею: статус handoff + уведомление в Telegram. Переписка лежит в
// поле dialog записи, чтобы Андрей видел на странице, что писал бот.

import { json, authOk, bearerOk } from '../../os/api/_shared.js';

const PREFIX = 'ff:scout:o:';
const OLD_KEY = 'ff:scout:outreach'; // документ первой версии, переносится при первом чтении
const SETTINGS = 'ff:scout:settings';
const MAX_ITEM = 24000;
const MAX_TEXT = 3000;

// Статусы, после которых повторная отправка запрещена: второе холодное
// сообщение тому же человеку выглядит как спам и бьет по аккаунту.
const FINAL = new Set(['sending', 'sent', 'replied', 'talking', 'handoff', 'call', 'lost', 'exists', 'closed']);
// queued — только пометка отправщика «лимит на сегодня, уйдет завтра».
const MAC_STATUSES = new Set(['queued', 'sending', 'sent', 'replied', 'talking', 'handoff', 'call', 'lost',
  'failed', 'closed', 'exists']);
// Поля, которые отправщик может писать в запись человека.
const MAC_FIELDS = ['sent_at', 'error', 'reply', 'reply_at', 'name', 'username', 'msg_id', 'bot_ids',
  'last_seen', 'turns', 'dialog', 'summary', 'qualified', 'track', 'reason', 'autopilot', 'handoff_at',
  'meet', 'call_slot', 'call_at'];

async function getSettings(env) {
  const raw = await env.FISHOK_BOARD.get(SETTINGS);
  try { return Object.assign({ autopilot: true }, raw ? JSON.parse(raw) : {}); } catch (e) { return { autopilot: true }; }
}

async function getItem(env, id) {
  const raw = await env.FISHOK_BOARD.get(PREFIX + id);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function putItem(env, id, item) {
  if (item) await env.FISHOK_BOARD.put(PREFIX + id, JSON.stringify(item));
  else await env.FISHOK_BOARD.delete(PREFIX + id);
}

async function migrateOld(env) {
  const raw = await env.FISHOK_BOARD.get(OLD_KEY);
  if (!raw) return;
  try {
    const doc = JSON.parse(raw);
    for (const [id, item] of Object.entries((doc && doc.items) || {})) {
      if (!(await env.FISHOK_BOARD.get(PREFIX + id))) await putItem(env, id, item);
    }
  } catch (e) { /* битый старый документ не мешает новому */ }
  await env.FISHOK_BOARD.delete(OLD_KEY);
}

async function loadAll(env) {
  await migrateOld(env);
  const ids = [];
  let cursor;
  do {
    const page = await env.FISHOK_BOARD.list({ prefix: PREFIX, cursor });
    for (const k of page.keys) ids.push(k.name.slice(PREFIX.length));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const items = {};
  const vals = await Promise.all(ids.map((id) => getItem(env, id)));
  ids.forEach((id, i) => { if (vals[i]) items[id] = vals[i]; });
  return items;
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max || 300) : null;
}

export async function onRequestGet({ request, env }) {
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);
  if (!(await authOk(request, env))) return json({ error: 'нет доступа' }, 401);
  return json({ items: await loadAll(env), settings: await getSettings(env), at: new Date().toISOString() });
}

export async function onRequestPost({ request, env }) {
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);
  if (!(await authOk(request, env))) return json({ error: 'нет доступа' }, 401);
  // Только JSON: чужая страница не может прислать такой запрос без
  // предварительной проверки CORS, значит, не отправит сообщение от имени Андрея.
  if (!/^application\/json/i.test(request.headers.get('Content-Type') || '')) {
    return json({ error: 'нужен Content-Type: application/json' }, 415);
  }

  let b;
  try {
    b = await request.json();
  } catch (e) {
    return json({ error: 'тело не JSON' }, 400);
  }
  if (b && b.action === 'settings') {
    const st = await getSettings(env);
    if (typeof b.autopilot === 'boolean') st.autopilot = b.autopilot;
    st.at = new Date().toISOString();
    await env.FISHOK_BOARD.put(SETTINGS, JSON.stringify(st));
    return json({ ok: true, settings: st });
  }
  const id = String((b && b.id) || '');
  if (!/^\d{1,20}$/.test(id)) return json({ error: 'нет id человека' }, 400);

  const cur = await getItem(env, id);
  const now = new Date().toISOString();
  const action = b.action;
  let next = cur;

  if (action === 'send') {
    if (cur && FINAL.has(cur.status)) return json({ error: 'этому человеку уже писали', item: cur }, 409);
    const text = str(b.text, MAX_TEXT);
    if (!text || text.trim().length < 20) return json({ error: 'пустой текст' }, 400);
    next = { status: 'queued', text, name: str(b.name, 120), username: str(b.username, 64), queued_at: now };
  } else if (action === 'cancel') {
    if (!cur || cur.status !== 'queued') return json({ error: 'отменить можно только до отправки', item: cur }, 409);
    next = null;
  } else if (action === 'manual' || action === 'skip') {
    if (cur && FINAL.has(cur.status)) return json({ error: 'уже отправлено', item: cur }, 409);
    next = { status: action, name: str(b.name, 120), username: str(b.username, 64), at: now };
  } else if (action === 'reset') {
    if (cur && FINAL.has(cur.status)) return json({ error: 'отправленное не сбрасывается', item: cur }, 409);
    next = null;
  } else if (action === 'call' || action === 'lost' || action === 'takeover') {
    // Итог разговора отмечает Андрей. «Веду сам» выключает автопилот у человека.
    if (!cur) return json({ error: 'этому человеку еще не писали' }, 404);
    next = Object.assign({}, cur, { at: now, autopilot: false });
    if (action === 'call') { next.status = 'call'; next.call_at = now; }
    if (action === 'lost') next.status = 'lost';
    if (action === 'takeover') { next.status = 'handoff'; next.reason = 'Андрей ведет сам'; next.handoff_at = now; }
  } else if (action === 'status') {
    // Статус доставки пишет только отправщик с Мака.
    if (!bearerOk(request, env)) return json({ error: 'статус пишет только отправщик' }, 401);
    if (!MAC_STATUSES.has(b.status)) return json({ error: 'неизвестный статус' }, 400);
    if (!cur && !b.text) return json({ error: 'нет заявки на этого человека' }, 404);
    next = Object.assign({}, cur || {}, { status: b.status, at: now });
    // Старая пометка («лимит на сегодня») не должна висеть у отправленного.
    if (b.status === 'sending' || b.status === 'sent' || b.status === 'replied') delete next.error;
    // Итог, который отметил Андрей (созвон, не интересно), отправщик не перетирает.
    if (cur && (cur.status === 'call' || cur.status === 'lost') && b.status !== 'lost' && b.status !== 'call') {
      next.status = cur.status;
    }
    if (b.status === 'call' && !next.call_at) next.call_at = now;
    for (const k of MAC_FIELDS) {
      if (!(k in b)) continue;
      const v = b[k];
      next[k] = typeof v === 'string' ? str(v, 2000) : v;
    }
    if (b.text) next.text = str(b.text, MAX_TEXT);
  } else {
    return json({ error: 'неизвестное действие' }, 400);
  }

  if (next && JSON.stringify(next).length > MAX_ITEM && Array.isArray(next.dialog)) {
    next.dialog = next.dialog.slice(-8);
  }
  await putItem(env, id, next);
  return json({ ok: true, item: next });
}
