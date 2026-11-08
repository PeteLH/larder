/* Larder — shared food stock tracker.
   Data lives in one JSON file in a private GitHub repo, read/written via the GitHub Contents API.
   Each phone keeps a local copy so the app works offline and syncs when it can. */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const KEY_CFG = 'larder.cfg', KEY_DATA = 'larder.data';

/* ---------- state ---------- */
let cfg = Object.assign({}, window.LARDER_DEFAULTS || {}, JSON.parse(localStorage.getItem(KEY_CFG) || '{}'));
let data = loadLocal();
let locFilter = 'all';

function loadLocal() { try { return Object.assign(emptyData(), JSON.parse(localStorage.getItem(KEY_DATA) || '{}')); } catch { return emptyData(); } }
function saveLocal() { localStorage.setItem(KEY_DATA, JSON.stringify(data)); }
const liveItems = () => data.items.filter(i => !i.deleted);
const configured = () => cfg.owner && cfg.repo && cfg.token;

/* ---------- GitHub storage ---------- */
function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin); }
function b64decode(b64) { const bin = atob(b64.replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
const apiUrl = () => `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${(cfg.path || 'inventory.json').split('/').map(encodeURIComponent).join('/')}`;
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
async function sync() {
  if (!configured()) { setStatus('Not set up — see Settings'); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true; setStatus('Syncing…');
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { remote, sha } = await ghGet();
      const merged = merge(remote, data);
      data = merged; saveLocal(); render();
      if (JSON.stringify(merge(remote, emptyData())) === JSON.stringify(merged) && sha) break; // nothing new to push
      try { await ghPut(merged, sha); break; }
      catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 4) continue; throw e; }
    }
    setStatus('Synced ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    console.error(e);
    setStatus(e.status === 401 ? 'Token rejected — check Settings' : e.status === 404 ? 'Repo not found — check Settings' : 'Offline — saved on phone');
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; sync(); }
  }
}
function setStatus(t) { $('#status').textContent = t; }

/* ---------- mutations ---------- */
function upsert(item) {
  item.updatedAt = nowIso();
  const i = data.items.findIndex(x => x.id === item.id);
  if (i >= 0) data.items[i] = item; else data.items.push(item);
  saveLocal(); render(); scheduleSync();
}
function logEvent(item, action) {
  data.log.unshift({ id: uid(), name: item.name, action, at: nowIso(), by: cfg.name || '', daysLeft: daysUntil(item.date) });
}
const newItem = p => makeItem(p, cfg.name);

/* ---------- stock list ---------- */
function badge(it) {
  if (!it.date) return it.location === 'freezer' && it.frozenOn ? `<span class="badge b-blue">Frozen ${prettyDate(it.frozenOn)}</span>` : `<span class="badge b-grey">No date</span>`;
  const n = daysUntil(it.date), ub = it.dateType === 'useby', est = it.estimated ? '~' : '';
  if (n < 0) return ub ? `<span class="badge b-red">Use-by passed</span>` : `<span class="badge b-amber">Past best before</span>`;
  const txt = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 7 ? prettyDate(it.date).split(' ')[0] + ` (${n}d)` : `${n} days`;
  const cls = n <= 1 ? (ub ? 'b-red' : 'b-amber') : n <= 3 ? 'b-amber' : 'b-grey';
  return `<span class="badge ${cls}">${est}${txt}</span>`;
}
function groupOf(it) {
  if (!it.date) return 5;
  const n = daysUntil(it.date);
  return n < 0 ? 0 : n === 0 ? 1 : n === 1 ? 2 : n <= 7 ? 3 : 4;
}
const GROUPS = ['Out of date', 'Today', 'Tomorrow', 'This week', 'Later', 'No date / frozen'];
const LOC_ICON = { fridge: '🧊', freezer: '❄️', cupboard: '🗄️' };

