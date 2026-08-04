// Снимок дня для портала /os/ — хранится в KV, а НЕ в репозитории.
//
// Причина: репозиторий портала sychinnikov-max/sychinnikov-portal публичный на GitHub
// (проверено 04.08.2026: private=false, raw.githubusercontent отдаёт файлы анонимно).
// В снимке лежат остатки счетов, суммы офферов и имена людей — такому файлу
// в открытом репозитории не место, даже если HTTP-путь закрыт Access.
// Поэтому build_os.py публикует снимок сюда, а страница читает его отсюда.
//
//   PUT /os/api/data          — публикация снимка. Только Bearer BOARD_READ_TOKEN
//                               (ходит build_os.py с Мака, через pages.dev вне гейта).
//                               Тело: сам объект снимка. Параметр ?d=ГГГГ-ММ-ДД — архив дня.
//   GET /os/api/data          — чтение снимка. Access JWT (браузер) ИЛИ Bearer (Клод).
//                               Параметр ?d=ГГГГ-ММ-ДД — архивный день.
//
// Ключи KV: os:data:latest и os:data:day:<ГГГГ-ММ-ДД>.

import { json, authOk, bearerOk, isRealDate, cut } from './_shared.js';

const KEY_LATEST = 'os:data:latest';
const KEY_DAY = 'os:data:day:';
// Снимок за день небольшой (десятки килобайт). Потолок защищает от случайной заливки мусора.
const MAX_BYTES = 512 * 1024;
// Архивы дней держим год, этого достаточно для стрелок по дням.
const DAY_TTL = 60 * 60 * 24 * 365;

function keyFor(url) {
  const d = url.searchParams.get('d');
  if (!d) return { key: KEY_LATEST, date: null };
  if (!isRealDate(d)) return { error: 'дата должна быть настоящим днём в виде ГГГГ-ММ-ДД' };
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
        ? 'за этот день снимок не сохранялся: день не открывался'
        : 'запусти build_os.py на Маке — он публикует снимок',
    }, 404);
  }

  return new Response(raw, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPut({ request, env }) {
  if (!env.FISHOK_BOARD) return json({ error: 'хранилище не подключено' }, 500);
  // Публикует только генератор с Мака: сессия браузера сюда писать не должна.
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
    return json({ error: 'в снимке нет поля date, это не снимок дня' }, 400);
  }

  const options = target.date ? { expirationTtl: DAY_TTL } : {};
  await env.FISHOK_BOARD.put(target.key, body, options);

  // Свежий снимок всегда доступен и как архив своего дня: тогда стрелки по дням
  // работают без отдельного запуска генератора с ключом заморозки.
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
