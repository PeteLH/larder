/* Larder core — shared by the phone app (browser) and the scheduled GitHub job (Node). */
'use strict';

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
function addDays(n, from = new Date()) { const d = new Date(from); d.setDate(d.getDate() + n); return ymd(d); }
function daysUntil(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(); const a = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86400000);
}
function prettyDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
const nowIso = () => new Date().toISOString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function emptyData() { return { version: 2, items: [], products: {}, log: [], devices: {}, imported: [], meta: {} }; }

/* ---------- shelf-life guesses (used when no date is known) ---------- */
// [regex, location, dateType, days]  — first match wins. days null = no date.
const RULES = [
  [/toilet|kitchen roll|tissue|washing|laundry|detergent|bleach|cleaner|spray|sponge|bin bag|foil|cling|baking paper|nappy|nappies|wipes|shampoo|conditioner|shower|soap|toothpaste|toothbrush|deodorant|razor|dishwasher|fabric|batter(y|ies)|light bulb|plaster|cotton|sanitary|tampon|pads\b|pet food|cat litter/i, 'cupboard', 'none', null, true],
  [/frozen|ice cream|ice lolly|lollies|oven chips|fish fingers|potato waffles|garden peas \d/i, 'freezer', 'bestbefore', 120],
  [/fresh fish|salmon|cod\b|haddock|prawn|mackerel|seabass|sea bass|tuna steak|scampi|smoked haddock/i, 'fridge', 'useby', 2],
  [/chicken|turkey|mince|steak|beef|pork|lamb|sausage|bacon|gammon|burger|meatball|chorizo|duck/i, 'fridge', 'useby', 4],
  [/ham\b|salami|pastrami|cooked meat|pepperoni|prosciutto/i, 'fridge', 'useby', 5],
  [/milk(?!.*(chocolate|choc))/i, 'fridge', 'useby', 7],
  [/cream(?!.*(cracker|soda|ice))|crème|creme fraiche|custard/i, 'fridge', 'useby', 6],
  [/yogh?urt|fromage frais|kefir|skyr/i, 'fridge', 'useby', 10],
  [/hummus|houmous|dip\b|coleslaw|guacamole|salsa|pesto(?!.*jar)|ready meal|pizza(?!.*frozen)|quiche|pasty|sandwich|sushi|fresh pasta|gnocchi|tortellini|ravioli/i, 'fridge', 'useby', 4],
  [/mozzarella|ricotta|feta|halloumi|cottage cheese|soft cheese|brie|camembert|mascarpone/i, 'fridge', 'useby', 8],
  [/cheese|cheddar|parmesan|parmigiano|gouda|edam|red leicester/i, 'fridge', 'bestbefore', 21],
  [/butter|spread|margarine/i, 'fridge', 'bestbefore', 30],
  [/egg/i, 'fridge', 'bestbefore', 21],
  [/fresh juice|smoothie|orange juice|apple juice/i, 'fridge', 'useby', 7],
  [/salad|lettuce|spinach|rocket|watercress|herbs|coriander|basil|parsley|mint\b|beansprout/i, 'fridge', 'useby', 4],
  [/strawberr|raspberr|blueberr|blackberr|cherries|grapes/i, 'fridge', 'bestbefore', 4],
  [/mushroom|courgette|pepper(?!corn)|cucumber|tomato(?!.*(tin|tinned|chopped|puree|passata|ketchup|sauce))|broccoli|cauliflower|asparagus|green beans|sweetcorn cob|leek|celery|avocado|spring onion|mange/i, 'fridge', 'bestbefore', 6],
  [/banana|pear|peach|nectarine|plum|melon|mango|pineapple|kiwi/i, 'cupboard', 'bestbefore', 5],
  [/apple(?!.*(juice|sauce))|orange(?!.*juice)|satsuma|clementine|easy peeler|lemon|lime/i, 'fridge', 'bestbefore', 14],
  [/carrot|parsnip|swede|beetroot|cabbage|sprouts/i, 'fridge', 'bestbefore', 12],
  [/potato|onion|garlic|squash|sweet potato/i, 'cupboard', 'bestbefore', 21],
  [/bread|loaf|roll|bagel|wrap|tortilla|pitta|naan|crumpet|muffin|croissant|brioche|baguette|sourdough|teacake|pancake/i, 'cupboard', 'bestbefore', 5],
  [/cake|doughnut|donut|cookie|pastry|tart/i, 'cupboard', 'bestbefore', 4],
  [/pasta|spaghetti|penne|rice|noodle|couscous|flour|sugar|oats|porridge|cereal|granola|lentil|tin|tinned|baked bean|beanz|soup|chopped tomatoes|passata|stock cube|gravy|sauce|ketchup|mayo|mustard|vinegar|oil|jam|honey|marmalade|peanut butter|spread|tea\b|coffee|biscuit|crisps|chocolate|sweets|nuts|cracker|crispbread|squash|cordial|water|cola|lemonade|beer|wine|cider|gin|vodka|spice|seasoning|salt|pepper/i, 'cupboard', 'bestbefore', 180],
];
function guess(name) {
  for (const [re, location, dateType, days, household] of RULES) {
    if (re.test(name)) return { location, dateType, days, household: !!household };
  }
  return { location: 'fridge', dateType: 'bestbefore', days: 7, household: false };
}

