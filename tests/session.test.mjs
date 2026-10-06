import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAM, REFERENCE_LOGS, MIGRATIONS } from '../js/program.js';
import { suggest } from '../js/progression.js';
import {
  buildSteps, firstUndone, isStepDone, isLastSetOf, restGroup, partnerStep, stepAfterSkip, stepCount,
} from '../js/session/steps.js';
import { plannedInput, lastSetPlan, targetReps, targetLoad } from '../js/session/prefill.js';

const program = () => structuredClone(PROGRAM);
const sessionOf = (p, id) => p.sessions.find((s) => s.id === id);
const newLog = (extra = {}) => ({ sets: [], weekType: 'normale', ...extra });
const brief = (steps) => steps.map((s) => `${s.key}:${s.rest}`);
const done = (exerciseId, setIndex, load = 0, reps = 10) => ({ exerciseId, setIndex, load, reps, ts: 0 });

// Historique au format de getExerciseHistory, à partir des séances de référence.
function refHistory(exerciseId) {
  return REFERENCE_LOGS
    .map((log) => ({
      logId: log.id, date: log.date, weekType: log.weekType, isReference: true,
      sets: log.sets.filter((s) => s.exerciseId === exerciseId).map(({ load, reps }) => ({ load, reps })),
    }))
    .filter((h) => h.sets.length);
}

const entry = (date, weekType, load, reps) => ({
  logId: date, date, weekType, isReference: false, sets: reps.map((r) => ({ load, reps: r })),
});

// Pré-remplissage tel que le calcule la vue Séance
function prefill(exId, setIdx, { history, weekType = 'normale', sets = [], target } = {}) {
  const ex = PROGRAM.exercises[exId];
  const hist = history ?? refHistory(exId);
  return plannedInput({
    exId, ex, setIdx, history: hist, sets, weekType,
    target: target ?? suggest(ex, hist, weekType),
  });
}

// ---------- buildSteps ----------

test('buildSteps : exos simples dans l\'ordre, repos après chaque série', () => {
  const p = program();
  const steps = buildSteps(sessionOf(p, 'pec-dos'), p, newLog());
  assert.deepEqual(brief(steps.slice(0, 6)), [
    'traction-pronation#0:90', 'traction-pronation#1:90', 'traction-pronation#2:90',
    'dc-incline-halteres#0:90', 'dc-incline-halteres#1:90', 'dc-incline-halteres#2:90',
  ]);
  assert.equal(steps.length, 3 + 3 + 6 + 6 + 3);
  steps.forEach((s, i) => assert.equal(s.idx, i));
  assert.ok(steps.every((s) => s.kind === 'set'));
  assert.equal(steps[0].blockIdx, 0);
  assert.equal(steps.at(-1).ex, 'reverse-crunch');
});

test('buildSteps : superset A1 B1 A2 B2, repos seulement après B', () => {
  const p = program();
  const steps = buildSteps(sessionOf(p, 'epaule-bras'), p, newLog()).filter((s) => s.blockIdx === 1);
  assert.deepEqual(brief(steps), [
    'elevation-laterale#0:0', 'oiseau-incline#0:75',
    'elevation-laterale#1:0', 'oiseau-incline#1:75',
    'elevation-laterale#2:0', 'oiseau-incline#2:75',
  ]);
});

test('buildSteps : intervalle wall ball, maintien et repos du bloc', () => {
  const p = program();
  const steps = buildSteps(sessionOf(p, 'jambes'), p, newLog()).filter((s) => s.blockIdx === 4);
  assert.equal(steps.length, 5);
  assert.ok(steps.every((s) => s.kind === 'interval' && s.hold === 20 && s.rest === 90 && s.ex === 'wallball-thruster'));
  assert.deepEqual(steps.map((s) => s.set), [0, 1, 2, 3, 4]);
});

