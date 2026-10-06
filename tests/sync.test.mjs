// Tests de la sauvegarde en ligne : fusion, file d'attente, moteur, client Supabase (fetch simulé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, planSync, remoteEntry, toRow, enqueue, settle, statusText, createSyncEngine, logTs, parseItemId, shouldApply,
} from '../js/sync.js';
import { createCloud, cloudError, parseAuthHash, toSession } from '../js/cloud.js';

const URL0 = 'https://exemple.supabase.co';
const KEY = 'sb_publishable_test';
const iso = (ts) => new Date(ts).toISOString();
const log = (id, ts, extra = {}) => ({ id, sessionId: 'pec-dos', date: '2026-10-06', status: 'done', startedAt: 1, sets: [], updatedAt: ts, ...extra });
const row = (kind, key, data, ts, deleted = false) => ({ user_id: 'u1', kind, key, data: data && { ...data, updatedAt: ts }, deleted, updated_at: iso(ts) });
const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;

/* ---------- Fusion ---------- */

test('fusion : la version la plus récente gagne, dans les deux sens', () => {
  const snap = { logs: [log('a', 100, { note: 'local' }), log('b', 300, { note: 'local' })], tombs: {}, kv: {} };
  const rows = [row('log', 'a', log('a', 200, { note: 'cloud' }), 200), row('log', 'b', log('b', 250, { note: 'cloud' }), 250)];
  const plan = planSync(snap, rows);
  assert.deepEqual(plan.pull.map((e) => e.key), ['a']);
  assert.equal(plan.pull[0].data.note, 'cloud');
  assert.deepEqual(plan.push, ['log:b']);
});

test('fusion : contenu identique, rien à faire ; même date mais contenus différents, le cloud tranche', () => {
  const same = planSync({ logs: [log('a', 100)] }, [row('log', 'a', log('a', 100), 100)]);
  assert.deepEqual(same, { pull: [], push: [] });
  // Log d'avant la synchro sans updatedAt mais identique : pas de faux conflit
  const old = log('a', undefined); delete old.updatedAt;
  assert.deepEqual(planSync({ logs: [old] }, [row('log', 'a', old, 1)]), { pull: [], push: [] });
  const tie = planSync({ kv: { program: { value: { v: 'seed' }, ts: 0 } } }, [row('kv', 'program', { value: { v: 'cloud' } }, 0)]);
  assert.equal(tie.pull.length, 1);
});

test('fusion : pierre tombale distante supprime la séance locale plus ancienne, et inversement', () => {
  const remoteTomb = planSync({ logs: [log('a', 100)] }, [row('log', 'a', { id: 'a' }, 200, true)]);
  assert.equal(remoteTomb.pull.length, 1);
  assert.equal(remoteTomb.pull[0].deleted, true);
  // Suppression locale plus récente que la version du cloud : on pousse la pierre tombale
  const localTomb = planSync({ tombs: { a: 500 } }, [row('log', 'a', log('a', 200), 200)]);
  assert.deepEqual(localTomb.push, ['log:a']);
  // Séance modifiée après sa suppression ailleurs : elle revient
  const revived = planSync({ tombs: { a: 100 } }, [row('log', 'a', log('a', 200), 200)]);
  assert.equal(revived.pull.length, 1);
  // Supprimée des deux côtés, ou inconnue localement et supprimée au cloud : rien
  assert.deepEqual(planSync({ tombs: { a: 1 } }, [row('log', 'a', { id: 'a' }, 2, true)]), { pull: [], push: [] });
  assert.deepEqual(planSync({}, [row('log', 'z', { id: 'z' }, 2, true)]), { pull: [], push: [] });
});

