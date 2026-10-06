// Branchement de la synchronisation dans l'app : quand pousser, quand récupérer, état pour l'écran Réglages.
// Tout est asynchrone et silencieux : une erreur réseau ne gêne jamais la séance, l'envoi est retenté plus tard.
import * as store from './sync-store.js';
import { onLocalWrite } from './db.js';
import { createCloud } from './cloud.js';
import { createSyncEngine } from './sync.js';
import { SUPABASE_URL, SUPABASE_KEY, TABLE } from './cloud-config.js';

const PUSH_DELAY = 2500;
const RETRY_MIN = 30000;
const RETRY_MAX = 10 * 60000;

export const cloud = createCloud({
  url: SUPABASE_URL, key: SUPABASE_KEY, table: TABLE,
  storage: { load: store.getSession, save: store.setSession },
});
const engine = createSyncEngine({ store, cloud });

const listeners = new Set();
let onRemoteChange = () => {};
let pushTimer = null;
let retryTimer = null;
let retryDelay = RETRY_MIN;
let syncing = false;
let started = false;
let needFull = false; // la dernière récupération a échoué : à refaire au prochain essai

const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
}

export async function status() {
  const [session, meta, box] = await Promise.all([store.getSession(), store.getMeta(), store.outbox()]);
  return {
    session, online: online(), syncing, pending: box.length,
    lastSyncAt: meta.lastSyncAt || null, error: meta.lastError || null,
  };
}

function after(result) {
  if (result?.ok) {
    retryDelay = RETRY_MIN;
    clearTimeout(retryTimer);
    retryTimer = null;
  } else if (result?.error && result.error.code !== 'auth' && !retryTimer) {
    // Réessai avec attente croissante, tant que la file n'est pas vide
    retryTimer = setTimeout(() => { retryTimer = null; pushSoon(0); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, RETRY_MAX);
  }
  if (result?.applied > 0) onRemoteChange();
  emit();
  return result;
}

async function run(fn) {
  syncing = true;
  emit();
  try {
    return after(await fn());
  } catch (e) {
    console.error(e);
    return after({ ok: false, error: { code: 'unknown', message: e?.message || String(e) } });
  } finally {
    syncing = false;
    emit();
  }
}

// Envoi de la file, regroupé : plusieurs écritures rapprochées ne font qu'un appel.
export function pushSoon(delay = PUSH_DELAY) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (!online()) { emit(); return; }
    if (needFull) syncNow(); else run(() => engine.push());
  }, delay);
}

export function syncNow() {
  if (!online()) { needFull = true; return Promise.resolve(after({ ok: false, offline: true })); }
  return run(async () => {
    const r = await engine.fullSync();
    needFull = !r.ok && !r.signedOut;
    return r;
  });
}

export async function signIn(email, password) {
  await cloud.signIn(email, password);
  await store.setMeta({ lastError: null });
  return syncNow();
}

export const signUp = (email, password) => cloud.signUp(email, password);

// Déconnexion : seule la session est oubliée, aucune donnée locale n'est touchée.
export async function signOut() {
  await cloud.signOut();
  await store.setMeta({ lastError: null, lastSyncAt: null });
  emit();
}

export async function startSync({ refresh, toast, authHash } = {}) {
  if (started) return;
  started = true;
  onRemoteChange = refresh || (() => {});
  onLocalWrite(() => pushSoon());
  window.addEventListener('online', () => { emit(); pushSoon(0); });
  window.addEventListener('offline', emit);
  // Écran éteint ou app quittée : on envoie tout de suite ce qui reste
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pushSoon(0); });

  if (authHash) {
    try {
      if (await cloud.sessionFromHash(authHash)) toast?.('Adresse confirmée, sauvegarde en ligne activée');
    } catch (e) {
      toast?.(e.message, 5000);
    }
  }
  if (await store.getSession()) syncNow();
}
