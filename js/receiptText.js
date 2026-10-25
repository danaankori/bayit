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