test('fusion : la séance active locale est protégée', () => {
  const active = log('a', 100, { status: 'in-progress', sets: [{ exerciseId: 'x', setIndex: 0, load: 10, reps: 8 }] });
  const plan = planSync({ logs: [active] }, [row('log', 'a', log('a', 999, { status: 'done' }), 999)]);
  assert.deepEqual(plan.pull, []);
  assert.deepEqual(plan.push, ['log:a']);
  // Pas même supprimée par une pierre tombale plus récente
  assert.equal(decide({ kind: 'log', key: 'a', ts: 1, deleted: false, data: active }, { kind: 'log', key: 'a', ts: 9, deleted: true, data: null }), 'push');
  // Une autre séance en cours venue du cloud ne détourne pas celle de ce téléphone
  const other = planSync({ logs: [active] }, [row('log', 'b', log('b', 5, { status: 'in-progress' }), 5)]);
  assert.deepEqual(other.pull, []);
  // Sans séance active ici, elle est récupérée (téléphone mort en pleine séance)
  assert.equal(planSync({}, [row('log', 'b', log('b', 5, { status: 'in-progress' }), 5)]).pull.length, 1);
});

test('fusion des réglages kv, clés non synchronisées ignorées', () => {
  const snap = { kv: { soundOn: { value: true, ts: 50 }, hyroxDate: { value: '2027-02-13', ts: 10 } } };
  const rows = [
    row('kv', 'soundOn', { value: false }, 40),
    row('kv', 'hyroxDate', { value: '2027-03-06' }, 20),
    row('kv', 'cycleEdits', { value: { b1: {} } }, 5),
    row('kv', 'seeded', { value: false }, 999),
    row('kv', 'session', { value: 'x' }, 999),
  ];
  const plan = planSync(snap, rows);
  assert.deepEqual(plan.pull.map((e) => e.key).sort(), ['cycleEdits', 'hyroxDate']);
  assert.deepEqual(plan.push, ['kv:soundOn']);
  assert.equal(plan.pull.find((e) => e.key === 'hyroxDate').data, '2027-03-06');
  // Valeur null transportée telle quelle (date provisoire)
  assert.equal(remoteEntry(row('kv', 'hyroxDate', { value: null }, 3)).data, null);
});

test('premier branchement : cloud vide, tout le local part ; téléphone neuf, tout revient', () => {
  const local = { logs: [log('a', 1), log('ref-x', 0, { isReference: true })], kv: { program: { value: { p: 1 }, ts: 0 }, soundOn: { value: true, ts: 0 } } };
  assert.deepEqual(planSync(local, []).push.sort(), ['kv:program', 'kv:soundOn', 'log:a', 'log:ref-x']);
  const seedOnly = { logs: [log('ref-x', 0, { isReference: true })], kv: { program: { value: { p: 'seed' }, ts: 0 } } };
  const cloudRows = [row('log', 'a', log('a', 10), 10), row('log', 'ref-x', log('ref-x', 0, { isReference: true }), 0), row('kv', 'program', { value: { p: 'perso' } }, 0), row('kv', 'hyroxDate', { value: '2027-03-06' }, 7)];
  const plan = planSync(seedOnly, cloudRows);
  assert.deepEqual(plan.pull.map((e) => `${e.kind}:${e.key}`).sort(), ['kv:hyroxDate', 'kv:program', 'log:a']);
  assert.deepEqual(plan.push, []);
});

test('lignes : format envoyé et relu', () => {
  const r = toRow({ kind: 'log', key: 'a', ts: 1000, deleted: false, data: log('a', 5) }, 'u1');
  assert.deepEqual(Object.keys(r).sort(), ['data', 'deleted', 'key', 'kind', 'updated_at', 'user_id']);
  assert.equal(r.data.updatedAt, 1000);
  assert.equal(r.updated_at, '1970-01-01T00:00:01.000Z');
  const t = toRow({ kind: 'log', key: 'a', ts: 7, deleted: true, data: null }, 'u1');
  assert.deepEqual([t.deleted, t.data], [true, { id: 'a', updatedAt: 7 }]);
  const k = toRow({ kind: 'kv', key: 'soundOn', ts: 3, deleted: false, data: false }, 'u1');
  assert.deepEqual(k.data, { value: false, updatedAt: 3 });
  assert.deepEqual(remoteEntry(k), { kind: 'kv', key: 'soundOn', ts: 3, deleted: false, data: false });
  assert.equal(remoteEntry({ kind: 'log', key: 'x', data: { pas: 'd id' }, updated_at: iso(1) }), null);
  assert.equal(logTs({ endedAt: 9, startedAt: 2 }), 9);
  assert.deepEqual(parseItemId('kv:program'), { kind: 'kv', key: 'program' });
  assert.equal(shouldApply(5, 5), true);
  assert.equal(shouldApply(6, 5), false);
});