/* ---------- sync merge ---------- */
// Merge two copies: newest edit of each item/device wins; deletions are kept as tombstones for 30 days.
function newest(list) {
  const m = new Map();
  for (const x of list) { const c = m.get(x.id); if (!c || (x.updatedAt || '') > (c.updatedAt || '')) m.set(x.id, x); }
  return m;
}
function merge(a, b) {
  a = Object.assign(emptyData(), a); b = Object.assign(emptyData(), b);
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const products = { ...a.products, ...b.products };
  const devs = newest([...Object.values(a.devices), ...Object.values(b.devices)]);
  const meta = { ...a.meta };
  for (const [k, v] of Object.entries(b.meta)) if (!(k in meta) || String(v) > String(meta[k])) meta[k] = v;
  return {
    version: 2,
    items: [...newest([...a.items, ...b.items]).values()].filter(i => !(i.deleted && i.updatedAt < cutoff)).sort((x, y) => x.id < y.id ? -1 : 1),
    products: Object.fromEntries(Object.keys(products).sort().map(k => [k, products[k]])),
    log: [...new Map([...a.log, ...b.log].map(l => [l.id, l])).values()].sort((x, y) => y.at < x.at ? -1 : 1).slice(0, 500),
    devices: Object.fromEntries([...devs.values()].filter(d => !(d.gone && d.updatedAt < cutoff)).sort((x, y) => x.id < y.id ? -1 : 1).map(d => [d.id, d])),
    imported: [...new Set([...a.imported, ...b.imported])].sort().slice(-300),
    meta: Object.fromEntries(Object.keys(meta).sort().map(k => [k, meta[k]])),
  };
}
function makeItem(p, by) {
  const now = nowIso();
  return { id: uid(), name: p.name, qty: p.qty || 1, location: p.location || 'fridge', dateType: p.dateType || 'useby',
    date: p.dateType === 'none' ? null : (p.date || null), estimated: !!p.estimated, barcode: p.barcode || null,
    source: p.source || 'manual', addedAt: now, addedBy: by || '', updatedAt: now };
}

