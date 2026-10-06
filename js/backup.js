// Export / import JSON de toutes les données (réexportés par db.js).
// L'import est une écriture comme une autre : tout ce qu'il pose part vers la sauvegarde en ligne,
// et les séances qu'il fait disparaître y sont effacées aussi.
import { PROGRAM } from './program.js';
import { SYNCED_KV } from './sync.js';
import { transaction, req, done, SYNC_STORE, markDirty, stampKv, notifyWrite } from './db.js';

// Clés du store kv qui ne sont pas des réglages utilisateur.
const INTERNAL_KEYS = new Set(['seeded', 'program', 'migrations']);

const byDateAsc = (a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.startedAt || 0) - (b.startedAt || 0));

export async function exportAll() {
  const tx = await transaction(['logs', 'kv'], 'readonly');
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
    program: program ?? structuredClone(PROGRAM),
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

  const now = Date.now();
  const tx = await transaction(['logs', 'kv', SYNC_STORE], 'readwrite');
  const logs = tx.objectStore('logs');
  const kv = tx.objectStore('kv');
  const sync = tx.objectStore(SYNC_STORE);
  const before = await req(logs.getAllKeys());
  logs.clear();
  kv.clear();
  const kept = new Set();
  for (const log of data.logs) {
    logs.put({ ...log, updatedAt: now });
    kept.add(String(log.id));
    sync.delete(`tomb:${log.id}`);
    markDirty(sync, 'log', log.id, now);
  }
  for (const id of before) {
    if (kept.has(String(id))) continue;
    sync.put(now, `tomb:${id}`);
    markDirty(sync, 'log', id, now);
  }
  kv.put(data.program, 'program');
  stampKv(sync, 'program', now);
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  for (const [key, value] of Object.entries(settings)) {
    if (INTERNAL_KEYS.has(key)) continue;
    kv.put(value, key);
    if (SYNCED_KV.includes(key)) stampKv(sync, key, now);
  }
  kv.put(true, 'seeded');
  await done(tx);
  notifyWrite('import', null);
  return { logs: data.logs.length };
}
