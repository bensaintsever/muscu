// Accès IndexedDB pour la synchronisation : session, état, file d'attente, instantané local, application du cloud.
// Clés du store `sync` : session · meta · out:<kind>:<key> (jeton) · stamp:<clé kv> (ms) · tomb:<id de log> (ms).
import { transaction, req, done, SYNC_STORE } from './db.js';
import { SYNCED_KV, logTs, shouldApply, parseItemId } from './sync.js';
import { MIGRATIONS } from './program.js';

const range = (prefix) => IDBKeyRange.bound(prefix, `${prefix}￿`);

async function syncGet(key) {
  const tx = await transaction(SYNC_STORE);
  return req(tx.objectStore(SYNC_STORE).get(key));
}

async function syncPut(key, value) {
  const tx = await transaction(SYNC_STORE, 'readwrite');
  if (value == null) tx.objectStore(SYNC_STORE).delete(key);
  else tx.objectStore(SYNC_STORE).put(value, key);
  await done(tx);
}

export const getSession = async () => (await syncGet('session')) || null;
export const setSession = (session) => syncPut('session', session);

export const getMeta = async () => (await syncGet('meta')) || {};
export async function setMeta(patch) {
  const tx = await transaction(SYNC_STORE, 'readwrite');
  const os = tx.objectStore(SYNC_STORE);
  const cur = (await req(os.get('meta'))) || {};
  os.put({ ...cur, ...patch }, 'meta');
  await done(tx);
}

// [{ id: 'log:<id>' | 'kv:<clé>', token }]
export async function outbox() {
  const tx = await transaction(SYNC_STORE);
  const os = tx.objectStore(SYNC_STORE);
  const [keys, values] = await Promise.all([req(os.getAllKeys(range('out:'))), req(os.getAll(range('out:')))]);
  return keys.map((k, i) => ({ id: k.slice(4), token: values[i] }));
}

export async function settle(sent) {
  if (!sent.length) return;
  const tx = await transaction(SYNC_STORE, 'readwrite');
  const os = tx.objectStore(SYNC_STORE);
  for (const { id, token } of sent) {
    if ((await req(os.get(`out:${id}`))) === token) os.delete(`out:${id}`);
  }
  await done(tx);
}

export async function snapshot() {
  const tx = await transaction(['logs', 'kv', SYNC_STORE]);
  const sync = tx.objectStore(SYNC_STORE);
  const kvOs = tx.objectStore('kv');
  const [logs, tombKeys, tombVals] = await Promise.all([
    req(tx.objectStore('logs').getAll()),
    req(sync.getAllKeys(range('tomb:'))),
    req(sync.getAll(range('tomb:'))),
  ]);
  const tombs = {};
  tombKeys.forEach((k, i) => { tombs[k.slice(5)] = tombVals[i]; });
  const kv = {};
  for (const key of SYNCED_KV) {
    const [value, ts] = await Promise.all([req(kvOs.get(key)), req(sync.get(`stamp:${key}`))]);
    if (value !== undefined) kv[key] = { value, ts: ts || 0 };
  }
  return { logs, tombs, kv };
}

// Entrées locales actuelles pour une liste d'ids de la file (lues au moment de l'envoi : toujours la dernière version).
export async function entriesFor(ids) {
  const tx = await transaction(['logs', 'kv', SYNC_STORE]);
  const logs = tx.objectStore('logs');
  const kvOs = tx.objectStore('kv');
  const sync = tx.objectStore(SYNC_STORE);
  const out = [];
  for (const id of ids) {
    const { kind, key } = parseItemId(id);
    if (kind === 'log') {
      const log = await req(logs.get(key));
      if (log) { out.push({ kind, key, ts: logTs(log), deleted: false, data: log }); continue; }
      const tomb = await req(sync.get(`tomb:${key}`));
      if (tomb != null) out.push({ kind, key, ts: tomb, deleted: true, data: null });
    } else if (kind === 'kv' && SYNCED_KV.includes(key)) {
      const value = await req(kvOs.get(key));
      if (value === undefined) continue;
      out.push({ kind, key, ts: (await req(sync.get(`stamp:${key}`))) || 0, deleted: false, data: value });
    }
  }
  return out;
}

// Écrit les entrées venues du cloud, sans les remettre en file. Tout est revérifié dans la transaction :
// une écriture locale plus récente entre-temps gagne, et la séance en cours n'est jamais touchée.
export async function apply(entries) {
  const tx = await transaction(['logs', 'kv', SYNC_STORE], 'readwrite');
  const logs = tx.objectStore('logs');
  const kvOs = tx.objectStore('kv');
  const sync = tx.objectStore(SYNC_STORE);
  const hasActive = (await req(logs.index('status').count('in-progress'))) > 0;
  let changed = 0;
  for (const e of entries) {
    if (e.kind === 'log') {
      const cur = await req(logs.get(e.key));
      if (cur?.status === 'in-progress') continue;
      if (!cur && hasActive && e.data?.status === 'in-progress') continue;
      const tomb = await req(sync.get(`tomb:${e.key}`));
      const localTs = cur ? logTs(cur) : (tomb ?? -1);
      if (!shouldApply(localTs, e.ts)) continue;
      if (e.deleted) {
        sync.put(e.ts, `tomb:${e.key}`);
        if (cur) { logs.delete(e.key); changed++; }
      } else {
        logs.put({ ...e.data, updatedAt: e.ts });
        sync.delete(`tomb:${e.key}`);
        changed++;
      }
    } else if (e.kind === 'kv' && SYNCED_KV.includes(e.key)) {
      const stamp = (await req(sync.get(`stamp:${e.key}`))) || 0;
      if (!shouldApply(stamp, e.ts)) continue;
      let value = e.data;
      if (e.key === 'program') {
        if (!value || typeof value !== 'object') continue;
        // Programme enregistré avant une migration : elles sont idempotentes, on les rejoue
        value = structuredClone(value);
        for (const m of MIGRATIONS) m.apply(value);
      }
      kvOs.put(value, e.key);
      sync.put(e.ts, `stamp:${e.key}`);
      changed++;
    }
  }
  await done(tx);
  return changed;
}
