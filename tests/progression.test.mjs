import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAM, REFERENCE_LOGS } from '../js/program.js';
import {
  WEEK_TYPES, weekInfo, sessionForDate, roundLoad, e1rm, suggest, sessionVolume,
} from '../js/progression.js';

const ex = (id) => PROGRAM.exercises[id];

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

test('weekInfo : calendrier du plan semi', () => {
  assert.deepEqual(
    [weekInfo('2026-10-02').week, weekInfo('2026-10-02').type], ['S11', 'legere']);
  assert.deepEqual(
    [weekInfo('2026-10-05').week, weekInfo('2026-10-05').type], ['S12', 'lourde']);
  assert.deepEqual(
    [weekInfo('2026-10-14').week, weekInfo('2026-10-14').type], ['S13', 'moyenne']);
  assert.deepEqual(
    [weekInfo('2026-11-04').week, weekInfo('2026-11-04').type], ['S16', 'aucune']);
  assert.deepEqual(
    [weekInfo('2026-11-22').week, weekInfo('2026-11-22').type], ['S18', 'aucune']);
  const after = weekInfo('2026-11-23');
  assert.equal(after.type, 'normale');
  assert.equal(after.week, null);
});

test('weekInfo : bornes, objet Date local et libellés', () => {
  assert.equal(weekInfo('2026-07-20').week, 'S1');
  assert.equal(weekInfo('2026-07-20').type, 'normale');
  assert.equal(weekInfo('2026-08-24').week, 'S6');
  assert.equal(weekInfo('2026-08-23').week, 'S5');
  assert.equal(weekInfo('2026-07-19').week, null);
  assert.equal(weekInfo(new Date(2026, 9, 5, 23, 59)).week, 'S12');
  assert.equal(weekInfo(new Date(2026, 9, 4, 0, 1)).week, 'S11');
  const info = weekInfo('2026-11-18');
  assert.equal(info.label, 'Pas de jambes');
  assert.match(info.note, /semi/);
  assert.equal(weekInfo('2026-10-02').label, WEEK_TYPES.legere.label);
});

test('sessionForDate', () => {
  assert.equal(sessionForDate('2026-10-05', PROGRAM), 'jambes');
  assert.equal(sessionForDate('2026-10-07', PROGRAM), 'pec-dos');
  assert.equal(sessionForDate('2026-10-02', PROGRAM), 'epaule-bras');
  assert.equal(sessionForDate('2026-10-04', PROGRAM), null);
});

test('roundLoad, e1rm, sessionVolume', () => {
  assert.equal(roundLoad(39, 5), 35);
  assert.equal(roundLoad(40, 5), 40);
  assert.equal(roundLoad(7.5, 2.5), 7.5);
  assert.equal(roundLoad(0.1 + 0.2 + 7.2, 2.5), 7.5);
  assert.equal(roundLoad(25.5, 2.5), 25);
  assert.equal(roundLoad(13.3, 0), 13.3);
  assert.equal(e1rm(0, 10), 0);
  assert.equal(e1rm(30, 30), 60);
  assert.equal(sessionVolume({ sets: [{ load: 20, reps: 10 }, { load: 0, reps: 8 }] }), 200);
});

test('suggest : tirage un bras 14/14/14 → hold vers 15/15/15', () => {
  const r = suggest(ex('tirage-un-bras'), refHistory('tirage-un-bras'), 'legere');
  assert.equal(r.action, 'hold');
  assert.equal(r.load, 24);
  assert.deepEqual(r.reps, [15, 15, 15]);
  assert.equal(r.reason, 'Même charge, vise +1 rep');
});

test('suggest : chest row 12/13/14 → 13/14/15', () => {
  const r = suggest(ex('chest-row-incline'), refHistory('chest-row-incline'), 'normale');
  assert.equal(r.action, 'hold');
  assert.equal(r.load, 22);
  assert.deepEqual(r.reps, [13, 14, 15]);
});

test('suggest : toutes les séries au plafond → increase', () => {
  const hist = [...refHistory('tirage-un-bras'), entry('2026-10-07', 'legere', 24, [15, 15, 15])];
  const r = suggest(ex('tirage-un-bras'), hist, 'lourde');
  assert.equal(r.action, 'increase');
  assert.equal(r.load, 26);
  assert.deepEqual(r.reps, [10, 10, 10]);
  assert.equal(r.reason, 'Toutes les séries à 15 : on monte à 26 kg');
});

test('suggest : increment 2,5 sans erreur flottante', () => {
  const hist = [entry('2026-10-09', 'normale', 32.5, [15, 15, 15])];
  const r = suggest(ex('curl-cable'), hist, 'normale');
  assert.equal(r.load, 35);
  assert.equal(r.reason, 'Toutes les séries à 15 : on monte à 35 kg');
});

