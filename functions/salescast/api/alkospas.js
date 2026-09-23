// Снимок кабины управленца по проекту АЛКОСПАС (Salescast). Хранится в KV, а НЕ в репозитории.
//
// Причина та же, что у /os/: репозиторий портала публичный на GitHub, а в снимке имена
// команды, название клиента, статусы работ и сроки. Такому файлу в открытом репозитории
// не место, даже если HTTP-путь закрыт Access. Генератор .scripts/salescast-dashboard/build.py
// публикует снимок сюда, страница /salescast/alkospas/ читает его отсюда.
//
//   PUT /salescast/api/alkospas   публикация снимка. Только Bearer BOARD_READ_TOKEN
//                                 (ходит build.py с Мака, через pages.dev вне гейта).
//                                 Параметр ?d=ГГГГ-ММ-ДД кладет архив дня.
//   GET /salescast/api/alkospas   чтение. Access JWT (браузер) ИЛИ Bearer (Клод).
//                                 Параметр ?d=ГГГГ-ММ-ДД отдает архивный день.
//
// Ключи KV: sc:alkospas:latest и sc:alkospas:day:<ГГГГ-ММ-ДД>.
// Механика скопирована из functions/os/api/data.js, отличаются только ключи.

import { json, authOk, bearerOk, isRealDate, cut } from '../../os/api/_shared.js';

const KEY_LATEST = 'sc:alkospas:latest';
const KEY_DAY = 'sc:alkospas:day:';
const MAX_BYTES = 1024 * 1024;
const DAY_TTL = 60 * 60 * 24 * 365;

function keyFor(url) {
  const d = url.searchParams.get('d');
  if (!d) return { key: KEY_LATEST, date: null };
  if (!isRealDate(d)) return { error: 'дата должна быть настоящим днем в виде ГГГГ-ММ-ДД' };
  return { key: KEY_DAY + d, date: d };
}

export async function onRequestGet({ request, env }) {
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);
  if (!(await authOk(request, env))) {
    return json({ error: 'нет доступа', hint: 'вход через Cloudflare Access либо Authorization: Bearer' }, 401);
  }

  const url = new URL(request.url);
  const target = keyFor(url);
  if (target.error) return json({ error: target.error }, 400);

  const raw = await env.FISHOK_BOARD.get(target.key);
  if (!raw) {
    return json({
      error: 'снимок не опубликован',
      key: target.key,
      hint: target.date
        ? 'за этот день снимок не сохранялся'
        : 'запусти .scripts/salescast-dashboard/build.py на Маке, он публикует снимок',
    }, 404);
  }

  return new Response(raw, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPut({ request, env }) {
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);
  if (!bearerOk(request, env)) {
    return json({ error: 'нет доступа', hint: 'публикация снимка только по Authorization: Bearer' }, 401);
  }

  const url = new URL(request.url);
  const target = keyFor(url);
  if (target.error) return json({ error: target.error }, 400);

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
  if (!parsed || typeof parsed !== 'object' || !parsed.date) {
    return json({ error: 'в снимке нет поля date, это не снимок' }, 400);
  }

  const options = target.date ? { expirationTtl: DAY_TTL } : {};
  await env.FISHOK_BOARD.put(target.key, body, options);
  if (!target.date && isRealDate(parsed.date)) {
    await env.FISHOK_BOARD.put(KEY_DAY + parsed.date, body, { expirationTtl: DAY_TTL });
  }

  return json({
    ok: true,
    key: target.key,
    date: cut(String(parsed.date), 10),
    bytes: body.length,
    published_at: new Date().toISOString(),
  });
}
