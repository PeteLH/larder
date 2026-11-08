/* Larder — shared food stock tracker (Direction B).
   Stock lives in one JSON file in a private GitHub repo, read/written via the GitHub Contents API.
   Each phone keeps a local copy, so the app works offline and syncs when it can.
   Shared logic (receipt reading, shelf-life guesses, merging, pack-date reading) is in core.js. */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const KEY_CFG = 'larder.cfg', KEY_DATA = 'larder.data';
const sleep = ms => new Promise(ok => setTimeout(ok, ms));

let cfg = Object.assign({ branch: 'main', path: 'inventory.json' }, window.LARDER_DEFAULTS || {}, JSON.parse(localStorage.getItem(KEY_CFG) || '{}'));
let data = loadLocal();

function loadLocal() { try { return Object.assign(emptyData(), JSON.parse(localStorage.getItem(KEY_DATA) || '{}')); } catch { return emptyData(); } }
function saveLocal() { localStorage.setItem(KEY_DATA, JSON.stringify(data)); }
function saveCfg() { localStorage.setItem(KEY_CFG, JSON.stringify(cfg)); }
const liveItems = () => data.items.filter(i => !i.deleted);
const configured = () => !!(cfg.owner && cfg.repo && cfg.token);
const byId = id => data.items.find(i => i.id === id);

/* ---------- how things look: names, tiles, days ---------- */
const CATS = [
  [/frozen|ice cream|fish fingers|oven chips|ice lolly/i, '#e3f1f4', '#1f6577'],
  [/chicken|turkey|mince|steak|beef|pork|lamb|sausage|bacon|gammon|burger|\bham\b|salami|chorizo|duck|fish|salmon|cod\b|prawn|haddock|tuna|mackerel/i, '#f8deda', '#9a2f20'],
  [/milk|cream|crème|creme|yogh?urt|cheese|cheddar|butter|mozzarella|feta|halloumi|brie|custard|kefir|skyr|fromage/i, '#dce8f7', '#1e4e8c'],
  [/chilli|curry|leftover|soup|stew|lasagne|\bpie\b|pizza|ready meal|bolognese|risotto|pasta bake|quiche|hummus|houmous|coleslaw|dip\b/i, '#eadff5', '#5b3a86'],
  [/salad|lettuce|spinach|rocket|herb|veg|carrot|potato|onion|garlic|pepper|tomato|cucumber|courgette|broccoli|mushroom|leek|cabbage|avocado|beans?\b|peas\b|sweetcorn|apple|banana|pear|orange|lemon|lime|berr|grape|melon|mango|fruit|kiwi|plum|satsuma|clementine|celery|parsnip|squash/i, '#ddf0dd', '#1e6b35'],
  [/bread|loaf|roll|bagel|wrap|tortilla|pitta|naan|crumpet|muffin|croissant|cake|biscuit|\beggs?\b|brioche|baguette/i, '#f6e9cf', '#7a5a12'],
];
function catColours(name) { for (const [re, bg, fg] of CATS) if (re.test(name)) return [bg, fg]; return ['#ebece6', '#4d5149']; }
function shortName(n) {
  let s = String(n || '').replace(/^sainsbury'?s\s+/i, '').replace(/^(taste the difference|so organic|by sainsbury'?s)\s+/i, '').replace(/^british\s+/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+\d+(\.\d+)?\s?(g|kg|ml|l|cl|pints?)\b.*$/i, '').trim();
  if (s === s.toUpperCase() || /^[A-Z][a-z]*( [A-Z][a-z]*)+/.test(s)) s = s.toLowerCase().replace(/^./, c => c.toUpperCase());
  return s || n;
}
function tileHtml(name, big) {
  const [bg, fg] = catColours(name);
  const mono = (shortName(name).replace(/[^A-Za-z ]/g, '').trim().split(/\s+/)[0] || '?').slice(0, 2).toUpperCase();
  return `<div class="tile${big ? ' lg' : ''}" style="background:${bg};color:${fg}" aria-hidden="true">${esc(mono)}</div>`;
}
const PLACE = { fridge: 'Fridge', freezer: 'Freezer', cupboard: 'Cupboard', all: 'Everything' };
const weekday = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' }); };
const dayMon = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
function whenText(it) {
  if (!it.date) return it.frozenOn ? `Frozen ${dayMon(it.frozenOn)}` : 'No date';
  const n = daysUntil(it.date), lbl = it.dateType === 'useby' ? 'Use by' : 'Best before';
  const d = n >= 0 && n < 7 ? weekday(it.date) : dayMon(it.date);
  return `${lbl} ${d}${it.estimated ? ' · guess' : ''}`;
}
function relText(n) { return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n < 0 ? `${-n} days ago` : `in ${n} days`; }
function dayCount(it) {   // the big number on the right of a row
  if (!it.date) {
    if (it.frozenOn) { const w = Math.max(0, Math.floor(-daysUntil(it.frozenOn) / 7)); return `<div class="dc"><b>${w}</b><span>wk frozen</span></div>`; }
    return `<div class="dc"><b>–</b><span>no date</span></div>`;
  }
  const n = daysUntil(it.date);
  if (n < 0) return `<div class="dc past"><b>Past</b><span>${it.dateType === 'useby' ? 'use-by' : 'best bef.'}</span></div>`;
  if (n === 0) return `<div class="dc ${it.dateType === 'useby' ? 'hot' : ''}"><b style="font-size:19px">Today</b><span>${it.dateType === 'useby' ? 'use by' : 'best bef.'}</span></div>`;
  const cls = it.estimated ? 'guess' : n <= 1 && it.dateType === 'useby' ? 'hot' : '';
  return `<div class="dc ${cls}"><b>${it.estimated ? '~' : ''}${n}</b><span>${n === 1 ? 'day' : 'days'}</span></div>`;
}
const byDate = (a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1
  : (a.dateType === 'useby' ? -1 : 1) - (b.dateType === 'useby' ? -1 : 1) || a.name.localeCompare(b.name);

/* ---------- screens ---------- */
let screen = 'home', placeKey = 'fridge';
function show(name, opts = {}) {
  if (screen === 'scan' && name !== 'scan') stopScan();
  screen = name;
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === 's-' + name));
  $$('#nav [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === name));
  document.body.classList.toggle('no-nav', name === 'scan' || name === 'welcome');
  if (name !== 'home' && name !== 'welcome' && !opts.noHistory) history.pushState({ s: name }, '');
  if (name === 'scan') startScan();
  if (name === 'settings') fillSettings();
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', () => { if ($('#sheet').open) { closeSheet(); return; } if ($('#datecam').open) { stopDateCam(null); return; } show('home', { noHistory: true }); });
$$('[data-back]').forEach(b => b.onclick = () => history.state ? history.back() : show('home', { noHistory: true }));
$$('#nav [data-go]').forEach(b => b.onclick = () => b.dataset.go === 'home' ? (history.state ? history.back() : show('home', { noHistory: true })) : show(b.dataset.go));
$('#avatar').onclick = () => show('settings');

function render() {
  const fn = { home: renderHome, place: renderPlace, orders: renderOrders, settings: renderSettings, welcome: renderWelcome }[screen];
  if (fn) fn();
  const pending = pendingChecks().length;
  $('#orders-pip').hidden = !pending;
  if ('setAppBadge' in navigator) {
    const n = liveItems().filter(i => i.date && i.dateType === 'useby' && daysUntil(i.date) <= 1).length;
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }
}

/* home */
function renderHome() {
  $('#today').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#avatar').textContent = (cfg.name || '?').trim().charAt(0).toUpperCase() || '?';
  const soon = liveItems().filter(i => i.date && i.location !== 'freezer' && daysUntil(i.date) <= 7).sort(byDate).slice(0, 10);
  const all = liveItems();
  $('#soon').innerHTML = soon.length ? soon.map(it => {
    const n = daysUntil(it.date), hot = n <= 0;
    const big = n < 0 ? 'Past' : n === 0 ? 'Today' : `${it.estimated ? '~' : ''}${n}`;
    const unit = n > 0 ? `<span>${n === 1 ? 'day' : 'days'}</span>` : '';
    const sub = n < 0 ? `${it.dateType === 'useby' ? 'use-by' : 'best before'} passed` : n === 0 ? (it.dateType === 'useby' ? 'use by tonight' : 'best before today') : `${it.dateType === 'useby' ? 'use by' : 'best before'} ${weekday(it.date)}`;
    const numCls = !hot && n === 1 && it.dateType === 'useby' ? ' class="c-urgent"' : '';
    return `<button class="scard${hot ? ' hot' : ''}" data-open="${it.id}">${tileHtml(it.name)}
      <div class="nm">${esc(shortName(it.name))}${it.qty > 1 ? ` ×${it.qty}` : ''}</div>
      <div class="num"><b${numCls}>${big}</b>${unit}</div><div class="sub">${sub}</div></button>`;
  }).join('') : `<div class="scard calm"><div class="nm">${all.length ? 'Nothing needs eating this week.' : 'Nothing here yet.'}</div><div class="sub">${all.length ? 'Enjoy it while it lasts.' : 'Scan things as you put them away, or wait for the next Sainsbury\'s order.'}</div></div>`;
  $('#home-title').textContent = soon.length ? 'Eat soon' : all.length ? 'All good' : 'Hello';

  const icons = {
    fridge: ['#dce8f7', '#1e4e8c', '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 10h12M9 5v2M9 13v3"/>'],
    freezer: ['#e3f1f4', '#1f6577', '<path d="M12 2v20M3 7l18 10M21 7 3 17"/>'],
    cupboard: ['#f6e9cf', '#7a5a12', '<path d="M3 9h18M5 9v11h14V9M8 4h8l2 5H6z"/>'],
  };
  $('#places').innerHTML = ['fridge', 'freezer', 'cupboard'].map(k => {
    const its = all.filter(i => i.location === k).sort(byDate);
    let sum = its.length ? `${its.length} item${its.length > 1 ? 's' : ''}` : 'Empty';
    if (k === 'freezer') { const old = its.filter(i => i.frozenOn).sort((a, b) => a.frozenOn < b.frozenOn ? -1 : 1)[0]; if (old) sum += ` · oldest frozen ${dayMon(old.frozenOn)}`; }
    else if (its.length) {
      const due = its.filter(i => i.date && daysUntil(i.date) <= 7).length;
      const next = its.find(i => i.date);
      sum += due ? ` · ${due} due this week` : next ? ` · next: ${shortName(next.name).toLowerCase()} ${daysUntil(next.date) < 30 ? 'by ' + weekday(next.date) : 'in ' + dayMon(next.date)}` : '';
    }
    const [bg, fg, path] = icons[k];
    return `<button class="place" data-place="${k}"><div class="tile" style="background:${bg};color:${fg}"><svg viewBox="0 0 24 24">${path}</svg></div>
      <div class="t"><b>${PLACE[k]}</b><span>${esc(sum)}</span></div><svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>`;
  }).join('') + `<button class="linkbtn" data-place="all">Search everything</button>`;

  const pend = pendingChecks();
  $('#nudge').hidden = !pend.length;
  if (pend.length) $('#nudge').textContent = `${batchLabel()} added · ${pend.length} date${pend.length > 1 ? 's' : ''} to check`;
}
$('#soon').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (b) openSheet(byId(b.dataset.open)); });
$('#places').addEventListener('click', e => { const b = e.target.closest('[data-place]'); if (b) { placeKey = b.dataset.place; $('#search').value = ''; $('#search').hidden = placeKey !== 'all'; show('place'); if (placeKey === 'all') $('#search').focus(); } });
$('#nudge').onclick = () => show('orders');