function render() {
  const q = $('#search').value.trim().toLowerCase();
  const items = liveItems()
    .filter(i => locFilter === 'all' || i.location === locFilter)
    .filter(i => !q || i.name.toLowerCase().includes(q))
    .sort((a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1 : a.name.localeCompare(b.name));

  const urgent = liveItems().filter(i => i.date && i.dateType === 'useby' && daysUntil(i.date) <= 1 && daysUntil(i.date) >= 0);
  const gone = liveItems().filter(i => i.date && i.dateType === 'useby' && daysUntil(i.date) < 0);
  $('#alerts').innerHTML =
    (urgent.length ? `<div class="alert">⏰ ${urgent.length} item${urgent.length > 1 ? 's' : ''} to use today or tomorrow: ${urgent.slice(0, 4).map(i => esc(i.name)).join(', ')}${urgent.length > 4 ? '…' : ''}</div>` : '') +
    (gone.length ? `<div class="alert">⚠️ ${gone.length} past use-by — check and bin or tick off</div>` : '');

  if (!items.length) {
    $('#list').innerHTML = `<div class="empty">${liveItems().length ? 'Nothing matches.' : 'No stock yet.<br>Import a Sainsbury\'s order or scan some items.'}</div>`;
  } else {
    let html = '', last = -1;
    for (const it of items) {
      const g = groupOf(it);
      if (g !== last) { html += `<h3>${GROUPS[g]}</h3>`; last = g; }
      const dlabel = it.date ? (it.dateType === 'useby' ? 'Use by ' : 'Best before ') + prettyDate(it.date) + (it.estimated ? ' (estimated)' : '') : '';
      html += `<div class="item" data-id="${it.id}">
        <div class="main"><div class="name">${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}</div>
        <div class="meta">${LOC_ICON[it.location] || ''} ${esc(dlabel)}</div></div>
        ${badge(it)}
        <button class="used" data-used="${it.id}" aria-label="Used one">✓</button></div>`;
    }
    $('#list').innerHTML = html;
  }
  renderStats();
  if ('setAppBadge' in navigator) { const n = urgent.length + gone.length; n ? navigator.setAppBadge(n).catch(() => {}) : navigator.clearAppBadge().catch(() => {}); }
}

function renderStats() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const recent = data.log.filter(l => l.at > since);
  const used = recent.filter(l => l.action === 'used').length, binned = recent.filter(l => l.action === 'binned');
  const pct = used + binned.length ? Math.round(binned.length / (used + binned.length) * 100) : 0;
  $('#stats').innerHTML = `<div class="stat"><span>Used (last 30 days)</span><b>${used}</b></div>
    <div class="stat"><span>Binned (last 30 days)</span><b>${binned.length} (${pct}%)</b></div>
    ${binned.slice(0, 8).map(l => `<div class="stat"><span>🗑️ ${esc(l.name)}</span><span>${new Date(l.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div>`).join('')}`;
}

/* ---------- edit dialog ---------- */
let editing = null, onSaved = null;
function openEditor(item, { isNew = false, info = '', after = null } = {}) {
  editing = { ...item }; onSaved = after;
  $('#editTitle').textContent = isNew ? 'Add item' : 'Edit item';
  $('#editInfo').textContent = info;
  $('#e-name').value = item.name || '';
  $('#e-qty').value = item.qty || 1;
  $('#e-loc').value = item.location || 'fridge';
  $('#e-type').value = item.date ? item.dateType : item.dateType === 'none' || !isNew ? 'none' : (item.dateType || 'useby');
  $('#e-date').value = item.date || '';
  $('#e-actions').style.display = $('#e-actions2').style.display = isNew ? 'none' : 'flex';
  $('#editDlg').showModal();
}
function closeEditor() { $('#editDlg').close(); }

$('#quickDates').addEventListener('click', e => {
  const d = e.target.dataset.d; if (d === undefined) return;
  $('#e-date').value = addDays(+d);
  if ($('#e-type').value === 'none') $('#e-type').value = 'useby';
});
$('#editForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#e-name').value.trim(); if (!name) return;
  const type = $('#e-type').value, date = $('#e-date').value || null;
  const it = { ...editing, name, qty: Math.max(1, parseInt($('#e-qty').value) || 1), location: $('#e-loc').value,
    dateType: type === 'none' ? 'none' : type, date: type === 'none' ? null : date };
  if (date !== editing.date || type !== editing.dateType) it.estimated = false;
  if (!it.id) Object.assign(it, newItem(it), { estimated: false });
  if (it.barcode) data.products[it.barcode] = { name: it.name, location: it.location, dateType: it.dateType, days: it.date ? daysUntil(it.date) : null };
  upsert(it); closeEditor(); toast('Saved');
  if (onSaved) onSaved();
});
$('#e-cancel').onclick = () => { closeEditor(); if (onSaved) onSaved(); };
$('#e-used').onclick = () => { useOne(editing.id); closeEditor(); };
$('#e-binned').onclick = () => {
  const it = data.items.find(i => i.id === editing.id); logEvent(it, 'binned');
  it.deleted = true; upsert(it); closeEditor(); toast('Logged as binned');
};
$('#e-freeze').onclick = () => {
  const it = data.items.find(i => i.id === editing.id);
  Object.assign(it, { location: 'freezer', frozenOn: todayStr(), date: null, dateType: 'none', estimated: false });
  upsert(it); closeEditor(); toast('Moved to freezer');
};
$('#e-delete').onclick = () => { const it = data.items.find(i => i.id === editing.id); it.deleted = true; upsert(it); closeEditor(); toast('Removed'); };

