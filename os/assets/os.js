/* Портал /os/ — главный экран «Сегодня».
   Один файл, без сборки и без зависимостей.
   Что делает: читает снимок дня из /os/api/data, накладывает поверх него события
   дня из /os/api/state, рисует блоки, копит исходящие события в очереди и шлет их
   НА КЛИК (а не на уходе со страницы: доска Fishok молчала 26 дней именно поэтому).

   Почему снимок берется из хранилища, а не файлом из репозитория: репозиторий
   портала публичный на GitHub, а в снимке остатки счетов, суммы офферов и имена
   людей. Файл в репозиторий не кладется вовсе, его публикует build_os.py в KV. */

const URL_DATA = '/os/api/data';
/* Запасной путь на случай, если снимок в хранилище еще не опубликован, а файл
   лежит локально (например при работе со стенда без сети). */
const URL_SNAPSHOT = '/os/data/os.json';
const URL_DAY = '/os/data/days/';
const URL_STATE = '/os/api/state';
const URL_INPUT = '/os/api/input';

const KEY_QUEUE = 'os.queue.v1';
const KEY_THEME = 'os.theme';

const CONTOURS = { ff: 'FF', fishok: 'Fishok', money: 'Деньги' };

/* Порядок блоков по режимам. Ничего не прячем, меняем только порядок и
   раскрытость блока «Закрыть день». */
const ORDER_DAY = ['b-frame', 'b-today', 'b-air', 'b-boards', 'b-mentor', 'b-close'];
const ORDER_EVENING = ['b-frame', 'b-close', 'b-today', 'b-air', 'b-boards', 'b-mentor'];

/* ──────────────────────────  мелкие помощники  ────────────────────────── */

function slot(name) {
  return document.querySelector('[data-slot="' + name + '"]');
}

function h(tag, attrs, kids) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const key in attrs) {
      const v = attrs[key];
      if (v === null || v === undefined || v === false) continue;
      if (key === 'class') node.className = v;
      else if (key === 'text') node.textContent = v;
      else if (key === 'html') node.innerHTML = v;
      else if (key.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(key.slice(2), v);
      else if (v === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(v));
    }
  }
  if (kids !== null && kids !== undefined) {
    const list = Array.isArray(kids) ? kids : [kids];
    for (const kid of list) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
    }
  }
  return node;
}

function fill(name, kids) {
  const box = slot(name);
  if (!box) return null;
  box.textContent = '';
  if (kids !== null && kids !== undefined) {
    const list = Array.isArray(kids) ? kids : [kids];
    for (const kid of list) {
      if (kid === null || kid === undefined || kid === false) continue;
      box.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
    }
  }
  return box;
}

/* Показать или спрятать узел. Атрибута hidden мало: любое display в os.css его перебьет,
   поэтому гасим еще и стилем, а возвращаем управление стилю пустой строкой. */
function show(node, visible) {
  if (!node) return;
  node.hidden = !visible;
  node.style.display = visible ? '' : 'none';
}

function pad(n) {
  return String(n).length < 2 ? '0' + n : String(n);
}

function ymd(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/* Метка времени с локальным сдвигом: в UTC писать нельзя, день начинается по Мадриду. */
function isoLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
}

function daysBetween(from, to) {
  if (!from || !to) return null;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function daysWord(n) {
  return n + ' ' + plural(n, ['день', 'дня', 'дней']);
}

function ddmm(s) {
  const d = parseYmd(s);
  return d ? pad(d.getDate()) + '.' + pad(d.getMonth() + 1) : String(s || '');
}

function hhmm(ts) {
  const d = ts ? new Date(ts) : null;
  return d && !isNaN(d.getTime()) ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '';
}

function weekday(d) {
  try {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(d);
  } catch (e) {
    return '';
  }
}

/* Возраст значения считается в браузере от as_of: протухнуть не может. */
function ageDays(asOf) {
  const d = parseYmd(asOf);
  return d ? daysBetween(d, new Date()) : null;
}

function ageText(asOf) {
  const n = ageDays(asOf);
  if (n === null) return null;
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'вчера';
  return daysWord(n) + ' назад';
}

function ageClass(n, warn, old) {
  if (n === null) return 'age--fresh';
  if (n >= old) return 'age--old';
  if (n >= warn) return 'age--warn';
  return 'age--fresh';
}

function contourTag(contour) {
  const label = CONTOURS[contour];
  if (!label) return null;
  return h('span', { class: 'tag tag--' + contour, text: label });
}

function unread(reason) {
  return h('div', { class: 'unread' }, [
    h('span', { class: 'unread__label', text: 'не прочитана' }),
    reason ? h('span', { class: 'unread__why', text: reason }) : null,
  ]);
}

function shiftDate(dateStr, delta) {
  const d = parseYmd(dateStr) || new Date();
  d.setDate(d.getDate() + delta);
  return ymd(d);
}

function uaTag() {
  const ua = String(navigator.userAgent || '');
  if (/iPhone/i.test(ua)) return 'iphone';
  if (/iPad/i.test(ua)) return 'ipad';
  if (/Android/i.test(ua)) return 'android';
  if (/Mac/i.test(ua)) return 'mac';
  return 'web';
}

/* ──────────────────────────  состояние экрана  ────────────────────────── */

const S = {
  date: ymd(new Date()),
  isToday: true,
  readonly: false,
  snap: null,
  snapError: null,
  emptyDay: false,
  events: [],
  byRef: new Map(),
  lastKind: new Map(),
  remind: new Map(),
  postpone: new Map(),
  stateError: null,
  statePartial: null,
  stateBroken: 0,
  serverCursor: null,
  mode: 'day',
  closeOpen: null,
  openCtx: new Set(),
  markersTouched: { energy: false, p1: false, money: false },
  markerVals: { energy: null, p1: null, money: null },
  closeDraft: { moved: null, seed: null },
  focusNext: null,
  notices: [],
};

/* ──────────────────────────  очередь и отправка  ────────────────────────── */

function queueRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_QUEUE) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function queueWrite(q) {
  try {
    localStorage.setItem(KEY_QUEUE, JSON.stringify(q));
  } catch (e) {
    /* переполнение хранилища: событие уже в памяти, отправка все равно попробует уйти */
  }
}