/* ---------- File d'attente ---------- */

test('file : ajout, dédoublonnage par clé, vidage sans perdre une réécriture', () => {
  let box = {};
  box = enqueue(box, 'log', 'a', 't1');
  box = enqueue(box, 'kv', 'soundOn', 't2');
  box = enqueue(box, 'log', 'a', 't3');
  assert.deepEqual(box, { 'log:a': 't3', 'kv:soundOn': 't2' });
  const sent = Object.entries(box).map(([id, token]) => ({ id, token }));
  box = enqueue(box, 'kv', 'soundOn', 't4'); // réécrit pendant l'envoi
  assert.deepEqual(settle(box, sent), { 'kv:soundOn': 't4' });
});

// Stockage local simulé, mêmes règles que sync-store.js
function fakeStore(init = {}) {
  const st = { logs: {}, tombs: {}, kv: {}, box: {}, meta: {}, n: 0, ...init };
  const write = (kind, key) => { st.box = enqueue(st.box, kind, key, `t${++st.n}`); };
  return {
    st,
    saveLog(l) { st.logs[l.id] = l; write('log', l.id); },
    deleteLog(id, ts) { delete st.logs[id]; st.tombs[id] = ts; write('log', id); },
    setKv(key, value, ts) { st.kv[key] = { value, ts }; write('kv', key); },
    async getMeta() { return st.meta; },
    async setMeta(p) { st.meta = { ...st.meta, ...p }; },
    async outbox() { return Object.entries(st.box).map(([id, token]) => ({ id, token })); },
    async settle(sent) { st.box = settle(st.box, sent); },
    async snapshot() { return structuredClone({ logs: Object.values(st.logs), tombs: st.tombs, kv: st.kv }); },
    async entriesFor(ids) {
      return ids.flatMap((id) => {
        const { kind, key } = parseItemId(id);
        if (kind === 'log') {
          if (st.logs[key]) return [{ kind, key, ts: logTs(st.logs[key]), deleted: false, data: st.logs[key] }];
          return st.tombs[key] != null ? [{ kind, key, ts: st.tombs[key], deleted: true, data: null }] : [];
        }
        return st.kv[key] ? [{ kind, key, ts: st.kv[key].ts, deleted: false, data: st.kv[key].value }] : [];
      });
    },
    async apply(entries) {
      let n = 0;
      for (const e of entries) {
        if (e.kind === 'log') {
          if (e.deleted) { delete st.logs[e.key]; st.tombs[e.key] = e.ts; } else st.logs[e.key] = { ...e.data, updatedAt: e.ts };
        } else st.kv[e.key] = { value: e.data, ts: e.ts };
        n++;
      }
      return n;
    },
  };
}

function fakeCloud({ rows = [], session = { user: { id: 'u1' } } } = {}) {
  const c = {
    rows, sent: [], fail: null, session,
    async getSession() { return c.session; },
    async selectAll() { if (c.fail) throw c.fail; return c.rows; },
    async upsert(batch) {
      if (c.fail) throw c.fail;
      c.sent.push(...batch);
      for (const r of batch) {
        c.rows = c.rows.filter((x) => !(x.kind === r.kind && x.key === r.key)).concat(r);
      }
    },
  };
  return c;
}