/* place list */
function renderPlace() {
  $('#place-title').textContent = PLACE[placeKey];
  const q = $('#search').value.trim().toLowerCase();
  const its = liveItems().filter(i => (placeKey === 'all' || i.location === placeKey) && (!q || i.name.toLowerCase().includes(q))).sort(byDate);
  $('#swipe-hint').hidden = !its.length;
  if (!its.length) { $('#list').innerHTML = `<div class="empty">${q ? 'Nothing matches.' : `Nothing in the ${PLACE[placeKey].toLowerCase()}.`}</div>`; return; }
  const group = it => !it.date ? (it.frozenOn ? 'Frozen' : 'No date') : daysUntil(it.date) < 0 ? 'Past the date' : daysUntil(it.date) <= 7 ? 'This week' : 'Later';
  let html = '', last = '';
  for (const it of its) {
    const g = group(it);
    if (g !== last) { html += `<div class="gh">${g}</div>`; last = g; }
    html += `<div class="swipe"><div class="under"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>Used</div>
      <div class="it" data-id="${it.id}">${tileHtml(it.name)}<div class="t"><div class="nm">${esc(shortName(it.name))}${it.qty > 1 ? ` <small>×${it.qty}</small>` : ''}</div>
      <div class="sb">${esc(whenText(it))}${placeKey === 'all' ? ' · ' + PLACE[it.location] : ''}</div></div>${dayCount(it)}</div></div>`;
  }
  $('#list').innerHTML = html;
  $$('#list .it').forEach(attachSwipe);
}
$('#search').addEventListener('input', renderPlace);
$('#place-search-btn').onclick = () => { const s = $('#search'); s.hidden = !s.hidden; if (!s.hidden) s.focus(); else { s.value = ''; renderPlace(); } };

