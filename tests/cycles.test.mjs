import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAM, REFERENCE_LOGS } from '../js/program.js';
import { CYCLES, EXERCISES } from '../js/cycles-data.js';
import {
  resolveCycles, dayPlan, nextPlanned, testsInWeek, testsForLog, nextChallenge, nextRace, evaluateTest, hyroxClassOn, blockAt,
} from '../js/cycles.js';
import { buildProgram, splitEdits, applyAdjust } from '../js/layers.js';
import { suggest } from '../js/progression.js';
import { plannedInput } from '../js/session/prefill.js';
import { buildSteps, estimateMinutes } from '../js/session/steps.js';
import { detectRecord, recordExcluded } from '../js/records.js';
import { validateProgram } from '../js/settings.js';

const R = resolveCycles();
const day = (iso, r = R) => dayPlan(r, iso);
const stored = () => structuredClone(PROGRAM);
const prog = (sourceId, opts = {}) => buildProgram({ stored: opts.stored || stored(), edits: opts.edits || {}, cycles: R, sourceId });
const sess = (p, id) => p.sessions.find((s) => s.id === id && !s.borrowed);
const exIds = (s) => [...new Set(s.blocks.flatMap((b) => b.exercises))];

// ---------- Bloc actif et séance du jour ----------

test('bloc actif selon la date', () => {
  assert.equal(day('2026-10-06').block.id, 'b0-actuel');
  assert.equal(day('2026-10-11').block.id, 'b0-actuel');
  assert.equal(day('2026-10-12').block.id, 'b1-derniere-charge');
  assert.equal(day('2026-11-01').block.id, 'b1-derniere-charge');
  assert.equal(day('2026-11-04').block.id, 'b2-atlas');
  assert.equal(day('2026-11-30').block.id, 'b3-fondations');
  assert.equal(day('2026-12-24').block.id, 'treve');
  assert.equal(day('2027-01-12').block.id, 'b4-moteur');
  assert.equal(day('2027-02-03').block.id, 'b5-duo');
  assert.equal(day('2027-03-01').block.id, 'apres');
  assert.deepEqual([day('2026-10-21').week.index, day('2026-10-21').week.count], [2, 3]);
});

test('cette semaine : jambes lourdes mercredi 07/10, Hyrox jeudi, Épaule/Bras vendredi avec 2 min au développé', () => {
  const d7 = day('2026-10-07');
  assert.equal(d7.sessionId, 'jambes');
  assert.equal(d7.weekType, 'lourde');
  assert.equal(d7.from, 'b0-actuel');
  assert.equal(day('2026-10-08').sessionId, null);
  assert.ok(day('2026-10-08').hyrox);
  const d9 = day('2026-10-09');
  assert.equal(d9.sessionId, 'epaule-bras');
  assert.equal(d9.adjust.blockRest.eb1, 120);
  // Programme actuel inchangé avant le 12/10
  assert.deepEqual(sess(prog('b0-actuel'), 'pec-dos'), { ...structuredClone(PROGRAM.sessions[0]), source: 'b0-actuel' });
});

test('schedule S13 : Hyrox lundi 12/10 sans jambes, jambes moyenne jeudi 15/10', () => {
  const d12 = day('2026-10-12');
  assert.equal(d12.sessionId, null);
  assert.ok(d12.hyrox);
  assert.match(d12.note, /Hyrox/);
  const d15 = day('2026-10-15');
  assert.equal(d15.sessionId, 'jambes');
  assert.equal(d15.weekType, 'moyenne');
  assert.equal(d15.hyrox, false);
  assert.equal(day('2026-10-14').sessionId, 'pec-dos');
  assert.equal(day('2026-10-19').sessionId, 'jambes');
  // Prochaine séance vue du lundi 12/10 : mercredi Pec/Dos
  assert.equal(nextPlanned(R, '2026-10-12').sessionId, 'pec-dos');
});