test('buildSteps : séries en plus, y compris superset aux séries inégales', () => {
  const p = program();
  const log = newLog({ extraSets: { 'elevation-laterale': 1, 'developpe-barre': 2 } });
  const steps = buildSteps(sessionOf(p, 'epaule-bras'), p, log);
  assert.equal(stepCount(steps, 'developpe-barre'), 6);
  const ss = steps.filter((s) => s.blockIdx === 1);
  assert.deepEqual(brief(ss), [
    'elevation-laterale#0:0', 'oiseau-incline#0:75',
    'elevation-laterale#1:0', 'oiseau-incline#1:75',
    'elevation-laterale#2:0', 'oiseau-incline#2:75',
    'elevation-laterale#3:75', // seul au 4e tour : le repos suit directement
  ]);
});

test('buildSteps : exercices sautés', () => {
  const p = program();
  const log = newLog({ skipped: ['developpe-barre', 'oiseau-incline'] });
  const steps = buildSteps(sessionOf(p, 'epaule-bras'), p, log);
  assert.equal(stepCount(steps, 'developpe-barre'), 0);
  assert.equal(stepCount(steps, 'oiseau-incline'), 0);
  // Superset réduit à un exo : repos après chaque série
  assert.deepEqual(brief(steps.filter((s) => s.blockIdx === 1)), [
    'elevation-laterale#0:75', 'elevation-laterale#1:75', 'elevation-laterale#2:75',
  ]);
  assert.equal(steps[0].ex, 'elevation-laterale');
});

test('buildSteps : exo absent du programme ignoré', () => {
  const p = program();
  sessionOf(p, 'pec-dos').blocks[4].exercises = ['inconnu'];
  const steps = buildSteps(sessionOf(p, 'pec-dos'), p, newLog());
  assert.ok(steps.every((s) => s.ex !== 'inconnu'));
  assert.ok(steps.every((s) => s.blockIdx < 4));
});

test('buildSteps : repos du bloc prioritaire sur celui de la séance, 90 s par défaut', () => {
  const p = program();
  const s = sessionOf(p, 'epaule-bras');
  s.blocks[1].rest = 60;
  let steps = buildSteps(s, p, newLog());
  assert.deepEqual(steps.filter((x) => x.blockIdx === 1 && x.rest).map((x) => x.rest), [60, 60, 60]);
  assert.ok(steps.filter((x) => x.blockIdx === 0).every((x) => x.rest === 75));
  delete s.rest;
  steps = buildSteps(s, p, newLog());
  assert.ok(steps.filter((x) => x.blockIdx === 0).every((x) => x.rest === 90));
  assert.equal(steps.find((x) => x.key === 'oiseau-incline#0').rest, 60);
});

// ---------- Reprise ----------

test('reprise : position = première étape non faite', () => {
  const p = program();
  const s = sessionOf(p, 'epaule-bras');
  const log = newLog({ sets: [done('developpe-barre', 0), done('developpe-barre', 1)] });
  const steps = buildSteps(s, p, log);
  assert.equal(firstUndone(steps, log).key, 'developpe-barre#2');

  // Trou au milieu : on y retourne
  log.sets = [done('developpe-barre', 0), done('developpe-barre', 2), done('developpe-barre', 3)];
  assert.equal(firstUndone(steps, log).key, 'developpe-barre#1');

  // Depuis une position donnée, on repart du début si tout ce qui suit est fait
  const fromIdx = steps.findIndex((x) => x.key === 'developpe-barre#3') + 1;
  assert.equal(firstUndone(steps, log, fromIdx).key, 'elevation-laterale#0');
  log.sets = steps.filter((x) => x.blockIdx > 0).map((x) => done(x.ex, x.set));
  assert.equal(firstUndone(steps, log, 5).key, 'developpe-barre#0');

  log.sets = steps.map((x) => done(x.ex, x.set));
  assert.equal(firstUndone(steps, log), null);
  assert.equal(firstUndone([], log), null);
  assert.ok(isStepDone(log, steps[0]));
});

