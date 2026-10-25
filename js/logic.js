// Domain rules on top of the store: list operations, shopping, receipt matching,
// price history and suggestions.

import * as db from './store.js';
import { CATS, guessCategory, isNonProduct, norm, TT_CATS } from './categories.js';
import { STORES } from './seed.js';

// First run on a phone: default stores only. On the computer that sets up the household,
// seed-private.js (not published) adds the personal catalog, list and first receipt.
export async function seedIfEmpty() {
  const s = db.raw();
  if (s.seeded) return;
  let own = null;
  try { own = await import('./seed-private.js'); } catch (e) { /* not published: start empty */ }
  db.batch(() => {
    for (const st of STORES) db.put('stores', st);
    if (own) {
      for (const p of own.PRODUCTS) db.put('products', p);
      for (const it of own.LIST) db.put('items', { ...it, addedAt: Date.now() });
      saveReceipt(own.FIRST_RECEIPT, matchLines(own.FIRST_RECEIPT.lines, 'rl'), 'rl');
    }
  });
  db.setLocal('seeded', true);
}

// ---------- stores ----------

export function stores() {
  return db.all('stores').sort((a, b) => a.order - b.order);
}

export function activeStores() {
  return stores().filter(s => s.active);
}

export function storeById(id) {
  return db.one('stores', id) || { id, name: '?', color: '#5B6660', route: CATS, active: false };
}

export function routeOf(store) {
  const r = (store && store.route) || CATS;
  // Categories added later go at the end.
  return r.concat(CATS.filter(c => !r.includes(c)));
}

export function storeForChain(chain) {
  return stores().find(s => s.chain === chain) || null;
}

export function defaultStoreFor(cat) {
  const act = activeStores();
  const want = cat && TT_CATS.includes(cat) ? 'tt' : 'rl';
  return act.find(s => s.id === want) ? want : (act[0] ? act[0].id : 'rl');
}

export function addStore(name) {
  const order = stores().length;
  const palette = ['#5B6660', '#6A4C93', '#2D6A4F', '#8C5E1A', '#3D5A80'];
  const id = db.uid('s');
  // A store added by hand is its own "chain", so photographed receipts can be filed under it.
  return db.put('stores', { id, name, chain: id, color: palette[order % palette.length], active: true, order, route: null });
}

export function moveRoute(storeId, index, delta) {
  const st = db.one('stores', storeId);
  const route = routeOf(st).slice();
  const j = index + delta;
  if (j < 0 || j >= route.length) return;
  [route[index], route[j]] = [route[j], route[index]];
  db.patch('stores', storeId, { route });
}

// ---------- products and list ----------

export function products() {
  return db.all('products');
}

export function listItems(storeId) {
  return db.all('items').filter(i => !storeId || i.store === storeId);
}

export function itemForProduct(productId) {
  return db.all('items').find(i => i.productId === productId) || null;
}

export function addToList(productId, qty, storeId) {
  const p = db.one('products', productId);
  const existing = itemForProduct(productId);
  if (existing) return db.patch('items', existing.id, { qty: existing.qty + (qty || 1), status: existing.status === 'taken' ? 'taken' : 'open' });
  return db.put('items', {
    id: db.uid('i'), productId, store: storeId || (p && p.store) || 'rl', qty: qty || 1,
    note: '', status: 'open', addedBy: db.raw().me.name || '', addedAt: Date.now()
  });
}

export function setQty(itemId, qty) {
  if (qty <= 0) db.remove('items', itemId);
  else db.patch('items', itemId, { qty });
}

export function createProduct({ name, cat, store, unit }) {
  return db.put('products', { id: db.uid('p'), name: name.trim(), cat: cat || 'שונות', store, codes: [], unit: unit || 'יח׳' });
}

export function renameProduct(id, { name, cat }) {
  return db.patch('products', id, { name: name.trim(), cat });
}

// Removes a product from the catalog and from the list. Past receipts and their prices stay
// in the history; a later receipt with its barcode will offer it as a new product.
export function deleteProduct(id) {
  db.batch(() => {
    for (const it of db.all('items').filter(i => i.productId === id)) db.remove('items', it.id);
    db.remove('products', id);
  });
}

export function findProducts(q) {
  const t = norm(q);
  if (t.length < 2) return [];
  return products().filter(p => norm(p.name).includes(t));
}

export function productName(id) {
  const p = db.one('products', id);
  return p ? p.name : 'מוצר שנמחק';
}

// ---------- pasted lists ----------