test('cours Hyrox : dernier le 22/10, aucun jusqu\'au semi, reprise le jeudi', () => {
  assert.ok(hyroxClassOn('2026-10-22'));
  assert.equal(hyroxClassOn('2026-10-29'), false);
  assert.equal(hyroxClassOn('2026-11-19'), false);
  assert.ok(hyroxClassOn('2026-11-26'));
  assert.equal(hyroxClassOn('2027-02-11', '2027-02-13'), false); // 2 jours avant la course
});

test('Maroc, semaine du semi, Noël', () => {
  assert.equal(day('2026-11-04').sessionId, 'atlas-a');
  assert.equal(day('2026-11-11').sessionId, null);
  const d13 = day('2026-11-13');
  assert.deepEqual([d13.sessionId, d13.from, d13.adjust.loadFactor], ['epaule-bras', 'b1-derniere-charge', 0.9]);
  assert.equal(day('2026-11-18').adjust.sets, 2);
  assert.equal(day('2026-11-16').sessionId, null);
  assert.equal(day('2026-11-16').weekType, 'aucune');
  assert.equal(day('2026-11-23').sessionId, null);
  assert.equal(day('2026-12-23').sessionId, 'treve-a');
  const d28 = day('2026-12-28');
  assert.deepEqual([d28.sessionId, d28.source, d28.adjust.loadFactor], ['jambes', 'b3-fondations', 0.9]);
});

test('après le semi : rampe jambes du bloc Fondations (weeks[].factor), pas weekInfo', () => {
  assert.deepEqual([day('2026-11-30').weekType, day('2026-11-30').legFactor], ['normale', 0.6]);
  assert.equal(day('2026-12-07').legFactor, 0.8);
  assert.equal(day('2026-12-14').legFactor, undefined);
  assert.equal(day('2026-11-25').weekType, 'aucune');
});

// ---------- Recalcul à rebours ----------

test('date du Hyrox : Moteur et Duo recalculés à rebours', () => {
  const at = (h) => Object.fromEntries(resolveCycles(CYCLES, { hyroxDate: h }).filter((b) => b.start >= '2027').map((b) => [b.id, [b.start, b.end, b.weeks.length]]));
  assert.deepEqual(at('2027-02-13')['b4-moteur'], ['2027-01-04', '2027-01-24', 3]);
  assert.deepEqual(at('2027-02-13')['b5-duo'], ['2027-01-25', '2027-02-14', 3]);
  assert.deepEqual(at('2027-02-06')['b4-moteur'], ['2027-01-04', '2027-01-17', 2]);
  assert.deepEqual(at('2027-02-27')['b4-moteur'], ['2027-01-04', '2027-02-07', 5]);
  // Mars : Moteur 3 semaines puis Moteur II
  const mars = at('2027-03-20');
  assert.deepEqual(mars['b4-moteur'], ['2027-01-04', '2027-01-24', 3]);
  assert.deepEqual(mars['b4b-moteur-2'], ['2027-01-25', '2027-02-28', 5]);
  // Fin janvier : plus de Moteur, le Duo commence le 04/01 avec une semaine 1 en plus
  const jan = at('2027-01-30');
  assert.equal(jan['b4-moteur'], undefined);
  assert.deepEqual(jan['b5-duo'], ['2027-01-04', '2027-01-31', 4]);
  // Les dates relatives suivent : répétition générale et défis
  const r = resolveCycles(CYCLES, { hyroxDate: '2027-02-27' });
  assert.equal(dayPlan(r, '2027-02-15').sessionId, 'repetition-generale');
  assert.equal(dayPlan(r, '2027-02-27').note, 'Hyrox duo mixte');
  assert.equal(r.find((b) => b.id === 'b4-moteur').tests.find((t) => t.id === 'b4-traction').date, '2027-02-03');
  // Fondations et Trêve ne bougent pas
  assert.equal(blockAt(r, '2026-12-20').id, 'b3-fondations');
});

// ---------- Défis ----------

