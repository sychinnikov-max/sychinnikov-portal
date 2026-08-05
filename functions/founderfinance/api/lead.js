// Прием заявок с лендингов Founder Finance.
//
// Зачем эта функция вообще появилась (01.08.2026):
// заявка с калькулятора уходила ТОЛЬКО письмом через Web3Forms на личную почту.
// Письмо утонуло в общей папке «Входящие» и было замечено через четыре дня.
// Один канал доставки без дубля это гарантированный пропуск лида.
//
//   POST /founderfinance/api/lead
//
// Функция раскладывает заявку по трем независимым каналам и переживает отказ
// любого из них:
//   1. Телеграм Андрею  — мгновенное уведомление (секреты TG_BOT_TOKEN, TG_CHAT_ID)
//   2. KV ff:lead:<...> — журнал заявок, чтобы лид существовал в системе, а не в почте
//   3. Web3Forms        — прежнее письмо, как запасной след
//
// Ответ 200, если сработал хотя бы один канал. Если не сработал ни один,
// возвращается 502: страница по этому коду шлет заявку напрямую в Web3Forms
// сама, как делала раньше.
//
// Путь лежит в публичном пространстве /founderfinance/, а не в /founder-finance/
// за Cloudflare Access: сюда ходят посторонние люди с лендинга, авторизации быть
// не может. Защита здесь другая: свой источник, потолок размера и потолок длины
// полей.
//
// Требуется на проекте Pages:
//   - KV-биндинг FISHOK_BOARD (уже есть)
//   - секреты TG_BOT_TOKEN и TG_CHAT_ID (без них канал 1 молча пропускается)
//   - переменная W3F_KEY (не обязательна, ключ Web3Forms и так публичен в HTML)
// Секретов в этом репозитории нет.

import { json, cut, rnd, sameOriginOk } from '../../os/api/_shared.js';

// Ключ Web3Forms лежит открытым текстом в разметке лендинга, поэтому секретом
// не является и держится здесь как запасное значение.
const DEFAULT_W3F_KEY = '24d71a36-877d-46e1-9956-566f0dbb8d50';
const W3F_URL = 'https://api.web3forms.com/submit';

// Колесо финздоровья присылает все 43 ответа простыней, поэтому потолок высокий.
const MAX_BODY = 32 * 1024;
const MAX_MESSAGE = 12000;
const MAX_SHORT = 300;

// Телеграм рвет сообщения длиннее 4096 символов.
const TG_LIMIT = 3900;

const KEY_PREFIX = 'ff:lead:';
// Журнал живет год: заявки нужны для истории воронки, а не вечно.
const TTL = 365 * 24 * 3600;

function shortenForTelegram(text) {
  if (text.length <= TG_LIMIT) return text;
  return text.slice(0, TG_LIMIT) + '\n\n[...обрезано, полный текст в письме и в журнале]';
}

async function toTelegram(env, lead) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return false;
  const lines = [
    '🔔 ЗАЯВКА С САЙТА',
    lead.subject || 'Founder Finance',
    lead.suspect ? '⚠️ адрес похож на опечатку, письмо может вернуться' : null,
    '',
    lead.message || '',
    '',
    'Страница: ' + (lead.page || 'неизвестна'),
    'Источник: ' + (lead.referrer || 'прямой заход'),
  ];
  if (lead.utm) lines.push('Метки: ' + lead.utm);
  if (lead.replyto) lines.push('Ответить: ' + lead.replyto);
  const text = lines.filter((l) => l !== null).join('\n');
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TG_CHAT_ID,
        text: shortenForTelegram(text),
        disable_web_page_preview: true,
      }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function toKv(env, lead) {
  if (!env.FISHOK_BOARD) return false;
  const key = KEY_PREFIX + lead.at + '-' + rnd();
  try {
    await env.FISHOK_BOARD.put(key, JSON.stringify(lead), { expirationTtl: TTL });
    return true;
  } catch (e) {
    return false;
  }
}