function attachSwipe(el) {
  let x0 = null, y0 = 0, dx = 0, drag = false, moved = false;
  el.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; dx = 0; drag = false; moved = false; });
  el.addEventListener('pointermove', e => {
    if (x0 === null) return;
    const ddx = e.clientX - x0, ddy = e.clientY - y0;
    if (Math.abs(ddx) > 6 || Math.abs(ddy) > 6) moved = true;
    if (!drag && ddx > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.5) { drag = true; el.classList.add('dragging'); el.parentNode.classList.add('drag'); try { el.setPointerCapture(e.pointerId); } catch {} }
    if (drag) { dx = Math.max(0, ddx); el.style.transform = `translateX(${dx}px)`; }
  });
  const end = () => {
    if (x0 === null) return; x0 = null; el.classList.remove('dragging');
    if (drag && dx > 110) { el.style.transform = 'translateX(110%)'; if (navigator.vibrate) navigator.vibrate(30); setTimeout(() => useOne(el.dataset.id), 160); }
    else { el.style.transform = ''; setTimeout(() => el.parentNode.classList.remove('drag'), 200); }
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('click', () => { if (!moved) openSheet(byId(el.dataset.id)); });
}

/* ---------- changes ---------- */
function upsert(item, quiet) {
  item.updatedAt = nowIso();
  const i = data.items.findIndex(x => x.id === item.id);
  if (i >= 0) data.items[i] = item; else data.items.push(item);
  saveLocal(); if (!quiet) render(); scheduleSync();
}
function logEvent(item, action) {
  const e = { id: uid(), name: item.name, action, at: nowIso(), by: cfg.name || '', daysLeft: daysUntil(item.date) };
  data.log.unshift(e); return e.id;
}
function undoable(text, before, logId) {
  toast(text, () => {
    upsert({ ...before });
    if (logId) data.log = data.log.filter(l => l.id !== logId);
    saveLocal(); render(); toast('Undone');
  });
}
function useOne(id) {
  const it = byId(id); if (!it) return;
  const before = { ...it }, logId = logEvent(it, 'used');
  if (it.qty > 1) { it.qty--; upsert(it); undoable(`${shortName(it.name)}: ${it.qty} left`, before, logId); }
  else { it.deleted = true; upsert(it); undoable(`Used up: ${shortName(it.name)}`, before, logId); }
}
function freeze(id) {
  const it = byId(id), before = { ...it };
  Object.assign(it, { location: 'freezer', frozenOn: todayStr(), date: null, dateType: 'none', estimated: false });
  upsert(it); undoable(`Frozen: ${shortName(it.name)}`, before);
}
function bin(id) {
  const it = byId(id), before = { ...it }, logId = logEvent(it, 'binned');
  it.deleted = true; upsert(it); undoable(`Binned: ${shortName(it.name)}`, before, logId);
}
function removeItem(id) { const it = byId(id), before = { ...it }; it.deleted = true; upsert(it); undoable('Removed', before); }

/* ---------- item sheet ---------- */
let cur = null, curIsNew = false, curOrig = '', afterSheet = null;
const QUICK = {
  useby: [['Today', 0], ['+1', 1], ['+2', 2], ['+3', 3], ['+5', 5], ['+1 wk', 7]],
  bestbefore: [['+1 wk', 7], ['+2 wk', 14], ['+1 mo', 30], ['+3 mo', 91], ['+6 mo', 182], ['+1 yr', 365]],
};
function openSheet(item, { isNew = false, after = null, meta = '' } = {}) {
  if (!item) return;
  cur = { ...item }; curIsNew = isNew; curOrig = JSON.stringify(item); afterSheet = after;
  if (isNew && !cur.date && cur.dateType !== 'none') cur.dateType = cur.dateType || 'useby';
  $('#sh-edit').hidden = !isNew;
  $('#sh-acts').hidden = isNew;
  $('#sh-remove').hidden = isNew;
  $('#sh-editbtn').hidden = isNew;
  $('#sh-save').textContent = isNew ? 'Add to the larder' : 'Done';
  $('#e-name').value = cur.name || ''; $('#e-qty').value = cur.qty || 1; $('#e-loc').value = cur.location || 'fridge';
  $('#readnote').hidden = true;
  $('#sh-meta').dataset.extra = meta;
  paintSheet();
  if (!$('#sheet').open) { $('#sheet').showModal(); history.pushState({ sheet: 1 }, ''); }
  if (isNew && !cur.name) setTimeout(() => $('#e-name').focus(), 150);
}
function paintSheet() {
  const name = $('#e-name').value.trim() || cur.name || 'New item';
  $('#sh-tile').outerHTML = tileHtml(name, true).replace('class="tile', 'id="sh-tile" class="tile');
  $('#sh-name').textContent = curIsNew ? (name === 'New item' ? 'New item' : shortName(name)) : shortName(cur.name);
  const src = cur.source && cur.source.startsWith('sainsburys') ? `from ${batchLabel(cur.addedAt)}` : cur.addedBy ? `added by ${cur.addedBy}` : '';
  $('#sh-meta').textContent = $('#sh-meta').dataset.extra || [cur.qty > 1 ? `×${cur.qty}` : '', PLACE[cur.location], src].filter(Boolean).join(' · ');
  $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.type === (cur.dateType || 'none')));
  const none = cur.dateType === 'none';
  $('#stepper').hidden = $('#quick').hidden = none;
  $('#scanDate').hidden = none;
  if (!none) {
    if (cur.date) {
      const n = daysUntil(cur.date);
      $('#sh-date').textContent = new Date(cur.date + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + (cur.date.slice(0, 4) !== String(new Date().getFullYear()) ? ' ' + cur.date.slice(2, 4) : '');
      $('#sh-rel').textContent = relText(n) + (cur.estimated ? ' · our guess' : '');
      $('#sh-rel').className = n <= 1 ? 'hot' : '';
    } else { $('#sh-date').textContent = 'No date yet'; $('#sh-rel').textContent = 'scan it or pick one'; $('#sh-rel').className = ''; }
    $('#quick').innerHTML = (QUICK[cur.dateType] || QUICK.useby).map(([l, d]) => `<button type="button" data-d="${d}">${l}</button>`).join('');
  }
  $('#e-date').value = cur.date || '';
}
function setDate(d) { cur.date = d; cur.estimated = false; if (cur.dateType === 'none') cur.dateType = 'useby'; $('#readnote').hidden = true; paintSheet(); }
$$('.seg button').forEach(b => b.onclick = () => { cur.dateType = b.dataset.type; if (cur.dateType === 'none') cur.date = null; paintSheet(); });
$('#minus').onclick = () => setDate(addDays(-1, cur.date ? new Date(cur.date + 'T12:00') : new Date()));
$('#plus').onclick = () => setDate(addDays(1, cur.date ? new Date(cur.date + 'T12:00') : new Date(Date.now() - 864e5)));
$('#quick').addEventListener('click', e => { const b = e.target.closest('[data-d]'); if (b) setDate(addDays(+b.dataset.d)); });
$('#e-date').addEventListener('change', e => e.target.value && setDate(e.target.value));
$('#readnote').addEventListener('click', e => { const b = e.target.closest('[data-alt]'); if (b) setDate(b.dataset.alt); });
$('#e-name').addEventListener('input', paintSheet);
$('#sh-editbtn').onclick = () => { $('#sh-edit').hidden = !$('#sh-edit').hidden; };
function collectSheet() {
  if (!$('#sh-edit').hidden) {
    cur.name = $('#e-name').value.trim() || cur.name;
    cur.qty = Math.max(1, parseInt($('#e-qty').value) || 1);
    cur.location = $('#e-loc').value;
  }
  if (cur.dateType === 'none') cur.date = null;
}
function saveSheet() {
  collectSheet();
  if (!cur.name) { toast('Give it a name first'); $('#e-name').focus(); return false; }
  if (curIsNew) {
    const it = makeItem(cur, cfg.name); it.estimated = !!cur.estimated && !!cur.date;
    upsert(it);
    toast(`Added: ${shortName(it.name)}`);
  } else if (JSON.stringify(cur) !== curOrig) upsert(cur);
  if (cur.barcode) {
    data.products[cur.barcode] = { name: cur.name, location: cur.location, dateType: cur.dateType, days: cur.date ? daysUntil(cur.date) : null };
    saveLocal(); scheduleSync();
  }
  return true;
}
function closeSheet() {
  if ($('#sheet').open) $('#sheet').close();
  const cb = afterSheet; afterSheet = null; cur = null;
  if (history.state && history.state.sheet) history.back();
  if (cb) cb();
}
$('#sheetForm').addEventListener('submit', e => { e.preventDefault(); if (saveSheet()) closeSheet(); });
$('#sheet').addEventListener('cancel', e => { e.preventDefault(); if (!curIsNew) saveSheet(); closeSheet(); });
$('#sheet').addEventListener('click', e => { if (e.target === $('#sheet')) { if (!curIsNew) saveSheet(); closeSheet(); } });
$('#a-used').onclick = () => { const id = cur.id; closeSheet(); useOne(id); };
$('#a-freeze').onclick = () => { const id = cur.id; closeSheet(); freeze(id); };
$('#a-bin').onclick = () => { const id = cur.id; closeSheet(); bin(id); };
$('#sh-remove').onclick = () => { const id = cur.id; closeSheet(); removeItem(id); };

