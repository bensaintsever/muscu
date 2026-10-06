// Stockage IndexedDB : base `muscu`, stores `logs` et `kv`.
import { PROGRAM, REFERENCE_LOGS, MIGRATIONS } from './program.js';

const DB_NAME = 'muscu';
const DB_VERSION = 1;
// Clés du store kv qui ne sont pas des réglages utilisateur.
const INTERNAL_KEYS = new Set(['seeded', 'program', 'migrations']);

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

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx) {
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
  const { tx, os } = await store('kv', 'readwrite');
  os.put(value, key);
  await done(tx);
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

export async function startLog(sessionId, weekType) {
  const now = Date.now();
  const log = {
    id: newId(),
    sessionId,
    date: localDate(new Date(now)),
    startedAt: now,
    endedAt: null,
    status: 'in-progress',
    weekType,
    sets: [],
  };
  await saveLog(log);
  return log;
}

export async function saveLog(log) {
  const { tx, os } = await store('logs', 'readwrite');
  os.put(clone(log));
  await done(tx);
  return log;
}

export async function getLog(id) {
  const { os } = await store('logs');
  return (await req(os.get(id))) ?? null;
}

export async function deleteLog(id) {
  const { tx, os } = await store('logs', 'readwrite');
  os.delete(id);
  await done(tx);
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
    history.push({
      logId: log.id,
      date: log.date,
      weekType: log.weekType,
      isReference: !!log.isReference,
      sets,
    });
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

// — Sauvegarde —

export async function exportAll() {
  const db = await init();
  const tx = db.transaction(['logs', 'kv'], 'readonly');
  const kv = tx.objectStore('kv');
  const [logs, keys, values] = await Promise.all([
    req(tx.objectStore('logs').getAll()),
    req(kv.getAllKeys()),
    req(kv.getAll()),
  ]);
  let program = null;
  const settings = {};
  keys.forEach((key, i) => {
    if (key === 'program') program = values[i];
    else if (!INTERNAL_KEYS.has(key)) settings[key] = values[i];
  });
  return {
    app: 'muscu',
    schema: 1,
    exportedAt: new Date().toISOString(),
    program: program ?? clone(PROGRAM),
    logs: logs.sort(byDateAsc),
    settings,
  };
}

export async function importAll(data) {
  if (!data || typeof data !== 'object') throw new Error('Fichier illisible : ce n\'est pas un export Muscu.');
  if (data.app !== 'muscu') throw new Error('Ce fichier ne vient pas de l\'app Muscu.');
  if (!data.program || typeof data.program !== 'object') throw new Error('Export incomplet : programme manquant.');
  if (!Array.isArray(data.logs)) throw new Error('Export incomplet : liste des séances manquante.');
  const bad = data.logs.findIndex((l) => !l || typeof l !== 'object' || l.id == null);
  if (bad !== -1) throw new Error(`Séance n° ${bad + 1} invalide (identifiant manquant).`);

  const db = await init();
  const tx = db.transaction(['logs', 'kv'], 'readwrite');
  const logs = tx.objectStore('logs');
  const kv = tx.objectStore('kv');
  logs.clear();
  kv.clear();
  for (const log of data.logs) logs.put(log);
  kv.put(data.program, 'program');
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  for (const [key, value] of Object.entries(settings)) {
    if (!INTERNAL_KEYS.has(key)) kv.put(value, key);
  }
  kv.put(true, 'seeded');
  await done(tx);
  return { logs: data.logs.length };
}