test('défis : semaine défi, séance concernée, prochain défi, prochaine course', () => {
  assert.deepEqual(testsInWeek(R, '2026-10-28').map((t) => t.id), ['b1-jambes', 'b1-traction', 'b1-developpe']);
  assert.equal(testsInWeek(R, '2026-10-20').length, 0);
  assert.equal(nextChallenge(R, '2026-10-13').id, 'b1-jambes');
  const pd = sess(prog('b1-derniere-charge'), 'pec-dos');
  const log = { date: '2026-10-29', sessionId: 'pec-dos', sets: [] };
  assert.deepEqual(testsForLog(R, log, exIds(pd)).map((t) => t.id), ['b1-traction']);
  assert.deepEqual(nextRace('2026-10-06'), { name: 'Semi', date: '2026-11-22', inDays: 47 });
  assert.equal(nextRace('2026-11-23', '2027-02-13').name, 'Hyrox');
});

test('défis : verdicts', () => {
  const t = (id) => R.flatMap((b) => b.tests).find((x) => x.id === id);
  const set = (exerciseId, load, reps, setIndex = 0) => ({ exerciseId, load, reps, setIndex });
  assert.equal(evaluateTest(t('b1-traction'), { sets: [set('traction-pronation', 0, 11)] }).status, 'success');
  assert.equal(evaluateTest(t('b1-traction'), { sets: [set('traction-pronation', 0, 10)] }).status, 'fail');
  assert.equal(evaluateTest(t('b1-traction'), { sets: [] }).status, 'none');
  const dev = (reps) => ({ sets: reps.map((r, i) => set('developpe-barre', 32.5, r, i)) });
  assert.equal(evaluateTest(t('b1-developpe'), dev([6, 6, 6, 6])).status, 'success');
  assert.equal(evaluateTest(t('b1-developpe'), dev([6, 6, 6, 5])).status, 'fail');
  // Battre la séance du 07/10, sinon les références du 01/10
  const refLog = REFERENCE_LOGS.find((l) => l.id === 'ref-jambes');
  const legs = (fentes, step) => ({ sets: [...fentes.map((r, i) => set('fentes-marchees', 40, r, i)), ...step.map((r, i) => set('step-up', 20, r, i))] });
  assert.equal(evaluateTest(t('b1-jambes'), legs([12, 13, 12], [12, 12, 12, 12]), { refLog }).status, 'success');
  assert.equal(evaluateTest(t('b1-jambes'), legs([12, 12, 12], [12, 12, 12, 12]), { refLog }).status, 'fail');
  // Mini-défi du 09/10, référence en dur
  assert.equal(evaluateTest(t('b0-developpe'), { sets: [8, 7, 6, 5].map((r, i) => set('developpe-barre', 30, r, i)) }).status, 'success');
  // Chrono : la première mesure sert de référence, ensuite plus bas = mieux
  const wb = { sets: [set('wallball-50', 0, 170)] };
  assert.equal(evaluateTest(t('b3-wallball'), wb).status, 'reference');
  assert.equal(evaluateTest(t('b3-wallball'), wb, { previousTimes: [180] }).status, 'success');
});

// ---------- Programme par couches ----------

test('bloc 1 : supersets au même poste, ancres seules à 2 min, rowing poulie basse supprimé', () => {
  const p = prog('b1-derniere-charge');
  const pd = sess(p, 'pec-dos');
  assert.deepEqual(pd.blocks.filter((b) => b.type === 'superset').map((b) => b.exercises),
    [['chest-row-incline', 'pompes'], ['tirage-poulie-haute-1bras', 'ecarte-poulie']]);
  assert.ok(!JSON.stringify(p.sessions).includes('rowing-poulie-basse'));
  assert.deepEqual(pd.blocks.slice(0, 2).map((b) => [b.type, b.rest, !!b.cue]), [['single', 120, true], ['single', 120, true]]);
  assert.equal(p.exercises['traction-pronation'].sets, 4);
  assert.equal(p.exercises['chest-row-incline'].name, PROGRAM.exercises['chest-row-incline'].name);
  // Séance jambes identique à celle d'aujourd'hui jusqu'au semi
  const { source, ...legs } = sess(p, 'jambes');
  assert.deepEqual({ ...legs, weekday: 1, fromBase: true }, { ...structuredClone(PROGRAM.sessions[2]), weekday: 1, fromBase: true });
});