test('moteur : envoi de la file puis vidage ; erreur réseau, la file est conservée', async () => {
  const store = fakeStore();
  const cloud = fakeCloud();
  const engine = createSyncEngine({ store, cloud, now: () => 42 });
  store.saveLog(log('a', 10));
  store.saveLog(log('a', 11, { note: 'v2' }));
  store.setKv('soundOn', false, 12);
  cloud.fail = Object.assign(new Error('Pas de connexion au serveur.'), { code: 'network' });
  const ko = await engine.push();
  assert.equal(ko.ok, false);
  assert.equal(ko.error.code, 'network');
  assert.equal((await store.outbox()).length, 2);
  assert.equal(store.st.meta.lastError.code, 'network');
  cloud.fail = null;
  const ok = await engine.push();
  assert.deepEqual([ok.ok, ok.pushed], [true, 2]);
  assert.equal(cloud.sent.find((r) => r.key === 'a').data.note, 'v2');
  assert.equal((await store.outbox()).length, 0);
  assert.deepEqual([store.st.meta.lastSyncAt, store.st.meta.lastError], [42, null]);
  // File vide : aucun appel réseau, rien de noté
  store.st.meta.lastSyncAt = 1;
  assert.equal((await engine.push()).pushed, 0);
  assert.equal(store.st.meta.lastSyncAt, 1);
});

test('moteur : déconnecté, rien ne part et rien ne se perd', async () => {
  const store = fakeStore();
  const cloud = fakeCloud({ session: null });
  store.deleteLog('a', 5);
  const r = await createSyncEngine({ store, cloud }).push();
  assert.equal(r.signedOut, true);
  assert.equal((await store.outbox()).length, 1);
});

test('moteur : synchro complète, premier branchement puis restauration sur un téléphone neuf', async () => {
  const phone1 = fakeStore({ logs: { a: log('a', 10), b: log('b', 20) }, kv: { program: { value: { p: 'perso' }, ts: 0 } } });
  phone1.deleteLog('c', 30);
  const cloud = fakeCloud();
  const r1 = await createSyncEngine({ store: phone1, cloud }).fullSync();
  assert.equal(r1.ok, true);
  assert.deepEqual(cloud.rows.map((x) => `${x.kind}:${x.key}:${x.deleted}`).sort(), ['kv:program:false', 'log:a:false', 'log:b:false', 'log:c:true']);
  assert.equal((await phone1.outbox()).length, 0);

  const phone2 = fakeStore({ kv: { program: { value: { p: 'seed' }, ts: 0 } } });
  const r2 = await createSyncEngine({ store: phone2, cloud }).fullSync();
  assert.equal(r2.applied, 3);
  assert.deepEqual(Object.keys(phone2.st.logs).sort(), ['a', 'b']);
  assert.deepEqual(phone2.st.kv.program.value, { p: 'perso' });
  assert.equal(r2.pushed, 0);
});

/* ---------- Client Supabase ---------- */

function mockFetch(handler) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, ...opts, json: opts.body ? JSON.parse(opts.body) : undefined });
    const { status = 200, body = null, throws } = (await handler(url, opts, calls.length)) || {};
    if (throws) throw new TypeError('Failed to fetch');
    return { ok: status >= 200 && status < 300, status, text: async () => (body == null ? '' : JSON.stringify(body)) };
  };
  return { f, calls };
}
function memStorage(session = null) {
  const s = { session, async load() { return s.session; }, async save(v) { s.session = v; } };
  return s;
}
const T0 = 1_800_000_000_000;

test('cloud : connexion, en-têtes, session conservée sans mot de passe', async () => {
  const storage = memStorage();
  const { f, calls } = mockFetch(() => ({ body: { access_token: jwt({ sub: 'u1', email: 'b@x.fr' }), refresh_token: 'r1', expires_in: 3600, user: { id: 'u1', email: 'b@x.fr' } } }));
  const cloud = createCloud({ url: URL0, key: KEY, storage, fetch: f, now: () => T0 });
  const s = await cloud.signIn('b@x.fr', 'secret123');
  assert.equal(calls[0].url, `${URL0}/auth/v1/token?grant_type=password`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.apikey, KEY);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.deepEqual(calls[0].json, { email: 'b@x.fr', password: 'secret123' });
  assert.equal(s.expires_at, T0 / 1000 + 3600);
  assert.deepEqual(storage.session.user, { id: 'u1', email: 'b@x.fr' });
  assert.ok(!JSON.stringify(storage.session).includes('secret123'));
});