let toastTimer = null;

/* Тост виден только с классом is-on: в os.css у него нулевая прозрачность,
   иначе подтверждение отправки существует в разметке, но не на экране. */
function toast(message, isError) {
  const box = slot('toast');
  if (!box) return;
  box.textContent = message;
  box.classList.toggle('is-err', Boolean(isError));
  show(box, true);
  /* Класс ставим следующим кадром, чтобы сработал переход прозрачности. */
  requestAnimationFrame(function () { box.classList.add('is-on'); });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    box.classList.remove('is-on');
    show(box, false);
  }, 1800);
}

function emit(ev) {
  if (S.readonly) return null;
  const now = new Date();
  ev.id = String(now.getTime()) + '-' + Math.random().toString(36).slice(2, 6);
  ev.ts = isoLocal(now);
  ev.date = ev.date || S.date;
  ev.ua = uaTag();
  if (ev.ref === undefined) ev.ref = null;
  if (ev.value === undefined) ev.value = null;
  if (ev.text === undefined) ev.text = null;

  const q = queueRead();
  q.push(ev);
  queueWrite(q);

  const local = Object.assign({}, ev);
  local._local = true;
  S.events.push(local);
  recompute();

  flush();
  return ev;
}

let flushing = false;

/* Из очереди уходит ровно то, что сервер назвал по имени: принятые события и
   отбитые разбором (им повтор не поможет). Событие, у которого не прошла запись
   в хранилище, остается в очереди и уезжает следующей попыткой. */
function queueTrim(batch, data) {
  const drop = new Set();
  if (data && Array.isArray(data.accepted)) {
    data.accepted.forEach(function (id) { if (id) drop.add(String(id)); });
  }
  if (data && Array.isArray(data.skipped)) {
    data.skipped.forEach(function (item) {
      if (item && item.client_id) drop.add(String(item.client_id));
    });
  }
  if (!drop.size) {
    /* Ответ без поименного разбора: старое поведение, чистим по длине пачки. */
    queueWrite(queueRead().slice(batch.length));
    return;
  }
  queueWrite(queueRead().filter(function (ev) {
    return !drop.has(String(ev && ev.id));
  }));
}

async function flush() {
  if (flushing) return;
  const q = queueRead();
  if (!q.length) { renderSync(); return; }
  flushing = true;
  const batch = q.slice(0, 50);
  try {
    const res = await fetch(URL_INPUT, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (res.ok) {
      queueTrim(batch, data);
      toast('принято');
      /* Событие, нажатое пока шла отправка, не ждет двадцати секунд таймера. */
      if (queueRead().length) setTimeout(flush, 300);
    } else if (res.status === 401) {
      toast('сессия истекла, обнови страницу', true);
    } else if (res.status === 403) {
      toast('запись отклонена, открой портал заново', true);
    } else if (res.status === 503) {
      /* Часть пачки могла лечь: убираем только названное, остальное повторим. */
      queueTrim(batch, data);
      toast('хранилище не приняло часть, повторю', true);
    } else if (res.status === 400) {
      /* Тело неисправимо: держать его в очереди значит вечно долбить сервер. */
      queueWrite(queueRead().slice(batch.length));
      toast('часть ввода не принята, разбери в чате', true);
    } else {
      toast('не ушло, повторю', true);
    }
  } catch (e) {
    toast('нет сети, повторю', true);
  } finally {
    flushing = false;
    renderSync();
  }
}

/* ──────────────────────────  загрузка данных  ────────────────────────── */

async function getJson(url) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const err = new Error('ответ ' + res.status);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

function reasonOf(err) {
  if (!err) return 'причина неизвестна';
  if (err.status === 401) return 'ответ 401: сессия Cloudflare Access истекла';
  if (err.status === 404) return 'ответ 404: файла нет';
  if (err.status) return 'ответ ' + err.status;
  return 'сеть недоступна или файл не разобран как JSON';
}

async function loadSnapshot(date, isToday) {
  S.snap = null;
  S.snapError = null;
  S.emptyDay = false;

  /* Основной источник — хранилище (в репозиторий снимок не кладется, он приватный).
     Запасной — файл рядом со страницей: он есть только на локальном стенде. */
  const primary = isToday ? URL_DATA : URL_DATA + '?d=' + encodeURIComponent(date);
  const fallback = isToday ? URL_SNAPSHOT : URL_DAY + date + '.json';

  try {
    S.snap = await getJson(primary);
    return;
  } catch (err) {
    /* 404 на архивный день означает ровно одно: день не открывался. Врать про
       непрерывность нельзя, поэтому запасной путь тут не пробуем. */
    if (!isToday && err.status === 404) {
      S.emptyDay = true;
      return;
    }
    S.snapError = err;
  }

  try {
    S.snap = await getJson(fallback);
    S.snapError = null;
  } catch (err) {
    if (!isToday && err.status === 404) {
      S.emptyDay = true;
      S.snapError = null;
    }
  }
}

async function loadEvents(date) {
  S.events = [];
  S.stateError = null;
  S.serverCursor = null;
  S.statePartial = null;
  S.stateBroken = 0;
  try {
    const data = await getJson(URL_STATE + '?d=' + encodeURIComponent(date));
    let list = [];
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.events)) list = data.events;
    else if (data && Array.isArray(data.items)) list = data.items;
    if (data && data.cursor) S.serverCursor = data.cursor;
    /* Сервер честно сознается, если отдал не все: молчать об этом нельзя. */
    if (data && data.partial) S.statePartial = data.partial_reason || 'причина не названа';
    if (data && typeof data.broken === 'number') S.stateBroken = data.broken;
    else if (data && Array.isArray(data.broken)) S.stateBroken = data.broken.length;
    S.events = list.filter(function (e) { return e && typeof e.kind === 'string'; });
  } catch (err) {
    S.stateError = err;
  }
  recompute();
}

