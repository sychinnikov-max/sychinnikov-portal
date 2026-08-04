// Диагностика: доступен ли KV-биндинг новым функциям /os/ и можно ли писать ключи os:*.
// GET  /os/api/ping           — статус биндинга (без секретов).
// GET  /os/api/ping?write=1   — пробная запись и чтение ключа os:ping.
// Ответ намеренно не содержит значений секретов.
//
// Авторизация обязательна: подпись Cloudflare Access ЛИБО Bearer BOARD_READ_TOKEN.
// Причина: зеркало sychinnikov-portal.pages.dev стоит вне гейта Access, и без
// проверки в интернете висела анонимная запись в боевое хранилище (проверено
// живым запросом 04.08: ?write=1 без единого заголовка вернул write_test: ok).

import { json, authOk } from './_shared.js';

export async function onRequestGet({ request, env }) {
  let allowed = false;
  try {
    allowed = await authOk(request, env);
  } catch (e) {
    allowed = false;
  }
  if (!allowed) {
    return json({
      error: 'unauthorized',
      hint: 'вход через Cloudflare Access либо заголовок Authorization: Bearer',
    }, 401);
  }

  const url = new URL(request.url);
  const out = {
    ok: true,
    kv_binding_present: Boolean(env.FISHOK_BOARD),
    read_token_present: Boolean(env.BOARD_READ_TOKEN),
    access_jwt_present: Boolean(request.headers.get('Cf-Access-Jwt-Assertion')),
  };

  if (out.kv_binding_present && url.searchParams.get('write') === '1') {
    try {
      const stamp = new Date().toISOString();
      await env.FISHOK_BOARD.put('os:ping', JSON.stringify({ stamp, note: 'диагностика /os/' }));
      const back = await env.FISHOK_BOARD.get('os:ping');
      out.write_test = 'ok';
      out.read_back = JSON.parse(back);
    } catch (e) {
      out.write_test = 'ошибка: ' + String(e && e.message ? e.message : e);
    }
  }

  return json(out, 200, 1);
}
