// Local-first data store with sync.
//
// Every change is written to this device first (localStorage) and queued in an outbox.
// When Supabase is reachable the outbox is pushed and the partner's changes are pulled,
// so the app works the same with no connection, or while the database is paused,
// and catches up when it comes back. Conflicts resolve as "last saved wins" per document.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const KEY = 'bayit.v1';
export const COLLS = ['stores', 'products', 'items', 'receipts'];
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let state;
let sb = null;
let channel = null;
let flushTimer = null;
let pollTimer = null;
let busy = false;
let batchDepth = 0;
const listeners = new Set();

export const sync = { status: 'local', error: '', members: [] };

function blank() {
  return {
    docs: Object.fromEntries(COLLS.map(c => [c, {}])),
    outbox: {},
    cursor: null,
    me: { name: '' },
    household: null,
    config: { url: '', key: '' },
    seeded: false
  };
}

export function load() {
  try {
    state = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY)) || {});
  } catch (e) {
    state = blank();
  }
  for (const c of COLLS) state.docs[c] = state.docs[c] || {};
  return state;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('save failed', e);
  }
}

function emit() {
  if (batchDepth === 0) listeners.forEach(fn => fn());
}

export function onChange(fn) { listeners.add(fn); }
export function raw() { return state; }

// ---------- documents ----------

export function all(coll) {
  return Object.values(state.docs[coll]).filter(d => !d.deleted);
}

export function one(coll, id) {
  const d = state.docs[coll][id];
  return d && !d.deleted ? d : null;
}

export function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function put(coll, doc) {
  const d = { ...doc, updatedAt: Date.now() };
  state.docs[coll][d.id] = d;
  state.outbox[coll + '/' + d.id] = { coll, id: d.id, data: d };
  persist();
  emit();
  scheduleFlush();
  return d;
}

export function patch(coll, id, fields) {
  const cur = state.docs[coll][id];
  if (!cur) return null;
  return put(coll, { ...cur, ...fields });
}

export function remove(coll, id) {
  const cur = state.docs[coll][id];
  if (cur) put(coll, { ...cur, deleted: true });
}

// Run several changes and redraw once.
export function batch(fn) {
  batchDepth++;
  try { fn(); } finally { batchDepth--; }
  emit();
}

export function setLocal(key, value) {
  state[key] = value;
  persist();
  emit();
}

export function pendingCount() {
  return Object.keys(state.outbox).length;
}

// ---------- connection ----------

function cfg() {
  return { url: (state.config.url || SUPABASE_URL).trim(), key: (state.config.key || SUPABASE_ANON_KEY).trim() };
}

export function configured() {
  const c = cfg();
  return !!(c.url && c.key);
}

function setStatus(status, error) {
  sync.status = status;
  sync.error = error || '';
  emit();
}

export async function connect() {
  if (!configured()) { setStatus('local'); return; }
  if (!navigator.onLine && !sb) { setStatus('offline'); return; }
  try {
    if (!sb) {
      const { createClient } = await import(SUPABASE_JS);
      const c = cfg();
      sb = createClient(c.url, c.key, { auth: { persistSession: true, storageKey: 'bayit.auth', autoRefreshToken: true } });
    }
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      const r = await sb.auth.signInAnonymously();
      if (r.error) throw r.error;
    }
    if (state.household) await startSync();
    else setStatus('nohousehold');
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline', e.message || String(e));
  }
}

export function resetConnection() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  sb = null;
  clearInterval(pollTimer);
  connect();
}

async function startSync() {
  await syncNow();
  subscribe();
  clearInterval(pollTimer);
  // Realtime covers most updates; this catches anything missed and retries the outbox.
  pollTimer = setInterval(() => syncNow(), 30000);
  loadMembers();
}

function subscribe() {
  if (channel || !sb || !state.household) return;
  channel = sb.channel('docs-' + state.household.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'household_id=eq.' + state.household.id },
      payload => { if (payload.new && applyRemote([payload.new])) { persist(); emit(); } })
    .subscribe();
}

export async function syncNow() {
  if (!sb || !state.household || busy) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  busy = true;
  setStatus('syncing');
  try {
    await flush();
    await pull();
    setStatus('synced');
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline', e.message || String(e));
  } finally {
    busy = false;
  }
}

