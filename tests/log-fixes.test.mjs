import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_FIXES, applyLogFixes } from '../js/log-fixes.js';

const fix = LOG_FIXES.find((f) => f.id === '2026-10-15-pec-dos-halteres');
const log = (o = {}) => ({ id: 'l1', sessionId: 'pec-dos', date: '2026-10-14', status: 'done', startedAt: 1, endedAt: 2, sets: [{ exerciseId: 'dc-incline-halteres', setIndex: 0, load: 26, reps: 10, ts: 1 }], ...o });

test('correction 14/10 : cible la séance Pec/Dos de la semaine', () => {
  const logs = [log({ id: 'old', date: '2026-10-05' }), log(), log({ id: 'j', sessionId: 'jambes' })];
  assert.equal(fix.find(logs).id, 'l1');
  assert.equal(fix.find([log({ date: '2026-10-05' })]), null);
});

test('correction 14/10 : ajoute écarté couché et tirage bûcheron, une seule fois', () => {
  const l = log();
  assert.equal(fix.apply(l), true);
  const of = (id) => l.sets.filter((s) => s.exerciseId === id).map((s) => `${s.load}x${s.reps}#${s.setIndex}`);
  assert.deepEqual(of('ecarte-banc'), ['18x10#0', '18x10#1', '18x11#2']);
  assert.deepEqual(of('tirage-un-bras'), ['26x10#0', '26x12#1', '26x10#2']);
  assert.equal(fix.apply(l), false);
  assert.equal(l.sets.length, 7);
});

test('applyLogFixes : séance absente → reste en attente ; présente → appliquée et marquée', async () => {
  const kv = {}; let saved = [];
  const db = {
    logs: [],
    getSetting: async (k, f) => (k in kv ? kv[k] : f),
    setSetting: async (k, v) => { kv[k] = v; },
    listLogs: async () => db.logs,
    saveLog: async (l) => { saved.push(l.id); },
  };
  assert.equal(await applyLogFixes(db), 0);
  assert.deepEqual(kv.logFixes, []);
  db.logs = [log()];
  assert.equal(await applyLogFixes(db), 1);
  assert.deepEqual(saved, ['l1']);
  assert.ok(kv.logFixes.includes(fix.id));
  assert.equal(await applyLogFixes(db), 0);
});