function useOne(id) {
  const it = data.items.find(i => i.id === id); if (!it) return;
  logEvent(it, 'used');
  if (it.qty > 1) { it.qty--; toast(`${it.name}: ${it.qty} left`); }
  else { it.deleted = true; toast(`Used up: ${it.name}`); }
  upsert(it);
}

$('#list').addEventListener('click', e => {
  const u = e.target.closest('[data-used]'); if (u) { useOne(u.dataset.used); return; }
  const row = e.target.closest('.item'); if (!row) return;
  const it = data.items.find(i => i.id === row.dataset.id);
  if (it) openEditor(it, { info: `Added ${new Date(it.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${it.addedBy ? ' by ' + it.addedBy : ''}${it.source === 'sainsburys' ? ' from Sainsbury\'s order' : ''}` });
});
$('#search').addEventListener('input', render);
$('#locFilter').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  locFilter = b.dataset.loc; $$('#locFilter .chip').forEach(c => c.classList.toggle('on', c === b)); render();
});

/* ---------- barcode scanning ---------- */
let scanner = null, scanning = false;
async function startScan() {
  if (typeof Html5Qrcode === 'undefined') { toast('Scanner failed to load — check connection'); return; }
  if (!scanner) {
    const F = Html5QrcodeSupportedFormats;
    scanner = new Html5Qrcode('reader', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128], verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
  }
  try {
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, onScan, () => {});
    scanning = true; $('#scanBtn').textContent = '⏹ Stop scanning';
  } catch (err) { toast('Camera not available: ' + (err.message || err)); }
}
async function stopScan() {
  if (scanner && scanning) { try { await scanner.stop(); } catch {} }
  scanning = false; $('#scanBtn').textContent = '📷 Start scanning';
}
$('#scanBtn').onclick = () => scanning ? stopScan() : startScan();

async function onScan(code) {
  await stopScan();
  if (navigator.vibrate) navigator.vibrate(60);
  const after = () => { if ($('#keepScanning').checked && $('#tab-add').classList.contains('on')) startScan(); };
  const known = data.products[code];
  if (known) {
    openEditor({ name: known.name, qty: 1, location: known.location, dateType: known.dateType === 'none' ? 'useby' : known.dateType,
      date: known.days != null ? addDays(known.days) : null, barcode: code },
      { isNew: true, info: `Seen before · ${code}. Check the date on the pack.`, after });
    return;
  }
  toast('Looking up product…');
  let name = '';
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_en,brands,quantity`);
    const j = await r.json();
    if (j.status === 1 && j.product) {
      const p = j.product;
      name = [p.brands?.split(',')[0], p.product_name_en || p.product_name, p.quantity].filter(Boolean).join(' ').trim();
    }
  } catch {}
  const g = guess(name || '');
  openEditor({ name, qty: 1, location: g.location, dateType: g.dateType === 'none' ? 'useby' : g.dateType, date: null, barcode: code },
    { isNew: true, info: name ? `Found: ${code}. Set the date from the pack.` : `Barcode ${code} not recognised — type a name once and it'll be remembered.`, after });
}
$('#manualBtn').onclick = () => openEditor({ name: '', qty: 1, location: 'fridge', dateType: 'useby', date: null }, { isNew: true });