// Splits a written list into lines with quantities: "חומץ בלסמי×2", "2 חלב", "- סודה".
export function parseListText(text) {
  return String(text || '').split(/\n|,|،|;/).map(raw => raw.trim()).filter(Boolean).map(raw => {
    let name = raw.replace(/^[-–•*·\d]+[.)]\s+/, '').replace(/^[-–•*·]\s*/, '').trim();
    let qty = 1;
    let m = name.match(/^(.*?)\s*[×xX*]\s*(\d+(?:\.\d+)?)$/) || name.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*(?:יח['׳]?|יחידות)$/);
    if (m && m[1].trim()) { name = m[1].trim(); qty = parseFloat(m[2]); }
    else if ((m = name.match(/^(\d+(?:\.\d+)?)\s*[×xX*]?\s+(.+)$/))) { qty = parseFloat(m[1]); name = m[2].trim(); }
    return { raw, name, qty: qty > 0 ? qty : 1 };
  }).filter(l => l.name);
}

// Spelling-tolerant key: without ו/י (נייר אפיה = נייר אפייה), hyphens and punctuation.
function looseKey(s) {
  return norm(s).replace(/[-–־]/g, '').replace(/[.,()\/]/g, ' ').replace(/[וי]/g, '').replace(/\s+/g, ' ').trim();
}

// Words that name the same thing for shopping purposes.
const SAME_AS = {
  'ספגטי': 'פסטה', 'פנה': 'פסטה', 'מקרוני': 'פסטה', 'פוזילי': 'פסטה', 'פרפלה': 'פסטה', 'ספירלות': 'פסטה', 'קונכיות': 'פסטה'
};
// Sizes and units say nothing about what the product is.
const NOISE = /^(\d+([.,]\d+)?%?|גר|גרם|ג|קג|ק"ג|קילו|ליטר|ל|מל|מ"ל|יח|יחידות|מארז|ארוז)$/;
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

// One word reduced to a comparable stem: final letters, plural/feminine endings
// (מלפפונים = מלפפון, עגבניות = עגבניה) and ו/י spelling differences.
function stem(word) {
  let w = SAME_AS[word] || word;
  w = w.replace(/[ךםןףץ]/g, c => FINALS[c]);
  if (w.length > 4 && /(ימ|ות)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && /ה$/.test(w)) w = w.slice(0, -1);
  return w.replace(/[וי]/g, '');
}

function matchWords(s) {
  return norm(s).replace(/[-–־]/g, '').replace(/[.,()\/*]/g, ' ').split(' ')
    // Two-letter words ("בר" in "פתי בר") are too short to identify a product.
    .filter(w => w.length >= 3 && !NOISE.test(w)).map(stem).filter(Boolean);
}

function matchScore(query, name) {
  const qa = matchWords(query);
  const qb = matchWords(name);
  if (!qa.length || !qb.length) return 0;
  if (qa.join(' ') === qb.join(' ')) return 1;
  // Words match when equal, or when the shorter one (4+ letters) starts the longer one
  // (3 would make שמן and שמנת the same).
  const same = (x, y) => x === y || (Math.min(x.length, y.length) >= 4 && (y.startsWith(x) || x.startsWith(y)));
  const hit = (x, list) => list.some(y => same(x, y));
  const fromQuery = qa.filter(x => hit(x, qb)).length / qa.length;
  const fromName = qb.filter(y => hit(y, qa)).length / qb.length;
  // A short catalog name fully contained in a longer one ("ספגטי" in "ספגטי פרפקטו 500 גרם").
  return Math.max(fromQuery * 0.7 + fromName * 0.3, fromName * 0.6);
}

// Best catalog products for a written name, best first.
export function matchProducts(name) {
  return products()
    .map(p => ({ p, score: matchScore(name, p.name) }))
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

// Adds reviewed lines to the list in one go. rows: [{include, choice, name, cat, qty, store}]
export function addPastedList(rows) {
  let added = 0;
  let updated = 0;
  let created = 0;
  db.batch(() => {
    for (const r of rows) {
      if (!r.include) continue;
      let pid = r.choice;
      if (pid === 'new') {
        pid = createProduct({ name: r.name, cat: r.cat, store: r.store }).id;
        created++;
      }
      const existing = itemForProduct(pid);
      if (existing) {
        db.patch('items', existing.id, { qty: r.qty, store: r.store, status: 'open' });
        updated++;
      } else {
        db.put('items', {
          id: db.uid('i'), productId: pid, store: r.store, qty: r.qty, note: '', status: 'open',
          addedBy: db.raw().me.name || '', addedAt: Date.now()
        });
        added++;
      }
    }
  });
  return { added, updated, created };
}

// Groups items of one store by the store's route order.
export function groupByRoute(items, store) {
  const route = routeOf(store);
  const byCat = {};
  for (const it of items) {
    const p = db.one('products', it.productId);
    const cat = (p && p.cat) || 'שונות';
    (byCat[cat] = byCat[cat] || []).push(it);
  }
  return route.filter(c => byCat[c]).map(c => ({
    cat: c,
    items: byCat[c].sort((a, b) => productName(a.productId).localeCompare(productName(b.productId), 'he'))
  }));
}

// Ends a shopping trip without a receipt: bought items leave the list and are kept in history.
export function finishShopping(storeId) {
  const items = listItems(storeId);
  const taken = items.filter(i => i.status === 'taken');
  db.batch(() => {
    if (taken.length) {
      db.put('receipts', {
        id: db.uid('r'), kind: 'manual', store: storeId, date: new Date().toISOString(), total: null,
        lines: taken.map(i => ({ productId: i.productId, qty: i.qty, name: productName(i.productId) }))
      });
    }
    for (const i of taken) db.remove('items', i.id);
    for (const i of items) if (i.status === 'oos') db.patch('items', i.id, { status: 'open' });
  });
  return taken.length;
}

// ---------- receipts ----------

function codeKey(code, storeId, name) {
  // Lines without a code (photographed paper receipts) are remembered by the store's name for them.
  if (!code) return storeId + ':name:' + looseKey(name);
  // Short codes are chain-internal (weighed produce); barcodes are global.
  return String(code).length < 8 ? storeId + ':' + code : String(code);
}

function productByCode(key) {
  return products().find(p => (p.codes || []).includes(key)) || null;
}

function words(s) {
  return norm(s).split(' ').filter(w => w.length >= 3);
}

// Loose name similarity for linking a receipt line to a list product with no barcode yet.
function similar(a, b) {
  const wa = words(a);
  const wb = words(b);
  return wb.some(x => wa.some(y => y.startsWith(x) || x.startsWith(y)));
}

export function matchLines(lines, storeId) {
  return lines.map((l, idx) => {
    const key = codeKey(l.code, storeId, l.name);
    const ignore = isNonProduct(l.name);
    const p = ignore ? null : productByCode(key);
    return { idx, ...l, key, ignore, productId: p ? p.id : null };
  });
}

// A receipt line not in the catalog yet: suggest catalog products with a similar name.
export function unknownLine(line) {
  const cands = matchProducts(line.name);
  return {
    line,
    cat: guessCategory(line.name) || 'שונות',
    cands: cands.map(c => ({ id: c.p.id, name: c.p.name })),
    target: cands[0] && cands[0].score >= 0.6 ? cands[0].p.id : 'new'
  };
}

// Compares a fetched receipt with the open list and returns what needs a decision.
export function reconcile(receipt) {
  const st = storeForChain(receipt.chain);
  const storeId = st ? st.id : 'rl';
  const lines = matchLines(receipt.lines, storeId);
  const openItems = listItems().filter(i => i.status !== 'oos');
  const used = new Set();
  const matched = [];
  const qtyDiff = [];
  const extraKnown = [];
  const confirm = [];
  const unknown = [];

  for (const l of lines) {
    if (l.ignore) continue;
    if (l.productId) {
      const item = openItems.find(i => i.productId === l.productId && !used.has(i.id));
      if (item) {
        used.add(item.id);
        matched.push({ line: l, item });
        if (!l.weight && item.qty !== l.qty) qtyDiff.push({ line: l, item });
      } else {
        extraKnown.push(l);
      }
    }
  }
  for (const l of lines) {
    if (l.ignore || l.productId) continue;
    // With a barcode, only list products that have no barcode yet can be the match.
    // Without one (a photographed receipt), take the list product whose name fits best.
    const cand = l.code
      ? openItems.find(i => !used.has(i.id) && !(db.one('products', i.productId) || {}).codes?.length && similar(l.name, productName(i.productId)))
      : openItems.filter(i => !used.has(i.id))
        .map(i => ({ i, score: matchScore(l.name, productName(i.productId)) }))
        .filter(x => x.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .map(x => x.i)[0];
    if (cand) {
      used.add(cand.id);
      confirm.push({ line: l, item: cand });
    } else {
      unknown.push(unknownLine(l));
    }
  }
  const missing = openItems.filter(i => i.store === storeId && !used.has(i.id));
  return { receipt, storeId, lines, matched, qtyDiff, extraKnown, confirm, unknown, missing };
}

// decisions: { confirm: {lineIdx: 'yes'|'no'}, unknown: {lineIdx: {action:'add'|'once', cat, name}},
//              missing: {itemId: 'keep'|'move'|'drop'}, qty: {itemId: 'update'|'keep'} }
export function applyReconcile(model, decisions) {
  const { storeId, lines } = model;
  const summary = { bought: 0, moved: 0, added: 0, linked: 0 };
  db.batch(() => {
    const otherStore = activeStores().find(s => s.id !== storeId);
    for (const { item } of model.matched) { db.remove('items', item.id); summary.bought++; }
    for (const { line, item } of model.confirm) {
      const d = decisions.confirm[line.idx];
      if (d === 'yes') {
        const p = db.one('products', item.productId);
        db.patch('products', p.id, { codes: (p.codes || []).concat([line.key]) });
        lines[line.idx].productId = p.id;
        db.remove('items', item.id);
        summary.bought++;
        summary.linked++;
      } else {
        model.unknown.push(unknownLine(line));
      }
    }
    for (const u of model.unknown) {
      const d = decisions.unknown[u.line.idx] || {};
      const target = d.target || u.target;
      if (d.action === 'add' && target !== 'new' && db.one('products', target)) {
        // An existing catalog product under the receipt's name: remember the link.
        const p = db.one('products', target);
        db.patch('products', p.id, { codes: (p.codes || []).concat([u.line.key]) });
        lines[u.line.idx].productId = p.id;
        summary.linked++;
      } else if (d.action === 'add') {
        const cat = d.cat || u.cat;
        const p = createProduct({ name: d.name || u.line.name, cat, store: storeId, unit: u.line.weight ? 'ק״ג' : 'יח׳' });
        db.patch('products', p.id, { codes: [u.line.key] });
        lines[u.line.idx].productId = p.id;
        summary.added++;
      }
    }
    for (const item of model.missing) {
      const d = decisions.missing[item.id] || 'keep';
      if (d === 'drop') db.remove('items', item.id);
      else if (d === 'move' && otherStore) { db.patch('items', item.id, { store: otherStore.id, status: 'open' }); summary.moved++; }
      else db.patch('items', item.id, { status: 'open' });
    }
    saveReceipt(model.receipt, lines, storeId);
  });
  return summary;
}

function saveReceipt(receipt, lines, storeId) {
  const id = 'r_' + (receipt.docId || db.uid('x'));
  db.put('receipts', {
    id, kind: 'receipt', store: storeId, chain: receipt.chain, branch: receipt.branch || '', date: receipt.date,
    total: receipt.total, lines: lines.map(l => ({
      code: l.code, name: l.name, qty: l.qty, weight: l.weight, unitPrice: l.unitPrice, gross: l.gross,
      discount: l.discount, promo: l.promo, productId: l.productId || null, ignore: !!l.ignore
    }))
  });
}

export function receiptExists(receipt) {
  return !!db.one('receipts', 'r_' + receipt.docId);
}

export function receipts() {
  return db.all('receipts').sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ---------- prices ----------

// Latest real price per product per store, only from imported receipts.
export function priceTable() {
  const table = {};
  for (const r of receipts().slice().reverse()) {
    if (r.kind !== 'receipt') continue;
    for (const l of r.lines) {
      if (!l.productId || l.ignore || !l.unitPrice) continue;
      const amount = l.weight || l.qty || 1;
      const paid = (l.gross - (l.discount || 0)) / amount;
      table[l.productId] = table[l.productId] || {};
      table[l.productId][r.store] = {
        regular: l.unitPrice, paid: Math.round(paid * 100) / 100, promo: l.discount > 0 ? l.promo : '',
        date: r.date, perKg: !!l.weight, receiptName: l.name
      };
    }
  }
  return table;
}

// ---------- suggestions ----------

// Products bought at least twice whose usual interval has passed, and not on the list.
export function suggestions() {
  const dates = {};
  for (const r of receipts()) {
    const day = String(r.date).slice(0, 10);
    for (const l of r.lines) {
      if (!l.productId || l.ignore) continue;
      (dates[l.productId] = dates[l.productId] || new Set()).add(day);
    }
  }
  const now = Date.now();
  const out = [];
  for (const [pid, set] of Object.entries(dates)) {
    if (set.size < 2 || itemForProduct(pid) || !db.one('products', pid)) continue;
    const ds = [...set].sort().map(d => new Date(d).getTime());
    const avg = (ds[ds.length - 1] - ds[0]) / (ds.length - 1);
    const since = now - ds[ds.length - 1];
    if (since >= avg * 0.9) out.push({ productId: pid, days: Math.round(since / 864e5), every: Math.round(avg / 864e5) });
  }
  return out.sort((a, b) => b.days / b.every - a.days / a.every).slice(0, 6);
}