/* Наложение событий поверх снимка: последнее по ts на один ref побеждает. */
function recompute() {
  S.byRef = new Map();
  S.lastKind = new Map();
  S.remind = new Map();
  S.postpone = new Map();

  const sorted = S.events.slice().sort(function (a, b) {
    const ta = Date.parse(a.ts || '') || 0;
    const tb = Date.parse(b.ts || '') || 0;
    if (ta !== tb) return ta - tb;
    return String(a.id || '') < String(b.id || '') ? -1 : 1;
  });

  for (const ev of sorted) {
    if (ev.ref) {
      S.byRef.set(ev.ref, ev);
      if (ev.kind === 'air.answered' && ev.value === 'reminded') {
        S.remind.set(ev.ref, (S.remind.get(ev.ref) || 0) + 1);
      }
      if (ev.kind === 'move.postpone') {
        S.postpone.set(ev.ref, (S.postpone.get(ev.ref) || 0) + 1);
      }
    } else {
      S.lastKind.set(ev.kind, ev);
    }
  }
}

/* ──────────────────────────  режим экрана  ────────────────────────── */

function computeMode() {
  const takt = (S.snap && S.snap.takt) || {};
  const closedInSystem = Boolean(takt.day_close && takt.day_close.value === true);
  if (closedInSystem || S.lastKind.has('day.close')) return 'closed';
  if (!S.isToday) return 'closed';
  return new Date().getHours() >= 17 ? 'evening' : 'day';
}

function applyMode() {
  const main = document.getElementById('os-main');
  if (!main) return;
  const order = S.mode === 'day' ? ORDER_DAY : ORDER_EVENING;
  for (const id of order) {
    const node = document.getElementById(id);
    if (node) main.appendChild(node);
  }
  document.body.dataset.mode = S.mode;
  document.body.dataset.readonly = S.readonly ? 'да' : 'нет';
}

/* ──────────────────────────  блок 0: строка такта  ────────────────────────── */

function renderBar() {
  const takt = (S.snap && S.snap.takt) || {};
  const d = parseYmd(S.date) || new Date();
  const day = takt.day || weekday(d);
  const parts = [];
  if (day) parts.push(day + ', ' + ddmm(S.date));
  else parts.push(ddmm(S.date));
  if (takt.week) parts.push(String(takt.week));
  fill('takt.date', parts.join(' · '));

  const btnToday = document.querySelector('[data-act="today"]');
  show(btnToday, !S.isToday);

  const open = takt.day_open || {};
  const close = takt.day_close || {};
  let status = 'день не открыт';
  let dotClass = 'dot dot--off';
  if (close.value === true) {
    status = 'день закрыт' + (close.at ? ' ' + close.at : '');
    dotClass = 'dot dot--ok';
  } else if (open.value === true) {
    status = 'день открыт' + (open.at ? ' ' + open.at : '') + ' · не закрыт';
    dotClass = 'dot dot--warn';
  } else if (S.emptyDay) {
    status = 'день не открывался';
  } else if (!S.snap) {
    status = 'снимок не прочитан';
  }
  const dot = slot('takt.dot');
  if (dot) dot.className = dotClass;
  fill('takt.status', status);

  renderGoal();
  renderDebts();
}

function renderGoal() {
  const takt = (S.snap && S.snap.takt) || {};
  const goal = takt.goal_date;
  const target = parseYmd(goal);
  if (!target) {
    fill('goal', h('span', { class: 'age age--old', text: 'дата цели не названа' }));
    return;
  }
  const left = daysBetween(new Date(), target);
  let text;
  if (left > 0) text = 'до ' + ddmm(goal) + ' осталось ' + daysWord(left);
  else if (left === 0) text = 'до ' + ddmm(goal) + ' остался последний день';
  else text = ddmm(goal) + ' прошло ' + daysWord(-left) + ' назад';
  fill('goal', text);
}

function renderDebts() {
  const debts = (S.snap && S.snap.debts) || null;
  const takt = (S.snap && S.snap.takt) || {};
  if (!debts && takt.streak_days === undefined) {
    fill('debts', h('span', { class: 'age age--old', text: 'долги не прочитаны' }));
    return;
  }
  const items = [];
  if (typeof takt.streak_days === 'number') {
    items.push(h('span', {
      class: 'debt',
      title: 'дней подряд с закрытием дня',
      text: 'подряд ' + takt.streak_days,
    }));
  }
  if (debts && debts.week && typeof debts.week.units === 'number') {
    items.push(h('span', {
      class: 'debt',
      title: 'недельная сборка: последний раз ' + ddmm(debts.week.last) + (debts.week.source ? ' · ' + debts.week.source : ''),
      text: 'неделя ' + debts.week.units,
    }));
  }
  if (debts && debts.finance && typeof debts.finance.units === 'number') {
    items.push(h('span', {
      class: 'debt',
      title: 'сверка финансов: последний раз ' + ddmm(debts.finance.last) + (debts.finance.source ? ' · ' + debts.finance.source : ''),
      text: 'финансы ' + debts.finance.units,
    }));
  }
  if (!items.length) {
    fill('debts', h('span', { class: 'age age--old', text: 'долги не прочитаны' }));
    return;
  }
  const row = [];
  items.forEach(function (item, i) {
    if (i) row.push(h('span', { class: 'debt__sep', text: ' · ' }));
    row.push(item);
  });
  fill('debts', row);
}

/* ──────────────────────────  блок 1: рамка дня  ────────────────────────── */

function renderFrame() {
  const frame = (S.snap && S.snap.frame) || null;
  const mentor = (S.snap && S.snap.mentor) || null;

  let text = null;
  let source = null;
  let asOf = null;
  let note = null;

  const dayOpen = Boolean(S.snap && S.snap.takt && S.snap.takt.day_open && S.snap.takt.day_open.value === true);

  if (S.mode === 'day' && frame && frame.value) {
    text = frame.value;
    source = frame.source;
    asOf = frame.as_of;
    if (frame.fallback || !dayOpen) note = 'день не открыт';
  } else if (mentor && mentor.headline) {
    text = mentor.headline;
    source = mentor.source;
    asOf = mentor.date;
    if (S.mode === 'day') note = 'вчерашняя рамка, день не открыт';
  } else if (frame && frame.value) {
    text = frame.value;
    source = frame.source;
    asOf = frame.as_of;
  }

  if (!text) {
    fill('frame.value', unread('в снимке нет ни рамки дня, ни заголовка наставника'));
    fill('frame.meta', null);
    return;
  }

  fill('frame.value', text);
  const bits = [];
  if (source) bits.push(source);
  const age = ageText(asOf);
  if (age) bits.push(age);
  if (note) bits.push(note);
  fill('frame.meta', bits.length ? bits.join(' · ') : null);
}