/* ---------- reading the date off the pack ---------- */
let ocrP = null;
function loadScript(src) {
  return new Promise((ok, fail) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
}
function getOcr() {
  if (!ocrP) ocrP = (async () => {
    await loadScript('vendor/ocr/tesseract.min.js');
    const base = new URL('vendor/ocr/', location.href).href;
    const w = await Tesseract.createWorker('eng', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: true, workerBlobURL: false });
    await w.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/.:- ' });
    return w;
  })().catch(e => { ocrP = null; throw e; });
  return ocrP;
}
// Image clean-up before OCR. Greyscale → stretch contrast → threshold → dark text on white.
// `blur` joins up dotted inkjet print; `adaptive` thresholds against the local neighbourhood, for shadows and shading.
function prepCanvas(src, { blur = 0, adaptive = false } = {}) {
  const W = src.width, H = src.height, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.filter = blur ? `blur(${blur}px)` : 'none'; g.drawImage(src, 0, 0); g.filter = 'none';
  const img = g.getImageData(0, 0, W, H), p = img.data, N = W * H, lum = new Float32Array(N), hist = new Array(256).fill(0);
  for (let i = 0, j = 0; j < N; i += 4, j++) { const v = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0; lum[j] = v; hist[v]++; }
  let lo = 0, hi = 255, acc = 0; const cut = N * 0.01;
  for (; lo < 255 && (acc += hist[lo]) < cut; lo++); acc = 0; for (; hi > 0 && (acc += hist[hi]) < cut; hi--);
  const span = Math.max(1, hi - lo); hist.fill(0);
  for (let j = 0; j < N; j++) { const v = Math.min(255, Math.max(0, (lum[j] - lo) * 255 / span)); lum[j] = v; hist[v | 0]++; }
  // Otsu: a global split, also used to decide whether the text is light-on-dark.
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = N - wB; if (!wF) break; sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2; if (between > best) { best = between; thr = t; } }
  let dark = 0; for (let j = 0; j < N; j++) if (lum[j] < thr) dark++;
  if (dark > N / 2) for (let j = 0; j < N; j++) lum[j] = 255 - lum[j];   // make the text the dark part
  if (dark > N / 2) thr = 255 - thr;
  const on = new Uint8Array(N);
  if (adaptive) {
    const ii = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += lum[y * W + x]; ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + row; } }
    const r = Math.max(8, Math.round(H / 5));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
      const s = ii[y1 * (W + 1) + x1] - ii[y0 * (W + 1) + x1] - ii[y1 * (W + 1) + x0] + ii[y0 * (W + 1) + x0];
      const mean = s / ((x1 - x0) * (y1 - y0));
      on[y * W + x] = lum[y * W + x] < mean - 18 ? 1 : 0;
    }
  } else for (let j = 0; j < N; j++) on[j] = lum[j] < thr ? 1 : 0;
  for (let i = 0, j = 0; j < N; i += 4, j++) { const v = on[j] ? 0 : 255; p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}
const OCR_PASSES = [{}, { adaptive: true }, { blur: 2, adaptive: true }, { blur: 3, adaptive: true }, { blur: 5 }, { blur: 5, adaptive: true }];
// Runs several clean-ups and cross-checks them: a date is trusted when two passes agree,
// or when one pass finds it in clean print right after "use by" / "best before".
async function readDateFrom(srcCanvas, passes = OCR_PASSES) {
  const w = await getOcr(), votes = {};
  let best = null;
  for (const opt of passes) {
    const { data: r } = await w.recognize(prepCanvas(srcCanvas, opt));
    const hit = readPackDate(r.text);
    if (!hit) continue;
    const v = votes[hit.date] = votes[hit.date] || { n: 0, score: 0, hit: null, text: '' };
    v.n++; if (hit.score > v.score) { v.score = hit.score; v.hit = hit; v.text = r.text.trim(); }
    const clean = (opt.blur || 0) === 0 && hit.score >= 7;
    if (v.n >= 2 || clean) { best = { ...v.hit, text: v.text, agree: v.n, sure: true }; break; }
  }
  if (!best) {
    const ranked = Object.entries(votes).sort((a, b) => b[1].n - a[1].n || b[1].score - a[1].score);
    if (!ranked.length) return null;
    const [, v] = ranked[0];
    best = { ...v.hit, text: v.text, agree: v.n, sure: false };
  }
  best.alts = Object.keys(votes).filter(d => d !== best.date);
  return best;
}