/* ---------- Sainsbury's import ---------- */
let review = [];
function readOrder(text) {
  review = parseReceipt(anyToText(text));
  if (!review.length) { toast('No items found in that — try the e-receipt email'); return; }
  showTab('import'); renderReview(); $('#reviewCard').style.display = 'block';
  setTimeout(() => $('#reviewCard').scrollIntoView({ behavior: 'smooth' }), 50);
}
$('#parseBtn').onclick = () => readOrder($('#pasteBox').value);
$('#fileBtn').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); };
async function readFile(f) {
  toast('Reading ' + (f.name || 'file') + '…');
  try {
    if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) readOrder(await pdfToText(await f.arrayBuffer()));
    else if (/\.msg$/i.test(f.name)) toast('That\'s an Outlook .msg file — save it as PDF instead');
    else readOrder(await f.text());
  } catch (err) { console.error(err); toast('Couldn\'t read that file'); }
}
function loadScript(src) {
  return new Promise((ok, fail) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
}
async function pdfToText(buf) {
  const base = 'vendor/';
  await loadScript(base + 'pdf.min.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise, lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent(), rows = new Map();
    for (const it of tc.items) { if (!it.str.trim()) continue; const y = Math.round(it.transform[5] / 3); (rows.get(y) || rows.set(y, []).get(y)).push(it); }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, r]) => lines.push(r.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ')));
  }
  return lines.join('\n');
}
// Files or text shared into the app from another Android app (the service worker stashes them).
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
  $('#reviewTitle').textContent = `Check the items (${review.length} found)`;
  $('#reviewList').innerHTML = review.map((r, i) => `<div class="rev" data-i="${i}">
    <div class="top"><input type="checkbox" data-f="include" ${r.include ? 'checked' : ''}>
      <input type="text" data-f="name" value="${esc(r.name)}">
      <input type="number" data-f="qty" value="${r.qty}" min="1" style="width:56px;flex:none" inputmode="numeric"></div>
    <div class="bottom">
      <select data-f="location">${['fridge', 'freezer', 'cupboard'].map(l => `<option value="${l}" ${r.location === l ? 'selected' : ''}>${LOC_ICON[l]} ${l}</option>`).join('')}</select>
      <select data-f="dateType"><option value="useby" ${r.dateType === 'useby' ? 'selected' : ''}>Use by</option><option value="bestbefore" ${r.dateType === 'bestbefore' ? 'selected' : ''}>Best before</option><option value="none" ${r.dateType === 'none' ? 'selected' : ''}>No date</option></select>
      <input type="date" data-f="date" value="${r.date || ''}">
    </div>${r.estimated ? '<div class="est">~estimated date</div>' : ''}</div>`).join('');
  updateImportBtn();
}
$('#reviewList').addEventListener('input', e => {
  const row = e.target.closest('.rev'), f = e.target.dataset.f; if (!row || !f) return;
  const r = review[+row.dataset.i];
  r[f] = e.target.type === 'checkbox' ? e.target.checked : f === 'qty' ? Math.max(1, +e.target.value || 1) : e.target.value;
  if (f === 'date') r.estimated = false;
  updateImportBtn();
});
function updateImportBtn() { const n = review.filter(r => r.include).length; $('#importBtn').textContent = `Add ${n} item${n === 1 ? '' : 's'} to stock`; }
$('#importBtn').onclick = () => {
  const chosen = review.filter(r => r.include && r.name.trim());
  for (const r of chosen) data.items.push(newItem({ ...r, source: 'sainsburys' }));
  saveLocal(); render(); scheduleSync();
  review = []; $('#reviewCard').style.display = 'none'; $('#pasteBox').value = '';
  toast(`Added ${chosen.length} items`); showTab('stock');
};