test('cloud : upsert et lecture PostgREST', async () => {
  const storage = memStorage({ access_token: 'A', refresh_token: 'R', expires_at: T0 / 1000 + 3600, user: { id: 'u1' } });
  const { f, calls } = mockFetch((url) => (url.includes('select=') ? { body: [{ kind: 'kv', key: 'soundOn' }] } : { status: 201 }));
  const cloud = createCloud({ url: URL0, key: KEY, storage, fetch: f, now: () => T0 });
  await cloud.upsert([{ user_id: 'u1', kind: 'kv', key: 'soundOn', data: { value: true }, deleted: false, updated_at: iso(1) }]);
  assert.equal(calls[0].url, `${URL0}/rest/v1/muscu_items?on_conflict=user_id,kind,key`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(calls[0].headers.Authorization, 'Bearer A');
  assert.equal(calls[0].headers.apikey, KEY);
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.ok(Array.isArray(calls[0].json));
  const rows = await cloud.selectAll();
  assert.equal(rows.length, 1);
  assert.match(calls[1].url, /\/rest\/v1\/muscu_items\?select=\*&order=kind\.asc,key\.asc&limit=1000&offset=0$/);
  await cloud.upsert([]);
  assert.equal(calls.length, 2);
});

test('cloud : session rafraîchie avant expiration, une seule fois même en parallèle', async () => {
  const storage = memStorage({ access_token: 'old', refresh_token: 'R1', expires_at: T0 / 1000 + 30, user: { id: 'u1', email: 'b@x.fr' } });
  const { f, calls } = mockFetch((url) => (url.includes('refresh_token')
    ? { body: { access_token: jwt({ sub: 'u1' }), refresh_token: 'R2', expires_at: T0 / 1000 + 3600, user: { id: 'u1', email: 'b@x.fr' } } }
    : { body: [] }));
  const cloud = createCloud({ url: URL0, key: KEY, storage, fetch: f, now: () => T0 });
  const [a, b] = await Promise.all([cloud.getSession(), cloud.getSession()]);
  assert.equal(a.refresh_token, 'R2');
  assert.equal(b.refresh_token, 'R2');
  assert.equal(calls.filter((c) => c.url.endsWith('grant_type=refresh_token')).length, 1);
  assert.deepEqual(calls[0].json, { refresh_token: 'R1' });
  assert.equal(storage.session.refresh_token, 'R2');
  // Session encore valide : pas de rafraîchissement
  await cloud.selectAll();
  assert.equal(calls.length, 2);
  assert.match(calls[1].headers.Authorization, /^Bearer x\./);
});

test('cloud : jeton de rafraîchissement refusé, session effacée ; réseau absent, session gardée', async () => {
  const dead = memStorage({ access_token: 'A', refresh_token: 'R', expires_at: T0 / 1000 - 10, user: { id: 'u1' } });
  const c1 = createCloud({ url: URL0, key: KEY, storage: dead, fetch: mockFetch(() => ({ status: 400, body: { code: 400, error_code: 'validation_failed', msg: 'Refresh token is not valid' } })).f, now: () => T0 });
  await assert.rejects(c1.getSession(), (e) => e.code === 'auth' && /reconnecte-toi/.test(e.message));
  assert.equal(dead.session, null);

  const kept = memStorage({ access_token: 'A', refresh_token: 'R', expires_at: T0 / 1000 - 10, user: { id: 'u1' } });
  const c2 = createCloud({ url: URL0, key: KEY, storage: kept, fetch: mockFetch(() => ({ throws: true })).f, now: () => T0 });
  await assert.rejects(c2.getSession(), (e) => e.code === 'network');
  assert.equal(kept.session.refresh_token, 'R');
});

test('cloud : un 401 sur la table déclenche un rafraîchissement et un nouvel essai', async () => {
  const storage = memStorage({ access_token: 'A', refresh_token: 'R', expires_at: T0 / 1000 + 3600, user: { id: 'u1' } });
  const { f, calls } = mockFetch((url, o, n) => {
    if (url.includes('refresh_token')) return { body: { access_token: 'B.x.y', refresh_token: 'R2', expires_in: 3600, user: { id: 'u1' } } };
    return n === 1 ? { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } } : { body: [] };
  });
  const cloud = createCloud({ url: URL0, key: KEY, storage, fetch: f, now: () => T0 });
  assert.deepEqual(await cloud.selectAll(), []);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].headers.Authorization, 'Bearer B.x.y');
});