test('après un exo passé : suite à partir de son bloc', () => {
  const p = program();
  const s = sessionOf(p, 'epaule-bras');
  const log = newLog({ sets: [done('developpe-barre', 0)], skipped: ['elevation-laterale'] });
  const steps = buildSteps(s, p, log);
  assert.equal(stepAfterSkip(steps, log, 1).key, 'oiseau-incline#0');
  // Bloc vidé en entier : on reprend au premier non fait suivant, ou au début
  log.skipped = ['elevation-laterale', 'oiseau-incline', 'extension-triceps-haut', 'curl-cable', 'pushdown-cable', 'curl-marteau-cable'];
  assert.equal(stepAfterSkip(buildSteps(s, p, log), log, 3).key, 'developpe-barre#1');
});

// ---------- Pré-remplissage ----------

test('pré-remplissage : reprend la séance précédente série par série (DC incliné 26 kg 10/10/8)', () => {
  assert.deepEqual([0, 1, 2].map((i) => prefill('dc-incline-halteres', i)), [
    { load: 26, reps: 10 }, { load: 26, reps: 10 }, { load: 26, reps: 8 },
  ]);
  // Charges différentes d'une série à l'autre
  const history = [entry('2026-10-07', 'normale', 0, [])];
  history[0].sets = [{ load: 26, reps: 10 }, { load: 24, reps: 10 }, { load: 22, reps: 8 }];
  assert.deepEqual([0, 1, 2].map((i) => prefill('dc-incline-halteres', i, { history })), [
    { load: 26, reps: 10 }, { load: 24, reps: 10 }, { load: 22, reps: 8 },
  ]);
});

test('pré-remplissage : semaine légère sur un exo qui ondule (65 × 0,6 → 35, reps identiques)', () => {
  assert.deepEqual([0, 1, 2].map((i) => prefill('leg-curl', i, { weekType: 'legere' })), [
    { load: 35, reps: 9 }, { load: 35, reps: 10 }, { load: 35, reps: 10 },
  ]);
  // Moyenne : 40 × 0,85 = 34 → pas de 4 → 32
  assert.deepEqual(prefill('fentes-marchees', 0, { weekType: 'moyenne' }), { load: 32, reps: 12 });
  // Exo qui n'ondule pas : pleine charge quelle que soit la semaine
  assert.deepEqual(prefill('dc-incline-halteres', 0, { weekType: 'legere' }), { load: 26, reps: 10 });
});

test('pré-remplissage : la base ignore une dernière séance de semaine légère', () => {
  const history = [...refHistory('leg-curl'), entry('2026-10-12', 'lourde', 65, [10, 11, 11]), entry('2026-10-26', 'legere', 35, [12, 12, 12])];
  assert.deepEqual([0, 1, 2].map((i) => prefill('leg-curl', i, { history, weekType: 'lourde' })), [
    { load: 65, reps: 10 }, { load: 65, reps: 11 }, { load: 65, reps: 11 },
  ]);
  assert.deepEqual(prefill('leg-curl', 0, { history, weekType: 'legere' }), { load: 35, reps: 10 });
  // Aucune séance à pleine charge : on se rabat sur la plus récente, ramenée elle aussi
  // au pourcentage (35 × 0,6 = 21 → 20), comme le fait suggest
  const legCurl = PROGRAM.exercises['leg-curl'];
  const onlyLight = [entry('2026-10-26', 'legere', 35, [12, 12, 12])];
  assert.deepEqual(lastSetPlan(legCurl, onlyLight, 'legere', 0), { load: 20, reps: 12 });
  assert.equal(suggest(legCurl, onlyLight, 'legere').load, 20);
  assert.deepEqual(lastSetPlan(legCurl, onlyLight, 'lourde', 0), { load: 35, reps: 12 });
  // Exo sans ondulation : la dernière séance, même légère
  const chest = [...refHistory('chest-row-incline'), entry('2026-10-07', 'legere', 22, [13, 14, 15])];
  assert.deepEqual(prefill('chest-row-incline', 2, { history: chest, weekType: 'lourde' }), { load: 22, reps: 15 });
});