/* ---------- turning emails / web pages into plain lines ---------- */
function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', times: '×', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…' };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))
    : (named[e.toLowerCase()] ?? m));
}
function htmlToText(html) {
  return decodeEntities(html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table|section|article|header|footer|ul|ol)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' \t ')
    .replace(/<[^>]+>/g, ' '))
    .split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
}
function bytesFromBinaryString(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
function decodeBytes(bytes, charset) {
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}
// Minimal MIME reader for a saved email (.eml): finds the HTML (or plain text) body and decodes it.
function emlToText(raw) {
  raw = raw.replace(/\r\n/g, '\n');
  const parts = [];
  (function walk(chunk, depth) {
    if (depth > 8) return;
    const cut = chunk.indexOf('\n\n');
    const head = (cut < 0 ? chunk : chunk.slice(0, cut)).replace(/\n[ \t]+/g, ' ');
    const body = cut < 0 ? '' : chunk.slice(cut + 2);
    const ct = ((head.match(/^content-type:\s*([^;\n]+)/im) || [])[1] || 'text/plain').trim().toLowerCase();
    const enc = ((head.match(/^content-transfer-encoding:\s*(\S+)/im) || [])[1] || '').toLowerCase();
    if (ct.startsWith('multipart/')) {
      const b = head.match(/boundary="?([^";\n]+)"?/i); if (!b) return;
      for (const p of body.split('--' + b[1]).slice(1)) if (!p.startsWith('--')) walk(p.replace(/^[ \t]*\n/, ''), depth + 1);
      return;
    }
    if (ct === 'message/rfc822') return walk(body, depth + 1);
    if (!ct.startsWith('text/')) return;
    const charset = (head.match(/charset="?([^";\s]+)/i) || [])[1];
    let text;
    if (enc === 'base64') text = decodeBytes(bytesFromBinaryString(atob(body.replace(/[^A-Za-z0-9+/=]/g, ''))), charset);
    else if (enc === 'quoted-printable') {
      const bin = body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
      // Non-ASCII characters that were already decoded stay as they are; only =XX escapes become raw bytes.
      text = /[^\x00-\xff]/.test(bin) ? bin : decodeBytes(bytesFromBinaryString(bin), charset);
    } else text = body;
    parts.push({ ct, text });
  })(raw, 0);
  const subject = ((raw.match(/^subject:\s*(.*)$/im) || [])[1] || '').trim();
  const html = parts.find(p => p.ct === 'text/html'), plain = parts.find(p => p.ct === 'text/plain');
  const text = html ? htmlToText(html.text) : plain ? plain.text : (/<html|<table|<td/i.test(raw) ? htmlToText(raw) : raw);
  return { subject, text };
}
// Anything a person might hand us (pasted text, HTML, a raw .eml) → plain lines.
function anyToText(s) {
  if (/^(received|return-path|delivered-to|mime-version|from|message-id|x-[\w-]+):/im.test(s.slice(0, 3000)) && /\n\n/.test(s.replace(/\r\n/g, '\n'))) return emlToText(s).text;
  if (/<(html|table|td|div|br)\b/i.test(s)) return htmlToText(s);
  return s;
}

/* ---------- receipt reading ---------- */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
function nearestYear(m, d) {
  const t = new Date(); let best = null;
  for (const y of [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1]) {
    const c = new Date(y, m, d), diff = (c - t) / 86400000;
    if (diff > -60 && diff < 300 && (!best || Math.abs(diff) < Math.abs((best - t) / 86400000))) best = c;
  }
  return best;
}
function findDate(line) {
  let m = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const d = +m[1], mo = +m[2] - 1; if (d < 1 || d > 31 || mo < 0 || mo > 11) return null;
    let date = m[3] ? new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], mo, d) : nearestYear(mo, d);
    return date ? { date: ymd(date), match: m[0] } : null;
  }
  m = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()], d = +m[1];
    const date = m[3] ? new Date(+m[3], mo, d) : nearestYear(mo, d);
    return date ? { date: ymd(date), match: m[0] } : null;
  }
  return null;
}
const PRICE_RE = /-?£\s?\d+(?:\.\d{1,2})?|\b\d+\.\d{2}\b/g;
const JUNK_RE = /(^(sent|to|cc|bcc|from|date|subject|fw|fwd|re):|\bsubject:|\bsent:\s|_{8,}|forwarded message|original message|sub-?total|^total|total (to pay|paid|savings|cost|price|items)|delivery|charge|nectar|points|voucher|coupon|saving|you saved|discount|order (number|no|ref)|payment|card ending|visa|mastercard|amex|paid|refund|dear |thank|address|slot|driver|your van|unsubscribe|privacy|terms|cookie|help centre|contact us|www\.|https?:|@|carrier bag|bag charge|instructions|description|unit price|vat|receipt|reference|account|copyright|registered|view (in|your)|download|app store|google play|follow us|customer|reserved|telephone|phone|postcode|^qty|^quantity|^price|^items?\b|^product)/i;
const UNAVAILABLE_RE = /^(unavailable|missing|not (available|delivered)|out of stock|items? (we couldn.t|not))/i;