let dcStream = null, dcLoop = false, dcDone = null, dcSeen = {};
function grabBox() {
  const v = $('#dc-video'), box = $('#dc-box');
  const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return null;
  const r = v.getBoundingClientRect(), b = box.getBoundingClientRect();
  const scale = Math.max(r.width / vw, r.height / vh), offX = (r.width - vw * scale) / 2, offY = (r.height - vh * scale) / 2;
  const sx = (b.left - r.left - offX) / scale, sy = (b.top - r.top - offY) / scale, sw = b.width / scale, sh = b.height / scale;
  const outW = 1100, outH = Math.round(outW * sh / sw), c = document.createElement('canvas');
  c.width = outW; c.height = outH; c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);
  return c;
}
async function openDateCam() {
  if (!navigator.mediaDevices?.getUserMedia) { toast('This phone\'s browser can\'t use the camera here'); return null; }
  return new Promise(async resolve => {
    dcDone = resolve; dcSeen = {};
    $('#datecam').showModal(); $('#dc-status').textContent = 'Starting camera…'; $('#dc-box').classList.remove('busy');
    history.pushState({ cam: 1 }, '');
    try {
      dcStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const v = $('#dc-video'); v.srcObject = dcStream; await v.play();
      const track = dcStream.getVideoTracks()[0], caps = track.getCapabilities ? track.getCapabilities() : {};
      $('#dc-torch').hidden = !caps.torch;
      try { if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch {}
    } catch (e) { toast('Camera not available'); stopDateCam(null); return; }
    $('#dc-status').textContent = 'Getting the reader ready…';
    try { await getOcr(); } catch (e) { console.error(e); toast('Date reader failed to load'); stopDateCam(null); return; }
    dcLoop = true; let tries = 0;
    while (dcLoop) {
      $('#dc-status').textContent = tries < 6 ? 'Reading…' : 'Can\'t quite read it. Try the torch, or move a little closer.';
      const hit = await tryRead();
      if (hit) { stopDateCam(hit); break; }
      tries++; await sleep(250);
    }
  });
}
async function tryRead(force) {
  const c = grabBox(); if (!c) return null;
  $('#dc-box').classList.add('busy');
  try {
    const hit = await readDateFrom(c);
    if (!hit) return null;
    dcSeen[hit.date] = (dcSeen[hit.date] || 0) + 1;
    if ((hit.sure && hit.score >= 7) || dcSeen[hit.date] >= 2) return hit;   // clean labelled print, or two separate frames agree
    if (force) return hit;
    $('#dc-status').textContent = `Is it ${dayMon(hit.date)}? Hold steady…`;
    return null;
  } finally { $('#dc-box').classList.remove('busy'); }
}
function stopDateCam(result) {
  dcLoop = false;
  if (dcStream) { dcStream.getTracks().forEach(t => t.stop()); dcStream = null; }
  if ($('#datecam').open) $('#datecam').close();
  if (history.state && history.state.cam) history.back();
  if (dcDone) { const d = dcDone; dcDone = null; d(result); }
}
$('#dc-close').onclick = () => stopDateCam(null);
$('#datecam').addEventListener('cancel', e => { e.preventDefault(); stopDateCam(null); });
$('#dc-snap').onclick = async () => { $('#dc-status').textContent = 'Reading…'; const hit = await tryRead(true); if (hit) stopDateCam(hit); else $('#dc-status').textContent = 'No date found in the box. Try again.'; };
$('#dc-torch').onclick = async () => {
  const t = dcStream && dcStream.getVideoTracks()[0]; if (!t) return;
  const on = !t.getSettings().torch; try { await t.applyConstraints({ advanced: [{ torch: on }] }); } catch {}
};
$('#scanDate').onclick = async () => {
  const hit = await openDateCam();
  if (!hit || !cur) return;
  if (navigator.vibrate) navigator.vibrate(60);
  cur.date = hit.date; cur.estimated = false;
  if (hit.dateType) cur.dateType = hit.dateType; else if (cur.dateType === 'none') cur.dateType = 'useby';
  paintSheet();
  const alts = (hit.alts || []).slice(0, 2);
  $('#readnote').innerHTML = `Read from the pack: “${esc(hit.raw)}”. Check it looks right.` +
    (alts.length && !hit.sure ? `<br>Or did it say ${alts.map(d => `<button type="button" class="linkbtn" data-alt="${d}" style="display:inline;padding:4px">${dayMon(d)}</button>`).join(' or ')}?` : '');
  $('#readnote').hidden = false;
};

/* ---------- barcode scanning ---------- */
let scanner = null, scanning = false, scannedThisTime = 0;
async function startScan() {
  scannedThisTime = 0; updateScanCount();
  if (typeof Html5Qrcode === 'undefined') { await sleep(400); if (typeof Html5Qrcode === 'undefined') { toast('Scanner didn\'t load. Check your connection'); return; } }
  if (!scanner) {
    const F = Html5QrcodeSupportedFormats;
    scanner = new Html5Qrcode('reader', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128], verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
  }
  if (scanning) return;
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, onBarcode, () => {});
    scanning = true;
    try { $('#torchBtn').hidden = !scanner.getRunningTrackCapabilities().torch; } catch { $('#torchBtn').hidden = true; }
  } catch (err) { toast('Camera not available: ' + (err.message || err)); }
}
async function stopScan() { if (scanner && scanning) { scanning = false; try { await scanner.stop(); } catch {} } }
$('#torchBtn').onclick = async () => { try { const on = !scanner.getRunningTrackSettings().torch; await scanner.applyVideoConstraints({ advanced: [{ torch: on }] }); } catch {} };
function updateScanCount() { $('#scan-count').textContent = scannedThisTime ? `Scanning · ${scannedThisTime} added` : 'Point at a barcode'; }
async function onBarcode(code) {
  await stopScan();
  if (navigator.vibrate) navigator.vibrate(60);
  const resume = () => { if (screen === 'scan') { startScan(); } };
  const added = () => { scannedThisTime++; updateScanCount(); };
  const known = data.products[code];
  if (known) {
    openSheet({ name: known.name, qty: 1, location: known.location, dateType: known.dateType === 'none' ? 'useby' : known.dateType,
      date: known.days != null ? addDays(known.days) : null, estimated: known.days != null, barcode: code, source: 'scan' },
      { isNew: true, meta: 'Seen before · check the date on the pack', after: () => { resume(); } });
    return;
  }
  let name = '';
  try {
    toast('Looking it up…');
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_en,brands,quantity`);
    const j = await r.json();
    if (j.status === 1 && j.product) { const p = j.product; name = [p.brands?.split(',')[0], p.product_name_en || p.product_name, p.quantity].filter(Boolean).join(' ').trim(); }
  } catch {}
  const g = guess(name || '');
  openSheet({ name, qty: 1, location: g.location, dateType: g.dateType === 'none' ? 'useby' : g.dateType, date: null, barcode: code, source: 'scan' },
    { isNew: true, meta: name ? 'Found it · now the date' : 'New to us · type a name once and it\'s remembered', after: resume });
}
$('#manualBtn').onclick = async () => { await stopScan(); openSheet({ name: '', qty: 1, location: 'fridge', dateType: 'useby', date: null, source: 'manual' }, { isNew: true, after: () => { if (screen === 'scan') startScan(); } }); };
// Count additions made from the scan screen.
const _upsert = upsert;
upsert = function (item, quiet) { const isNewItem = !data.items.some(x => x.id === item.id); _upsert(item, quiet); if (isNewItem && screen === 'scan') { scannedThisTime++; updateScanCount(); } };

/* ---------- orders ---------- */
const pendingChecks = () => liveItems().filter(i => i.estimated && i.date && (i.source || '').startsWith('sainsburys')).sort((a, b) => a.name.localeCompare(b.name));
function latestBatch() {
  const its = data.items.filter(i => (i.source || '').startsWith('sainsburys'));
  if (!its.length) return null;
  const day = its.map(i => (i.addedAt || '').slice(0, 10)).sort().pop();
  return { day, items: its.filter(i => (i.addedAt || '').slice(0, 10) === day) };
}
function batchLabel(at) {
  const day = (at || (latestBatch() || {}).day || '').slice(0, 10); if (!day) return 'Sainsbury\'s shop';
  const n = -daysUntil(day);
  return n === 0 ? 'Today\'s shop' : n === 1 ? 'Yesterday\'s shop' : n < 7 ? `${new Date(day + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long' })}'s shop` : `the ${dayMon(day)} shop`;
}
function renderOrders() {
  const b = latestBatch(), pend = pendingChecks();
  if (b) {
    const total = b.items.length, done = b.items.filter(i => !i.estimated || i.deleted || !i.date).length;
    $('#order-kicker').textContent = `Sainsbury's · ${new Date(b.day + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} · ${total} items`;
    $('#order-title').innerHTML = pend.length ? 'Check the dates<br>as you unpack' : 'All dates checked';
    $('#order-progress').hidden = false;
    $('#order-fill').style.width = `${Math.round(done / total * 100)}%`;
    $('#order-count').textContent = `${done} of ${total} done`;
  } else {
    $('#order-kicker').textContent = 'Sainsbury\'s';
    $('#order-title').innerHTML = 'No orders yet';
    $('#order-progress').hidden = true;
  }
  $('#order-hint').textContent = pend.length ? 'Our guess is on the green button. Tap it if the pack agrees.'
    : b ? 'Nothing left to check. New orders appear here by themselves when the app opens.' : 'When a Sainsbury\'s receipt reaches the larder inbox, the items appear here by themselves.';
  $('#checklist').innerHTML = pend.map(it => `<div class="ck" data-id="${it.id}">${tileHtml(it.name)}
      <div class="t"><div class="nm">${esc(shortName(it.name))}${it.qty > 1 ? ` ×${it.qty}` : ''}</div><div class="sb">${it.dateType === 'useby' ? 'Use by' : 'Best before'}</div></div>
      <button class="yes" data-yes="${it.id}">${daysUntil(it.date) < 7 ? weekday(it.date) + ' ' + Number(it.date.slice(8)) : dayMon(it.date)}</button>
      <button class="pen" data-pen="${it.id}" aria-label="Different date"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button></div>`).join('');
}
$('#checklist').addEventListener('click', e => {
  const y = e.target.closest('[data-yes]'), p = e.target.closest('[data-pen]');
  if (y) { const it = byId(y.dataset.yes); it.estimated = false; upsert(it); if (navigator.vibrate) navigator.vibrate(20); }
  if (p) openSheet(byId(p.dataset.pen));
});

/* manual import: email file, PDF, pasted text, shared from another app */
let review = [];
function readOrder(text) {
  review = parseReceipt(anyToText(text));
  if (!review.length) { toast('No items found in that. Try the e-receipt email'); return; }
  if (screen !== 'orders') show('orders');
  renderReview(); $('#review').hidden = false;
  setTimeout(() => $('#review').scrollIntoView({ behavior: 'smooth' }), 60);
}
$('#parseBtn').onclick = () => readOrder($('#pasteBox').value);
$('#fileBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); };
async function readFile(f) {
  toast('Reading ' + (f.name || 'file') + '…');
  try {
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) readOrder(await pdfToText(await f.arrayBuffer()));
    else if (/\.msg$/i.test(f.name)) toast('That\'s an Outlook .msg file. Save it as PDF instead');
    else readOrder(await f.text());
  } catch (err) { console.error(err); toast('Couldn\'t read that file'); }
}
async function pdfToText(buf) {
  await loadScript('vendor/pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise, lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent(), rows = new Map();
    for (const it of tc.items) { if (!it.str.trim()) continue; const y = Math.round(it.transform[5] / 3); (rows.get(y) || rows.set(y, []).get(y)).push(it); }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, r]) => lines.push(r.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ')));
  }
  return lines.join('\n');
}
async function readShared() {
  const q = new URLSearchParams(location.search); if (!q.has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('larder-share'), res = await c.match('shared');
    if (!res) return; await c.delete('shared');
    const fd = await res.formData(), file = fd.get('file');
    if (file && file.size) readFile(file); else readOrder([fd.get('title'), fd.get('text'), fd.get('url')].filter(Boolean).join('\n'));
  } catch (e) { console.error(e); }
}
function renderReview() {
  $('#review-title').textContent = `Check the items (${review.length} found)`;
  $('#review-list').innerHTML = review.map((r, i) => `<div class="rev" data-i="${i}">
    <div class="r1"><input type="checkbox" data-f="include" ${r.include ? 'checked' : ''} aria-label="Include">
      <input type="text" class="field" data-f="name" value="${esc(r.name)}" aria-label="Name">
      <input type="number" class="field" data-f="qty" value="${r.qty}" min="1" style="width:64px;flex:none" inputmode="numeric" aria-label="Quantity"></div>
    <div class="r2"><select class="field" data-f="location" aria-label="Where">${['fridge', 'freezer', 'cupboard'].map(l => `<option value="${l}" ${r.location === l ? 'selected' : ''}>${PLACE[l]}</option>`).join('')}</select>
      <input type="date" class="field" data-f="date" value="${r.date || ''}" aria-label="Date"></div>${r.estimated ? '<div class="est">our guess at the date</div>' : ''}</div>`).join('');
  updateImportBtn();
}
$('#review-list').addEventListener('input', e => {
  const row = e.target.closest('.rev'), f = e.target.dataset.f; if (!row || !f) return;
  const r = review[+row.dataset.i];
  r[f] = e.target.type === 'checkbox' ? e.target.checked : f === 'qty' ? Math.max(1, +e.target.value || 1) : e.target.value;
  if (f === 'date') r.estimated = false;
  updateImportBtn();
});
function updateImportBtn() { const n = review.filter(r => r.include).length; $('#importBtn').textContent = `Add ${n} item${n === 1 ? '' : 's'}`; }
$('#importBtn').onclick = () => {
  const chosen = review.filter(r => r.include && r.name.trim());
  for (const r of chosen) data.items.push(makeItem({ ...r, source: 'sainsburys' }, cfg.name));
  saveLocal(); scheduleSync();
  review = []; $('#review').hidden = true; $('#pasteBox').value = ''; $('#pasteWrap').open = false;
  toast(`Added ${chosen.length} items`); render();
};

/* ---------- GitHub storage ---------- */
function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin); }
function b64decode(b64) { const bin = atob(b64.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
const repoUrl = () => `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
const apiUrl = () => `${repoUrl()}/contents/${(cfg.path || 'inventory.json').split('/').map(encodeURIComponent).join('/')}`;
const headers = () => ({ Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
async function ghGet() {
  const r = await fetch(`${apiUrl()}?ref=${encodeURIComponent(cfg.branch || 'main')}`, { headers: headers(), cache: 'no-store' });
  if (r.status === 404) return { remote: emptyData(), sha: null };
  if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}`), { status: r.status });
  const j = await r.json();
  return { remote: Object.assign(emptyData(), JSON.parse(b64decode(j.content))), sha: j.sha };
}
async function ghPut(d, sha) {
  const body = { message: `Larder update (${cfg.name || 'phone'})`, content: b64encode(JSON.stringify(d, null, 1)), branch: cfg.branch || 'main' };
  if (sha) body.sha = sha;
  const r = await fetch(apiUrl(), { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}`), { status: r.status });
}
let syncing = false, syncAgain = false, syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 700); }
function setSync(state, title) { const d = $('#syncdot'); d.className = 'dot ' + state; d.title = title; }
async function sync() {
  if (!configured()) { setSync('', 'Not connected'); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true; setSync('busy', 'Syncing…');
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { remote, sha } = await ghGet();
      const merged = merge(remote, data);
      data = merged; saveLocal();
      if (!(cur && $('#sheet').open)) render();
      if (JSON.stringify(merge(remote, emptyData())) === JSON.stringify(merged) && sha) break;
      try { await ghPut(merged, sha); break; }
      catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 4) continue; throw e; }
    }
    setSync('ok', 'Synced ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    console.error(e);
    setSync('err', e.status === 401 ? 'Access key rejected. Check Settings' : e.status === 404 ? 'Data repo not found. Check Settings' : 'Offline. Changes are saved on this phone');
    if (e.status === 401 || e.status === 404) toast($('#syncdot').title);
  } finally { syncing = false; if (syncAgain) { syncAgain = false; sync(); } }
}

/* ask the GitHub job to look for new orders: quietly on open (at most hourly across phones), or on request */
let checking = false;
async function requestCheck(manual = false) {
  if (!configured() || checking) return;
  const last = Math.max(Date.parse(data.meta.lastMailCheck || 0) || 0, +localStorage.getItem('larder.lastCheckAsk') || 0);
  if (!manual && Date.now() - last < 3600e3) return;
  checking = true; localStorage.setItem('larder.lastCheckAsk', Date.now());
  const before = liveItems().length;
  if (manual) $('#checkNow').textContent = 'Checking… (about a minute)';
  try {
    const r = await fetch(`${repoUrl()}/actions/workflows/larder.yml/dispatches`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: cfg.branch || 'main', inputs: { mode: 'check' } }) });
    if (!r.ok) throw Object.assign(new Error('dispatch ' + r.status), { status: r.status });
    for (const wait of [40, 30, 30, 40]) { await sleep(wait * 1000); await sync(); if (Date.parse(data.meta.lastMailCheck || 0) > last) break; }
    const added = liveItems().length - before;
    if (manual) toast(added > 0 ? `Found a new order: ${added} items added` : 'No new orders');
  } catch (e) {
    console.error(e);
    if (manual) toast(e.status === 403 || e.status === 404 ? 'The access key can\'t start checks yet (needs Actions permission)' : 'Couldn\'t check right now');
  } finally { checking = false; $('#checkNow').textContent = 'Check for new orders now'; }
}
$('#checkNow').onclick = () => requestCheck(true);

/* ---------- reminders (web push, sent by the job in the data repo) ---------- */
function deviceId() { let d = localStorage.getItem('larder.device'); if (!d) { d = uid(); localStorage.setItem('larder.device', d); } return d; }
const myDevice = () => data.devices[deviceId()];
const remindersOn = () => !!(myDevice() && !myDevice().gone && 'Notification' in window && Notification.permission === 'granted');
function b64urlToBytes(s) { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function enableReminders() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('This browser can\'t do notifications. Open the app in Chrome'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications are blocked. Allow them in Chrome\'s site settings'); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(window.LARDER_VAPID) });
  const prev = myDevice() || {};
  data.devices[deviceId()] = { id: deviceId(), name: cfg.name || 'Phone', sub: sub.toJSON(), morning: prev.morning ?? true, evening: prev.evening ?? true, imports: prev.imports ?? true, updatedAt: nowIso() };
  saveLocal(); scheduleSync(); render();
  reg.showNotification('Reminders are on', { body: 'You\'ll get a nudge at 8am when food needs using up.', icon: 'icon-192.png', badge: 'icon-192.png' });
}
function setReminderPref(key, val) { const d = myDevice(); if (!d) return; data.devices[d.id] = { ...d, [key]: val, updatedAt: nowIso() }; saveLocal(); scheduleSync(); }
async function refreshSubscription() {
  if (!remindersOn()) return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub && JSON.stringify(sub.toJSON()) !== JSON.stringify(myDevice().sub)) { data.devices[deviceId()] = { ...myDevice(), sub: sub.toJSON(), updatedAt: nowIso() }; saveLocal(); scheduleSync(); }
  } catch {}
}

/* ---------- settings ---------- */
function fillSettings() {
  $('#s-name').value = cfg.name || ''; $('#s-owner').value = cfg.owner || ''; $('#s-repo').value = cfg.repo || ''; $('#s-token').value = cfg.token || '';
  $('#storage').open = !configured();
}
function renderSettings() {
  const on = remindersOn(), d = myDevice() || {};
  $('#remState').innerHTML = on
    ? `<label class="tick"><input type="checkbox" data-pref="morning" ${d.morning !== false ? 'checked' : ''}> 8am: what to use today and tomorrow</label>
       <label class="tick"><input type="checkbox" data-pref="evening" ${d.evening !== false ? 'checked' : ''}> 5pm: anything that must be eaten tonight</label>
       <label class="tick"><input type="checkbox" data-pref="imports" ${d.imports !== false ? 'checked' : ''}> When a Sainsbury's order is added</label>`
    : `<p class="hint" style="margin:0">Get a nudge when food is about to go off.</p><button class="btn" id="remBtn">Turn on reminders</button>`;
  if (!on) $('#remBtn').onclick = enableReminders;
  const since = new Date(Date.now() - 30 * 86400000).toISOString(), recent = data.log.filter(l => l.at > since);
  const used = recent.filter(l => l.action === 'used').length, binned = recent.filter(l => l.action === 'binned');
  const pct = used + binned.length ? Math.round(binned.length / (used + binned.length) * 100) : 0;
  $('#stats').innerHTML = `<div class="stat"><span>Used</span><b>${used}</b></div><div class="stat"><span>Binned</span><b>${binned.length} (${pct}%)</b></div>
    ${binned.slice(0, 6).map(l => `<div class="stat"><span>${esc(shortName(l.name))}</span><span>${dayMon(l.at.slice(0, 10))}</span></div>`).join('')}`;
}
$('#remState').addEventListener('change', e => { const k = e.target.dataset.pref; if (k) setReminderPref(k, e.target.checked); });
$('#s-name').addEventListener('change', e => { cfg.name = e.target.value.trim(); saveCfg(); });
$('#saveCfg').onclick = () => {
  cfg = { ...cfg, name: $('#s-name').value.trim(), owner: $('#s-owner').value.trim(), repo: $('#s-repo').value.trim(), token: $('#s-token').value.trim() };
  saveCfg(); toast('Saved'); sync();
};
$('#shareCfg').onclick = async () => {
  if (!configured()) { toast('Connect this phone first'); return; }
  const { owner, repo, branch, path, token } = cfg;
  const link = `${location.origin}${location.pathname}#setup=${encodeURIComponent(btoa(JSON.stringify({ owner, repo, branch, path, token })))}`;
  try { if (navigator.share) await navigator.share({ title: 'Larder', text: 'Tap to set up our Larder app:', url: link }); else { await navigator.clipboard.writeText(link); toast('Link copied'); } } catch {}
};
$('#exportBtn').onclick = () => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `larder-backup-${todayStr()}.json`; a.click();
};
function readSetupLink() {
  const m = location.hash.match(/setup=([^&]+)/); if (!m) return false;
  try { cfg = { ...cfg, ...JSON.parse(atob(decodeURIComponent(m[1]))) }; saveCfg(); history.replaceState(null, '', location.pathname); return true; }
  catch { toast('That setup link didn\'t work'); return false; }
}

