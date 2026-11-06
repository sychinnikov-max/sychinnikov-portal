// Отметки скаута: кому написали, кто ответил, кто «не то». Хранится в KV, НЕ в репозитории.
//
// Зачем (06.11.2026). Андрей нажимает «Отправить» у человека в скауте, и
// сообщение должно уйти из Telegram само. Отправляет Мак (сессия аккаунта Work
// живет только там), поэтому страница не шлет сама, а ставит заявку сюда.
// Скрипт .scripts/telegram-scout/send.py раз в минуту забирает заявки,
// отправляет и пишет статус обратно. Страница видит статус и показывает
// «Отправлено».
//
// Прежние пометки жили в localStorage браузера и не переезжали между
// телефоном и Маком. Теперь все отметки здесь, одна правда на все устройства.
//
//   GET  /founder-finance/api/scout-outreach  — все отметки. Access JWT или Bearer.
//   POST /founder-finance/api/scout-outreach  — одно действие над одним человеком:
//        {id, action: 'send', text, name, username}   поставить в очередь (браузер)
//        {id, action: 'cancel'}                       снять из очереди, пока не ушло
//        {id, action: 'manual' | 'skip' | 'reset'}    «написал сам», «не то», сброс
//        {id, action: 'status', status, ...}          отчет отправщика (только Bearer)
//
// Чтение-изменение-запись идет здесь, на сервере, по одному человеку за раз:
// браузер и Мак никогда не перезаписывают документ целиком и не затирают
// отметки друг друга.
//
// Ключ KV: ff:scout:outreach.

import { json, authOk, bearerOk } from '../../os/api/_shared.js';

const KEY = 'ff:scout:outreach';
const MAX_TEXT = 3000;
const MAX_ITEMS = 3000;

// Статусы, после которых повторная отправка запрещена: второе холодное
// сообщение тому же человеку выглядит как спам и бьет по аккаунту.
const FINAL = new Set(['sending', 'sent', 'replied', 'exists', 'closed']);
// queued — только пометка отправщика «лимит на сегодня, уйдет завтра».
const MAC_STATUSES = new Set(['queued', 'sending', 'sent', 'replied', 'failed', 'closed', 'exists']);

async function load(env) {
  const raw = await env.FISHOK_BOARD.get(KEY);
  if (!raw) return { items: {} };
  try {
    const doc = JSON.parse(raw);
    return doc && typeof doc.items === 'object' ? doc : { items: {} };
  } catch (e) {
    return { items: {} };
  }
}

async function save(env, doc) {
  doc.updated_at = new Date().toISOString();
  await env.FISHOK_BOARD.put(KEY, JSON.stringify(doc));
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max || 300) : null;
}

export async function onRequestGet({ request, env }) {
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);
  if (!(await authOk(request, env))) return json({ error: 'нет доступа' }, 401);
  return json(await load(env));
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
  const id = String((b && b.id) || '');
  if (!/^\d{1,20}$/.test(id)) return json({ error: 'нет id человека' }, 400);

  const doc = await load(env);
  const cur = doc.items[id] || null;
  const now = new Date().toISOString();
  const action = b.action;

  if (action === 'send') {
    if (cur && FINAL.has(cur.status)) {
      return json({ error: 'этому человеку уже писали', item: cur }, 409);
    }
    const text = str(b.text, MAX_TEXT);
    if (!text || text.trim().length < 20) return json({ error: 'пустой текст' }, 400);
    if (Object.keys(doc.items).length >= MAX_ITEMS && !cur) return json({ error: 'переполнено' }, 400);
    doc.items[id] = {
      status: 'queued',
      text,
      name: str(b.name, 120),
      username: str(b.username, 64),
      queued_at: now,
    };
  } else if (action === 'cancel') {
    if (!cur || cur.status !== 'queued') return json({ error: 'отменить можно только до отправки', item: cur }, 409);
    delete doc.items[id];
  } else if (action === 'manual' || action === 'skip') {
    if (cur && FINAL.has(cur.status)) return json({ error: 'уже отправлено', item: cur }, 409);
    doc.items[id] = { status: action, name: str(b.name, 120), username: str(b.username, 64), at: now };
  } else if (action === 'reset') {
    if (cur && FINAL.has(cur.status)) return json({ error: 'отправленное не сбрасывается', item: cur }, 409);
    delete doc.items[id];
  } else if (action === 'status') {
    // Статус доставки пишет только отправщик с Мака.
    if (!bearerOk(request, env)) return json({ error: 'статус пишет только отправщик' }, 401);
    if (!MAC_STATUSES.has(b.status)) return json({ error: 'неизвестный статус' }, 400);
    if (!cur) return json({ error: 'нет заявки на этого человека' }, 404);
    const item = Object.assign({}, cur, { status: b.status, at: now });
    // Старая пометка («лимит на сегодня») не должна висеть у отправленного.
    if (b.status === 'sending' || b.status === 'sent' || b.status === 'replied') delete item.error;
    for (const k of ['sent_at', 'error', 'reply', 'reply_at']) {
      if (k in b) item[k] = str(b[k], 600);
    }
    doc.items[id] = item;
  } else {
    return json({ error: 'неизвестное действие' }, 400);
  }

  await save(env, doc);
  return json({ ok: true, item: doc.items[id] || null });
}