async function toMail(env, lead) {
  const accessKey = env.W3F_KEY || DEFAULT_W3F_KEY;
  // Источник и метки дописываются в тело письма: Web3Forms показывает только
  // те поля, что ему передали, а раньше про источник не знал вообще никто.
  const tail = [
    '',
    '---',
    lead.suspect ? 'ВНИМАНИЕ: адрес похож на опечатку, письмо может вернуться' : null,
    'Страница: ' + (lead.page || 'неизвестна'),
    'Источник: ' + (lead.referrer || 'прямой заход'),
    lead.utm ? 'Метки: ' + lead.utm : null,
    'IP: ' + (lead.ip || 'неизвестен') + (lead.country ? ' (' + lead.country + ')' : ''),
  ].filter(Boolean).join('\n');
  const body = {
    access_key: accessKey,
    subject: lead.subject || 'Заявка с сайта — Founder Finance',
    from_name: lead.from_name || 'Founder Finance',
    name: lead.name || 'Заявка с сайта',
    message: (lead.message || '') + '\n' + tail,
  };
  if (lead.replyto) body.replyto = lead.replyto;
  try {
    const r = await fetch(W3F_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOriginOk(request)) return json({ error: 'чужой источник' }, 403);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'слишком большая заявка' }, 413);

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return json({ error: 'не разобрал JSON' }, 400);
  }
  if (!data || typeof data !== 'object') return json({ error: 'пустая заявка' }, 400);

  // Ловушка для ботов: поле botcheck на странице скрыто, человек его не заполнит.
  // Отвечаем успехом, чтобы бот не искал обходной путь.
  if (data.botcheck) return json({ ok: true, skipped: 'бот' });

  const lead = {
    at: new Date().toISOString(),
    subject: cut(data.subject, MAX_SHORT),
    from_name: cut(data.from_name, MAX_SHORT),
    name: cut(data.name, MAX_SHORT),
    replyto: cut(data.replyto, MAX_SHORT),
    message: cut(data.message, MAX_MESSAGE),
    page: cut(data.page, MAX_SHORT),
    referrer: cut(data.referrer, MAX_SHORT),
    utm: cut(data.utm, MAX_SHORT),
    // Страница помечает адреса, в имени которых сидит чужой домен: почти всегда описка.
    suspect: Boolean(data.suspect),
    ip: request.headers.get('CF-Connecting-IP') || null,
    country: (request.cf && request.cf.country) || null,
  };
  if (!lead.message && !lead.replyto) return json({ error: 'заявка без содержимого' }, 400);

  // Каналы независимы: падение одного не должно уносить остальные.
  const [tg, kv, mail] = await Promise.all([
    toTelegram(env, lead),
    toKv(env, lead),
    toMail(env, lead),
  ]);

  if (!tg && !kv && !mail) {
    // Ни один канал не принял заявку. Клиенту сообщаем честно, он отправит сам.
    return json({ ok: false, error: 'ни один канал не принял заявку', tg, kv, mail }, 502);
  }
  return json({ ok: true, tg, kv, mail });
}

// Журнал заявок для Клода с Мака. Открытым его оставлять нельзя: внутри почты
// живых людей. Читается тем же токеном, что доска Fishok.
export async function onRequestGet({ request, env }) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  const tok = m ? m[1].trim() : '';
  if (!env.BOARD_READ_TOKEN || tok !== env.BOARD_READ_TOKEN) {
    return json({ error: 'нет доступа' }, 401);
  }
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);

  const list = await env.FISHOK_BOARD.list({ prefix: KEY_PREFIX, limit: 200 });
  const names = (list.keys || []).map((k) => k.name).sort().reverse();
  const leads = [];
  for (const name of names.slice(0, 100)) {
    const value = await env.FISHOK_BOARD.get(name);
    if (!value) continue;
    try {
      leads.push(JSON.parse(value));
    } catch (e) { /* битую запись пропускаем */ }
  }
  return json({ count: leads.length, leads }, 200, 1);
}