/* ──────────────────────────  блок 2: сегодня  ────────────────────────── */

function renderToday() {
  renderMain();
  renderMoves();
  renderOverflow();
}

function renderMain() {
  const main = (S.snap && S.snap.main_action) || null;
  if (!main || !main.text) {
    fill('main', unread('в снимке нет главного действия'));
    return;
  }
  const id = main.id || 'main-' + S.date;
  const ev = S.byRef.get(id);
  const done = Boolean(ev && ev.kind === 'main.done');
  const ok = done && ev.value !== false;

  const meta = [];
  const tag = contourTag(main.contour);
  if (main.source) meta.push(main.source);
  const age = ageText(main.as_of);
  if (age) meta.push(age);
  if (main.fallback) meta.push('день не открыт, семя вчерашнего вечера');

  const card = h('div', {
    class: 'card card--action' + (main.contour ? ' c-' + main.contour : '') + (done ? ' is-done' : ''),
    'data-contour': main.contour || null,
  });

  if (done) {
    const mark = ok ? '✓' : '×';
    const stamp = hhmm(ev.ts);
    card.appendChild(h('p', { class: 'action__done' }, [
      h('span', { class: 'action__mark', text: mark }),
      ' ',
      stamp ? h('span', { class: 'action__time', text: stamp }) : null,
      ' ',
      h('span', { class: 'action__text', text: main.text }),
    ]));
    card.appendChild(h('p', { class: 'meta' }, [tag, tag ? ' ' : null, meta.join(' · ')]));
    if (!S.readonly) {
      card.appendChild(inlineForm(
        ok ? 'результат' : 'почему',
        ev.text || '',
        'main-note',
        function (value) {
          emit({ kind: 'main.done', ref: id, value: ok, text: value || null });
          S.focusNext = null;
          renderMain();
          renderSync();
        }
      ));
    }
  } else {
    card.appendChild(h('p', { class: 'action__text', text: main.text }));
    /* Заголовок пункта часто звучит как «Роман — текстом, до всего остального»,
       а сама формулировка (что именно сказать, какой закрытый вопрос) лежит в
       уточнении. Без него самый крупный элемент экрана не отвечает на вопрос
       «что делать», ради которого он и существует. */
    if (main.detail) {
      card.appendChild(h('p', { class: 'action__detail', text: main.detail }));
    }
    card.appendChild(h('p', { class: 'meta' }, [tag, tag ? ' ' : null, meta.join(' · ')]));
    if (!S.readonly) {
      card.appendChild(h('div', { class: 'action__btns' }, [
        h('button', {
          class: 'btn btn--primary', type: 'button', text: 'Сделал',
          onclick: function () {
            emit({ kind: 'main.done', ref: id, value: true });
            S.focusNext = '[data-focus="main-note"]';
            renderMain();
            focusNext();
            renderSync();
          },
        }),
        h('button', {
          class: 'btn', type: 'button', text: 'Не сделал',
          onclick: function () {
            emit({ kind: 'main.done', ref: id, value: false });
            S.focusNext = '[data-focus="main-note"]';
            renderMain();
            focusNext();
            renderSync();
          },
        }),
      ]));
    }
  }
  fill('main', card);
}

function inlineForm(placeholder, value, focusKey, onSubmit) {
  const field = h('input', {
    class: 'inline__field',
    type: 'text',
    placeholder: placeholder,
    value: value || '',
    autocomplete: 'off',
    'aria-label': placeholder,
    'data-focus': focusKey || null,
  });
  return h('form', {
    class: 'inline',
    onsubmit: function (e) {
      e.preventDefault();
      onSubmit(field.value.trim());
    },
  }, [field, h('button', { class: 'btn btn--ghost', type: 'submit', text: 'ок' })]);
}

function renderMoves() {
  const list = slot('moves');
  if (!list) return;
  list.textContent = '';
  const moves = (S.snap && Array.isArray(S.snap.moves)) ? S.snap.moves : [];
  if (!moves.length) {
    list.appendChild(h('li', { class: 'moves__empty' }, [
      S.snap ? 'ходов на день не собрано' : unread('снимок дня не прочитан'),
    ]));
    return;
  }
  moves.slice(0, 3).forEach(function (move) {
    list.appendChild(moveRow(move));
  });
}

function moveRow(move) {
  const id = move.id || ('mv-' + S.date + '-' + Math.random().toString(36).slice(2, 6));
  const ev = S.byRef.get(id);
  const done = Boolean(ev && ev.kind === 'move.done');
  const postponedNow = Boolean(ev && ev.kind === 'move.postpone');
  const postponed = (typeof move.postponed_count === 'number' ? move.postponed_count : 0)
    + (S.postpone.get(id) || 0);

  const box = h('li', { class: 'move' + (done ? ' is-done' : ''), 'data-id': id });

  const check = h('input', {
    class: 'move__check',
    type: 'checkbox',
    'aria-label': 'ход сделан',
    checked: done || null,
    disabled: S.readonly || null,
    onchange: function () {
      if (check.checked) {
        emit({ kind: 'move.done', ref: id });
        S.focusNext = '[data-id="' + id + '"] .inline__field';
      }
      renderMoves();
      focusNext();
      renderSync();
    },
  });

  const textBtn = h('button', {
    class: 'move__text',
    type: 'button',
    'aria-expanded': S.openCtx.has(id) ? 'true' : 'false',
    text: move.text || 'ход без текста',
    onclick: function () {
      if (S.openCtx.has(id)) S.openCtx.delete(id);
      else S.openCtx.add(id);
      renderMoves();
    },
  });

  const right = h('span', { class: 'row-move__right' }, [
    move.due ? h('span', { class: 'move__due', text: ddmm(move.due) }) : null,
    S.readonly ? null : h('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: 'завтра',
      onclick: function () {
        emit({ kind: 'move.postpone', ref: id, value: 'tomorrow' });
        renderMoves();
        renderSync();
      },
    }),
  ]);

  box.appendChild(h('div', { class: 'row-move' }, [
    check,
    contourTag(move.contour) || h('span', { class: 'tag tag--none', text: '—' }),
    textBtn,
    right,
  ]));

  if (S.openCtx.has(id)) {
    const ctx = Array.isArray(move.context) ? move.context : [];
    box.appendChild(h('div', { class: 'move__ctx' }, [
      ctx.length
        ? h('ul', {}, ctx.slice(0, 5).map(function (line) { return h('li', { text: line }); }))
        : h('p', { class: 'meta', text: 'контекста в рабочем листе нет' }),
      move.source ? h('p', { class: 'meta', text: move.source }) : null,
    ]));
  }

  if (postponedNow) {
    box.appendChild(h('p', { class: 'meta', text: 'перенесен на завтра ' + hhmm(ev.ts) }));
  }

  if (done && !S.readonly) {
    box.appendChild(inlineForm('результат', ev.text || '', null, function (value) {
      emit({ kind: 'move.done', ref: id, text: value || null });
      S.focusNext = null;
      renderMoves();
      renderSync();
    }));
  }

  if (postponed >= 3) {
    box.appendChild(h('p', { class: 'move__warn', text: 'переносится 3-й раз' }));
  }

  return box;
}