test('cloud : inscription, confirmation attendue ou adresse déjà prise', async () => {
  const { f, calls } = mockFetch(() => ({ body: { id: 'u1', email: 'b@x.fr', identities: [{ id: 'i' }], confirmation_sent_at: 'x' } }));
  const storage = memStorage();
  const r = await createCloud({ url: URL0, key: KEY, storage, fetch: f }).signUp('b@x.fr', 'secret123');
  assert.equal(calls[0].url, `${URL0}/auth/v1/signup`);
  assert.deepEqual(r, { session: null, needsConfirmation: true });
  assert.equal(storage.session, null);
  const taken = createCloud({ url: URL0, key: KEY, storage, fetch: mockFetch(() => ({ body: { id: 'u1', identities: [] } })).f });
  await assert.rejects(taken.signUp('b@x.fr', 'secret123'), /existe déjà/);
});

test('cloud : messages d\'erreur en français', async () => {
  assert.match(cloudError(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }).message, /mot de passe incorrect/);
  assert.match(cloudError(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }).message, /mot de passe incorrect/);
  assert.match(cloudError(400, { error_code: 'email_not_confirmed' }).message, /pas encore confirmée/);
  assert.match(cloudError(422, { error_code: 'weak_password' }).message, /trop faible/);
  assert.match(cloudError(429, { error_code: 'over_email_send_rate_limit' }).message, /Trop de tentatives/);
  assert.match(cloudError(503, {}).message, /503/);
  const storage = memStorage();
  const off = createCloud({ url: URL0, key: KEY, storage, fetch: mockFetch(() => ({ throws: true })).f });
  await assert.rejects(off.signIn('b@x.fr', 'secret123'), (e) => e.code === 'network' && /réseau/.test(e.message));
});

test('cloud : déconnexion locale immédiate, retour du lien de confirmation', async () => {
  const storage = memStorage({ access_token: 'A', refresh_token: 'R', expires_at: 9e9, user: { id: 'u1' } });
  const { f, calls } = mockFetch(() => ({ throws: true }));
  const cloud = createCloud({ url: URL0, key: KEY, storage, fetch: f, now: () => T0 });
  await cloud.signOut();
  assert.equal(storage.session, null);
  assert.equal(calls[0].url, `${URL0}/auth/v1/logout`);
  assert.equal(calls[0].headers.Authorization, 'Bearer A');

  assert.deepEqual(parseAuthHash('#error=access_denied&error_description=Email+link+is+invalid+or+has+expired'), { error: 'Email link is invalid or has expired' });
  assert.equal(parseAuthHash('#/settings'), null);
  const s = await cloud.sessionFromHash(`#access_token=${jwt({ sub: 'u9', email: 'n@x.fr' })}&expires_in=3600&refresh_token=R9&token_type=bearer&type=signup`);
  assert.deepEqual([s.user.id, s.user.email, s.refresh_token, s.expires_at], ['u9', 'n@x.fr', 'R9', T0 / 1000 + 3600]);
  assert.equal(toSession({ access_token: 'a' }, T0), null);
});

/* ---------- Textes d'état ---------- */

test('état affiché dans Réglages', () => {
  const now = T0;
  assert.equal(statusText({ lastSyncAt: now - 2 * 60000 }, now).text, 'Sauvegardé il y a 2 min');
  assert.equal(statusText({ lastSyncAt: now - 10000 }, now).text, 'Sauvegardé à l\'instant');
  assert.equal(statusText({ pending: 3, online: false }, now).text, '3 éléments en attente, envoi au retour du réseau');
  assert.equal(statusText({ pending: 1 }, now).text, '1 élément en attente d\'envoi');
  const err = statusText({ pending: 2, error: { code: 'server', message: 'Le serveur ne répond pas.' } }, now);
  assert.equal(err.warn, true);
  assert.equal(statusText({}, now).text, 'Pas encore sauvegardé');
  assert.equal(statusText({ error: { code: 'auth', message: 'Session expirée : reconnecte-toi.' }, lastSyncAt: now }, now).warn, true);
});