function parseReceipt(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/[ \t]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = []; let skipSection = false, shortLife = false;
  for (const raw of lines) {
    const plainPrice = raw.replace(PRICE_RE, '').replace(/[\s:x×-]/gi, '') === '';
    if (plainPrice) { if (out.length && /£|\d\.\d{2}/.test(raw)) out[out.length - 1].hasPrice = true; continue; }
    if (raw.length < 60 && UNAVAILABLE_RE.test(raw)) { skipSection = true; continue; }
    if (raw.length < 60 && /short[- ]?life|use[- ]?by|delivered items|your (items|shopping)|substitut/i.test(raw) && !findDate(raw)) {
      skipSection = false; shortLife = /short|use[- ]?by/i.test(raw); continue;
    }
    if (JUNK_RE.test(raw)) continue;
    let line = raw, qty = 1, hasQty = false;
    const hasPrice = (raw.match(PRICE_RE) || []).length > 0;
    line = line.replace(PRICE_RE, ' ');
    const dt = findDate(line);
    if (dt) line = line.replace(dt.match, ' ').replace(/\b(use[- ]?by|best before|bb|exp(iry|ires)?|date)\b:?/gi, ' ');
    let m = line.match(/^\s*(\d{1,2})\s*[x×]\s+/i) || line.match(/^\s*(\d{1,2})\s+(?=[A-Za-z'])/) || line.match(/\bqty:?\s*(\d{1,2})\b/i);
    if (m) { qty = +m[1]; hasQty = true; line = line.replace(m[0], ' '); }
    const name = line.replace(/\s+/g, ' ').replace(/^[\s\-–•*:,.|]+|[\s\-–•*:,.|]+$/g, '').trim();
    if (!/[a-z]{3}/i.test(name) || name.length > 110 || skipSection) continue;
    out.push({ name, qty, hasQty, hasPrice, date: dt?.date || null, fromShortLife: shortLife });
  }
  // Lines with a price/quantity are the order lines. Dated lines without one (the short-life
  // list) usually repeat an order line, so copy the date onto that line instead of adding twice.
  const structured = out.some(o => o.hasPrice || o.hasQty);
  const norm = n => n.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const merged = structured ? out.filter(o => o.hasPrice || o.hasQty) : [];
  for (const d of structured ? out.filter(o => !(o.hasPrice || o.hasQty) && o.date) : out) {
    const k = norm(d.name);
    const hit = merged.find(p => { const pk = norm(p.name); return pk === k || (k.length > 8 && (pk.includes(k) || k.includes(pk))); });
    if (hit) { hit.date = hit.date || d.date; hit.fromShortLife = hit.fromShortLife || d.fromShortLife; }
    else merged.push(d);
  }
  return merged.map(it => {
    const g = guess(it.name);
    const dateType = g.dateType === 'none' ? 'none' : (it.date && it.fromShortLife ? 'useby' : g.dateType);
    return { include: !g.household, name: it.name, qty: it.qty, location: g.location, dateType,
      date: it.date || (g.days != null ? addDays(g.days) : null), estimated: !it.date && g.days != null };
  });
}


/* ---------- reading a date off a pack (text from the on-phone OCR) ---------- */
const MON_RE = 'JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC';
function readPackDate(raw) {
  // Undo the usual OCR mix-ups: letters inside numbers, digits inside month names.
  let t = ' ' + String(raw || '').toUpperCase().replace(/[\n\r]+/g, ' ') + ' ';
  t = t.replace(/[A-Z0-9|]+/g, tok => {
    const digits = (tok.match(/[0-9]/g) || []).length;
    if (digits >= tok.length / 2 && !new RegExp(`(${MON_RE})`).test(tok)) return tok.replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5').replace(/Z/g, '2').replace(/B(?=\d)/g, '8');
    return tok.replace(/0/g, 'O').replace(/1(?=[A-Z])/g, 'I');
  });
  t = t.replace(/\b(\d{1,2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)/g, '$1 $2').replace(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)(\d)/g, '$1 $2');
  const dateType = /USE\s*-?\s*BY|U5E\s*BY|\bUB\b|USE\s*8Y/.test(t) ? 'useby'
    : /BEST\s*BEFORE|BEST\s*BY|\bBBE?\b|\bB\/B\b|DISPLAY\s*UNTIL/.test(t) ? 'bestbefore' : null;
  const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, SEPT: 8, OCT: 9, NOV: 10, DEC: 11 };
  const yr = y => y == null ? null : (String(y).length === 2 ? 2000 + +y : +y);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sane = d => d && !isNaN(d) && (d - today) / 86400000 > -60 && (d - today) / 86400000 < 4 * 365;
  const found = [];
  // A date right after "use by" / "best before" beats one after "display until" or a batch code.
  const add = (d, score, raw, at) => {
    if (!sane(d)) return;
    const before = t.slice(Math.max(0, at - 22), at);
    let type = null;
    if (/USE\s*-?\s*BY|\bUB\b/.test(before)) { score += 3; type = 'useby'; }
    else if (/BEST\s*BEFORE|BEST\s*BY|\bBBE?\b|END/.test(before)) { score += 3; type = 'bestbefore'; }
    else if (/DISPLAY|SELL\s*BY|PACKED|PROD/.test(before)) score -= 3;
    found.push({ date: ymd(d), score, raw: raw.trim(), type });
  };
  const withYearOrNearest = (y, m, d) => y ? new Date(y, m, d) : nearestYear(m, d);
  let m;
  const R1 = new RegExp(`\\b(\\d{1,2})[\\s./-]*(${MON_RE})[A-Z]*\\.?[\\s./-]*(\\d{4}|\\d{2})?(?!\\d)`, 'g');
  while ((m = R1.exec(t))) if (+m[1] >= 1 && +m[1] <= 31) add(withYearOrNearest(yr(m[3]), months[m[2]], +m[1]), m[3] ? 5 : 4, m[0], m.index);
  const R2 = /\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)/g;
  while ((m = R2.exec(t))) if (+m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) add(new Date(yr(m[3]), +m[2] - 1, +m[1]), 5, m[0], m.index);
  const R2b = /\b(\d{2})\s(\d{2})\s(\d{2})\b/g;   // "12 11 26"
  while ((m = R2b.exec(t))) if (+m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) add(new Date(yr(m[3]), +m[2] - 1, +m[1]), 3, m[0], m.index);
  const R3 = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b(?!\s*[./-]\s*\d)/g;
  while ((m = R3.exec(t))) if (+m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) add(nearestYear(+m[2] - 1, +m[1]), 2, m[0], m.index);
  // Month + year only ("END MAR 2027", "03/2027"): the last day of that month.
  const R4 = new RegExp(`(?:^|[^0-9])\\s(${MON_RE})[A-Z]*[\\s./-]*(\\d{4}|\\d{2})(?!\\d)`, 'g');
  while ((m = R4.exec(t))) { const y = yr(m[2]); if (y >= 2020) add(new Date(y, months[m[1]] + 1, 0), 3, m[0], m.index); }
  const R5 = /\b(\d{1,2})\s*[./\s-]\s*(\d{4})\b/g;
  while ((m = R5.exec(t))) if (+m[1] >= 1 && +m[1] <= 12) add(new Date(+m[2], +m[1], 0), 3, m[0], m.index);
  if (!found.length) return null;
  found.sort((a, b) => b.score - a.score || (a.date < b.date ? -1 : 1));
  return { date: found[0].date, score: found[0].score, dateType: found[0].type || dateType, raw: found[0].raw, others: [...new Set(found.slice(1).map(f => f.date))].filter(d => d !== found[0].date) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ymd, todayStr, addDays, daysUntil, prettyDate, nowIso, uid, emptyData, guess, merge, makeItem,
    htmlToText, emlToText, anyToText, parseReceipt, findDate, readPackDate };
}