function renderOverflow() {
  const box = slot('moves.overflow');
  if (!box) return;
  const over = (S.snap && S.snap.moves_overflow) || null;
  const moves = (S.snap && Array.isArray(S.snap.moves)) ? S.snap.moves : [];
  const cut = Math.max(0, moves.length - 3);
  box.textContent = '';
  if (!over && !cut) { show(box, false); return; }

  const bits = [];
  if (over && typeof over.count === 'number' && over.count > 0) {
    bits.push('еще ' + over.count + ' ' + plural(over.count, ['пункт', 'пункта', 'пунктов']) + ' рабочего листа');
  }
  if (over && typeof over.backlog_open === 'number') {
    bits.push(over.backlog_open + ' ' + plural(over.backlog_open, ['задача', 'задачи', 'задач']) + ' в бэклоге');
  }
  if (!bits.length && !cut) { show(box, false); return; }
  show(box, true);
  if (bits.length) {
    box.appendChild(h('a', { class: 'tail__link', href: '/tasks/', text: bits.join(' и ') + ' ›' }));
  }
  /* Потолок в три хода режет намеренно, но молча терять строки снимка нельзя. */
  if (cut) {
    box.appendChild(h('span', {
      class: 'tail__cut',
      text: (bits.length ? ' · ' : '') + 'в снимке сверх потолка еще ' + cut + ' '
        + plural(cut, ['ход', 'хода', 'ходов']),
    }));
  }
}

/* ──────────────────────────  блок 3: деньги в воздухе  ────────────────────────── */

function renderAir() {
  const list = slot('air');
  if (!list) return;
  list.textContent = '';
  const air = (S.snap && Array.isArray(S.snap.air)) ? S.snap.air : [];
  if (!air.length) {
    list.appendChild(h('li', { class: 'air__empty' }, [
      S.snap ? 'в воздухе ничего не висит' : unread('снимок дня не прочитан'),
    ]));
    return;
  }
  const rows = air.slice().map(function (item) {
    const d = parseYmd(item.sent);
    const days = d ? daysBetween(d, new Date()) : (typeof item.days === 'number' ? item.days : null);
    return { item: item, days: days };
  }).sort(function (a, b) {
    return (b.days === null ? -1 : b.days) - (a.days === null ? -1 : a.days);
  });

  rows.slice(0, 5).forEach(function (row) {
    list.appendChild(airRow(row.item, row.days));
  });

  if (rows.length > 5) {
    const rest = rows.length - 5;
    list.appendChild(h('li', {
      class: 'air__tail',
      text: 'еще ' + rest + ' ' + plural(rest, ['строка', 'строки', 'строк']) + ' в воздухе',
    }));
  }
}

function airRow(item, days) {
  const id = item.id || ('air-' + (item.who || 'без-имени'));
  const ev = S.byRef.get(id);
  const answered = ev && ev.kind === 'air.answered' && (ev.value === 'yes' || ev.value === 'no');
  const touches = (typeof item.touches === 'number' ? item.touches : 0) + (S.remind.get(id) || 0);

  const box = h('li', { class: 'air-row' + (answered ? ' is-answered' : ''), 'data-id': id });

  const head = h('div', { class: 'air-row__head' }, [
    h('span', { class: 'air-row__who', text: item.who || 'без имени' }),
    h('span', { class: 'air-row__what', text: item.what || '' }),
    item.amount ? h('span', { class: 'air-row__amount', text: item.amount }) : null,
    days === null
      ? h('span', { class: 'days', text: 'срок не прочитан' })
      : h('span', { class: 'days ' + ageClass(days, 5, 8), text: daysWord(days) }),
  ]);
  box.appendChild(head);

  /* Подпись называет дату, от которой посчитаны дни, и источник этой даты:
     в карточке воронки текст бывает устаревшим, и без этой строки цифра дней
     спорила бы с текстом рядом, а проверить было бы нечем. */
  const src = [];
  if (item.sent) src.push('оффер от ' + ddmm(item.sent));
  if (item.sent_source) src.push(item.sent_source);
  else if (item.source) src.push(item.source);
  if (src.length) box.appendChild(h('p', { class: 'meta', text: src.join(' · ') }));

  if (answered) {
    box.appendChild(h('p', { class: 'air-row__state', text: (ev.value === 'yes' ? 'да' : 'нет') + ' · ' + hhmm(ev.ts) }));
    if (!S.readonly) {
      box.appendChild(inlineForm('комментарий', ev.text || '', null, function (value) {
        emit({ kind: 'air.answered', ref: id, value: ev.value, text: value || null });
        renderAir();
        renderSync();
      }));
    }
  } else if (!S.readonly) {
    const answer = function (value) {
      emit({ kind: 'air.answered', ref: id, value: value });
      renderAir();
      renderSync();
    };
    box.appendChild(h('div', { class: 'air-row__btns' }, [
      h('button', { class: 'btn', type: 'button', text: 'да', onclick: function () { answer('yes'); } }),
      h('button', { class: 'btn', type: 'button', text: 'нет', onclick: function () { answer('no'); } }),
      h('button', {
        class: 'btn btn--ghost',
        type: 'button',
        text: 'напомнил',
        disabled: touches >= 2 ? true : null,
        onclick: function () { answer('reminded'); },
      }),
      touches >= 2 ? h('span', { class: 'meta', text: 'правило: не догонять больше одного раза' }) : null,
    ]));
  }

  if (ev && ev.kind === 'air.answered' && ev.value === 'reminded') {
    box.appendChild(h('p', { class: 'meta', text: 'напомнил ' + hhmm(ev.ts) }));
  }

  return box;
}

