// Screens and interaction. Each render rebuilds #app from state; clicks are routed
// through data-a="<action>" attributes and inputs through data-in="<field>".

import * as db from './store.js';
import * as L from './logic.js';
import { CATS, guessCategory } from './categories.js';
import { parseReceiptText, looksLikeLink, looksLikeJson, parseReceiptJson, parseScannedTexts, receiptFromDraft } from './receiptText.js';
import { readPdfLines, parseReceiptPdfLines } from './receiptPdf.js';
import { readImages } from './ocr.js';

const app = document.getElementById('app');

const ui = {
  tab: 'catalog',
  shop: null,
  listStore: 'rl',
  catQ: '',
  catFilter: 'all',
  add: { open: false, name: '', cat: null, target: null, picking: false },
  lastAdded: null,
  listQ: '',
  bulk: null,
  shopQ: '',
  finishing: false,
  receipt: { step: 'paste', text: '', error: '', warnings: [], model: null, dec: null, summary: null, showMatched: false },
  priceMode: 'promo',
  priceQ: '',
  routeStore: 'rl',
  newStore: '',
  welcomeName: '',
  hh: { name: 'הבית שלנו', code: '', error: '', busy: false },
  cfgUrl: null,
  cfgKey: null,
  toast: ''
};

// ---------- helpers ----------

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Hebrew prefix letter before a store name; Latin names get a hyphen ("ל-Ten2Ten").
const pre = (p, n) => p + (/^[A-Za-z0-9]/.test(n) ? '-' : '') + n;
const money = n => '₪' + Number(n).toFixed(2);
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: '2-digit' }); };

const I = {
  plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  search: '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  swap: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7h13l-3-3M17 17H4l3 3"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  left: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  cart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11h10.2L20 8H7"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
  spark: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
  tabCatalog: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  tabList: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  tabReceipt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  tabPrices: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
  tabSettings: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>'
};

function storePill(store, action, id) {
  const st = L.storeById(store);
  return `<button class="pill" style="background:${st.color}1F;color:${st.color}" data-a="${action}" data-id="${esc(id)}" aria-label="החלפת חנות, עכשיו ${esc(st.name)}">${esc(st.name)}</button>`;
}

function searchBox(id, value, placeholder) {
  return `<div class="search"><label class="sr" for="${id}">${esc(placeholder)}</label>
    <input id="${id}" class="field" data-in="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
    ${I.search}
    ${value ? `<button class="clear" data-a="clear" data-k="${id}" aria-label="ניקוי החיפוש">${I.x}</button>` : ''}</div>`;
}

function qtyLabel(item) {
  const p = db.one('products', item.productId);
  return p && p.unit === 'ק״ג' ? `${item.qty} ק״ג` : `× ${item.qty}`;
}

function syncBadge() {
  const s = db.sync.status;
  const pend = db.pendingCount();
  const text = {
    local: 'במכשיר בלבד',
    nohousehold: 'צריך משק בית',
    offline: pend ? `בלי חיבור · ${pend} ממתינים` : 'בלי חיבור',
    syncing: 'מסנכרן…',
    synced: 'מסונכרן',
    error: pend ? `השרת לא זמין · ${pend} ממתינים` : 'השרת לא זמין'
  }[s] || s;
  return `<button class="sync ${s}" data-a="tab" data-tab="settings" style="cursor:pointer"><span class="dot"></span>${esc(text)}</button>`;
}

function head(kicker, title, right) {
  return `<header class="page-head"><div><span class="kicker">${kicker}</span><h1>${title}</h1></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">${syncBadge()}${right || ''}</div></header>`;
}

function nav() {
  const tabs = [['catalog', 'קטלוג', I.tabCatalog], ['list', 'רשימה', I.tabList], ['receipts', 'קבלות', I.tabReceipt], ['prices', 'מחירים', I.tabPrices], ['settings', 'הגדרות', I.tabSettings]];
  return `<nav class="tabs" aria-label="ניווט ראשי"><div class="inner">${tabs.map(([id, label, icon]) =>
    `<button class="${ui.tab === id ? 'on' : ''}" data-a="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}>${icon}${label}</button>`).join('')}</div></nav>`;
}

function otherStoreId(storeId) {
  const act = L.activeStores();
  const i = act.findIndex(s => s.id === storeId);
  const next = act[(i + 1) % act.length];
  return next && next.id !== storeId ? next.id : null;
}

// ---------- catalog ----------