/* ---------- settings ---------- */
function fillSettings() {
  $('#s-name').value = cfg.name || ''; $('#s-owner').value = cfg.owner || ''; $('#s-repo').value = cfg.repo || '';
  $('#s-branch').value = cfg.branch || ''; $('#s-path').value = cfg.path || ''; $('#s-token').value = cfg.token || '';
}
function saveCfg() { localStorage.setItem(KEY_CFG, JSON.stringify(cfg)); }
$('#s-name').addEventListener('change', e => { cfg.name = e.target.value.trim(); saveCfg(); });
$('#saveCfg').onclick = () => {
  cfg = { ...cfg, name: $('#s-name').value.trim(), owner: $('#s-owner').value.trim(), repo: $('#s-repo').value.trim(),
    branch: $('#s-branch').value.trim() || 'main', path: $('#s-path').value.trim() || 'inventory.json', token: $('#s-token').value.trim() };
  saveCfg(); sync(); toast('Saved');
};
$('#shareCfg').onclick = async () => {
  if (!configured()) { toast('Fill in and save the settings first'); return; }
  const { owner, repo, branch, path, token } = cfg;
  const link = `${location.origin}${location.pathname}#setup=${encodeURIComponent(btoa(JSON.stringify({ owner, repo, branch, path, token })))}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Larder setup', text: 'Tap to set up our Larder app:', url: link });
    else { await navigator.clipboard.writeText(link); toast('Link copied'); }
  } catch {}
};
$('#exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `larder-backup-${todayStr()}.json`; a.click();
};
function readSetupLink() {
  const m = location.hash.match(/setup=([^&]+)/); if (!m) return;
  try {
    const s = JSON.parse(atob(decodeURIComponent(m[1])));
    cfg = { ...cfg, ...s }; saveCfg();
    history.replaceState(null, '', location.pathname);
    if (!cfg.name) { const n = prompt('Set up done! What\'s your name? (shown on items you add)'); if (n) { cfg.name = n.trim(); saveCfg(); } }
    toast('Connected to your shared larder');
  } catch { toast('That setup link didn\'t work'); }
}

/* ---------- reminders (web push; sent by the scheduled job in the data repo) ---------- */
function deviceId() { let d = localStorage.getItem('larder.device'); if (!d) { d = uid(); localStorage.setItem('larder.device', d); } return d; }
const myDevice = () => data.devices[deviceId()];
const remindersOn = () => !!(myDevice() && !myDevice().gone && 'Notification' in window && Notification.permission === 'granted');
function b64urlToBytes(s) { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function enableReminders() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('This browser can\'t do notifications — open the app in Chrome'); return; }
  if (!window.LARDER_VAPID) { toast('Reminders aren\'t configured yet'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications are blocked — allow them in Chrome\'s site settings'); return; }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(window.LARDER_VAPID) });
  const prev = myDevice() || {};
  data.devices[deviceId()] = { id: deviceId(), name: cfg.name || 'Phone', sub: sub.toJSON(), morning: prev.morning ?? true, evening: prev.evening ?? true, updatedAt: nowIso() };
  saveLocal(); scheduleSync(); renderReminders(); renderWelcome();
  reg.showNotification('Larder reminders are on 👍', { body: 'You\'ll get a nudge at 8am when food needs using up.', icon: 'icon-192.png', badge: 'icon-192.png' });
}
function setReminderPref(key, val) {
  const d = myDevice(); if (!d) return;
  data.devices[d.id] = { ...d, [key]: val, updatedAt: nowIso() }; saveLocal(); scheduleSync();
}
async function refreshSubscription() {
  // Chrome occasionally rotates push subscriptions; keep the shared copy current.
  if (!remindersOn()) return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub && JSON.stringify(sub.toJSON()) !== JSON.stringify(myDevice().sub)) { data.devices[deviceId()] = { ...myDevice(), sub: sub.toJSON(), updatedAt: nowIso() }; saveLocal(); scheduleSync(); }
  } catch {}
}
function renderReminders() {
  const on = remindersOn(), d = myDevice() || {};
  $('#remState').innerHTML = on
    ? `<p class="hint">✅ On for this phone.</p>
       <label class="tick"><input type="checkbox" id="remMorning" ${d.morning !== false ? 'checked' : ''}> 8am — what to use today and tomorrow</label>
       <label class="tick"><input type="checkbox" id="remEvening" ${d.evening !== false ? 'checked' : ''}> 5pm — anything that must be eaten tonight</label>
       <label class="tick"><input type="checkbox" id="remImport" ${d.imports !== false ? 'checked' : ''}> When a Sainsbury's order is added</label>`
    : `<p class="hint">Get a nudge on this phone when food is about to go off.</p><button class="btn" id="remBtn">🔔 Turn on reminders</button>`;
  if (on) {
    $('#remMorning').onchange = e => setReminderPref('morning', e.target.checked);
    $('#remEvening').onchange = e => setReminderPref('evening', e.target.checked);
    $('#remImport').onchange = e => setReminderPref('imports', e.target.checked);
  } else $('#remBtn').onclick = enableReminders;
}