/* ──────────────────────────  блок 4: три доски  ────────────────────────── */

function renderBoards() {
  const box = slot('boards');
  if (!box) return;
  box.textContent = '';
  const boards = (S.snap && Array.isArray(S.snap.boards)) ? S.snap.boards : [];
  if (!boards.length) {
    box.appendChild(unread(S.snap ? 'в снимке нет секции досок' : 'снимок дня не прочитан'));
    return;
  }
  boards.forEach(function (board) {
    const metric = h('div', { class: 'metric', 'data-id': board.id || null });
    metric.appendChild(h('div', { class: 'metric__label', text: board.label || board.id || 'доска' }));

    if (board.error || board.value === null || board.value === undefined || board.value === '') {
      metric.appendChild(unread(board.error || 'значение не собрано'));
    } else {
      metric.appendChild(h('div', { class: 'metric__value', text: String(board.value) }));
    }

    const days = ageDays(board.as_of);
    const age = ageText(board.as_of);
    const note = [];
    if (board.note) note.push(board.note);
    const src = [];
    if (board.source) src.push(board.source);
    if (age) src.push(age);

    metric.appendChild(h('div', { class: 'metric__note' }, [
      note.length ? note.join(' · ') + ' · ' : null,
      src.length ? h('span', { class: 'age ' + ageClass(days, 4, 8), text: src.join(' · ') }) : null,
    ]));
    box.appendChild(metric);
  });
}

/* ──────────────────────────  блок 5: закрыть день  ────────────────────────── */

/* Нетронутый ползунок без вчерашней подсказки уходит пустым: выдумывать оценку нельзя. */
function markerValue(kind) {
  if (S.markersTouched[kind] && typeof S.markerVals[kind] === 'number') return S.markerVals[kind];
  const sent = S.lastKind.get('day.close');
  if (sent && sent.value && typeof sent.value[kind] === 'number') return sent.value[kind];
  const hint = (S.snap && S.snap.mentor && S.snap.mentor.markers) || null;
  if (hint && typeof hint[kind] === 'number') return hint[kind];
  return null;
}

function renderClose() {
  const form = slot('close.form');
  const toggle = document.querySelector('[data-act="close-toggle"]');
  if (!form) return;
  form.textContent = '';

  const sent = S.lastKind.get('day.close');
  let sentBody = null;
  if (sent && typeof sent.text === 'string') {
    try { sentBody = JSON.parse(sent.text); } catch (e) { sentBody = null; }
  }
  const hint = (S.snap && S.snap.mentor && S.snap.mentor.markers) || null;

  const markers = [
    { kind: 'energy', label: 'энергия' },
    { kind: 'p1', label: 'P1' },
    { kind: 'money', label: 'деньги' },
  ];

  markers.forEach(function (m) {
    const touched = S.markersTouched[m.kind];
    let known = null;
    if (touched && typeof S.markerVals[m.kind] === 'number') known = S.markerVals[m.kind];
    else if (sent && sent.value && typeof sent.value[m.kind] === 'number') known = sent.value[m.kind];
    else if (hint && typeof hint[m.kind] === 'number') known = hint[m.kind];

    const out = h('output', {
      class: 'marker__val',
      text: known === null ? '—' : String(known),
    });
    const input = h('input', {
      class: 'marker__range',
      type: 'range',
      'data-marker': m.kind,
      'aria-label': m.label,
      disabled: S.readonly || null,
      oninput: function () {
        S.markersTouched[m.kind] = true;
        S.markerVals[m.kind] = Number(input.value);
        out.textContent = input.value;
        const row = input.parentNode;
        if (row && row.classList) row.classList.remove('marker--untouched');
      },
    });
    input.min = '1';
    input.max = '5';
    input.step = '1';
    /* Середина шкалы — только положение ручки. Пока ползунок не тронут и вчерашнего
       значения нет, справа стоит прочерк и в событие уходит пусто. */
    input.value = String(known === null ? 3 : known);
    form.appendChild(h('div', {
      class: 'marker' + (touched ? '' : ' marker--untouched'),
    }, [h('span', { class: 'marker__label', text: m.label }), input, out]));
  });

  if (!hint && !sent) {
    form.appendChild(h('p', { class: 'meta', text: 'вчерашних маркеров в снимке нет: неотодвинутый ползунок уйдет пустым' }));
  } else if (hint && !sent) {
    form.appendChild(h('p', { class: 'meta', text: 'значения по умолчанию вчерашние, до первого касания они серые' }));
  }

  const movedStart = S.closeDraft.moved !== null
    ? S.closeDraft.moved
    : (sentBody && sentBody.moved ? sentBody.moved : '');
  const moved = h('textarea', {
    class: 'close__moved',
    'aria-label': 'что двинулось',
    placeholder: 'что двинулось',
    disabled: S.readonly || null,
    text: movedStart,
    oninput: function () { S.closeDraft.moved = moved.value; },
  });
  moved.rows = 3;
  form.appendChild(moved);

  const seedStart = S.closeDraft.seed !== null
    ? S.closeDraft.seed
    : (sentBody && sentBody.seed ? sentBody.seed : '');
  const seed = h('input', {
    class: 'close__seed',
    type: 'text',
    'aria-label': 'что первым делом завтра',
    placeholder: 'семя на завтра',
    autocomplete: 'off',
    value: seedStart,
    disabled: S.readonly || null,
    oninput: function () { S.closeDraft.seed = seed.value; },
  });
  form.appendChild(seed);
  form.appendChild(h('p', { class: 'meta', text: 'что первым делом завтра' }));

  if (!S.readonly) {
    form.appendChild(h('button', { class: 'btn btn--primary', type: 'submit', text: 'Отправить в закрытие дня' }));
  }

  form.onsubmit = function (e) {
    e.preventDefault();
    if (S.readonly) return;
    emit({
      kind: 'day.close',
      value: {
        energy: markerValue('energy'),
        p1: markerValue('p1'),
        money: markerValue('money'),
      },
      text: JSON.stringify({ moved: moved.value.trim(), seed: seed.value.trim() }),
    });
    emit({ kind: 'request', value: 'day-close' });
    S.mode = computeMode();
    S.closeOpen = true;
    renderClose();
    renderAfterClose();
    renderMentor();
    renderSync();
    applyMode();
  };

  const open = S.closeOpen === null ? S.mode !== 'day' : S.closeOpen;
  show(form, open);
  if (toggle) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Свернуть' : 'Закрыть день';
  }
  renderAfterClose();
}