test('suggest : leg curl en semaine légère (65 × 0,6 = 39 → 35)', () => {
  const r = suggest(ex('leg-curl'), refHistory('leg-curl'), 'legere');
  assert.equal(r.action, 'undulate');
  assert.equal(r.load, 35);
  assert.deepEqual(r.reps, [9, 10, 10]);
  assert.equal(r.reason, 'Semaine légère : 60 % de la charge de base');
});

test('suggest : semaine moyenne → 85 %', () => {
  const r = suggest(ex('fentes-marchees'), refHistory('fentes-marchees'), 'moyenne');
  assert.equal(r.action, 'undulate');
  assert.equal(r.load, 32); // 40 × 0,85 = 34 → pas de 4 → 32
  assert.deepEqual(r.reps, [12, 12, 12]);
});

test('suggest : sans historique → first', () => {
  const r = suggest(ex('dc-incline-halteres'), [], 'normale');
  assert.equal(r.action, 'first');
  assert.equal(r.load, null);
  assert.deepEqual(r.reps, [8, 8, 8]);
  assert.ok(r.reason.length > 0);
});

test('suggest : la base ignore une dernière entrée en semaine légère', () => {
  const hist = [
    ...refHistory('leg-curl'),
    entry('2026-10-12', 'lourde', 65, [10, 11, 11]),
    entry('2026-10-26', 'legere', 35, [12, 12, 12]),
  ];
  const heavy = suggest(ex('leg-curl'), hist, 'lourde');
  assert.equal(heavy.action, 'hold');
  assert.equal(heavy.load, 65);
  assert.deepEqual(heavy.reps, [11, 12, 12]);

  const medium = suggest(ex('leg-curl'), hist, 'moyenne');
  assert.equal(medium.load, 55); // 65 × 0,85 = 55,25 → 55
  assert.deepEqual(medium.reps, [10, 11, 11]);
});

test('suggest : exo sans ondulation progresse aussi sur une séance de semaine légère', () => {
  const hist = [...refHistory('chest-row-incline'), entry('2026-10-07', 'legere', 22, [13, 14, 15])];
  const r = suggest(ex('chest-row-incline'), hist, 'legere');
  assert.equal(r.action, 'hold');
  assert.deepEqual(r.reps, [14, 15, 15]);
});

test('suggest : séries manquantes complétées à repMin', () => {
  const hist = [entry('2026-10-01', 'normale', 30, [8, 7])];
  const r = suggest(ex('developpe-barre'), hist, 'normale');
  assert.equal(r.action, 'hold');
  assert.deepEqual(r.reps, [9, 8, 6, 6]);
});

test('suggest : traction au poids du corps', () => {
  const first = suggest(ex('traction-pronation'), [], 'normale');
  assert.equal(first.action, 'first');
  assert.equal(first.load, 0);
  assert.deepEqual(first.reps, [6, 6, 6]);

  const hold = suggest(ex('traction-pronation'), [entry('2026-10-07', 'normale', 0, [8, 7, 6])], 'normale');
  assert.equal(hold.action, 'hold');
  assert.equal(hold.load, 0);
  assert.deepEqual(hold.reps, [9, 8, 7]);

  const inc = suggest(ex('traction-pronation'), [entry('2026-10-07', 'normale', 0, [10, 10, 11])], 'normale');
  assert.equal(inc.action, 'increase');
  assert.equal(inc.load, 2.5);
  assert.deepEqual(inc.reps, [6, 6, 6]);
});

test('suggest : unit reps (crunch), charge toujours 0', () => {
  const first = suggest(ex('crunch'), [], 'normale');
  assert.equal(first.load, 0);
  assert.deepEqual(first.reps, [15, 15, 15]);
  const r = suggest(ex('crunch'), [entry('2026-10-07', 'normale', 0, [20, 25, 24])], 'normale');
  assert.equal(r.load, 0);
  assert.deepEqual(r.reps, [21, 25, 25]);
  const max = suggest(ex('crunch'), [entry('2026-10-07', 'normale', 0, [25, 25, 25])], 'normale');
  assert.equal(max.load, 0);
  assert.deepEqual(max.reps, [25, 25, 25]);
});

test('reasons sans tiret cadratin', () => {
  const all = [
    suggest(ex('leg-curl'), refHistory('leg-curl'), 'legere'),
    suggest(ex('tirage-un-bras'), refHistory('tirage-un-bras'), 'normale'),
    suggest(ex('dc-incline-halteres'), [], 'normale'),
  ];
  for (const r of all) assert.ok(!r.reason.includes('—'));
});