test('pré-remplissage : charge modifiée plus tôt dans la séance conservée pour les séries suivantes', () => {
  const sets = [done('dc-incline-halteres', 0, 28, 10)];
  assert.deepEqual(prefill('dc-incline-halteres', 1, { sets }), { load: 28, reps: 10 });
  assert.deepEqual(prefill('dc-incline-halteres', 2, { sets: [...sets, done('dc-incline-halteres', 1, 28, 9)] }), { load: 28, reps: 8 });
  // Reps différentes mais même charge que prévu : on garde le plan
  assert.deepEqual(prefill('dc-incline-halteres', 1, { sets: [done('dc-incline-halteres', 0, 26, 12)] }), { load: 26, reps: 10 });
  // Charge prévue suivie alors que le plan descend : le plan l'emporte
  const history = [entry('2026-10-07', 'normale', 0, [])];
  history[0].sets = [{ load: 26, reps: 10 }, { load: 24, reps: 10 }];
  assert.deepEqual(prefill('dc-incline-halteres', 1, { history, sets: [done('dc-incline-halteres', 0, 26, 10)] }), { load: 24, reps: 10 });
  // Les séries des autres exos ne comptent pas
  assert.deepEqual(prefill('dc-incline-halteres', 1, { sets: [done('ecarte-banc', 0, 30, 10)] }), { load: 26, reps: 10 });
  // Semaine légère : 33 kg tapés au lieu de 35 → gardés
  assert.deepEqual(prefill('leg-curl', 1, { weekType: 'legere', sets: [done('leg-curl', 0, 30, 9)] }), { load: 30, reps: 10 });
});

test('pré-remplissage : série en plus au-delà de l\'historique → reprend la dernière série', () => {
  assert.deepEqual(prefill('dc-incline-halteres', 3), { load: 26, reps: 8 });
  assert.deepEqual(prefill('dc-incline-halteres', 3, { sets: [done('dc-incline-halteres', 2, 28, 8)] }), { load: 28, reps: 8 });
});

test('pré-remplissage : sans historique → cible de suggest', () => {
  assert.deepEqual(prefill('dc-incline-halteres', 0, { history: [] }), { load: 0, reps: 8 });
  assert.deepEqual(prefill('traction-pronation', 2, { history: [] }), { load: 0, reps: 7 });
  const ex = PROGRAM.exercises['curl-cable'];
  const target = { load: 30, reps: [10, 11], action: 'hold', reason: '' };
  assert.deepEqual(plannedInput({ exId: 'curl-cable', ex, setIdx: 0, history: [], target }), { load: 30, reps: 10 });
  assert.deepEqual(plannedInput({ exId: 'curl-cable', ex, setIdx: 3, history: [], target }), { load: 30, reps: 11 });
  // Cible pas encore chargée : repMin
  assert.deepEqual(plannedInput({ exId: 'curl-cable', ex, setIdx: 0 }), { load: 0, reps: 10 });
  assert.equal(targetReps({ repMin: undefined }, null, 0), 10);
  assert.equal(targetLoad(ex, { load: null }, [entry('x', 'normale', 17.5, [10])]), 17.5);
});

test('pré-remplissage : exo en reps, charge toujours 0', () => {
  const history = [entry('2026-10-07', 'normale', 5, [18, 20, 16])];
  assert.deepEqual(prefill('reverse-crunch', 1, { history }), { load: 0, reps: 20 });
  assert.deepEqual(prefill('reverse-crunch', 1, { history, sets: [done('reverse-crunch', 0, 12, 18)] }), { load: 0, reps: 20 });
});

// ---------- Offre « + 1 série » ----------