function renderAfterClose() {
  const box = slot('close.after');
  if (!box) return;
  const sent = S.lastKind.get('day.close');
  box.textContent = '';
  if (!sent) { show(box, false); return; }
  show(box, true);
  const n = S.events.length;
  box.appendChild(h('p', {
    class: 'close__ok',
    text: 'ушло, ' + n + ' ' + plural(n, ['событие', 'события', 'событий']) + ' за день',
  }));
  box.appendChild(h('p', { class: 'close__cmd' }, [
    h('code', { text: '/day-close' }),
    ' ',
    h('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: 'скопировать',
      onclick: function (e) {
        copyText('/day-close');
        e.currentTarget.textContent = 'скопировано';
      },
    }),
  ]));
}

function copyText(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).catch(function () { copyFallback(value); });
  } else {
    copyFallback(value);
  }
}

function copyFallback(value) {
  const area = document.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try { document.execCommand('copy'); } catch (e) { /* буфер недоступен */ }
  document.body.removeChild(area);
}

/* ──────────────────────────  блок 6: запись наставника  ────────────────────────── */

function renderMentor() {
  const box = slot('mentor');
  if (!box) return;
  box.textContent = '';
  const m = (S.snap && S.snap.mentor) || null;
  if (!m || (!m.headline && !m.sections && !m.focus_tomorrow)) {
    box.appendChild(unread(S.snap ? 'в снимке нет записи наставника' : 'снимок дня не прочитан'));
    return;
  }

  const line = [];
  if (m.date) line.push(h('span', { class: 'mentor__date', text: ddmm(m.date) }));
  if (m.verdict) {
    line.push(h('span', { class: 'mentor__sep', text: ' · вердикт ' }));
    line.push(h('span', { class: 'verdict verdict--' + m.verdict, text: String(m.verdict) }));
  }
  const mk = m.markers || {};
  const pairs = [['энергия', mk.energy], ['P1', mk.p1], ['деньги', mk.money]];
  pairs.forEach(function (pair) {
    if (typeof pair[1] === 'number') {
      line.push(h('span', { class: 'mentor__marker', text: ' · ' + pair[0] + ' ' + pair[1] }));
    }
  });
  if (line.length) box.appendChild(h('p', { class: 'mentor__line' }, line));

  if (m.headline) box.appendChild(h('h3', { class: 'mentor__headline', text: m.headline }));

  const sections = (m.sections && typeof m.sections === 'object') ? m.sections : {};
  Object.keys(sections).forEach(function (key) {
    const value = sections[key];
    if (typeof value !== 'string' || !value.trim()) return;
    box.appendChild(h('details', { class: 'mentor__section' }, [
      h('summary', { text: key }),
      h('div', { class: 'mentor__body', html: value }),
    ]));
  });

  const focus = Array.isArray(m.focus_tomorrow) ? m.focus_tomorrow.filter(Boolean) : [];
  if (focus.length) {
    box.appendChild(h('details', { class: 'mentor__section', open: true }, [
      h('summary', { text: 'Фокус на завтра' }),
      h('ol', { class: 'mentor__focus' }, focus.map(function (line2) { return h('li', { text: String(line2) }); })),
    ]));
  }

  if (m.source) box.appendChild(h('p', { class: 'meta', text: m.source }));
}

/* ──────────────────────────  блок 7: строка ввода и счетчик разбора  ────────────────────────── */

function renderSync() {
  const box = slot('sync');
  if (!box) return;
  const sync = (S.snap && S.snap.sync) || {};
  const cursor = S.serverCursor || {};
  const appliedUntil = sync.applied_until || cursor.applied_until || '';
  const appliedAt = sync.applied_at || cursor.applied_at || null;

  let unsorted = 0;
  let known = true;
  if (S.stateError) known = false;
  for (const ev of S.events) {
    if (ev._local) { unsorted++; continue; }
    const key = String(ev.id || '');
    if (!appliedUntil || key > appliedUntil) unsorted++;
  }

  const queued = queueRead().length;
  const bits = [];
  bits.push('не разобрано: ' + (known ? unsorted : 'не прочитано'));

  if (appliedAt) {
    const d = new Date(appliedAt);
    if (!isNaN(d.getTime())) {
      const gap = daysBetween(d, new Date());
      const when = gap === 0 ? 'сегодня' : gap === 1 ? 'вчера' : ddmm(ymd(d));
      bits.push('последний разбор ' + when + ' ' + hhmm(appliedAt));
    }
  } else {
    bits.push('разбора еще не было');
  }
  if (queued) bits.push('в очереди ' + queued);

  box.textContent = bits.join(' · ');

  let alarm = false;
  if (known && unsorted > 20) alarm = true;
  if (appliedAt) {
    const d = new Date(appliedAt);
    if (!isNaN(d.getTime()) && daysBetween(d, new Date()) > 3) alarm = true;
  }
  box.className = 'os-input__sync' + (alarm ? ' is-red' : '');

  const banner = slot('alarm');
  if (banner) {
    show(banner, alarm);
    banner.textContent = alarm ? 'портал накопил ввод, которого нет в файлах' : '';
  }
}