/* ---------- welcome ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (screen === 'welcome') renderWelcome(); });
window.addEventListener('appinstalled', () => { localStorage.setItem('larder.installed', '1'); if (screen === 'welcome') renderWelcome(); });
const standalone = () => matchMedia('(display-mode: standalone)').matches;
const isInstalled = () => standalone() || localStorage.getItem('larder.installed') === '1';
function needsWelcome() { return !configured() || (localStorage.getItem('larder.welcomeDone') !== '1' && !(isInstalled() && remindersOn())); }
function renderWelcome() {
  $('#w-title').textContent = configured() && cfg.name ? `Hi ${cfg.name}, you're in.` : 'Welcome to Larder';
  $('#w-sub').textContent = configured() ? 'Your phone is connected to the family larder. Just two taps left.' : 'What\'s in the fridge, freezer and cupboard, and what needs eating first.';
  const steps = [
    { done: configured(), t: 'Connect', p: 'Open the setup link you were sent.', b: '<button class="btn ghost" id="w-setup">I\'m the first one: enter the key</button>' },
    { done: isInstalled(), t: 'Put it on your home screen', p: installEvt ? 'So it opens like any other app.' : 'In Chrome, tap ⋮ then Install app (or Add to Home screen).', b: installEvt ? '<button class="btn" id="w-install">Install Larder</button>' : '' },
    { done: remindersOn(), t: 'Turn on reminders', p: 'A nudge at 8am when food needs using up, and when the shopping\'s been added.', b: '<button class="btn" id="w-rem">Turn on reminders</button>' },
  ];
  $('#w-steps').innerHTML = steps.map((s, i) => `<div class="step ${s.done ? 'done' : ''}"><div class="n">${s.done ? '✓' : i + 1}</div><div><b>${s.t}</b>${s.done ? '' : `<p>${s.p}</p>${s.b}`}</div></div>`).join('');
  $('#w-setup') && ($('#w-setup').onclick = () => { show('settings'); $('#storage').open = true; setTimeout(() => $('#s-token').focus(), 150); });
  $('#w-install') && ($('#w-install').onclick = async () => { installEvt.prompt(); const r = await installEvt.userChoice; if (r.outcome === 'accepted') { localStorage.setItem('larder.installed', '1'); installEvt = null; renderWelcome(); } });
  $('#w-rem') && ($('#w-rem').onclick = async () => { if (!configured()) { toast('Connect first'); return; } await enableReminders(); renderWelcome(); });
  $('#w-skip').textContent = steps.every(s => s.done) ? 'Start using Larder' : 'Skip for now';
  if (steps.every(s => s.done)) { localStorage.setItem('larder.welcomeDone', '1'); }
}
$('#w-skip').onclick = () => { localStorage.setItem('larder.welcomeDone', '1'); show('home', { noHistory: true }); };

/* ---------- toast ---------- */
let toastT;
function toast(text, undo) {
  const el = $('#toast');
  el.innerHTML = esc(text) + (undo ? ' <button class="linkbtn" style="color:#86efac;padding:0 0 0 8px">Undo</button>' : '');
  el.style.pointerEvents = undo ? 'auto' : 'none';
  if (undo) el.querySelector('button').onclick = () => { el.classList.remove('on'); undo(); };
  el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), undo ? 5000 : 2400);
}

/* ---------- start ---------- */
const fromLink = readSetupLink();
window.addEventListener('hashchange', () => { if (readSetupLink()) { askName(); show('welcome', { noHistory: true }); sync(); } });
function askName() { if (!cfg.name) { const n = prompt('Connected! What\'s your name? (shown on things you add)'); if (n) { cfg.name = n.trim(); saveCfg(); } } }
if (fromLink) askName();
show(needsWelcome() ? 'welcome' : 'home', { noHistory: true });
sync();
setTimeout(() => requestCheck(false), 3000);
readShared();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); sync(); requestCheck(false); } });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(refreshSubscription).catch(() => {});
const startTab = new URLSearchParams(location.search).get('tab'); if (startTab && !needsWelcome()) show(startTab);
