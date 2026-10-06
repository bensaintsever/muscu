// Stockage IndexedDB : base `muscu`, stores `logs`, `kv` et `sync` (session cloud, file d'attente, horodatages).
import { PROGRAM, REFERENCE_LOGS, MIGRATIONS } from './program.js';
import { todayISO } from './clock.js';
import { SYNCED_KV } from './sync.js';

export { exportAll, importAll } from './backup.js';

const DB_NAME = 'muscu';
const DB_VERSION = 2;
export const SYNC_STORE = 'sync';
const SYNCED = new Set(SYNCED_KV);

let dbPromise = null;
let initPromise = null;

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}-${Math.random().toString(36).slice(2, 10)}`;
}

// Date locale du jour au format YYYY-MM-DD (pas toISOString, qui est en UTC).
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('logs')) {
        const logs = db.createObjectStore('logs', { keyPath: 'id' });
        logs.createIndex('sessionId', 'sessionId');
        logs.createIndex('status', 'status');
        logs.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains(SYNC_STORE)) db.createObjectStore(SYNC_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Une autre version ouverte ailleurs : on libère la base proprement.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => reject(new Error('Base bloquée par un autre onglet'));
  });
  return dbPromise;
}

export function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const db = await openDb();
    const tx = db.transaction(['logs', 'kv'], 'readwrite');
    const kv = tx.objectStore('kv');
    const seeded = await req(kv.get('seeded'));
    if (!seeded) {
      kv.put(clone(PROGRAM), 'program');
      const logs = tx.objectStore('logs');
      for (const log of REFERENCE_LOGS) logs.put(clone(log));
      kv.put(true, 'seeded');
    }
    // Migrations du programme : chacune une seule fois, sans toucher aux réglages faits à la main
    const applied = (await req(kv.get('migrations'))) || [];
    const pending = MIGRATIONS.filter((m) => !applied.includes(m.id));
    if (pending.length) {
      const program = (await req(kv.get('program'))) || clone(PROGRAM);
      for (const m of pending) m.apply(program);
      kv.put(program, 'program');
      kv.put([...applied, ...pending.map((m) => m.id)], 'migrations');
    }
    await done(tx);
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch {
      // Persistance refusée ou indisponible : sans conséquence bloquante.
    }
    return db;
  })();
  initPromise.catch(() => { initPromise = null; });
  return initPromise;
}

export async function transaction(names, mode = 'readonly') {
  return (await init()).transaction(names, mode);
}

// — Suivi des écritures pour la sauvegarde en ligne —
// Chaque écriture synchronisée met l'élément en file (une entrée par clé, jeton neuf) et prévient les abonnés.

const writeListeners = new Set();
export function onLocalWrite(fn) {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}
export function notifyWrite(kind, key) {
  for (const fn of writeListeners) { try { fn({ kind, key }); } catch (e) { console.error(e); } }
}

export function markDirty(sync, kind, key, now) {
  sync.put(`${now}-${Math.random().toString(36).slice(2, 10)}`, `out:${kind}:${key}`);
}

export function stampKv(sync, key, now) {
  sync.put(now, `stamp:${key}`);
  markDirty(sync, 'kv', key, now);
}

async function store(name, mode = 'readonly') {
  const db = await init();
  const tx = db.transaction(name, mode);
  return { tx, os: tx.objectStore(name) };
}

async function kvGet(key) {
  const { os } = await store('kv');
  return req(os.get(key));
}

async function kvPut(key, value) {
  if (!SYNCED.has(key)) {
    const { tx, os } = await store('kv', 'readwrite');
    os.put(value, key);
    await done(tx);
    return;
  }
  const tx = await transaction(['kv', SYNC_STORE], 'readwrite');
  tx.objectStore('kv').put(value, key);
  stampKv(tx.objectStore(SYNC_STORE), key, Date.now());
  await done(tx);
  notifyWrite('kv', key);
}

// — Programme —

export async function getProgram() {
  const program = await kvGet('program');
  return program ?? clone(PROGRAM);
}

export async function saveProgram(program) {
  await kvPut('program', clone(program));
  return program;
}

export async function resetProgram() {
  const program = clone(PROGRAM);
  await kvPut('program', program);
  return clone(program);
}

// — Séances —

// extra : contexte du cycle figé au démarrage (cycleId, blockId, legFactor, adjust).
export async function startLog(sessionId, weekType, extra = {}) {
  const now = Date.now();
  const log = {
    id: newId(),
    sessionId,
    date: todayISO(),
    startedAt: now,
    endedAt: null,
    status: 'in-progress',
    weekType,
    ...extra,
    sets: [],
  };
  await saveLog(log);
  return log;
}

export async function saveLog(log) {
  const now = Date.now();
  log.updatedAt = now;
  const tx = await transaction(['logs', SYNC_STORE], 'readwrite');
  tx.objectStore('logs').put(clone(log));
  const sync = tx.objectStore(SYNC_STORE);
  sync.delete(`tomb:${log.id}`);
  markDirty(sync, 'log', log.id, now);
  await done(tx);
  notifyWrite('log', log.id);
  return log;
}

export async function getLog(id) {
  const { os } = await store('logs');
  return (await req(os.get(id))) ?? null;
}

// Suppression : une pierre tombale datée part vers le cloud pour effacer la séance partout.
export async function deleteLog(id) {
  const now = Date.now();
  const tx = await transaction(['logs', SYNC_STORE], 'readwrite');
  tx.objectStore('logs').delete(id);
  const sync = tx.objectStore(SYNC_STORE);
  sync.put(now, `tomb:${id}`);
  markDirty(sync, 'log', id, now);
  await done(tx);
  notifyWrite('log', id);
}

async function logsByStatus(status) {
  const { os } = await store('logs');
  return req(os.index('status').getAll(status));
}

export async function getActiveLog() {
  const logs = await logsByStatus('in-progress');
  if (!logs.length) return null;
  logs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return logs[0];
}

export async function finishLog(id) {
  const log = await getLog(id);
  if (!log) throw new Error(`Séance introuvable : ${id}`);
  log.status = 'done';
  log.endedAt = Date.now();
  await saveLog(log);
  return log;
}

function byDateAsc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.startedAt || 0) - (b.startedAt || 0);
}

export async function listLogs({ sessionId, limit } = {}) {
  let logs = await logsByStatus('done');
  if (sessionId) logs = logs.filter((l) => l.sessionId === sessionId);
  logs.sort((a, b) => byDateAsc(b, a));
  return limit ? logs.slice(0, limit) : logs;
}

export async function getExerciseHistory(exerciseId) {
  const logs = (await logsByStatus('done')).sort(byDateAsc);
  const history = [];
  for (const log of logs) {
    const sets = (log.sets || [])
      .filter((s) => s.exerciseId === exerciseId)
      .sort((a, b) => a.setIndex - b.setIndex)
      .map((s) => ({ load: s.load, reps: s.reps }));
    if (!sets.length) continue;
    const entry = {
      logId: log.id,
      date: log.date,
      weekType: log.weekType,
      isReference: !!log.isReference,
      sets,
    };
    if (log.legFactor < 1) entry.legFactor = log.legFactor;
    if (log.adjust?.loadFactor < 1) entry.loadFactor = log.adjust.loadFactor;
    history.push(entry);
  }
  return history;
}

// — Réglages —

export async function getSetting(key, fallback) {
  const value = await kvGet(key);
  return value === undefined ? fallback : value;
}

export async function setSetting(key, value) {
  await kvPut(key, value);
  return value;
}
