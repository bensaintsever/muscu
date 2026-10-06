// Synchronisation avec la sauvegarde en ligne : logique pure (fusion, lignes, file d'attente, textes d'état)
// et moteur qui reçoit le stockage local et le client cloud en paramètres (testable sans navigateur).

// Réglages synchronisés. Le reste du store kv est propre à l'appareil (seeded, migrations, lastExportAt…).
export const SYNCED_KV = ['program', 'cycleEdits', 'weekTypeOverride', 'soundOn', 'hyroxDate'];
const CHUNK = 100;

export const itemId = (kind, key) => `${kind}:${key}`;
export function parseItemId(id) {
  const i = id.indexOf(':');
  return { kind: id.slice(0, i), key: id.slice(i + 1) };
}

// Horodatage d'un log : updatedAt posé à chaque écriture ; les logs d'avant la synchro retombent sur leurs dates.
export function logTs(log) {
  return Number(log?.updatedAt) || Number(log?.endedAt) || Number(log?.startedAt) || 0;
}

export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function sameData(kind, a, b) {
  if (kind !== 'log') return stableStringify(a) === stableStringify(b);
  const strip = (l) => { const { updatedAt, ...rest } = l || {}; return rest; };
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

/* ---------- Entrées locales et distantes ---------- */

// snapshot = { logs: [log], tombs: { id: ts }, kv: { key: { value, ts } } }
export function localEntries({ logs = [], tombs = {}, kv = {} }) {
  const map = new Map();
  for (const log of logs) {
    const key = String(log.id);
    map.set(itemId('log', key), { kind: 'log', key, ts: logTs(log), deleted: false, data: log });
  }
  for (const [key, ts] of Object.entries(tombs)) {
    const cur = map.get(itemId('log', key));
    if (!cur || ts > cur.ts) map.set(itemId('log', key), { kind: 'log', key, ts: Number(ts) || 0, deleted: true, data: null });
  }
  for (const [key, { value, ts }] of Object.entries(kv)) {
    if (value === undefined || !SYNCED_KV.includes(key)) continue;
    map.set(itemId('kv', key), { kind: 'kv', key, ts: Number(ts) || 0, deleted: false, data: value });
  }
  return map;
}

// Ligne de la table → entrée. Les lignes inattendues (kind inconnu, réglage non synchronisé, log sans id) sont ignorées.
export function remoteEntry(row) {
  if (!row || (row.kind !== 'log' && row.kind !== 'kv') || row.key == null) return null;
  const key = String(row.key);
  if (row.kind === 'kv' && !SYNCED_KV.includes(key)) return null;
  const deleted = !!row.deleted;
  const ts = Number(row.data?.updatedAt) || Date.parse(row.updated_at) || 0;
  let data = null;
  if (!deleted) {
    if (row.kind === 'kv') data = row.data && 'value' in row.data ? row.data.value : null;
    else {
      if (!row.data || typeof row.data !== 'object' || row.data.id == null) return null;
      data = row.data;
    }
  }
  return { kind: row.kind, key, ts, deleted, data };
}

export function toRow(entry, userId) {
  const { kind, key, ts, deleted, data } = entry;
  let payload;
  if (deleted) payload = { id: key, updatedAt: ts };
  else if (kind === 'kv') payload = { value: data ?? null, updatedAt: ts };
  else payload = { ...data, updatedAt: ts };
  return { user_id: userId, kind, key, data: payload, deleted: !!deleted, updated_at: new Date(ts).toISOString() };
}

/* ---------- Fusion : la version la plus récente gagne ---------- */

const isActive = (e) => e?.kind === 'log' && !e.deleted && e.data?.status === 'in-progress';

// 'pull' : le cloud remplace le local ; 'push' : le local part vers le cloud ; 'none' : rien à faire.
export function decide(local, remote, { hasActive = false } = {}) {
  if (!remote) return local ? 'push' : 'none';
  if (!local) {
    if (remote.deleted) return 'none';
    // Une séance en cours venue d'ailleurs ne doit pas détourner celle de ce téléphone
    if (hasActive && isActive(remote)) return 'none';
    return 'pull';
  }
  if (local.deleted && remote.deleted) return 'none';
  if (local.deleted === remote.deleted && sameData(local.kind, local.data, remote.data)) return 'none';
  // La séance active de ce téléphone fait foi, même si le cloud a plus récent
  if (isActive(local)) return 'push';
  if (remote.ts > local.ts) return 'pull';
  if (local.ts > remote.ts) return 'push';
  return 'pull'; // même horodatage, contenus différents : le cloud tranche, tous les appareils convergent
}

export function planSync(snapshot, rows) {
  const local = localEntries(snapshot);
  const remote = new Map();
  for (const row of rows || []) {
    const e = remoteEntry(row);
    if (e) remote.set(itemId(e.kind, e.key), e);
  }
  const hasActive = [...local.values()].some(isActive);
  const pull = [];
  const push = [];
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const d = decide(local.get(id), remote.get(id), { hasActive });
    if (d === 'pull') pull.push(remote.get(id));
    else if (d === 'push') push.push(id);
  }
  return { pull, push };
}