test('tous les blocs : programmes valides, exercices connus, ancres au même id', () => {
  const anchors = ['developpe-barre', 'traction-pronation', 'dc-incline-halteres', 'elevation-laterale', 'fentes-marchees'];
  for (const b of R) {
    const p = prog(b.sessionsFrom || b.id);
    assert.deepEqual(validateProgram(p), [], b.id);
    for (const s of p.sessions) for (const id of exIds(s)) assert.ok(p.exercises[id], `${b.id}/${s.id} : ${id}`);
  }
  for (const id of anchors) assert.ok(!EXERCISES[id], `${id} garde sa définition d'origine`);
  assert.ok(JSON.stringify(sess(prog('b4-moteur'), 'jambes')).includes('wallball-thruster'));
});

test('migration : programme déjà modifié à la main appliqué aux blocs, rien de perdu', () => {
  const old = stored();
  old.exercises['dc-incline-halteres'].name = 'DC incliné (banc 3)';
  old.exercises['dc-incline-halteres'].increment = 2.5;
  old.exercises['traction-pronation'].sets = 5;
  old.exercises['elevation-laterale'].note = 'Coudes hauts';
  old.sessions.find((s) => s.id === 'jambes').blocks[0].rest = 150;
  old.sessions.find((s) => s.id === 'epaule-bras').blocks[1].rest = 60; // élévation + oiseau
  const before = structuredClone(old);
  const p1 = prog('b1-derniere-charge', { stored: old });
  assert.equal(p1.exercises['dc-incline-halteres'].name, 'DC incliné (banc 3)');
  assert.equal(p1.exercises['dc-incline-halteres'].increment, 2.5);
  assert.equal(p1.exercises['elevation-laterale'].note, 'Coudes hauts');
  assert.equal(p1.exercises['traction-pronation'].sets, 4, 'le format du bloc l\'emporte sur un réglage antérieur');
  assert.equal(sess(p1, 'jambes').blocks[0].rest, 150);
  // Bloc 3 : même paire élévation + oiseau, repos réglé à la main repris ; ancre prescrite à 2 min gardée
  const p3 = prog('b3-fondations', { stored: old });
  assert.equal(sess(p3, 'epaule-bras').blocks[1].rest, 60);
  assert.equal(sess(p3, 'epaule-bras').blocks[0].rest, 120);
  // Le programme enregistré n'est jamais modifié par la lecture
  assert.deepEqual(old, before);
  assert.deepEqual(prog('b0-actuel', { stored: old }).sessions.map(({ source, ...s }) => s), old.sessions);
});

test('réglages : chaque modification va dans la bonne couche, aller-retour stable', () => {
  const base = stored();
  const p = prog('b1-derniere-charge', { stored: base });
  const edited = structuredClone(p);
  edited.exercises['traction-pronation'].sets = 5; // champ fixé par le bloc → retouche du bloc
  edited.exercises['pompes'].name = 'Pompes au sol'; // champ libre → réglage global
  sess(edited, 'pec-dos').blocks[2].rest = 100; // repos d'un bloc du cycle
  sess(edited, 'jambes').blocks[1].rest = 75; // séance jambes reprise telle quelle → programme enregistré
  const { stored: s2, edits } = splitEdits({ edited, stored: base, edits: {}, cycles: R, sourceId: 'b1-derniere-charge' });
  assert.deepEqual(edits['b1-derniere-charge'].exercises, { 'traction-pronation': { sets: 5 } });
  assert.equal(edits['b1-derniere-charge'].blockRest['pec-dos:pd3'], 100);
  assert.equal(s2.exercises.pompes.name, 'Pompes au sol');
  assert.equal(s2.exercises['traction-pronation'].sets, PROGRAM.exercises['traction-pronation'].sets);
  assert.equal(s2.sessions.find((s) => s.id === 'jambes').blocks[1].rest, 75);
  const again = prog('b1-derniere-charge', { stored: s2, edits });
  assert.equal(again.exercises['traction-pronation'].sets, 5);
  assert.equal(again.exercises.pompes.name, 'Pompes au sol');
  assert.equal(sess(again, 'pec-dos').blocks[2].rest, 100);
  // Bloc suivant : retouche du bloc 1 sans effet, nom global conservé
  const p3 = prog('b3-fondations', { stored: s2, edits });
  assert.equal(p3.exercises['traction-pronation'].sets, 4);
  // Rien à ranger si rien ne change
  const same = splitEdits({ edited: again, stored: s2, edits, cycles: R, sourceId: 'b1-derniere-charge' });
  assert.deepEqual(same, { stored: s2, edits });
  // Avant le 12/10, comportement d'origine : tout va dans le programme enregistré
  const p0 = prog('b0-actuel', { stored: base });
  p0.exercises['developpe-barre'].sets = 5;
  p0.sessions.find((s) => s.id === 'epaule-bras').rest = 80;
  const r0 = splitEdits({ edited: p0, stored: base, edits: {}, cycles: R, sourceId: 'b0-actuel' });
  assert.equal(r0.stored.exercises['developpe-barre'].sets, 5);
  assert.equal(r0.stored.sessions.find((s) => s.id === 'epaule-bras').rest, 80);
  assert.deepEqual(r0.edits, {});
});