/* ---------- first-run checklist ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderWelcome(); });
window.addEventListener('appinstalled', () => { localStorage.setItem('larder.installed', '1'); renderWelcome(); });
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || localStorage.getItem('larder.installed') === '1';
function renderWelcome() {
  if (isInstalled() && matchMedia('(display-mode: standalone)').matches) localStorage.setItem('larder.installed', '1');
  const steps = [
    { done: configured(), title: 'Connect', body: 'Open the setup link you were sent. That\'s it.' },
    { done: isInstalled(), title: 'Put it on your home screen', body: installEvt ? '<button class="btn small" id="wInstall">📲 Install Larder</button>' : 'In Chrome tap <b>⋮</b> then <b>Install app</b> (or <b>Add to Home screen</b>).' },
    { done: remindersOn(), title: 'Turn on reminders', body: '<button class="btn small" id="wRem">🔔 Turn on</button>' },
  ];
  const card = $('#welcome');
  if (steps.every(s => s.done) || localStorage.getItem('larder.welcomeHidden') === '1') { card.style.display = 'none'; return; }
  card.style.display = 'block';
  card.innerHTML = `<h2>Welcome to Larder 👋</h2>${steps.map((s, i) => `<div class="step ${s.done ? 'done' : ''}">
      <div class="num">${s.done ? '✓' : i + 1}</div><div><b>${s.title}</b>${s.done ? '' : `<div class="hint">${s.body}</div>`}</div></div>`).join('')}
    <button class="btn ghost small" id="wHide" style="margin-top:8px">Hide this</button>`;
  $('#wInstall') && ($('#wInstall').onclick = async () => { installEvt.prompt(); const r = await installEvt.userChoice; if (r.outcome === 'accepted') { localStorage.setItem('larder.installed', '1'); installEvt = null; renderWelcome(); } });
  $('#wRem') && ($('#wRem').onclick = enableReminders);
  $('#wHide').onclick = () => { localStorage.setItem('larder.welcomeHidden', '1'); renderWelcome(); };
}

/* ---------- tabs, toast, boot ---------- */
function showTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name));
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  if (name !== 'add') stopScan();
  if (name === 'settings') { fillSettings(); renderReminders(); }
  window.scrollTo(0, 0);
}
$$('nav button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
let toastT; function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }

readSetupLink();
window.addEventListener('hashchange', () => { readSetupLink(); renderWelcome(); sync(); });
render();
sync();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); sync(); } });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(refreshSubscription).catch(() => {});
renderWelcome();
readShared();
if (new URLSearchParams(location.search).get('tab')) showTab(new URLSearchParams(location.search).get('tab'));