// Le local mérite-t-il d'être remplacé par une entrée distante ? (revérifié au moment d'écrire)
export function shouldApply(localTs, remoteTs) {
  return !(localTs > remoteTs);
}

/* ---------- File d'attente ---------- */

// Une entrée par élément (dédoublonnage par clé) ; le jeton change à chaque écriture.
export function enqueue(box, kind, key, token) {
  return { ...box, [itemId(kind, key)]: token };
}

// Après envoi : on ne retire que les entrées non réécrites pendant l'envoi.
export function settle(current, sent) {
  const next = { ...current };
  for (const { id, token } of sent) if (next[id] === token) delete next[id];
  return next;
}

/* ---------- Textes d'état ---------- */

function ago(ts, now) {
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  if (min < 24 * 60) return `il y a ${Math.floor(min / 60)} h`;
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `le ${p(d.getDate())}/${p(d.getMonth() + 1)} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function statusText({ online = true, pending = 0, lastSyncAt = null, error = null, syncing = false }, now = Date.now()) {
  const n = `${pending} élément${pending > 1 ? 's' : ''} en attente`;
  if (syncing) return { text: 'Synchronisation en cours…', warn: false };
  if (error?.code === 'auth') return { text: error.message, warn: true };
  if (pending && !online) return { text: `${n}, envoi au retour du réseau`, warn: false };
  if (pending && error) return { text: `${n}. ${error.message}`, warn: true };
  if (pending) return { text: `${n} d'envoi`, warn: false };
  if (error && !lastSyncAt) return { text: error.message, warn: true };
  if (lastSyncAt) return { text: `Sauvegardé ${ago(lastSyncAt, now)}`, warn: false };
  return { text: 'Pas encore sauvegardé', warn: false };
}

/* ---------- Moteur ---------- */

// store : getMeta, setMeta, outbox, settle, snapshot, entriesFor, apply. cloud : getSession, selectAll, upsert.
export function createSyncEngine({ store, cloud, now = () => Date.now() }) {
  let chain = Promise.resolve();
  let queuedPush = null;
  const serial = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };

  async function send(ids, userId) {
    if (!ids.length) return 0;
    const rows = (await store.entriesFor(ids)).map((e) => toRow(e, userId));
    for (let i = 0; i < rows.length; i += CHUNK) await cloud.upsert(rows.slice(i, i + CHUNK));
    return rows.length;
  }

  // Erreurs absorbées : rendues dans le résultat et notées pour l'écran Réglages, jamais levées.
  async function guarded(work) {
    let session;
    try {
      session = await cloud.getSession();
    } catch (e) {
      return fail(e);
    }
    if (!session) return { ok: false, signedOut: true };
    try {
      const r = await work(session);
      if (r.contacted !== false) await store.setMeta({ lastSyncAt: now(), lastError: null });
      return { ok: true, ...r };
    } catch (e) {
      return fail(e);
    }
  }

  async function fail(e) {
    const error = { code: e?.code || 'unknown', message: e?.message || String(e), at: now() };
    try { await store.setMeta({ lastError: error }); } catch { /* rien */ }
    return { ok: false, error };
  }

  function push() {
    if (queuedPush) return queuedPush;
    queuedPush = serial(() => {
      queuedPush = null;
      return guarded(async (session) => {
        const box = await store.outbox();
        if (!box.length) return { pushed: 0, contacted: false };
        const pushed = await send(box.map((b) => b.id), session.user.id);
        await store.settle(box);
        return { pushed };
      });
    });
    return queuedPush;
  }

  function fullSync() {
    return serial(() => guarded(async (session) => {
      const rows = await cloud.selectAll();
      const box = await store.outbox();
      const plan = planSync(await store.snapshot(), rows);
      const applied = plan.pull.length ? await store.apply(plan.pull) : 0;
      const ids = [...new Set([...plan.push, ...box.map((b) => b.id)])];
      const pushed = await send(ids, session.user.id);
      await store.settle(box);
      return { applied, pushed, remote: rows.length };
    }));
  }

  return { push, fullSync };
}