test('ajustements : rappel à 2 séries, reprise à 90 %, affûtage sans circuit, bloc ajouté', () => {
  const p1 = prog('b1-derniere-charge');
  const { program, session } = applyAdjust(p1, sess(p1, 'pec-dos'), { sets: 2 });
  assert.ok(exIds(session).every((id) => program.exercises[id].sets === 2));
  assert.equal(p1.exercises['traction-pronation'].sets, 4, 'pas de mutation');
  const p5 = prog('b5-duo');
  const aff = applyAdjust(p5, sess(p5, 'jambes'), { volume: 0.5, dropTypes: ['circuit'] });
  assert.equal(aff.session.blocks.length, 2);
  assert.equal(aff.program.exercises['fentes-marchees'].sets, 2);
  const p4 = prog('b4-moteur');
  const ch = applyAdjust(p4, sess(p4, 'jambes'), day('2027-01-18').adjust);
  assert.equal(ch.session.blocks.at(-1).exercises[0], 'fentes-100m');
  // Borrowed : le bloc Atlas liste les séances du bloc 1 reprises
  assert.deepEqual(prog('b2-atlas').sessions.filter((s) => s.borrowed).map((s) => [s.id, s.source]),
    [['epaule-bras', 'b1-derniere-charge'], ['pec-dos', 'b1-derniere-charge']]);
});

test('EMOM et circuit : étapes de séance', () => {
  const p4 = prog('b4-moteur');
  const emom = buildSteps(sess(p4, 'jambes'), p4, { sets: [] }).filter((s) => s.kind === 'emom');
  assert.equal(emom.length, 10);
  const p5 = prog('b5-duo');
  const circ = buildSteps(sess(p5, 'jambes'), p5, { sets: [] }).filter((s) => s.blockIdx === 2);
  assert.equal(circ.length, 12);
  assert.deepEqual(circ.slice(0, 4).map((s) => s.rest), [0, 0, 0, 120]);
  const pa = prog('b2-atlas');
  const atlas = buildSteps(sess(pa, 'atlas-a'), pa, { sets: [] });
  assert.ok(atlas.every((s) => s.rest === 60));
});

test('durée estimée des séances de salle : 45 à 60 min', () => {
  for (const id of ['b1-derniere-charge', 'b3-fondations', 'b4-moteur']) {
    const p = prog(id);
    for (const s of p.sessions.filter((x) => ['pec-dos', 'epaule-bras', 'jambes'].includes(x.id) && !x.borrowed)) {
      const m = estimateMinutes(s, p);
      assert.ok(m >= 40 && m <= 60, `${id}/${s.id} : ${m} min`);
    }
  }
});

// ---------- Pré-remplissage et suggestions ----------

