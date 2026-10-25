// Reads the PDF that the Rami Levy receipt page shares ("להורדת מסמך המקור").
// Each item in the PDF has: a line with name, quantity (יח' or ק"ג), unit price and
// sometimes the line total; a line with the barcode and, after a promotion, the amount paid;
// and for promotions a "מבצע <name> -₪x" line. Text is read on the phone with pdf.js.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';

// Text pieces of all pages → lines (top to bottom), each a list of tokens (right to left).
export function groupLines(pieces) {
  const rows = new Map();
  for (const p of pieces) {
    const s = p.str.trim();
    if (!s) continue;
    const key = p.page * 10000 - Math.round(p.y);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ x: p.x, s });
  }
  return [...rows.keys()].sort((a, b) => a - b).map(k => rows.get(k).sort((a, b) => b.x - a.x).map(t => t.s));
}

export async function readPdfLines(file) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pieces = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    for (const it of tc.items) pieces.push({ str: it.str, x: it.transform[4], y: it.transform[5], page: n });
  }
  return groupLines(pieces);
}

// Turns a line's tokens into words and amounts. Amounts come as ".20 | 2 | ₪" (or with "-").
function tokenize(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i], b = tokens[i + 1], c = tokens[i + 2];
    if (/^\.\d{2}$/.test(a) && /^\d+$/.test(b || '') && c === '₪') {
      const neg = tokens[i + 3] === '-';
      out.push({ amount: parseFloat(b + a) * (neg ? -1 : 1) });
      i += neg ? 3 : 2;
    } else if (a === '₪' && /^\d+$/.test(b || '') && /^\.\d{2}$/.test(c || '')) {
      out.push({ amount: parseFloat(b + c) });
      i += 2;
    } else {
      out.push({ word: a });
    }
  }
  return out;
}

const joinWords = words => words.join(' ').replace(/\s*(['"״׳])\s*/g, '$1').replace(/\s+/g, ' ').trim();

export function parseReceiptPdfLines(lines) {
  const L = lines.map(tokenize);
  const words = l => l.filter(t => t.word).map(t => t.word);
  const amounts = l => l.filter(t => t.amount != null).map(t => t.amount);
  const text = l => joinWords(words(l));

  const all = L.map(text);
  if (!all.some(t => /רמי לוי/.test(t))) return { error: 'זה לא נראה כמו קבלה של רמי לוי.' };
  const txnAt = all.findIndex(t => t === 'קבלה');
  const txn = txnAt >= 0 && /^\d+$/.test(all[txnAt + 1] || '') ? all[txnAt + 1] : '';
  const dateLine = all.find(t => /\d{2}\/\d{2}\/\d{4}/.test(t)) || '';
  const dm = dateLine.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const tm = dateLine.match(/(\d{1,2}):(\d{2})/);
  if (!dm) return { error: 'לא מצאתי את תאריך הקבלה בקובץ.' };
  const branchLine = all.find(t => /^סניף /.test(t));
  const payAt = all.findIndex(t => /סכום לתשלום/.test(t));
  const total = payAt >= 0 ? amounts(L[payAt])[0] : null;

  const items = [];
  let cur = null;
  let pendingGross = null;
  const isEnd = t => /סיכום התשלום|אמצעי תשלום/.test(t);
  for (let i = 0; i < L.length; i++) {
    const t = all[i];
    if (isEnd(t)) break;
    const w = words(L[i]);
    const am = amounts(L[i]);
    // The last unit marker on the line ("ביצים 30יח ... 1 יח'" has one inside the name).
    const unitAt = w.findLastIndex((x, k) => (x === 'יח' && /^['׳]$/.test(w[k + 1] || '')) || (x === 'ק' && /^["״]$/.test(w[k + 1] || '') && w[k + 2] === 'ג'));
    if (unitAt > 0 && am.length) {
      // Item line: "<name> <qty> יח' ₪unit [₪total]" or "<name> <weight> ק"ג ₪unit/kg ₪total".
      const qtyTok = w[unitAt - 1];
      const weighed = w[unitAt] === 'ק';
      const name = joinWords(w.slice(0, unitAt - 1));
      cur = {
        name, code: '', qty: weighed ? 1 : parseFloat(qtyTok) || 1, weight: weighed ? parseFloat(qtyTok) : null,
        unitPrice: am[0], gross: am[1] != null ? am[1] : pendingGross, discount: 0, promo: []
      };
      if (cur.gross == null) cur.gross = Math.round(cur.unitPrice * (cur.weight || cur.qty) * 100) / 100;
      items.push(cur);
      pendingGross = null;
      continue;
    }
    if (/^מבצע(\s|$)/.test(t) && cur && am.some(a => a < 0)) {
      cur.discount = Math.round((cur.discount - am.filter(a => a < 0).reduce((s, a) => s + a, 0)) * 100) / 100;
      cur.promo.push(joinWords(w.slice(1)));
      continue;
    }
    const code = w.find(x => /^\d{3,14}$/.test(x));
    if (code && cur && !cur.code && w.length === 1) {
      cur.code = code;
      continue;
    }
    // A line with only an amount right before an item line is that item's total before discount.
    if (!w.length && am.length === 1 && am[0] > 0) pendingGross = am[0];
  }
  if (!items.length) return { error: 'לא מצאתי פריטים בקובץ.' };

  const out = items.map(it => ({
    code: it.code, name: it.name, qty: it.qty, weight: it.weight, unitPrice: it.unitPrice,
    gross: it.gross, discount: it.discount, promo: it.promo.join(' · ')
  }));
  const sum = Math.round(out.reduce((s, l) => s + l.gross - l.discount, 0) * 100) / 100;
  const warnings = [];
  if (total != null && Math.abs(sum - total) > 0.05) warnings.push(`סכום הפריטים (₪${sum.toFixed(2)}) שונה מהסכום לתשלום (₪${total.toFixed(2)}).`);
  const [, d, m, y] = dm;
  const date = new Date(Number(y), Number(m) - 1, Number(d), tm ? Number(tm[1]) : 12, tm ? Number(tm[2]) : 0);
  return {
    receipt: {
      chain: 'rami-levy',
      docId: `rl-${txn || 'x'}-${y}-${m}-${d}`,
      branch: branchLine ? branchLine.replace(/^סניף\s+/, '') : '',
      date: date.toISOString(),
      total: total != null ? total : sum,
      lines: out
    },
    warnings
  };
}
