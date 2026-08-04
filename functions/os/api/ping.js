// Диагностика: доступен ли KV-биндинг новым функциям /os/ и можно ли писать ключи os:*.
// GET  /os/api/ping           — статус биндинга (без секретов).
// GET  /os/api/ping?write=1   — пробная запись и чтение ключа os:ping.
// Ответ намеренно не содержит значений секретов.

export async function onRequestGet({ request, env }) {
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

  return new Response(JSON.stringify(out, null, 1), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