test('pré-remplissage : nouvel exercice → charge de départ du bloc, sinon cible de suggest', () => {
  const p = prog('b1-derniere-charge');
  const pre = (id) => {
    const ex = p.exercises[id];
    return plannedInput({ exId: id, ex, setIdx: 0, history: [], target: suggest(ex, [], 'moyenne') });
  };
  assert.deepEqual(pre('curl-marteau-halteres'), { load: 12, reps: 10 });
  assert.deepEqual(pre('pushdown-corde'), { load: 25, reps: 10 });
  assert.deepEqual(pre('ecarte-poulie'), { load: 0, reps: 12 });
  assert.deepEqual(pre('pompes'), { load: 0, reps: 10 });
  assert.match(suggest(p.exercises['curl-incline'], [], 'normale').reason, /départ/);
});

test('rampe et reprise : charge réduite, et ces séances ne servent pas de base', () => {
  const ex = PROGRAM.exercises['leg-curl'];
  const hist = [{ logId: 'a', date: '2026-10-26', weekType: 'lourde', sets: [{ load: 65, reps: 10 }, { load: 65, reps: 10 }, { load: 65, reps: 10 }] }];
  assert.equal(suggest(ex, hist, 'normale', { legFactor: 0.6 }).load, 35);
  assert.equal(plannedInput({ exId: 'leg-curl', ex, setIdx: 0, history: hist, weekType: 'normale', factors: { legFactor: 0.8 } }).load, 50);
  const after = [...hist, { logId: 'b', date: '2026-11-30', weekType: 'normale', legFactor: 0.6, sets: [{ load: 35, reps: 12 }] }];
  assert.equal(suggest(ex, after, 'normale').load, 65);
  // Reprise à 90 % sur un exo qui n'ondule pas, puis retour à la base pleine charge
  const dc = PROGRAM.exercises['dc-incline-halteres'];
  const h2 = [{ logId: 'c', date: '2026-10-28', weekType: 'lourde', sets: [{ load: 26, reps: 10 }] }];
  assert.equal(suggest(dc, h2, 'aucune', { loadFactor: 0.9 }).load, 22);
  const h3 = [...h2, { logId: 'd', date: '2026-11-13', weekType: 'aucune', loadFactor: 0.9, sets: [{ load: 22, reps: 12 }] }];
  assert.equal(suggest(dc, h3, 'normale').load, 26);
});

test('records en direct : e1RM, reps à charge égale, exclusions', () => {
  const dc = PROGRAM.exercises['dc-incline-halteres'];
  const hist = [{ sets: [{ load: 26, reps: 10 }, { load: 26, reps: 8 }] }];
  assert.equal(detectRecord(dc, { load: 28, reps: 9 }, hist).kind, 'e1rm');
  assert.equal(detectRecord(dc, { load: 26, reps: 10 }, hist), null);
  assert.equal(detectRecord(dc, { load: 24, reps: 12 }, [{ sets: [{ load: 26, reps: 10 }, { load: 24, reps: 11 }] }]).kind, 'reps');
  assert.equal(detectRecord(dc, { load: 28, reps: 9 }, []), null, 'première fois : pas de record');
  // Une série déjà record dans la séance relève la barre
  assert.equal(detectRecord(dc, { load: 28, reps: 9 }, hist, [{ load: 28, reps: 10 }]), null);
  const trac = PROGRAM.exercises['traction-pronation'];
  assert.equal(detectRecord(trac, { load: 0, reps: 9 }, [{ sets: [{ load: 0, reps: 8 }] }]).text, 'Record : 9 reps');
  const fentes = PROGRAM.exercises['fentes-marchees'];
  assert.ok(recordExcluded(fentes, { weekType: 'moyenne' }));
  assert.ok(recordExcluded(fentes, { weekType: 'normale', legFactor: 0.6 }));
  assert.ok(!recordExcluded(dc, { weekType: 'moyenne' }));
  assert.ok(recordExcluded(dc, { weekType: 'aucune', adjust: { loadFactor: 0.9 } }));
  assert.ok(recordExcluded(EXERCISES['farmer-carry'], { weekType: 'normale' }));
});
