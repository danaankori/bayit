// Reads a Rami Levy digital receipt from the text of its page, as copied with
// "select all" + "copy" (or shared as text) by the person who opened the link.
//
// Per item the page shows: [מבצע] name, code, paid amount, quantity or weight, [-discount].
// The regular unit price is recovered as (paid + discount) / quantity.

const MONEY = /(-?)\s*₪\s*(\d+)\s*(\.\d{1,2})?/g;

function lines(text) {
  // Put every amount on a line of its own, whatever way the copy split "₪ / 15 / .00".
  const joined = String(text || '')
    .replace(/\r/g, '')
    .replace(MONEY, (m, neg, whole, frac) => `\n${neg ? '-' : ''}₪${whole}${frac || ''}\n`);
  return joined.split('\n').map(s => s.trim()).filter(Boolean);
}

const isMoney = s => /^-?₪\d+(\.\d+)?$/.test(s);
const money = s => parseFloat(s.replace('₪', ''));
const isCode = s => /^\d{3,14}$/.test(s);
const UNIT = /^(יח['׳]?|ק["״]?ג)$/;

// ---------- receipt data from the iPhone shortcut ----------
//
// The "קבלה לבית" shortcut opens the receipt from the phone, like a browser does, and copies
// Rami Levy's receipt data (JSON) to the clipboard. Only items, totals, branch and date are kept.

export function looksLikeJson(text) {
  return /^\s*\{/.test(String(text || ''));
}

export function parseReceiptJson(text) {
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return { error: 'התוכן שהודבק אינו קבלה תקינה. כדאי להריץ שוב את קיצור הדרך.' }; }
  const d = obj && (obj.data || obj);
  if (!d || !Array.isArray(d.items)) {
    return { error: 'רמי לוי לא החזירו את פרטי הקבלה לקיצור הדרך. אפשר לטעון את קובץ ה-PDF במקום.' };
  }
  const num = v => (typeof v === 'number' ? v : parseFloat(String(v == null ? '0' : v))) || 0;
  const lines = d.items.map(it => {
    const extra = Array.isArray(it.additional_info) ? it.additional_info : [];
    const discount = Math.round(extra.reduce((s, a) => s + Math.max(0, -num(a.value)), 0) * 100) / 100;
    const weight = it.weight ? num(it.weight) / 1000 : null;
    return {
      code: String(it.code == null ? '' : it.code), name: String(it.name || ''),
      qty: weight ? 1 : num(it.quantity), weight, unitPrice: num(it.price), gross: num(it.total), discount,
      promo: extra.map(a => String(a.key || '')).filter(Boolean).join(' · ')
    };
  });
  const created = d.created_at ? new Date(d.created_at) : new Date();
  const day = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
  return {
    receipt: {
      chain: 'rami-levy',
      docId: `rl-${d.transaction_id || 'x'}-${day}`,
      branch: (d.branch && d.branch.name) || '',
      date: created.toISOString(),
      total: num(d.payments && d.payments.total),
      lines
    },
    warnings: []
  };
}

// ---------- text read from photos (OCR) ----------
//
// Photos give noisier text than a copied page: the shekel sign is often lost, digits get
// split, and paper receipts put name and price on one line. This reader is deliberately
// forgiving and its result always goes to an editing step before it is used.

const HEB = /[֐-׿]{2,}/;
const NOT_A_NAME = /סה["״']?כ|לתשלום|שולם|מע["״']?מ|עודף|אשראי|ויזה|ישראכרט|מאסטרקארד|מזומן|חסכת|פריטים|^קבלה|סניף|תודה|טלפון|ח\.?פ|עוסק|קופה|קופאי|הקבלה|היי,?$|הצגת|במבצע$|^מבצע$|מחיר ליח|^הנחה|כרטיס|חשבונית|מספר|ברקוד|לקוח/;
const END = /סיכום התשלום|לפני מע|הצגת פחות/;
const TOTAL = /סה["״']?כ\s*(?:שולם|לתשלום)|לתשלום|סה["״']?כ כולל/;

function cleanOcrLine(s) {
  return s
    .replace(/[‎‏‪-‮]/g, '') // direction marks
    .replace(/(\d)\s*[.,]\s*(\d{2})(?!\d)/g, '$1.$2') // "15 .00" / "15,00" → 15.00
    .replace(/[|{}\[\]_~`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function amountsIn(s) {
  // Prices have exactly two decimals; weights like 0.710 are not prices.
  return [...s.matchAll(/(-?)\s*₪?\s*(\d{1,4}\.\d{2})(?!\d)(\s*-)?/g)].map(m => ({ value: parseFloat(m[2]), neg: !!(m[1] || m[3]) }));
}

function storeHint(text) {
  if (/רמי לוי|rami/i.test(text)) return 'rami-levy';
  if (/ten\s*2\s*ten|טן טו טן|טן 2 טן/i.test(text)) return 'ten2ten';
  if (/שופרסל|shufersal/i.test(text)) return 'shufersal';
  if (/קרפור|carrefour/i.test(text)) return 'carrefour';
  return null;
}

// Items from one image's text.
function itemsFromOcr(text, digital) {
  const items = [];
  let cur = null;
  let started = false;
  const finish = () => { if (cur && (cur.amount != null)) items.push(cur); cur = null; };
  for (const rawLine of String(text).split('\n')) {
    const line = cleanOcrLine(rawLine);
    if (!line) continue;
    if (END.test(line) || (!digital && started && TOTAL.test(line))) { finish(); break; }
    if (TOTAL.test(line)) continue;
    // Barcodes, or a short chain code on a line of its own (cucumber = "101").
    const code = (line.match(/(?:^|\s)(\d{7,13})(?:\s|$)/) || line.match(/^(\d{3,6})$/) || [])[1] || null;
    const amounts = amountsIn(line.replace(code || '\u0000', ' '));
    // A discount line ("הנחה ... 2.60-") belongs to the product above it.
    if (cur && amounts.length && amounts.every(a => a.neg)) {
      cur.discount = Math.round((cur.discount + amounts.reduce((s, a) => s + a.value, 0)) * 100) / 100;
      continue;
    }
    if (NOT_A_NAME.test(line)) continue;
    const weight = (line.match(/(\d+\.\d{3})(?!\d)/) || [])[1];
    // "2 x 10.90", or the same line reordered by right-to-left reading: "x 10.90 2".
    const qtyMatch = line.match(/(?:^|\s)(\d{1,3})\s*(?:יח['׳]?|x|X|×|\*)/) || line.match(/[xX×*]\s*\d+\.\d{2}\s+(\d{1,3})(?:\s|$)/);
    const name = line.replace(/-?\s*₪?\s*\d+(?:\.\d+)?\s*%?/g, ' ').replace(/יח['׳]?|ק["״']?ג|₪|[x×*%]/g, ' ').replace(/\s+/g, ' ').trim();
    const hasName = HEB.test(name) && name.replace(/[^֐-׿a-zA-Z]/g, '').length >= 3;

    if (hasName && !(amounts.length && amounts.every(a => a.neg))) {
      // A new product line (paper receipts carry the price on the same line).
      finish();
      started = true;
      cur = { name, code: null, qty: 1, weight: weight ? parseFloat(weight) : null, amount: null, discount: 0 };
      const pos = amounts.filter(a => !a.neg);
      if (pos.length) cur.amount = pos[pos.length - 1].value;
      if (code) cur.code = code;
      continue;
    }
    if (!cur) continue;
    if (code && !cur.code) cur.code = code;
    if (weight) cur.weight = parseFloat(weight);
    else if (qtyMatch) cur.qty = parseInt(qtyMatch[1], 10);
    const pos = amounts.filter(a => !a.neg);
    for (const a of amounts) if (a.neg) cur.discount = Math.round((cur.discount + a.value) * 100) / 100;
    if (qtyMatch && !digital && pos.length) {
      // "8 x 2.20 17.60": the last amount is the line total. "2 x 10.90" alone: total = 2 × 10.90,
      // unless the product line above already showed that total.
      const q = parseInt(qtyMatch[1], 10);
      const lineTotal = pos.length > 1 ? pos[pos.length - 1].value : Math.round(q * pos[0].value * 100) / 100;
      if (cur.amount == null || pos.length > 1 || Math.abs(cur.amount - lineTotal) > 0.01) cur.amount = lineTotal;
    } else if (cur.amount == null && pos.length) {
      cur.amount = pos[0].value;
    }
  }
  finish();
  return items;
}

const sameItem = (a, b) => (a.code && a.code === b.code || a.name === b.name) && a.amount === b.amount;

// Joins several screenshots, dropping items repeated where two shots overlap.
function joinShots(lists) {
  const out = [];
  for (const list of lists) {
    let k = Math.min(out.length, list.length);
    for (; k > 0; k--) {
      let match = true;
      for (let i = 0; i < k && match; i++) match = sameItem(out[out.length - k + i], list[i]);
      if (match) break;
    }
    out.push(...list.slice(k));
  }
  return out;
}

// Returns a draft for the editing step: { chain, date (yyyy-mm-dd), total, lines }.
export function parseScannedTexts(texts) {
  const all = texts.join('\n');
  const digital = /הקבלה הדיגיטלית|במבצע|מחיר ליח/.test(all);
  const lists = texts.map(t => itemsFromOcr(t, digital));
  const items = joinShots(lists);
  const dm = all.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  let date = new Date().toISOString().slice(0, 10);
  if (dm) {
    const y = dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
    date = `${y}-${String(dm[2]).padStart(2, '0')}-${String(dm[1]).padStart(2, '0')}`;
  }
  let total = null;
  const allLines = all.split('\n').map(cleanOcrLine).filter(Boolean);
  for (let i = 0; i < allLines.length && total == null; i++) {
    if (!TOTAL.test(allLines[i])) continue;
    // The amount is on the same line, or (digital receipts) on the next one.
    for (const line of [allLines[i], allLines[i + 1] || '']) {
      const a = amountsIn(line).filter(x => !x.neg);
      if (a.length) { total = a[a.length - 1].value; break; }
    }
  }
  return {
    chain: storeHint(all),
    date,
    total,
    lines: items.map(it => {
      // Digital receipts show what was paid; paper receipts show the price before the discount line.
      const paid = digital ? it.amount : Math.round((it.amount - it.discount) * 100) / 100;
      return { name: it.name, code: it.code || '', qty: it.weight ? 1 : it.qty, weight: it.weight, paid, discount: it.discount };
    })
  };
}

// Turns the edited draft into the receipt shape used for matching.
export function receiptFromDraft(draft, chain) {
  const lines = draft.lines.filter(l => l.name.trim() && l.paid >= 0).map(l => {
    const gross = Math.round((Number(l.paid) + Number(l.discount || 0)) * 100) / 100;
    const amount = l.weight || Number(l.qty) || 1;
    return {
      code: l.code || '', name: l.name.trim(), qty: l.weight ? 1 : Number(l.qty) || 1, weight: l.weight || null,
      unitPrice: Math.round((gross / amount) * 100) / 100, gross, discount: Number(l.discount || 0),
      promo: l.discount > 0 ? 'מבצע' : ''
    };
  });
  const sum = Math.round(lines.reduce((s, l) => s + l.gross - l.discount, 0) * 100) / 100;
  return {
    chain,
    docId: `scan-${chain}-${draft.date}-${Math.round((draft.total || sum) * 100)}`,
    branch: '',
    date: new Date(draft.date + 'T12:00:00').toISOString(),
    total: draft.total || sum,
    lines
  };
}

export function looksLikeLink(text) {
  return /^\s*https?:\/\/\S+\s*$/.test(String(text || ''));
}

export function parseReceiptText(text) {
  const L = lines(text);
  if (!L.length) return { error: 'לא הודבק טקסט.' };
  if (!/רמי לוי|rami-levy/.test(text) && !L.some(s => /^סניף /.test(s))) {
    return { error: 'זה לא נראה כמו קבלה דיגיטלית של רמי לוי. כרגע נתמכות רק הקבלות שלהם.' };
  }

  const warnings = [];
  const txnAt = L.indexOf('קבלה');
  const txn = txnAt >= 0 && /^\d+$/.test(L[txnAt + 1] || '') ? L[txnAt + 1] : '';
  const dateLine = L.find(s => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s));
  const timeLine = L.find(s => /^\d{1,2}:\d{2}$/.test(s)) || '12:00';
  const branchLine = L.find(s => /^סניף /.test(s));
  const totalAt = L.findIndex(s => /^סה["״]כ שולם$/.test(s));
  const total = totalAt >= 0 && isMoney(L[totalAt + 1] || '') ? money(L[totalAt + 1]) : null;
  const countLine = L.find(s => /^\d+ פריטים$/.test(s));
  const expected = countLine ? parseInt(countLine, 10) : null;

  if (!dateLine) return { error: 'לא מצאתי את תאריך הקבלה בטקסט. כדאי להעתיק את כל העמוד.' };
  const [d, m, y] = dateLine.split('/').map(Number);
  const [hh, mi] = timeLine.split(':').map(Number);
  const date = new Date(y, m - 1, d, hh, mi);
  const isoDay = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // Items end where the payment summary begins.
  let end = L.findIndex(s => /^(הצגת פחות|סיכום התשלום|הצגת עוד)/.test(s));
  if (end < 0) end = L.length;
  if (L.some(s => /^הצגת עוד \d+/.test(s))) {
    return { error: 'בעמוד הקבלה מוצגים רק חלק מהפריטים. לוחצים שם על "הצגת עוד פריטים", ואז מעתיקים שוב.' };
  }

  const out = [];
  for (let i = 1; i < end; i++) {
    if (!isCode(L[i]) || !isMoney(L[i + 1] || '') || L[i + 1].startsWith('-')) continue;
    const name = L[i - 1];
    if (!name || isMoney(name) || name === 'קבלה') continue;
    const paid = money(L[i + 1]);
    let j = i + 2;
    let qty = 1;
    let weight = null;
    // Quantity and unit: "8" + "יח'", "0.710" + "ק"ג", or both on one line.
    const one = (L[j] || '').match(/^(\d+(?:\.\d+)?)\s*(יח['׳]?|ק["״]?ג)$/);
    if (one) {
      qty = parseFloat(one[1]);
      if (/ק/.test(one[2])) weight = qty;
      j += 1;
    } else if (/^\d+(\.\d+)?$/.test(L[j] || '') && UNIT.test(L[j + 1] || '')) {
      qty = parseFloat(L[j]);
      if (/ק/.test(L[j + 1])) weight = qty;
      j += 2;
    }
    let discount = 0;
    if (isMoney(L[j] || '') && L[j].startsWith('-')) discount = Math.abs(money(L[j]));
    const gross = Math.round((paid + discount) * 100) / 100;
    const amount = weight || qty || 1;
    out.push({
      code: L[i],
      name,
      qty: weight ? 1 : qty,
      weight,
      unitPrice: Math.round((gross / amount) * 100) / 100,
      gross,
      discount,
      promo: discount > 0 ? 'מבצע' : ''
    });
  }

  if (!out.length) return { error: 'לא מצאתי פריטים בטקסט. כדאי לבחור את כל העמוד ולהעתיק שוב.' };
  if (expected && out.length < expected) {
    warnings.push(`בקבלה כתוב ${expected} פריטים ונקראו ${out.length}. ייתכן שחלק מהעמוד לא הועתק.`);
  }
  const sum = Math.round(out.reduce((s, l) => s + l.gross - l.discount, 0) * 100) / 100;
  if (total != null && Math.abs(sum - total) > 0.05) {
    warnings.push(`סכום הפריטים (₪${sum.toFixed(2)}) שונה מהסכום ששולם (₪${total.toFixed(2)}).`);
  }

  return {
    receipt: {
      chain: 'rami-levy',
      docId: `rl-${txn || 'x'}-${isoDay}`,
      branch: branchLine ? branchLine.replace(/^סניף\s+/, '') : '',
      date: date.toISOString(),
      total: total != null ? total : sum,
      lines: out
    },
    warnings
  };
}