function addForm() {
  const a = ui.add;
  const name = a.name.trim();
  const guessed = guessCategory(name);
  const cat = a.cat || guessed;
  const suggested = L.defaultStoreFor(cat);
  const target = a.target || suggested;
  const existing = L.findProducts(name).slice(0, 3);
  const showPicker = !!name && (a.picking || !cat);
  const canAdd = !!(name && cat);
  const targets = L.activeStores().map(s => ({ id: s.id, label: s.name, color: s.color })).concat([{ id: 'none', label: 'רק לקטלוג', color: '#1B2420' }]);
  return `<div class="card bordered">
    <label class="lbl" for="addName" style="margin:0">מה להוסיף? רק השם, את השאר האפליקציה משלימה</label>
    <input id="addName" class="field" data-in="addName" value="${esc(a.name)}" placeholder="למשל: חומץ בלסמי" autocomplete="off">
    ${!a.name ? `<button class="btn link small" style="align-self:flex-start;padding:0" data-a="bulkOpen">יש רשימה כתובה? הדבקת כמה מוצרים בבת אחת</button>` : ''}
    ${existing.length ? `<div style="display:flex;flex-direction:column;gap:6px"><span class="tiny muted">כבר יש בקטלוג</span>
      ${existing.map(p => { const inList = !!L.itemForProduct(p.id); return `<button class="btn" style="justify-content:space-between;background:#F7F8F6" data-a="addExisting" data-id="${p.id}"><span>${esc(p.name)} <span class="tiny muted">· ${esc(p.cat)}</span></span><span style="color:var(--green);font-weight:600">${inList ? 'כבר ברשימה' : '+ לרשימה'}</span></button>`; }).join('')}</div>` : ''}
    ${name ? `<div class="card soft" style="padding:10px 12px">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="small muted" style="width:62px;flex:none">קטגוריה</span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <span style="font-weight:600;color:${cat ? 'var(--ink)' : 'var(--warn)'}">${esc(cat || 'לא זוהתה')}</span>
          <span class="tiny muted" style="display:flex;align-items:center;gap:4px">${!a.cat && guessed ? `<span style="color:var(--green)">${I.spark}</span>זוהתה אוטומטית לפי השם` : (a.cat ? 'נבחרה ידנית' : 'יש לבחור מהרשימה למטה')}</span>
        </span>
        <button class="btn small" data-a="togglePicker" aria-expanded="${showPicker}">${a.picking ? 'סגירה' : 'שינוי'}</button>
      </div>
      <div style="border-top:1px solid #E6E9E4;padding-top:10px;display:flex;flex-direction:column;gap:6px">
        <span class="small muted">להוסיף גם לרשימת הקניות?</span>
        <div style="display:grid;grid-template-columns:repeat(${targets.length}, minmax(0, 1fr));gap:6px">
          ${targets.map(t => { const on = t.id === target; return `<button class="btn small" style="${on ? `background:${t.color};border-color:${t.color};color:#fff` : `color:${t.color}`};font-weight:600;padding:0 4px" aria-pressed="${on}" data-a="addTarget" data-id="${t.id}">${esc(t.label)}</button>`; }).join('')}
        </div>
        <span class="tiny muted">${target === 'none' ? 'יישמר בקטלוג בלבד. אפשר להוסיף לרשימה מתי שרוצים' : (a.target ? 'החנות הקבועה של המוצר תהיה ' + esc(L.storeById(target).name) : 'הוצע לפי הקטגוריה. אפשר לבחור אחרת')}</span>
      </div>
    </div>` : ''}
    ${showPicker ? `<div class="wrap-chips">${CATS.map(c => `<button class="chip ${c === cat ? 'on' : ''}" aria-pressed="${c === cat}" data-a="addCat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    <button class="btn ${canAdd ? 'primary' : ''}" ${canAdd ? '' : 'disabled'} data-a="addNew" style="height:48px">${canAdd ? (target === 'none' ? 'הוספה לקטלוג' : 'הוספה לקטלוג ולרשימת ' + esc(L.storeById(target).name)) : (name ? 'יש לבחור קטגוריה' : 'הוספה')}</button>
  </div>`;
}

function catalogRow(p) {
  const item = L.itemForProduct(p.id);
  const right = item
    ? `<div class="stepper"><button data-a="inc" data-id="${p.id}" aria-label="עוד אחד">${I.plus}</button><span>${item.qty}</span><button data-a="dec" data-id="${p.id}" aria-label="אחד פחות">${I.minus}</button></div>`
    : `<button class="add-btn" data-a="inc" data-id="${p.id}" aria-label="הוספת ${esc(p.name)} לרשימה">${I.plus}</button>`;
  return `<div class="row ${item ? 'on' : ''}"><div class="grow"><span class="name">${esc(p.name)}</span>
    <div class="meta">${storePill(item ? item.store : p.store, 'productStore', p.id)}${p.unit === 'ק״ג' ? '<span>לפי משקל</span>' : ''}</div></div>${right}</div>`;
}

function renderCatalog() {
  const q = ui.catQ.trim();
  const all = L.products();
  const shown = all.filter(p => (ui.catFilter === 'all' || p.cat === ui.catFilter) && (!q || p.name.includes(q)));
  const groups = CATS.map(c => ({ c, items: shown.filter(p => (p.cat || 'שונות') === c).sort((a, b) => a.name.localeCompare(b.name, 'he')) })).filter(g => g.items.length);
  const items = L.listItems();
  const sugg = L.suggestions();
  const usedCats = CATS.filter(c => all.some(p => p.cat === c));
  const chips = [['all', 'הכול']].concat(usedCats.map(c => [c, c]));
  const counts = L.activeStores().map(s => `${esc(s.name)} ${items.filter(i => i.store === s.id).length}`).join(' · ');
  const last = ui.lastAdded;
  return `${head('הקטלוג · ירוק = ברשימה עכשיו', 'מה צריך?', `<button class="btn small" data-a="toggleAdd">${I.plus} מוצר חדש</button>`)}
  <div class="wrap">
    ${ui.add.open ? addForm() : ''}
    ${last ? `<div class="banner" role="status"><span style="flex:1">${esc(last.text)}</span>
      ${last.where === 'none' ? `<button class="btn small" data-a="lastToList">+ לרשימה</button>` : `<button class="btn link small" data-a="tab" data-tab="list">לרשימה</button>`}
      <button class="icon-btn plain" data-a="dismissLast" aria-label="סגירת ההודעה">${I.x}</button></div>` : ''}
    ${searchBox('catQ', ui.catQ, 'חיפוש בקטלוג')}
    <div class="chips">${chips.map(([id, label]) => `<button class="chip ${ui.catFilter === id ? 'on' : ''}" data-a="catFilter" data-cat="${esc(id)}">${esc(label)}</button>`).join('')}</div>
    ${sugg.length && !q ? `<div class="card darkcard"><span class="tag">הצעה לפי הקניות הקודמות</span>
      <p style="font-size:15px">אלה בדרך כלל נגמרים בערך עכשיו, ולא ברשימה:</p>
      ${sugg.map(s => `<div style="display:flex;align-items:center;gap:8px"><span style="flex:1">${esc(L.productName(s.productId))} <span class="tiny muted">· כל ~${s.every} ימים, עברו ${s.days}</span></span><button class="btn small" data-a="inc" data-id="${s.productId}">הוספה</button></div>`).join('')}
    </div>` : ''}
    ${groups.map(g => `<section class="group"><h2>${esc(g.c)}</h2>${g.items.map(catalogRow).join('')}</section>`).join('')}
    ${!groups.length ? `<p class="empty">לא נמצא בקטלוג. אפשר להוסיף כמוצר חדש.</p>` : ''}
    <div class="spacer-cta"></div>
  </div>
  ${items.length ? `<div class="footer-cta"><button class="cta" data-a="tab" data-tab="list"><span><span>${items.length} פריטים ברשימה</span><span class="sub">${counts}</span></span><span style="display:flex;align-items:center;gap:4px">לרשימה ${I.left}</span></button></div>` : ''}`;
}

// ---------- list ----------

function renderList() {
  const act = L.activeStores();
  if (!act.find(s => s.id === ui.listStore) && act[0]) ui.listStore = act[0].id;
  const store = L.storeById(ui.listStore);
  const q = ui.listQ.trim();
  const hits = i => !q || L.productName(i.productId).includes(q);
  const mine = L.listItems(store.id).filter(hits);
  const groups = L.groupByRoute(mine, store);
  const other = otherStoreId(store.id);
  const inOther = other ? L.listItems(other).filter(hits).length : 0;
  const hh = db.raw().household;
  let n = 0;
  return `${head(hh ? 'רשימה משותפת · ' + esc(hh.name) : 'שמור במכשיר הזה', 'רשימת הקניות', `<div class="row-actions" style="justify-content:flex-end"><button class="btn small" data-a="bulkOpen">הדבקת רשימה</button><button class="btn small" data-a="tab" data-tab="catalog">${I.plus} מהקטלוג</button></div>`)}
  <div class="wrap">
    <div class="seg" role="tablist">${act.map(s => `<button role="tab" class="${s.id === store.id ? 'on' : ''}" aria-selected="${s.id === store.id}" data-a="listStore" data-id="${s.id}"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}<span class="count">${L.listItems(s.id).filter(hits).length}</span></button>`).join('')}</div>
    ${searchBox('listQ', ui.listQ, 'חיפוש ברשימה')}
    ${!q ? `<p class="tiny muted" style="margin:0 4px">מסודר לפי המסלול בחנות. משנים את הסדר בהגדרות.</p>` : ''}
    ${q && !mine.length ? `<div class="card"><span style="font-weight:500">"${esc(q)}" לא ברשימת ${esc(store.name)}</span>
      <div class="row-actions">${inOther ? `<button class="btn small" data-a="listStore" data-id="${other}">נמצא ברשימת ${esc(L.storeById(other).name)} (${inOther})</button>` : ''}
      <button class="btn small primary" data-a="tab" data-tab="catalog">הוספה מהקטלוג</button></div></div>` : ''}
    ${!q && !mine.length ? `<p class="empty">הרשימה של ${esc(store.name)} ריקה. מוסיפים מהקטלוג.</p>` : ''}
    ${groups.map(g => { n++; return `<section class="group"><h2><span class="num">${n}</span>${esc(g.cat)}</h2><div class="list-card">${g.items.map(it => {
      const o = otherStoreId(it.store);
      return `<div class="row ${it.status === 'taken' ? 'taken' : ''}">
        <div class="stepper light"><button data-a="itemInc" data-id="${it.id}" aria-label="עוד אחד">${I.plus}</button><span>${it.qty}</span><button data-a="itemDec" data-id="${it.id}" aria-label="אחד פחות">${I.minus}</button></div>
        <div class="grow"><span class="name">${esc(L.productName(it.productId))}</span>
          <span class="meta">${it.status === 'taken' ? '<span style="color:var(--green);font-weight:600">בעגלה</span>' : ''}${it.status === 'oos' ? '<span style="color:var(--warn);font-weight:600">לא היה במלאי</span>' : ''}${it.note ? `<span>${esc(it.note)}</span>` : ''}${it.addedBy ? `<span>נוסף ע״י ${esc(it.addedBy)}</span>` : ''}</span></div>
        ${o ? `<button class="icon-btn" data-a="moveItem" data-id="${it.id}" aria-label="העברה ${esc(pre("ל", L.storeById(o).name))}" title="העברה ${esc(pre("ל", L.storeById(o).name))}">${I.swap}</button>` : ''}
        <button class="icon-btn plain" data-a="removeItem" data-id="${it.id}" aria-label="הסרה מהרשימה">${I.x}</button>
      </div>`; }).join('')}</div></section>`; }).join('')}
    <div class="spacer-cta"></div>
  </div>
  ${L.listItems(store.id).length ? `<div class="footer-cta"><button class="cta center" style="background:${store.color}" data-a="startShop" data-id="${store.id}">${I.cart} מצב קנייה · ${esc(store.name)}</button></div>` : ''}`;
}

// ---------- pasted list ----------

function renderBulk() {
  const b = ui.bulk;
  if (b.step === 'paste') {
    return `${head('כמה מוצרים בבת אחת', 'הדבקת רשימה')}
    <div class="wrap">
      <div class="card bordered">
        <p class="small muted">מדביקים רשימה שכבר כתובה, שורה לכל מוצר. כמות כותבים כך: "חומץ בלסמי×2" או "2 חלב".</p>
        <label class="sr" for="bulkText">הרשימה</label>
        <textarea id="bulkText" class="field" data-in="bulkText" rows="10" style="height:auto;padding:10px 12px;resize:vertical" placeholder="פילטר למים&#10;חומץ בלסמי×2&#10;נוזל קוקוס×3">${esc(b.text)}</textarea>
        <div class="row-actions"><button class="btn" data-a="bulkPaste">הדבקה</button>
        <button class="btn primary" style="flex:1" data-a="bulkReview" ${b.text.trim() ? '' : 'disabled'}>המשך</button></div>
        <button class="btn link" data-a="bulkCancel">ביטול</button>
      </div>
    </div>`;
  }
  const act = L.activeStores();
  const n = b.rows.filter(r => r.include).length;
  const fresh = b.rows.filter(r => r.include && r.choice === 'new').length;
  return `${head(`${b.rows.length} שורות · ${fresh ? fresh + ' מוצרים חדשים' : 'כולם מהקטלוג'}`, 'בדיקה לפני הוספה')}
  <div class="wrap">
    <div class="card soft" style="padding:10px 12px">
      <span class="small muted">לאיזו חנות?</span>
      <div class="wrap-chips">${[{ id: 'auto', name: 'לפי כל מוצר' }].concat(act).map(s => `<button class="chip ${b.storeAll === s.id ? 'on' : ''}" aria-pressed="${b.storeAll === s.id}" data-a="bulkStoreAll" data-id="${s.id}">${esc(s.name)}</button>`).join('')}</div>
    </div>
    <p class="tiny muted" style="margin:0 4px">מה שמסומן "התאמה משוערת" כדאי לבדוק. אפשר לבחור מוצר אחר מהרשימה או "מוצר חדש".</p>
    ${b.rows.map((r, i) => {
      const inList = r.choice !== 'new' && L.itemForProduct(r.choice);
      const tag = r.choice === 'new' ? ['מוצר חדש', 'var(--green)'] : (r.exact ? null : ['התאמה משוערת', 'var(--warn)']);
      return `<div class="card" style="gap:8px;${r.include ? '' : 'opacity:.55'}">
        <div style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="bi${i}" data-in="bulkInclude" data-k="${i}" ${r.include ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--green)">
          <label for="bi${i}" style="flex:1;font-weight:500">${esc(r.raw)}</label>
          ${tag ? `<span class="tiny" style="color:${tag[1]};font-weight:600">${tag[0]}</span>` : ''}
        </div>
        ${r.include ? `<label class="sr" for="bc${i}">מוצר</label>
        <select id="bc${i}" class="field" data-in="bulkChoice" data-k="${i}">
          ${r.cands.map(c => `<option value="${c.id}" ${r.choice === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          <option value="new" ${r.choice === 'new' ? 'selected' : ''}>מוצר חדש: ${esc(r.name)}</option>
        </select>
        ${r.choice === 'new' ? `<label class="sr" for="bk${i}">קטגוריה</label><select id="bk${i}" class="field" data-in="bulkCat" data-k="${i}">${CATS.map(c => `<option ${c === r.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="stepper light"><button data-a="bulkQty" data-k="${i}" data-d="1" aria-label="עוד אחד">${I.plus}</button><span>${r.qty}</span><button data-a="bulkQty" data-k="${i}" data-d="-1" aria-label="אחד פחות">${I.minus}</button></div>
          ${storePill(r.store, 'bulkStore', i)}
          ${inList ? `<span class="tiny muted">כבר ברשימה (${inList.qty}), הכמות תתעדכן</span>` : ''}
        </div>` : ''}
      </div>`;
    }).join('')}
    <button class="btn link" data-a="bulkBack">חזרה לעריכת הטקסט</button>
    <div class="spacer-cta"></div>
  </div>
  <div class="footer-cta"><button class="cta center" data-a="bulkApply" ${n ? '' : 'disabled'}>הוספת ${n} פריטים לרשימה</button></div>`;
}

function buildBulkRows(text, storeAll) {
  return L.parseListText(text).map(l => {
    const m = L.matchProducts(l.name);
    const best = m[0];
    const cat = guessCategory(l.name) || 'שונות';
    const row = {
      raw: l.raw, name: l.name, qty: l.qty, include: true,
      choice: best ? best.p.id : 'new', exact: !!best && best.score === 1,
      cands: m.map(x => ({ id: x.p.id, name: x.p.name })), cat, store: null
    };
    row.store = bulkStoreFor(row, storeAll);
    return row;
  });
}

function bulkStoreFor(row, storeAll) {
  if (storeAll && storeAll !== 'auto') return storeAll;
  if (row.choice === 'new') return L.defaultStoreFor(row.cat);
  const it = L.itemForProduct(row.choice);
  const p = db.one('products', row.choice);
  return (it && it.store) || (p && p.store) || L.defaultStoreFor(row.cat);
}

// ---------- shopping mode ----------

function renderShop() {
  const store = L.storeById(ui.shop);
  const all = L.listItems(store.id);
  const q = ui.shopQ.trim();
  const shown = all.filter(i => !q || L.productName(i.productId).includes(q));
  const open = shown.filter(i => i.status === 'open');
  const oos = shown.filter(i => i.status === 'oos');
  const taken = shown.filter(i => i.status === 'taken');
  const done = all.filter(i => i.status !== 'open').length;
  const pct = all.length ? Math.round(done / all.length * 100) : 0;
  const other = otherStoreId(store.id);
  const others = L.activeStores().filter(s => s.id !== store.id).map(s => {
    const its = L.listItems(s.id);
    const t = its.filter(i => i.status === 'taken').length;
    return t ? `<div class="banner" style="background:${s.color}1A;color:var(--ink)"><span style="flex:1" class="small">${esc(s.name)}: נאספו ${t} מתוך ${its.length}</span></div>` : '';
  }).join('');
  const groups = L.groupByRoute(open, store);
  return `<div class="shop-head" style="background:${store.color}">
    <div style="display:flex;justify-content:space-between;align-items:center"><button class="back" data-a="endShop">${I.back} לרשימה</button>${syncBadge()}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end"><h1>קנייה ${esc(pre("ב", store.name))}</h1><span style="font-weight:600">${done} מתוך ${all.length}</span></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
  </div>
  <div class="wrap" style="margin-top:12px">
    ${others}
    ${searchBox('shopQ', ui.shopQ, 'חיפוש ברשימה, למשל: גבינה')}
    ${q && !shown.length ? `<div class="card"><span style="font-weight:500">"${esc(q)}" לא ברשימה</span><span class="small muted">ראיתם משהו שצריך? אפשר להוסיף אותו עכשיו.</span><button class="btn primary" style="align-self:flex-start;background:${store.color};border-color:${store.color}" data-a="shopAdd">הוספת "${esc(q)}" לרשימה</button></div>` : ''}
    ${groups.map(g => `<section class="group"><h2>${esc(g.cat)}</h2>${g.items.map(it => `<div class="row" style="padding:4px 6px 4px 6px">
      <button class="take" data-a="take" data-id="${it.id}" aria-label="סימון ${esc(L.productName(it.productId))} כנלקח"><span class="circle"></span><span class="name" style="flex:1">${esc(L.productName(it.productId))}${it.note ? ` <span class="tiny muted">(${esc(it.note)})</span>` : ''}</span><span style="font-weight:600;color:${store.color}">${qtyLabel(it)}</span></button>
      <button class="btn small" style="background:#F7F8F6;border-color:var(--line);color:var(--muted)" data-a="oos" data-id="${it.id}">אין במלאי</button></div>`).join('')}</section>`).join('')}
    ${!q && all.length && !open.length ? `<div class="card" style="background:var(--green-soft);text-align:center"><b style="color:var(--green)">הכול בעגלה</b><span class="small" style="color:#2F5E49">אחרי התשלום אפשר לייבא את הקבלה ולבדוק שלא פספסתם כלום</span></div>` : ''}
    ${oos.length ? `<section class="group"><h2 style="color:var(--warn)">לא היה במלאי</h2>${oos.map(it => `<div class="row oos"><div class="grow"><span class="name">${esc(L.productName(it.productId))}</span></div>
      ${other ? `<button class="btn small" data-a="moveItem" data-id="${it.id}">להעביר ${esc(pre("ל", L.storeById(other).name))}</button>` : ''}<button class="btn small link" data-a="untake" data-id="${it.id}">ביטול</button></div>`).join('')}</section>` : ''}
    ${taken.length ? `<section class="group"><h2 style="color:var(--green)">בעגלה (${taken.length})</h2>${taken.map(it => `<div class="row taken"><button class="take" data-a="untake" data-id="${it.id}" aria-label="ביטול הסימון של ${esc(L.productName(it.productId))}"><span class="circle done">${I.check}</span><span class="name" style="flex:1">${esc(L.productName(it.productId))}</span><span>${qtyLabel(it)}</span></button></div>`).join('')}</section>` : ''}
    <div class="spacer-cta"></div>
  </div>
  <div class="footer-cta"><button class="cta center" data-a="finishOpen">סיום קנייה</button></div>
  ${ui.finishing ? `<div class="sheet-back" data-a="finishClose"><div class="sheet" data-a="noop">
    <h2 style="font-size:18px">סיום הקנייה ${esc(pre("ב", store.name))}</h2>
    <p class="small muted">${done ? `${taken.length || all.filter(i => i.status === 'taken').length} פריטים בעגלה.` : 'עוד לא סומן שום פריט.'} עם קבלה דיגיטלית אפשר לבדוק מה נקנה באמת ולשמור מחירים.</p>
    <button class="btn block primary" data-a="finishReceipt">ייבוא הקבלה</button>
    <button class="btn block" data-a="finishNoReceipt">סיום בלי קבלה</button>
    <button class="btn link" data-a="finishClose">ביטול</button>
  </div></div>` : ''}`;
}

// ---------- receipts ----------

function renderReceipts() {
  const r = ui.receipt;
  if (r.step === 'review') return renderReview();
  if (r.step === 'scanning') {
    return `${head('קבלה מצילום', 'קורא את הקבלה…')}<div class="wrap"><div class="card" style="gap:12px">
      <span>${esc(r.scan.label || 'מתחיל')}</span>
      <div style="height:8px;border-radius:999px;background:#E6E9E4;overflow:hidden"><div style="height:8px;background:var(--green);width:${Math.round((r.scan.f || 0) * 100)}%"></div></div>
      <span class="tiny muted">הכול נעשה בטלפון. זה יכול לקחת כמה שניות לכל תמונה.</span>
    </div></div>`;
  }
  if (r.step === 'edit') return renderScanEdit();
  if (r.step === 'done') {
    const s = r.summary;
    return `${head('ייבוא קבלה', 'הקנייה נשמרה')}<div class="wrap"><div class="card" style="align-items:center;text-align:center;padding:22px 18px">
      <span class="circle done" style="width:56px;height:56px">${I.check}</span>
      <span>${s.bought} פריטים מהרשימה סומנו כנקנו והורדו מהרשימה</span>
      ${s.linked ? `<span>${s.linked} מוצרים קושרו לברקוד שלהם, בפעם הבאה הם יזוהו לבד</span>` : ''}
      ${s.added ? `<span>${s.added} מוצרים חדשים נוספו לקטלוג</span>` : ''}
      ${s.moved ? `<span>${s.moved} פריטים הועברו לחנות אחרת</span>` : ''}
      <span>המחירים ששילמתם נשמרו להשוואה</span>
      <div class="row-actions"><button class="btn dark" data-a="tab" data-tab="list">לרשימה</button><button class="btn" data-a="receiptReset">קבלה נוספת</button></div>
    </div></div>`;
  }
  const hist = L.receipts();
  return `${head('אחרי הקנייה', 'ייבוא קבלה')}
  <div class="wrap">
    <div class="card bordered">
      <h2 style="font-size:17px">קבלה דיגיטלית של רמי לוי</h2>
      <p class="small muted">טוענים את קובץ ה-PDF של הקבלה. הוא נקרא במלואו, כולל ברקודים, כמויות, מחירים ומבצעים.</p>
      <label class="btn primary block" style="cursor:pointer">טעינת קובץ PDF<input type="file" accept="application/pdf,.pdf" data-in="receiptPdf" class="sr"></label>
      <details id="helpPdf"><summary class="small" style="cursor:pointer;color:var(--green)">איך משיגים את קובץ ה-PDF?</summary>
        <div class="small muted" style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          <b style="color:var(--ink)">באייפון</b>
          <ol style="margin:0;padding-inline-start:20px;display:flex;flex-direction:column;gap:4px">
            <li>פותחים את הקישור לקבלה מה-SMS</li>
            <li>גוללים לתחתית העמוד ולוחצים "להורדת מסמך המקור"</li>
            <li>כשהקובץ נפתח: כפתור השיתוף ← "שמירה בקבצים" ← שמירה</li>
            <li>חוזרים לכאן: "טעינת קובץ PDF" ← בוחרים את הקובץ (בדרך כלל בתיקייה "הורדות" או "אחרונים")</li>
          </ol>
          <b style="color:var(--ink)">באנדרואיד</b>
          <ol style="margin:0;padding-inline-start:20px;display:flex;flex-direction:column;gap:4px">
            <li>פותחים את הקישור ולוחצים "להורדת מסמך המקור"</li>
            <li>בקובץ שירד: שיתוף ← "בית". האפליקציה תיפתח עם הקבלה</li>
            <li>או: "טעינת קובץ PDF" כאן ובחירת הקובץ מההורדות</li>
          </ol>
          <span>באפשרות "הורדת חשבונית מס" לא צריך להשתמש: היא מבקשת שם ות.ז.</span>
        </div>
      </details>
      <div style="border-top:1px solid var(--line-soft);padding-top:10px;display:flex;flex-direction:column;gap:8px">
        <span class="small muted">יש לך באייפון את קיצור הדרך "קבלה לבית"? אחרי שהרצת אותו מהקישור, לוחצים כאן:</span>
        <button class="btn" data-a="paste">הדבקת הקבלה מקיצור הדרך</button>
      </div>
      ${r.error ? `<div class="banner warn" role="alert">${esc(r.error)}</div>` : ''}
      <details id="pasteText"><summary class="tiny muted" style="cursor:pointer">אפשרות נוספת: הדבקת הטקסט של עמוד הקבלה</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
          <span class="tiny muted">בעמוד הקבלה: "הצגת עוד פריטים" ← לחיצה ארוכה ← "בחר הכל" ← "העתק", ואז הדבקה כאן.</span>
          <label class="sr" for="receiptText">טקסט הקבלה</label>
          <textarea id="receiptText" class="field" data-in="receiptText" rows="3" style="height:auto;padding:10px 12px;resize:vertical" placeholder="הטקסט שהועתק מעמוד הקבלה">${esc(r.text)}</textarea>
          <button class="btn" data-a="readReceipt" ${r.text.trim() ? '' : 'disabled'}>קריאת הטקסט</button>
          ${looksLikeLink(r.text) ? `<div class="banner warn" role="status" style="flex-wrap:wrap"><span style="flex:1;min-width:200px">הודבק קישור, לא טקסט. אפשר לפתוח אותו ולהוריד משם את ה-PDF.</span>
            <a class="btn small" href="${esc(r.text.trim())}" target="_blank" rel="noopener">פתיחת הקבלה</a></div>` : ''}
        </div>
      </details>
      <p class="tiny muted">הקריאה נעשית בטלפון. נשמרים רק המוצרים, הכמויות, המחירים, הסניף והתאריך.</p>
    </div>
    <div class="card bordered">
      <h2 style="font-size:17px">קבלה מודפסת או צילומי מסך</h2>
      <p class="small muted">מצלמים את הקבלה (אפשר כמה תמונות לקבלה ארוכה) או בוחרים צילומי מסך של קבלה דיגיטלית. הקריאה נעשית בטלפון, ואחריה בודקים ומתקנים את השורות.</p>
      <div class="row-actions">
        <label class="btn primary" style="flex:1;cursor:pointer">צילום קבלה<input type="file" accept="image/*" capture="environment" data-in="receiptPhotos" class="sr"></label>
        <label class="btn" style="flex:1;cursor:pointer">בחירת תמונות<input type="file" accept="image/*" multiple data-in="receiptPhotos" class="sr"></label>
      </div>
      <p class="tiny muted">הקריאה מתמונה פחות מדויקת מהעתקת טקסט: כדאי לצלם ישר, באור טוב, וכל הקבלה בתוך התמונה.</p>
    </div>
    <section class="group"><h2>קניות קודמות</h2>
      ${hist.length ? `<div class="list-card">${hist.map(h => `<div class="row"><div class="grow"><span class="name">${esc(L.storeById(h.store).name)}${h.branch ? ' · ' + esc(h.branch) : ''}</span>
        <span class="meta"><span>${fmtDate(h.date)}</span><span>${h.lines.filter(l => !l.ignore).length} פריטים</span><span>${h.kind === 'manual' ? 'בלי קבלה' : ''}</span></span></div>
        <span style="font-weight:600">${h.total != null ? money(h.total) : ''}</span></div>`).join('')}</div>` : '<p class="empty">עוד אין קניות שמורות.</p>'}
    </section>
  </div>`;
}

function renderScanEdit() {
  const r = ui.receipt;
  const dr = r.draft;
  const chains = L.stores().map(s => ({ id: s.chain || s.id, name: s.name, color: s.color }));
  const sum = dr.lines.reduce((s, l) => s + (Number(l.paid) || 0), 0);
  const off = dr.total != null && Math.abs(sum - dr.total) > 0.05;
  return `${head('נקרא מהצילום · כדאי לבדוק', 'בדיקת השורות')}
  <div class="wrap">
    <div class="card soft" style="padding:10px 12px">
      <span class="small muted">מאיזו חנות הקבלה?</span>
      <div class="wrap-chips">${chains.map(c => `<button class="chip ${dr.chain === c.id ? 'on' : ''}" aria-pressed="${dr.chain === c.id}" data-a="scanChain" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>
      <label class="lbl" for="scanDate" style="margin:6px 0 0">תאריך הקנייה</label>
      <input id="scanDate" type="date" class="field" data-in="scanDate" value="${esc(dr.date)}" style="max-width:200px">
    </div>
    <div class="banner ${off ? 'warn' : ''}" role="status"><span>סכום השורות ${money(sum)}${dr.total != null ? ` · בקבלה ${money(dr.total)}` : ''}${off ? '. משהו לא נקרא נכון: כדאי לבדוק מחירים חסרים או כפולים.' : ''}</span></div>
    <p class="tiny muted" style="margin:0 4px">מתקנים שם, כמות או סכום ששולם (אחרי הנחה). שורה מיותרת מוחקים ב-×.</p>
    <div class="list-card">${dr.lines.map((l, i) => `<div class="row" style="flex-wrap:wrap;gap:6px;padding:8px 10px">
      <label class="sr" for="sn${i}">שם</label><input id="sn${i}" class="field" style="flex:1 1 100%;height:40px" data-in="scanName" data-k="${i}" value="${esc(l.name)}">
      <label class="tiny muted" for="sq${i}">${l.weight ? 'ק״ג' : 'כמות'}</label><input id="sq${i}" class="field" style="width:70px;height:38px" inputmode="decimal" data-in="scanQty" data-k="${i}" value="${esc(l.weight || l.qty)}">
      <label class="tiny muted" for="sp${i}">שולם ₪</label><input id="sp${i}" class="field" style="width:90px;height:38px" inputmode="decimal" data-in="scanPaid" data-k="${i}" value="${esc(l.paid)}">
      ${l.discount ? `<span class="tiny muted">הנחה ${money(l.discount)}</span>` : ''}
      <span style="flex:1"></span>
      <button class="icon-btn plain" data-a="scanRemove" data-k="${i}" aria-label="מחיקת השורה ${esc(l.name)}">${I.x}</button>
    </div>`).join('')}</div>
    <button class="btn" data-a="scanAddLine">${I.plus} הוספת שורה</button>
    ${r.error ? `<div class="banner warn" role="alert">${esc(r.error)}</div>` : ''}
    <details id="ocrText"><summary class="tiny muted" style="cursor:pointer">הטקסט שזוהה בצילום</summary><pre class="tiny muted" style="white-space:pre-wrap;direction:rtl">${esc(r.ocrText || '')}</pre></details>
    <button class="btn link" data-a="receiptReset">ביטול</button>
    <div class="spacer-cta"></div>
  </div>
  <div class="footer-cta"><button class="cta center" data-a="scanContinue">המשך להשוואה עם הרשימה</button></div>`;
}

function syncText() {
  return { local: 'האפליקציה לא מחוברת לשרת', nohousehold: 'מחוברים, אבל עוד לא נוצר משק בית', offline: 'אין אינטרנט', error: 'השרת לא זמין', syncing: 'מסנכרן', synced: 'מחובר' }[db.sync.status] || '';
}

function decisionButtons(group, key, options, current) {
  return `<div class="row-actions">${options.map(([v, label]) => `<button class="btn small ${current === v ? 'primary' : ''}" aria-pressed="${current === v}" data-a="decide" data-g="${group}" data-k="${esc(key)}" data-v="${v}">${label}</button>`).join('')}</div>`;
}

function renderReview() {
  const m = ui.receipt.model;
  const d = ui.receipt.dec;
  const rc = m.receipt;
  const store = L.storeById(m.storeId);
  const other = otherStoreId(m.storeId);
  const pending = m.confirm.filter(c => !d.confirm[c.line.idx]).length + m.unknown.filter(u => !d.unknown[u.line.idx]).length;
  const unknownCards = m.unknown.concat(m.confirm.filter(c => d.confirm[c.line.idx] === 'no').map(c => L.unknownLine(c.line)));
  return `${head('קבלה מ-' + fmtDate(rc.date), 'מה נקנה לעומת הרשימה')}
  <div class="wrap">
    <div class="card" style="background:${store.color};color:#fff">
      <div style="display:flex;justify-content:space-between"><b>${esc(store.name)}${rc.branch ? ' · ' + esc(rc.branch) : ''}</b><span class="small">${fmtDate(rc.date)}</span></div>
      <div style="display:flex;gap:16px;align-items:baseline"><span style="font-size:28px;font-weight:700">${money(rc.total)}</span><span class="small">${m.lines.filter(l => !l.ignore).length} פריטים</span></div>
    </div>
    ${(ui.receipt.warnings || []).map(w => `<div class="banner warn" role="status">${esc(w)}</div>`).join('')}
    <div class="card">
      <button class="take" style="padding:0" data-a="toggleMatched" aria-expanded="${ui.receipt.showMatched}"><span class="circle done">${I.check}</span>
        <span style="flex:1;display:flex;flex-direction:column"><b>${m.matched.length} מוצרים מהרשימה נמצאו בקבלה</b><span class="tiny muted">יסומנו כנקנו, גם אם שכחתם לסמן</span></span>
        <span class="small" style="color:var(--green)">${ui.receipt.showMatched ? 'הסתרה' : 'הצגה'}</span></button>
      ${ui.receipt.showMatched ? m.matched.map(x => `<div style="display:flex;justify-content:space-between;font-size:14px;border-top:1px solid var(--line-soft);padding-top:6px"><span>${esc(L.productName(x.item.productId))} <span class="muted">× ${x.line.weight ? x.line.weight + ' ק״ג' : x.line.qty}</span></span><span class="muted">${money(x.line.gross - (x.line.discount || 0))}</span></div>`).join('') : ''}
    </div>
    ${m.qtyDiff.length ? `<section class="group"><h2>כמות שונה מהרשימה</h2>${m.qtyDiff.map(x => `<div class="card"><span>${esc(L.productName(x.item.productId))}</span><span class="small muted">ברשימה ${x.item.qty}, נקנו ${x.line.qty}</span></div>`).join('')}</section>` : ''}
    ${m.confirm.length ? `<section class="group"><h2>צריך אישור התאמה</h2>${m.confirm.map(c => `<div class="card">
      <span><b>${esc(c.line.name)}</b> <span class="small muted">· ${money(c.line.gross - (c.line.discount || 0))}</span></span>
      <span class="small muted">זה "${esc(L.productName(c.item.productId))}" מהרשימה? אם כן, בפעם הבאה הוא יזוהה לבד.</span>
      ${decisionButtons('confirm', c.line.idx, [['yes', 'כן, זה הוא'], ['no', 'לא, מוצר אחר']], d.confirm[c.line.idx])}</div>`).join('')}</section>` : ''}
    ${m.missing.length ? `<section class="group"><h2>ברשימה ולא בקבלה</h2><p class="tiny muted" style="margin:0 4px">מה שלא בוחרים לגביו נשאר ברשימה.</p>${m.missing.map(it => `<div class="card">
      <span><b>${esc(L.productName(it.productId))}</b> <span class="small muted">${qtyLabel(it)}</span></span>
      <span class="small muted">שכחתם, או שלא היה במלאי?</span>
      ${decisionButtons('missing', it.id, [['keep', 'להשאיר ברשימה']].concat(other ? [['move', 'להעביר ' + esc(pre("ל", L.storeById(other).name))]] : []).concat([['drop', 'לא צריך']]), d.missing[it.id] || 'keep')}</div>`).join('')}</section>` : ''}
    ${unknownCards.length ? `<section class="group"><h2>מוצרים שלא זוהו</h2>${unknownCards.map(u => {
      const cur = d.unknown[u.line.idx] || {};
      const target = cur.target || u.target;
      return `<div class="card">
      <span><b>${esc(u.line.name)}</b> <span class="small muted">· ${money(u.line.gross - (u.line.discount || 0))}</span></span>
      <label class="lbl" for="ut${u.line.idx}" style="margin:0">זה מוצר מהקטלוג, או מוצר חדש?</label>
      <select id="ut${u.line.idx}" class="field" data-in="unknownTarget" data-k="${u.line.idx}">
        ${(u.cands || []).map(c => `<option value="${c.id}" ${target === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        <option value="new" ${target === 'new' ? 'selected' : ''}>מוצר חדש</option>
      </select>
      ${target === 'new' && cur.action === 'add' ? `<label class="lbl" for="un${u.line.idx}">שם בקטלוג</label><input id="un${u.line.idx}" class="field" data-in="unknownName" data-k="${u.line.idx}" value="${esc(cur.name != null ? cur.name : u.line.name)}">
        <label class="lbl" for="uc${u.line.idx}">קטגוריה</label><select id="uc${u.line.idx}" class="field" data-in="unknownCat" data-k="${u.line.idx}">${CATS.map(c => `<option ${c === (cur.cat || u.cat) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
      ${decisionButtons('unknown', u.line.idx, [['add', target === 'new' ? 'להוסיף לקטלוג' : 'כן, לקשר למוצר'], ['once', 'חד־פעמי']], cur.action)}</div>`; }).join('')}</section>` : ''}
    ${m.extraKnown.length ? `<p class="tiny muted" style="margin:0 4px">עוד ${m.extraKnown.length} מוצרים בקבלה כבר בקטלוג ולא היו ברשימה. הם נשמרים בהיסטוריה עם המחיר ששולם.</p>` : ''}
    <div class="spacer-cta"></div>
  </div>
  <div class="footer-cta"><button class="cta center" data-a="saveReceipt">${pending ? `שמירה · עוד ${pending} בלי החלטה` : 'שמירה ועדכון ההיסטוריה'}</button></div>`;
}

// ---------- prices ----------

function renderPrices() {
  const table = L.priceTable();
  const act = L.activeStores();
  const q = ui.priceQ.trim();
  const promo = ui.priceMode === 'promo';
  const inList = new Set(L.listItems().map(i => i.productId));
  const rows = Object.keys(table).map(id => db.one('products', id)).filter(Boolean)
    .filter(p => !q || p.name.includes(q))
    .sort((a, b) => (inList.has(b.id) - inList.has(a.id)) || a.name.localeCompare(b.name, 'he'));
  const storesWithData = act.filter(s => Object.values(table).some(t => t[s.id]));
  let compared = 0;
  const cols = `grid-template-columns:minmax(0,1fr) repeat(${act.length}, 70px)`;
  const body = rows.map(p => {
    const t = table[p.id];
    const val = s => t[s.id] ? (promo ? t[s.id].paid : t[s.id].regular) : null;
    const known = act.filter(s => val(s) != null);
    const best = known.length >= 2 ? known.reduce((a, s) => val(s) < val(a) ? s : a) : null;
    if (best) compared++;
    return `<div class="prow" style="${cols}"><span style="display:flex;flex-direction:column;min-width:0"><span style="font-size:14px;font-weight:500">${esc(p.name)}</span><span class="tiny muted">${inList.has(p.id) ? 'ברשימה · ' : ''}${Object.values(t).some(x => x.perKg) ? 'לק״ג' : 'ליחידה'}</span></span>
      ${act.map(s => { const v = val(s); const e = t[s.id]; return `<span class="pcell ${best && best.id === s.id ? 'best' : ''}">${v == null ? '<span class="muted">—</span><span class="t">אין נתון</span>' : `<span>${money(v)}</span><span class="t">${promo && e.promo ? 'מבצע · ' : ''}${fmtDate(e.date)}</span>`}</span>`; }).join('')}</div>`;
  }).join('');
  return `${head('רק מחירים מקבלות שיובאו', 'השוואת מחירים')}
  <div class="wrap">
    <div class="seg" role="tablist"><button role="tab" class="${promo ? 'on' : ''}" data-a="priceMode" data-v="promo">מה ששולם (כולל מבצעים)</button><button role="tab" class="${!promo ? 'on' : ''}" data-a="priceMode" data-v="regular">מחיר רגיל</button></div>
    ${storesWithData.length < 2 ? `<div class="card darkcard"><span class="tag">עדיין אין מספיק מידע להשוואה</span><p class="small muted">יש מחירים רק מ${storesWithData.map(s => esc(s.name)).join(', ') || 'אף רשת'}. אחרי ייבוא קבלה מרשת נוספת תופיע כאן השוואה.</p><button class="btn small" style="align-self:flex-start" data-a="tab" data-tab="receipts">ייבוא קבלה</button></div>` : ''}
    ${searchBox('priceQ', ui.priceQ, 'חיפוש מוצר')}
    ${rows.length ? `<div class="ptable"><div class="prow head" style="${cols}"><span class="muted">מוצר</span>${act.map(s => `<span style="text-align:center;color:${s.color}">${esc(s.name)}</span>`).join('')}</div>${body}</div>` : '<p class="empty">אין עדיין מחירים. הם נאספים מקבלות שמייבאים.</p>'}
    <p class="tiny muted" style="margin:0 4px">כל מחיר מוצג עם תאריך הקבלה שממנה הוא נלקח. מסומן בירוק הזול ביותר, רק כשיש מחיר מלפחות שתי רשתות.${compared ? '' : ''}</p>
  </div>`;
}

// ---------- settings ----------

function renderSettings() {
  const s = db.raw();
  const hh = s.household;
  const st = db.sync.status;
  const cfgUrl = ui.cfgUrl != null ? ui.cfgUrl : (s.config.url || '');
  const cfgKey = ui.cfgKey != null ? ui.cfgKey : (s.config.key || '');
  const all = L.stores();
  const act = L.activeStores();
  if (!act.find(x => x.id === ui.routeStore) && act[0]) ui.routeStore = act[0].id;
  const rs = L.storeById(ui.routeStore);
  const route = L.routeOf(rs);
  return `${head('הגדרות', 'משק בית וחנויות')}
  <div class="wrap">
    <section class="group"><h2>אני</h2><div class="card">
      <label class="lbl" for="meName">השם שיופיע ליד מה שאני מוסיף/ה</label>
      <input id="meName" class="field" data-in="meName" value="${esc(s.me.name)}">
    </div></section>

    <section class="group"><h2>משק הבית</h2><div class="card">
      ${hh ? `<b>${esc(hh.name)}</b>
        <span class="small muted">קוד ההצטרפות. ישי מזין אותו בטלפון שלו בהגדרות ← "הצטרפות".</span>
        <div class="code">${esc(hh.code)}</div>
        <button class="btn" data-a="shareInvite">שליחת הזמנה</button>
        ${db.sync.members.length ? db.sync.members.map(m => `<div style="display:flex;align-items:center;gap:10px"><span class="avatar">${esc((m.display_name || '?').slice(0, 1))}</span><span>${esc(m.display_name)}</span></div>`).join('') : ''}`
      : st === 'nohousehold' ? `<span class="small muted">מחוברים לשרת. יוצרים משק בית פעם אחת בטלפון הראשון, ובטלפון השני מצטרפים עם הקוד.</span>
        <label class="lbl" for="hhName">שם משק הבית</label><input id="hhName" class="field" data-in="hhName" value="${esc(ui.hh.name)}">
        <button class="btn primary" data-a="createHousehold" ${ui.hh.busy ? 'disabled' : ''}>יצירת משק בית (הנתונים מהטלפון הזה יעלו אליו)</button>
        <div style="border-top:1px solid var(--line-soft);padding-top:10px;display:flex;flex-direction:column;gap:8px">
        <label class="lbl" for="hhCode">יש כבר משק בית? קוד הצטרפות</label><input id="hhCode" class="field" data-in="hhCode" dir="ltr" value="${esc(ui.hh.code)}" placeholder="ABC123" autocomplete="off">
        <button class="btn" data-a="joinHousehold" ${ui.hh.busy ? 'disabled' : ''}>הצטרפות (הנתונים בטלפון הזה יוחלפו בנתונים של משק הבית)</button></div>
        ${ui.hh.error ? `<div class="banner warn" role="alert">${esc(ui.hh.error)}</div>` : ''}`
      : `<span class="small muted">${st === 'local' ? 'כרגע הכול נשמר רק בטלפון הזה. כדי לשתף עם ישי צריך לחבר את השרת (למטה).' : esc(syncText()) + '. אחרי שהחיבור יחזור אפשר ליצור משק בית או להצטרף.'}</span>`}
    </div></section>

    <section class="group"><h2>סנכרון</h2><div class="card">
      <span>${esc(syncText())}${db.pendingCount() ? ` · ${db.pendingCount()} שינויים ממתינים לשליחה` : ''}</span>
      ${st === 'error' ? `<span class="small muted">השינויים נשמרים בטלפון ויישלחו כשהשרת יחזור. אם הוא במצב שינה, מעירים אותו בלוח הבקרה של Supabase.</span><span class="tiny muted" dir="ltr">${esc(db.sync.error)}</span>` : ''}
      ${hh ? `<button class="btn" data-a="syncNow">סנכרון עכשיו</button>` : ''}
      <details id="cfgDetails" ${db.configured() ? '' : 'open'}><summary class="small" style="cursor:pointer">פרטי החיבור ל-Supabase</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          <label class="lbl" for="cfgUrl">Project URL</label><input id="cfgUrl" class="field" dir="ltr" data-in="cfgUrl" value="${esc(cfgUrl)}" placeholder="https://xxxx.supabase.co" autocomplete="off">
          <label class="lbl" for="cfgKey">anon public key</label><input id="cfgKey" class="field" dir="ltr" data-in="cfgKey" value="${esc(cfgKey)}" autocomplete="off">
          <span class="tiny muted">אם הפרטים כבר בקובץ config.js אפשר להשאיר ריק.</span>
          <button class="btn" data-a="saveConfig">שמירה וחיבור</button>
        </div></details>
    </div></section>

    <section class="group"><h2>החנויות שלי</h2><div class="list-card">
      ${all.map(x => `<div class="row"><span style="width:14px;height:14px;border-radius:50%;background:${x.color};flex:none"></span><div class="grow"><span class="name">${esc(x.name)}</span><span class="meta">${x.active ? 'פעילה' : 'כבויה · לא מופיעה ברשימה'}</span></div>
        <button class="switch ${x.active ? 'on' : ''}" aria-pressed="${!!x.active}" aria-label="${x.active ? 'כיבוי' : 'הפעלת'} ${esc(x.name)}" data-a="toggleStore" data-id="${x.id}"><span></span></button></div>`).join('')}
      <div class="row"><label class="sr" for="newStore">שם רשת חדשה</label><input id="newStore" class="field" data-in="newStore" value="${esc(ui.newStore)}" placeholder="רשת חדשה, למשל יוחננוף" style="flex:1;min-width:0"><button class="btn primary" data-a="addStore">הוספה</button></div>
    </div></section>

    <section class="group"><h2>סדר המסלול בחנות</h2>
      <p class="tiny muted" style="margin:0 4px">לפי הסדר הזה הרשימה מסתדרת בחנות.</p>
      <div class="chips">${act.map(x => `<button class="chip ${x.id === rs.id ? 'on' : ''}" data-a="routeStore" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>
      <div class="list-card">${route.map((c, i) => `<div class="row" style="min-height:52px;padding:4px 6px 4px 10px"><span class="num">${i + 1}</span><span class="grow">${esc(c)}</span>
        <button class="icon-btn plain" data-a="routeMove" data-i="${i}" data-d="-1" aria-label="להזיז את ${esc(c)} למעלה" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>${I.up}</button>
        <button class="icon-btn plain" data-a="routeMove" data-i="${i}" data-d="1" aria-label="להזיז את ${esc(c)} למטה" ${i === route.length - 1 ? 'disabled style="opacity:.3"' : ''}>${I.down}</button></div>`).join('')}</div>
    </section>

    <section class="group"><h2>גיבוי</h2><div class="card">
      <span class="small muted">קובץ עם כל הקטלוג, הרשימות והקבלות.</span>
      <div class="row-actions"><button class="btn" data-a="exportData">ייצוא גיבוי</button>
      <label class="btn" style="cursor:pointer">ייבוא מגיבוי<input type="file" accept="application/json,.json" data-in="importFile" class="sr"></label></div>
    </div></section>
    <p class="tiny muted" style="text-align:center;padding:10px">בית · גרסה 1</p>
  </div>`;
}

function renderWelcome() {
  return `<div class="wrap" style="padding-top:calc(60px + env(safe-area-inset-top))">
    <h1 style="font-size:28px">ברוכים הבאים</h1>
    <p class="muted">רשימת קניות משותפת לבית. אחרי הכניסה מצטרפים למשק הבית עם הקוד, וכל הקטלוג והרשימה יורדים לטלפון.</p>
    <div class="card"><label class="lbl" for="welcomeName">איך לקרוא לך?</label>
      <input id="welcomeName" class="field" data-in="welcomeName" value="${esc(ui.welcomeName)}" placeholder="למשל: דנה" autocomplete="given-name">
      <button class="btn primary" data-a="welcomeDone" ${ui.welcomeName.trim() ? '' : 'disabled'}>התחלה</button></div>
  </div>`;
}

// ---------- render ----------

function render() {
  const active = document.activeElement;
  const focusId = active && active.id;
  const sel = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;

  let html;
  if (!db.raw().me.name) html = renderWelcome();
  else if (ui.shop) html = renderShop();
  else if (ui.bulk) html = renderBulk() + nav();
  else html = ({ catalog: renderCatalog, list: renderList, receipts: renderReceipts, prices: renderPrices, settings: renderSettings }[ui.tab])() + nav();
  if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
  app.className = ui.shop ? 'no-nav' : '';
  // Collapsible sections stay open across redraws (e.g. while typing inside one).
  const openDetails = [...app.querySelectorAll('details[id]')].filter(d => d.open).map(d => d.id);
  app.innerHTML = html;
  for (const id of openDetails) { const d = document.getElementById(id); if (d) d.open = true; }

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el && el.tagName !== 'BUTTON') {
      el.focus({ preventScroll: true });
      if (sel != null && el.setSelectionRange) try { el.setSelectionRange(sel, sel); } catch (e) { /* not a text field */ }
    }
  }
}

let toastTimer;
function toast(msg) {
  ui.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = ''; render(); }, 2600);
}

// ---------- actions ----------

const A = {
  noop() {},
  tab(d) { ui.tab = d.tab; ui.shop = null; ui.bulk = null; scrollTo(0, 0); },

  bulkOpen() { ui.bulk = { step: 'paste', text: '', rows: [], storeAll: 'auto' }; scrollTo(0, 0); },
  bulkCancel() { ui.bulk = null; },
  async bulkPaste() {
    try { ui.bulk.text = await navigator.clipboard.readText(); } catch (e) { toast('לא הצלחתי לקרוא מהלוח. אפשר להדביק ידנית בשדה.'); }
    render();
  },
  bulkReview() {
    const b = ui.bulk;
    b.rows = buildBulkRows(b.text, b.storeAll);
    if (!b.rows.length) { toast('לא נמצאו מוצרים בטקסט'); return; }
    b.step = 'review';
    scrollTo(0, 0);
  },
  bulkBack() { ui.bulk.step = 'paste'; },
  bulkStoreAll(d) {
    const b = ui.bulk;
    b.storeAll = d.id;
    for (const r of b.rows) r.store = bulkStoreFor(r, b.storeAll);
  },
  bulkQty(d) { const r = ui.bulk.rows[d.k]; r.qty = Math.max(1, r.qty + Number(d.d)); },
  bulkStore(d) { const r = ui.bulk.rows[d.id]; r.store = otherStoreId(r.store) || r.store; },
  bulkApply() {
    const s = L.addPastedList(ui.bulk.rows);
    const first = ui.bulk.rows.find(r => r.include);
    ui.bulk = null;
    ui.tab = 'list';
    if (first) ui.listStore = first.store;
    const parts = [];
    if (s.added) parts.push(`${s.added} נוספו`);
    if (s.updated) parts.push(`${s.updated} עודכנו`);
    if (s.created) parts.push(`${s.created} מוצרים חדשים בקטלוג`);
    toast(parts.join(' · ') || 'לא נוסף כלום');
    scrollTo(0, 0);
  },
  clear(d) { ui[d.k] = ''; },

  toggleAdd() { ui.add = { open: !ui.add.open, name: '', cat: null, target: null, picking: false }; },
  togglePicker() { ui.add.picking = !ui.add.picking; },
  addCat(d) { ui.add.cat = d.cat === guessCategory(ui.add.name) ? null : d.cat; ui.add.picking = false; },
  addTarget(d) { ui.add.target = d.id; },
  addExisting(d) {
    if (!L.itemForProduct(d.id)) L.addToList(d.id, 1);
    ui.lastAdded = { productId: d.id, where: 'list', text: `"${L.productName(d.id)}" נוסף לרשימה` };
    ui.add = { open: false, name: '', cat: null, target: null, picking: false };
  },
  addNew() {
    const a = ui.add;
    const name = a.name.trim();
    const cat = a.cat || guessCategory(name);
    if (!name || !cat) return;
    const target = a.target || L.defaultStoreFor(cat);
    const store = target === 'none' ? L.defaultStoreFor(cat) : target;
    const p = L.createProduct({ name, cat, store });
    if (target !== 'none') L.addToList(p.id, 1, store);
    ui.lastAdded = { productId: p.id, where: target, text: target === 'none' ? `"${name}" נוסף לקטלוג` : `"${name}" נוסף לקטלוג ולרשימת ${L.storeById(store).name}` };
    ui.add = { open: false, name: '', cat: null, target: null, picking: false };
    ui.catQ = ''; ui.catFilter = 'all';
  },
  lastToList() {
    const p = db.one('products', ui.lastAdded.productId);
    if (p) L.addToList(p.id, 1, p.store);
    ui.lastAdded = { ...ui.lastAdded, where: p.store, text: `"${p.name}" נוסף לרשימת ${L.storeById(p.store).name}` };
  },
  dismissLast() { ui.lastAdded = null; },
  catFilter(d) { ui.catFilter = d.cat; },
  inc(d) { L.addToList(d.id, 1); },
  dec(d) { const it = L.itemForProduct(d.id); if (it) L.setQty(it.id, it.qty - 1); },
  productStore(d) {
    const p = db.one('products', d.id);
    const it = L.itemForProduct(d.id);
    const next = otherStoreId(it ? it.store : p.store);
    if (!next) return;
    db.batch(() => {
      db.patch('products', p.id, { store: next });
      if (it) db.patch('items', it.id, { store: next });
    });
  },

  listStore(d) { ui.listStore = d.id; },
  itemInc(d) { const it = db.one('items', d.id); L.setQty(it.id, it.qty + 1); },
  itemDec(d) { const it = db.one('items', d.id); L.setQty(it.id, it.qty - 1); },
  moveItem(d) { const it = db.one('items', d.id); const o = otherStoreId(it.store); if (o) { db.patch('items', it.id, { store: o, status: 'open' }); toast('הועבר ' + pre("ל", L.storeById(o).name)); } },
  removeItem(d) { db.remove('items', d.id); },
  startShop(d) { ui.shop = d.id; ui.shopQ = ''; scrollTo(0, 0); },

  take(d) { db.patch('items', d.id, { status: 'taken' }); },
  untake(d) { db.patch('items', d.id, { status: 'open' }); },
  oos(d) { db.patch('items', d.id, { status: 'oos' }); },
  shopAdd() {
    const name = ui.shopQ.trim();
    const existing = L.products().find(p => p.name === name);
    const p = existing || L.createProduct({ name, cat: guessCategory(name) || 'שונות', store: ui.shop });
    const it = L.addToList(p.id, 1, ui.shop);
    if (it.store !== ui.shop) db.patch('items', it.id, { store: ui.shop });
    ui.shopQ = '';
  },
  endShop() { ui.shop = null; ui.tab = 'list'; },
  finishOpen() { ui.finishing = true; },
  finishClose(d, el) { if (el.classList.contains('sheet-back') || el.dataset.a === 'finishClose') ui.finishing = false; },
  finishReceipt() { ui.finishing = false; ui.shop = null; ui.tab = 'receipts'; ui.receipt = { ...ui.receipt, step: 'paste', error: '' }; },
  finishNoReceipt() {
    const n = L.finishShopping(ui.shop);
    ui.finishing = false; ui.shop = null; ui.tab = 'list';
    toast(n ? `${n} פריטים נשמרו בהיסטוריה והורדו מהרשימה` : 'הקנייה נסגרה');
  },

  async paste() {
    const r = ui.receipt;
    try {
      const t = await navigator.clipboard.readText();
      r.error = '';
      if (looksLikeJson(t)) A.openReceipt(parseReceiptJson(t));
      else if (looksLikeLink(t)) r.error = 'בלוח יש קישור ולא קבלה. מריצים את קיצור הדרך "קבלה לבית" מהקישור, או טוענים את קובץ ה-PDF.';
      else if (t.trim()) { r.text = t; A.readReceipt(); }
      else r.error = 'הלוח ריק.';
    } catch (e) {
      r.error = 'לא הצלחתי לקרוא מהלוח. אם הדפדפן שאל, צריך לאשר "הדבקה".';
    }
    render();
  },
  readReceipt() {
    const r = ui.receipt;
    if (looksLikeLink(r.text)) return;
    A.openReceipt(looksLikeJson(r.text) ? parseReceiptJson(r.text) : parseReceiptText(r.text));
  },
  // Goes from a read receipt (text, PDF or shortcut) to the comparison with the list.
  openReceipt(res) {
    const r = ui.receipt;
    if (res.error) { r.error = res.error; r.step = 'paste'; return; }
    if (L.receiptExists(res.receipt)) { r.error = `הקבלה מ-${fmtDate(res.receipt.date)} כבר יובאה.`; r.step = 'paste'; return; }
    r.model = L.reconcile(res.receipt);
    r.warnings = res.warnings || [];
    r.dec = { confirm: {}, unknown: {}, missing: {} };
    r.error = '';
    r.step = 'review';
    r.showMatched = false;
    scrollTo(0, 0);
  },
  async loadPdf(file) {
    const r = ui.receipt;
    ui.tab = 'receipts';
    r.step = 'scanning';
    r.scan = { f: 0.3, label: 'קורא את קובץ ה-PDF' };
    r.error = '';
    render();
    try {
      A.openReceipt(parseReceiptPdfLines(await readPdfLines(file)));
    } catch (e) {
      r.step = 'paste';
      r.error = 'לא הצלחתי לקרוא את הקובץ. ודאו שזה ה-PDF מ"להורדת מסמך המקור" בעמוד הקבלה.';
    }
    render();
  },
  async scan(files) {
    const r = ui.receipt;
    r.step = 'scanning';
    r.scan = { f: 0, label: 'מכין את התמונות' };
    r.error = '';
    render();
    try {
      const texts = await readImages(files, (f, label) => { r.scan = { f, label }; render(); });
      r.ocrText = texts.join('\n\n— — —\n\n');
      const draft = parseScannedTexts(texts);
      if (!draft.lines.length) throw new Error('לא הצלחתי לזהות שורות של מוצרים בתמונה. אפשר לנסות שוב באור טוב יותר, או להוסיף שורות ידנית.');
      r.draft = draft;
      r.step = 'edit';
    } catch (e) {
      r.step = 'paste';
      r.error = e.message || 'הקריאה נכשלה';
    }
    scrollTo(0, 0);
    render();
  },
  scanChain(d) { ui.receipt.draft.chain = d.id; ui.receipt.error = ''; },
  scanRemove(d) { ui.receipt.draft.lines.splice(Number(d.k), 1); },
  scanAddLine() { ui.receipt.draft.lines.push({ name: '', code: '', qty: 1, weight: null, paid: 0, discount: 0 }); },
  scanContinue() {
    const r = ui.receipt;
    const dr = r.draft;
    if (!dr.chain) { r.error = 'צריך לבחור מאיזו חנות הקבלה.'; return; }
    const receipt = receiptFromDraft(dr, dr.chain);
    if (!receipt.lines.length) { r.error = 'אין שורות לשמירה.'; return; }
    if (L.receiptExists(receipt)) { r.error = 'נראה שהקבלה הזו כבר יובאה (אותו תאריך ואותו סכום).'; return; }
    r.model = L.reconcile(receipt);
    r.warnings = [];
    r.dec = { confirm: {}, unknown: {}, missing: {} };
    r.error = '';
    r.step = 'review';
    r.showMatched = false;
    scrollTo(0, 0);
  },
  toggleMatched() { ui.receipt.showMatched = !ui.receipt.showMatched; },
  decide(d) {
    const dec = ui.receipt.dec;
    if (d.g === 'unknown') dec.unknown[d.k] = { ...(dec.unknown[d.k] || {}), action: d.v };
    else dec[d.g][d.k] = d.v;
  },
  saveReceipt() {
    const r = ui.receipt;
    r.summary = L.applyReconcile(r.model, r.dec);
    r.step = 'done';
    r.text = '';
    scrollTo(0, 0);
  },
  receiptReset() { ui.receipt = { step: 'paste', text: '', error: '', warnings: [], model: null, dec: null, summary: null, showMatched: false }; },

  priceMode(d) { ui.priceMode = d.v; },

  welcomeDone() {
    const n = ui.welcomeName.trim();
    if (!n) return;
    // A new phone goes straight to joining the household.
    if (db.configured() && !db.raw().household) ui.tab = 'settings';
    db.setLocal('me', { ...db.raw().me, name: n });
  },
  async createHousehold() {
    ui.hh.busy = true; ui.hh.error = ''; render();
    try { await db.createHousehold(ui.hh.name.trim() || 'הבית שלנו', db.raw().me.name); toast('משק הבית נוצר'); } catch (e) { ui.hh.error = e.message; }
    ui.hh.busy = false; render();
  },
  async joinHousehold() {
    if (!ui.hh.code.trim()) { ui.hh.error = 'צריך להזין קוד'; return; }
    ui.hh.busy = true; ui.hh.error = ''; render();
    try { await db.joinHousehold(ui.hh.code, db.raw().me.name); toast('הצטרפת למשק הבית'); } catch (e) { ui.hh.error = /not found|לא נמצא/i.test(e.message) ? 'הקוד לא נמצא' : e.message; }
    ui.hh.busy = false; render();
  },
  async shareInvite() {
    const hh = db.raw().household;
    const text = `הצטרפות לרשימת הקניות שלנו: פותחים את האפליקציה ${location.origin + location.pathname}, ובהגדרות מזינים את הקוד ${hh.code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('ההזמנה הועתקה'); }
    } catch (e) { /* cancelled */ }
    render();
  },
  syncNow() { db.syncNow(); },
  saveConfig() {
    db.setLocal('config', { url: (ui.cfgUrl != null ? ui.cfgUrl : db.raw().config.url).trim(), key: (ui.cfgKey != null ? ui.cfgKey : db.raw().config.key).trim() });
    ui.cfgUrl = null; ui.cfgKey = null;
    db.resetConnection();
    toast('מתחבר…');
  },
  toggleStore(d) { const s = db.one('stores', d.id); db.patch('stores', s.id, { active: !s.active }); },
  addStore() { const n = ui.newStore.trim(); if (n) { L.addStore(n); ui.newStore = ''; } },
  routeStore(d) { ui.routeStore = d.id; },
  routeMove(d) { L.moveRoute(ui.routeStore, Number(d.i), Number(d.d)); },
  exportData() {
    const blob = new Blob([db.exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bayit-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
};

const INPUTS = {
  catQ: v => { ui.catQ = v; },
  listQ: v => { ui.listQ = v; },
  shopQ: v => { ui.shopQ = v; },
  priceQ: v => { ui.priceQ = v; },
  addName: v => { ui.add.name = v; },
  receiptText: v => { ui.receipt.text = v; ui.receipt.error = ''; },
  bulkText: v => { ui.bulk.text = v; },
  bulkInclude: (v, el) => { ui.bulk.rows[el.dataset.k].include = el.checked; },
  bulkChoice: (v, el) => {
    const r = ui.bulk.rows[el.dataset.k];
    r.choice = v;
    r.exact = v !== 'new' && r.cands[0] && r.cands[0].id === v && r.exact;
    r.store = bulkStoreFor(r, ui.bulk.storeAll);
  },
  bulkCat: (v, el) => { const r = ui.bulk.rows[el.dataset.k]; r.cat = v; r.store = bulkStoreFor(r, ui.bulk.storeAll); },
  welcomeName: v => { ui.welcomeName = v; },
  meName: v => { db.setLocal('me', { ...db.raw().me, name: v }); },
  hhName: v => { ui.hh.name = v; },
  hhCode: v => { ui.hh.code = v; },
  cfgUrl: v => { ui.cfgUrl = v; },
  cfgKey: v => { ui.cfgKey = v; },
  newStore: v => { ui.newStore = v; },
  unknownName: (v, el) => { const dec = ui.receipt.dec.unknown; dec[el.dataset.k] = { ...(dec[el.dataset.k] || {}), name: v }; },
  unknownCat: (v, el) => { const dec = ui.receipt.dec.unknown; dec[el.dataset.k] = { ...(dec[el.dataset.k] || {}), cat: v }; },
  receiptPhotos: (v, el) => { const files = [...(el.files || [])]; if (files.length) A.scan(files); },
  receiptPdf: (v, el) => { const f = el.files && el.files[0]; if (f) A.loadPdf(f); },
  scanDate: v => { ui.receipt.draft.date = v; },
  scanName: (v, el) => { ui.receipt.draft.lines[el.dataset.k].name = v; },
  scanQty: (v, el) => {
    const l = ui.receipt.draft.lines[el.dataset.k];
    const n = parseFloat(String(v).replace(',', '.'));
    if (l.weight) l.weight = n || l.weight; else l.qty = n || 1;
  },
  scanPaid: (v, el) => { ui.receipt.draft.lines[el.dataset.k].paid = parseFloat(String(v).replace(',', '.')) || 0; },
  unknownTarget: (v, el) => { const dec = ui.receipt.dec.unknown; dec[el.dataset.k] = { ...(dec[el.dataset.k] || {}), target: v }; },
  importFile: (v, el) => {
    const f = el.files && el.files[0];
    if (!f) return;
    f.text().then(t => { try { db.importData(t); toast('הגיבוי יובא'); } catch (e) { toast(e.message); } render(); });
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  // Clicks inside the bottom sheet should not close it.
  if (el.dataset.a === 'finishClose' && el.classList.contains('sheet-back') && e.target.closest('.sheet')) return;
  const fn = A[el.dataset.a];
  if (!fn) return;
  const out = fn(el.dataset, el);
  if (!(out instanceof Promise)) render();
});

function onInput(e) {
  const el = e.target;
  // File pickers fire both "input" and "change"; handle them once.
  if (el.type === 'file' && e.type !== 'change') return;
  const fn = el.dataset && INPUTS[el.dataset.in];
  if (!fn) return;
  fn(el.value, el);
  if (el.type !== 'file') render();
}
document.addEventListener('input', onInput);
document.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'file') onInput(e); });

// ---------- start ----------

db.load();
await L.seedIfEmpty();
db.onChange(render);

// Shared from another app (Android share sheet): a receipt PDF or photo kept by the service
// worker, or text.
const params = new URLSearchParams(location.search);
const sharedText = params.get('text') || params.get('url');
const sharedFile = params.get('shared') === 'file';
if (sharedText || sharedFile) {
  history.replaceState(null, '', location.pathname);
  ui.tab = 'receipts';
}
if (sharedFile) {
  (async () => {
    try {
      const cache = await caches.open('bayit-share');
      const res = await cache.match('shared-file');
      if (!res) return;
      const blob = await res.blob();
      await cache.delete('shared-file');
      const file = new File([blob], decodeURIComponent(res.headers.get('x-name') || 'receipt'), { type: blob.type });
      if (/pdf/.test(blob.type) || /\.pdf$/i.test(file.name)) A.loadPdf(file);
      else if (/^image\//.test(blob.type)) A.scan([file]);
    } catch (e) { /* nothing shared */ }
  })();
} else if (sharedText && !looksLikeLink(sharedText)) {
  ui.receipt.text = sharedText;
  A.readReceipt();
}

render();
db.connect();

// Lets screens be checked on a local test server without a real receipt.
if (location.hostname === 'localhost') window.__bayit = { ui, render, L, db, A };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