function bindNote() {
  const form = slot('note.form');
  const field = slot('note.field');
  const ack = slot('note.ack');
  if (!form || !field) return;
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const value = field.value.trim();
    if (!value) return;
    emit({ kind: 'note', text: value });
    field.value = '';
    if (ack) ack.textContent = 'принято ' + hhmm(isoLocal(new Date()));
    renderSync();
  });
}

/* ──────────────────────────  честные пояснения и сбои  ────────────────────────── */

function renderNotices() {
  const box = slot('notices');
  if (!box) return;
  box.textContent = '';
  const lines = [];

  if (S.readonly && !S.emptyDay) {
    lines.push('архив дня: снимок заморожен, ввод выключен');
  }
  if (S.snap && S.isToday && S.snap.date && S.snap.date !== S.date) {
    lines.push('снимок собран за ' + ddmm(S.snap.date) + ', сегодня генератор не запускался');
  }
  if (S.stateError) {
    lines.push('отметки дня не прочитаны (' + reasonOf(S.stateError) + '), на экране только снимок');
  }
  if (S.statePartial) {
    lines.push('отметки дня прочитаны не полностью: ' + S.statePartial);
  }
  if (S.stateBroken) {
    lines.push('событий с испорченной записью: ' + S.stateBroken + ', они не легли на экран');
  }
  S.notices.forEach(function (line) { lines.push(line); });

  lines.forEach(function (line) {
    box.appendChild(h('p', { class: 'notice', text: line }));
  });
}

function renderEmptyOrFatal() {
  const main = document.getElementById('os-main');
  const empty = slot('empty');
  const fatal = slot('fatal');
  const inputBar = slot('input.bar');

  if (empty) { show(empty, false); empty.textContent = ''; }
  if (fatal) { show(fatal, false); fatal.textContent = ''; }
  show(main, true);
  /* В архиве строку ввода прячем: живое поле, которое молча ничего не пишет, хуже отсутствия поля. */
  show(inputBar, !S.readonly);

  if (S.emptyDay) {
    show(main, false);
    show(inputBar, false);
    if (empty) {
      show(empty, true);
      empty.appendChild(h('p', { class: 'empty__title', text: 'день не открывался' }));
      empty.appendChild(h('p', { class: 'meta', text: 'файла ' + URL_DAY + S.date + '.json нет, и придумывать за этот день нечего' }));
    }
    return true;
  }

  if (!S.snap) {
    show(main, false);
    show(inputBar, false);
    if (fatal) {
      show(fatal, true);
      fatal.appendChild(h('p', { class: 'fatal__title', text: 'снимок дня не загрузился' }));
      fatal.appendChild(h('p', { class: 'meta', text: 'причина: ' + reasonOf(S.snapError) + ' · адрес: ' + (S.isToday ? URL_SNAPSHOT : URL_DAY + S.date + '.json') }));
      fatal.appendChild(h('p', {}, [
        h('a', { href: location.pathname + location.search, text: 'обновить страницу' }),
        ' · ',
        h('a', { href: '/os/api/ping', text: 'проверить доступ' }),
        ' · ',
        h('a', { href: '/', text: 'старый портал' }),
      ]));
    }
    return true;
  }
  return false;
}

function focusNext() {
  if (!S.focusNext) return;
  const node = document.querySelector(S.focusNext);
  S.focusNext = null;
  if (node && node.focus) node.focus();
}

/* ──────────────────────────  общий рендер  ────────────────────────── */

function render() {
  S.mode = computeMode();
  renderBar();
  renderNotices();
  const stop = renderEmptyOrFatal();
  if (stop) {
    renderSync();
    applyMode();
    return;
  }
  renderFrame();
  renderToday();
  renderAir();
  renderBoards();
  renderClose();
  renderMentor();
  renderSync();
  applyMode();
  focusNext();
}

/* ──────────────────────────  навигация по дням  ────────────────────────── */

async function load(date, push) {
  S.date = date;
  S.isToday = date === ymd(new Date());
  S.readonly = !S.isToday;
  S.openCtx = new Set();
  S.closeOpen = null;
  S.markersTouched = { energy: false, p1: false, money: false };
  S.markerVals = { energy: null, p1: null, money: null };
  S.closeDraft = { moved: null, seed: null };
  S.notices = [];

  await loadSnapshot(date, S.isToday);
  await loadEvents(date);

  if (push) {
    const url = S.isToday ? location.pathname : location.pathname + '?d=' + date;
    history.pushState({ d: date }, '', url);
  }
  render();
}

function bindNav() {
  document.addEventListener('click', function (e) {
    const btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'prev') { load(shiftDate(S.date, -1), true); }
    else if (act === 'next') { load(shiftDate(S.date, 1), true); }
    else if (act === 'today') { load(ymd(new Date()), true); }
    else if (act === 'theme') { toggleTheme(); }
    else if (act === 'close-toggle') {
      S.closeOpen = !(S.closeOpen === null ? S.mode !== 'day' : S.closeOpen);
      renderClose();
    }
  });

  window.addEventListener('popstate', function () {
    const d = new URLSearchParams(location.search).get('d');
    load(d && parseYmd(d) ? d : ymd(new Date()), false);
  });
}

/* ──────────────────────────  тема  ────────────────────────── */

function themeLabel() {
  const dark = document.documentElement.classList.contains('dark');
  const box = slot('theme.label');
  if (box) box.textContent = dark ? 'светлая' : 'темная';
  const btn = document.querySelector('[data-act="theme"]');
  if (btn) btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
}

function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem(KEY_THEME, dark ? 'dark' : 'light'); } catch (e) { /* приватный режим */ }
  themeLabel();
}

/* ──────────────────────────  запуск  ────────────────────────── */

function tick() {
  /* Счетчик до цели и возраст цифр живут в браузере: раз в минуту сверяем дату. */
  if (S.isToday && S.date !== ymd(new Date())) {
    S.notices.push('наступил новый день, обнови страницу');
    renderNotices();
    return;
  }
  renderGoal();
}

async function init() {
  themeLabel();
  bindNav();
  bindNote();

  const param = new URLSearchParams(location.search).get('d');
  const start = param && parseYmd(param) ? param : ymd(new Date());
  await load(start, false);

  window.addEventListener('online', flush);
  setInterval(flush, 20000);
  setInterval(tick, 60000);
  flush();
}

init();