test('offre « + 1 série » : seulement après la dernière série de l\'exo', () => {
  const p = program();
  const s = sessionOf(p, 'epaule-bras');
  let steps = buildSteps(s, p, newLog());
  const at = (key) => steps.find((x) => x.key === key);
  assert.equal(isLastSetOf(steps, at('developpe-barre#2')), false);
  assert.equal(isLastSetOf(steps, at('developpe-barre#3')), true);
  assert.equal(isLastSetOf(steps, at('elevation-laterale#2')), true);
  assert.equal(isLastSetOf(steps, at('oiseau-incline#1')), false);

  steps = buildSteps(s, p, newLog({ extraSets: { 'elevation-laterale': 1 } }));
  assert.equal(isLastSetOf(steps, at('elevation-laterale#2')), false);
  assert.equal(isLastSetOf(steps, at('elevation-laterale#3')), true);
  assert.equal(isLastSetOf(steps, at('oiseau-incline#2')), true);
});

// ---------- Repos ----------

test('groupe affiché au repos : exos du tour de superset qui restent à faire', () => {
  const p = program();
  const s = sessionOf(p, 'epaule-bras');
  const log = newLog();
  const steps = buildSteps(s, p, log);
  const at = (key) => steps.find((x) => x.key === key);
  const keys = (g) => g.map((x) => x.key);

  assert.deepEqual(keys(restGroup(steps, log, at('elevation-laterale#1'))), ['elevation-laterale#1', 'oiseau-incline#1']);
  log.sets = [done('elevation-laterale', 1)];
  assert.deepEqual(keys(restGroup(steps, log, at('oiseau-incline#1'))), ['oiseau-incline#1']);
  // Exo simple : lui seul ; rien en cours : rien
  assert.deepEqual(keys(restGroup(steps, log, at('developpe-barre#0'))), ['developpe-barre#0']);
  assert.deepEqual(restGroup(steps, log, null), []);
});

test('superset : charge à préparer pour l\'autre exo', () => {
  const p = program();
  const s = sessionOf(p, 'epaule-bras');
  const steps = buildSteps(s, p, newLog({ extraSets: { 'elevation-laterale': 1 } }));
  const at = (key) => steps.find((x) => x.key === key);
  assert.equal(partnerStep(steps, at('elevation-laterale#1'), 'oiseau-incline').key, 'oiseau-incline#1');
  // Tour sans partenaire : sa dernière série
  assert.equal(partnerStep(steps, at('elevation-laterale#3'), 'oiseau-incline').key, 'oiseau-incline#2');
});

// ---------- Migration ----------

test('migration reverse-crunch : remplace crunch dans les blocs, idempotente', () => {
  const m = MIGRATIONS.find((x) => x.id === '2026-10-06-reverse-crunch');
  assert.ok(m);
  // Base installée avant la migration : crunch dans le bloc, pas de reverse-crunch
  const old = program();
  delete old.exercises['reverse-crunch'];
  sessionOf(old, 'pec-dos').blocks[4].exercises = ['crunch'];
  sessionOf(old, 'epaule-bras').blocks.push({ id: 'x', type: 'superset', exercises: ['curl-cable', 'crunch'] });

  m.apply(old);
  assert.deepEqual(sessionOf(old, 'pec-dos').blocks[4].exercises, ['reverse-crunch']);
  assert.deepEqual(sessionOf(old, 'epaule-bras').blocks.at(-1).exercises, ['curl-cable', 'reverse-crunch']);
  assert.deepEqual(old.exercises['reverse-crunch'], PROGRAM.exercises['reverse-crunch']);
  assert.ok(old.exercises.crunch, 'crunch reste au programme pour son historique');
  assert.ok(!JSON.stringify(old.sessions).includes('"crunch"'));

  // Copie, pas une référence au programme d'origine
  old.exercises['reverse-crunch'].sets = 5;
  assert.equal(PROGRAM.exercises['reverse-crunch'].sets, 3);

  // Deuxième passage : rien ne bouge, réglages faits à la main conservés
  const before = structuredClone(old);
  m.apply(old);
  assert.deepEqual(old, before);
  assert.equal(old.exercises['reverse-crunch'].sets, 5);
});