function scheduleFlush() {
  if (!sb || !state.household) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => syncNow(), 600);
}

async function flush() {
  const entries = Object.values(state.outbox);
  for (let i = 0; i < entries.length; i += 200) {
    const chunk = entries.slice(i, i + 200);
    const rows = chunk.map(e => ({ household_id: state.household.id, coll: e.coll, id: e.id, data: e.data, deleted: !!e.data.deleted }));
    const { error } = await sb.from('docs').upsert(rows, { onConflict: 'household_id,coll,id' });
    if (error) throw error;
    for (const e of chunk) {
      const k = e.coll + '/' + e.id;
      // Keep the entry if it changed again while the upload was in flight.
      if (state.outbox[k] && state.outbox[k].data.updatedAt === e.data.updatedAt) delete state.outbox[k];
    }
    persist();
  }
}

async function pull() {
  for (;;) {
    let q = sb.from('docs').select('coll,id,data,deleted,updated_at')
      .eq('household_id', state.household.id).order('updated_at').limit(1000);
    // Small overlap so rows committed slightly out of order are not missed.
    if (state.cursor) q = q.gt('updated_at', new Date(new Date(state.cursor).getTime() - 5000).toISOString());
    const { data, error } = await q;
    if (error) throw error;
    const changed = applyRemote(data);
    const last = data.length ? data[data.length - 1].updated_at : null;
    const advanced = last && last !== state.cursor;
    if (last) state.cursor = last;
    persist();
    if (changed) emit();
    if (data.length < 1000 || !advanced) break;
  }
}

function applyRemote(rows) {
  let changed = false;
  for (const row of rows) {
    if (!COLLS.includes(row.coll)) continue;
    const k = row.coll + '/' + row.id;
    if (state.outbox[k]) continue; // our unsent change is newer
    const local = state.docs[row.coll][row.id];
    const next = { ...row.data, deleted: !!row.deleted };
    if (local && local.updatedAt === next.updatedAt && !!local.deleted === next.deleted) continue;
    state.docs[row.coll][row.id] = next;
    changed = true;
  }
  return changed;
}

// ---------- household ----------

export async function createHousehold(name, displayName) {
  const { data, error } = await sb.rpc('create_household', { p_name: name, p_display: displayName });
  if (error) throw error;
  batch(() => {
    state.household = { id: data.id, name: data.name, code: data.code };
    state.me.name = displayName;
    // Upload everything entered so far on this phone.
    for (const c of COLLS) for (const d of Object.values(state.docs[c])) state.outbox[c + '/' + d.id] = { coll: c, id: d.id, data: d };
    state.cursor = null;
  });
  persist();
  await startSync();
}

export async function joinHousehold(code, displayName) {
  const { data, error } = await sb.rpc('join_household', { p_code: code.trim().toUpperCase(), p_display: displayName });
  if (error) throw error;
  // Joining replaces this phone's data with the household's.
  batch(() => {
    state.docs = Object.fromEntries(COLLS.map(c => [c, {}]));
    state.outbox = {};
    state.cursor = null;
    state.seeded = true;
    state.household = { id: data.id, name: data.name, code: data.code };
    state.me.name = displayName;
  });
  persist();
  await startSync();
}

async function loadMembers() {
  if (!sb || !state.household) return;
  const { data } = await sb.from('members').select('user_id,display_name,joined_at').eq('household_id', state.household.id).order('joined_at');
  if (data) { sync.members = data; emit(); }
}

// ---------- backup ----------

export function exportData() {
  return JSON.stringify({ app: 'bayit', version: 1, exportedAt: new Date().toISOString(), docs: state.docs }, null, 1);
}

export function importData(text) {
  const obj = JSON.parse(text);
  if (!obj || obj.app !== 'bayit' || !obj.docs) throw new Error('הקובץ אינו גיבוי של האפליקציה');
  batch(() => {
    for (const c of COLLS) for (const d of Object.values(obj.docs[c] || {})) put(c, d);
  });
}

addEventListener('online', () => { if (sb) syncNow(); else connect(); });
addEventListener('offline', () => setStatus(configured() ? 'offline' : 'local'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && sb) syncNow(); });
