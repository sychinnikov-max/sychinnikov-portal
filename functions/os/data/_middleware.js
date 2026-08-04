// Замок на /os/data/*.
//
// В репозитории нет файла _headers, значит зеркало sychinnikov-portal.pages.dev
// отдает статику кому угодно, а в os.json лежат остатки счетов, суммы офферов
// и имена людей. Этот посредник пропускает дальше только своих.
//
// Пускаем: подпись Cloudflare Access JWT (браузер Андрея на sychinnikov.com)
// ЛИБО Authorization: Bearer <BOARD_READ_TOKEN> (Клод через pages.dev).
// Всем остальным 401, статика при этом не отдается вообще.

import { json, authOk } from '../api/_shared.js';

export async function onRequest(context) {
  const { request, env } = context;

  let allowed = false;
  try {
    allowed = await authOk(request, env);
  } catch (e) {
    return json({ error: 'auth-failed', detail: String((e && e.message) || e) }, 500);
  }
  if (!allowed) {
    return json({ error: 'unauthorized', hint: 'вход через Cloudflare Access либо заголовок Authorization: Bearer' }, 401);
  }

  // Свой: отдаем статику как есть, только запрещаем кэш:
  // снимок дня меняется несколько раз в день, старый os.json хуже пустого.
  const res = await context.next();
  const emptyBody = res.status === 204 || res.status === 304;
  const out = new Response(emptyBody ? null : res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
