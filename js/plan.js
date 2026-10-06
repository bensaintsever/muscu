// Lien entre les cycles (purs) et la base : programme actif du jour, séance d'un log, défis, réglages.
import * as db from './db.js';
import { CYCLES, CYCLES_DEFAULTS } from './cycles-data.js';
import * as cy from './cycles.js';
import { buildProgram, splitEdits, applyAdjust } from './layers.js';
import { REFERENCE_LOGS } from './program.js';
import { todayISO } from './clock.js';

export async function loadPlan() {
  const [stored, edits, hyroxSetting, override] = await Promise.all([
    db.getProgram(), db.getSetting('cycleEdits', {}), db.getSetting('hyroxDate', null), db.getSetting('weekTypeOverride', null),
  ]);
  const race = hyroxSetting || CYCLES_DEFAULTS.hyroxDate;
  return {
    stored, edits: edits || {}, override, race, provisional: !hyroxSetting,
    resolved: cy.resolveCycles(CYCLES, { hyroxDate: race }),
  };
}

// Plan du jour, avec le type de semaine forcé dans Réglages s'il y en a un.
export function dayOf(plan, iso = todayISO()) {
  const day = cy.dayPlan(plan.resolved, iso, { race: plan.race });
  if (plan.override) return { ...day, weekType: plan.override, legFactor: undefined, forced: true };
  return day;
}

export function programFor(plan, sourceId) {
  return buildProgram({ stored: plan.stored, edits: plan.edits, cycles: plan.resolved, sourceId });
}

// Programme listé un jour donné (séances du bloc en cours, séances empruntées comprises).
export async function activeProgram(iso = todayISO()) {
  const plan = await loadPlan();
  const day = dayOf(plan, iso);
  return { plan, day, program: programFor(plan, day.source) };
}

// Contexte figé dans le log au démarrage : la séance garde son bloc même si elle déborde sur le suivant.
export function startContext(day, session, { planned = false } = {}) {
  const adjust = { ...((planned ? day.adjust : day.week?.adjust) || {}), ...(session.adjust || {}) };
  return {
    cycleId: (planned ? day.from : null) || session.source || day.source,
    blockId: day.block.id,
    ...(day.legFactor < 1 ? { legFactor: day.legFactor } : {}),
    ...(Object.keys(adjust).length ? { adjust } : {}),
  };
}

// Programme et séance d'un log (en cours ou ancien), ajustements du jour appliqués.
export async function sessionForLog(log) {
  const plan = await loadPlan();
  let source = log.cycleId;
  if (!source) {
    const block = cy.blockAt(plan.resolved, log.date);
    source = cy.listSource(block, cy.weekAt(block, log.date));
  }
  const program = programFor(plan, source);
  const session = program.sessions.find((s) => s.id === log.sessionId && !s.borrowed)
    || program.sessions.find((s) => s.id === log.sessionId);
  if (!session) return { plan, program, session: null };
  return { plan, ...applyAdjust(program, session, log.adjust || {}) };
}

export async function saveEdits(plan, sourceId, edited) {
  const { stored, edits } = splitEdits({ edited, stored: plan.stored, edits: plan.edits, cycles: plan.resolved, sourceId });
  await db.saveProgram(stored);
  await db.setSetting('cycleEdits', edits);
  plan.stored = stored;
  plan.edits = edits;
}

// « Garder ce repos » pendant une séance : seul le repos du bloc change, rangé dans la bonne couche.
export async function saveBlockRest(log, sessionId, blockId, seconds) {
  const plan = await loadPlan();
  const source = log.cycleId || cy.listSource(cy.blockAt(plan.resolved, log.date), cy.weekAt(cy.blockAt(plan.resolved, log.date), log.date));
  const edited = programFor(plan, source);
  const s = edited.sessions.find((x) => x.id === sessionId && !x.borrowed);
  const b = s?.blocks.find((x) => x.id === blockId);
  if (!b) return false;
  b.rest = seconds;
  await saveEdits(plan, source, edited);
  return true;
}

export async function resetAll() {
  await db.resetProgram();
  await db.setSetting('cycleEdits', {});
}

// Pour Historique et Progression : tous les exercices et tous les noms de séance connus.
export async function catalogProgram(iso = todayISO()) {
  const { plan, program } = await activeProgram(iso);
  const sessionNames = {};
  for (const c of plan.resolved) {
    for (const s of programFor(plan, cy.listSource(c, null)).sessions) sessionNames[s.id] ??= s.name;
  }
  for (const s of program.sessions) sessionNames[s.id] = s.name;
  return { ...program, sessionNames };
}

const hasAny = (log, ids) => (log.sets || []).some((s) => ids.includes(s.exerciseId));

async function refLogFor(test, logs) {
  if (!test.refDate) return null;
  const same = logs.filter((l) => l.date === test.refDate && (!test.sessionId || l.sessionId === test.sessionId));
  if (same.length) return same[0];
  if (!test.fallbackRef) return null;
  return (await db.getLog(test.fallbackRef)) || REFERENCE_LOGS.find((l) => l.id === test.fallbackRef) || null;
}

function previousTimes(test, logs, beforeDate) {
  const ids = cy.testExerciseIds(test);
  return logs.filter((l) => l.date < beforeDate && hasAny(l, ids))
    .map((l) => l.sets.filter((s) => ids.includes(s.exerciseId)).reduce((a, s) => a + (Number(s.reps) || 0), 0));
}

// Verdict d'un défi pour une séance donnée.
export async function evaluateForLog(test, log, logs) {
  const all = logs || await db.listLogs();
  return cy.evaluateTest(test, log, {
    refLog: await refLogFor(test, all),
    previousTimes: previousTimes(test, all.filter((l) => l.id !== log.id), log.date),
  });
}

// Verdict d'un défi sur sa semaine : réussi si une séance de la semaine le réussit.
export async function weekVerdict(test, logs) {
  const mon = cy.mondayOf(test.date);
  const sun = cy.addDays(mon, 6);
  const ids = cy.testExerciseIds(test);
  const cands = logs.filter((l) => l.date >= mon && l.date <= sun && hasAny(l, ids) && (!test.sessionId || l.sessionId === test.sessionId));
  let best = { status: 'none' };
  for (const l of cands) {
    const r = await evaluateForLog(test, l, logs);
    if (r.status === 'success' || r.status === 'reference') return r;
    if (r.status === 'fail') best = r;
  }
  return best;
}

// Référence à battre affichée sur la carte défi (beatSession), sinon ''.
export async function refText(test) {
  if (test.kind !== 'beatSession') return '';
  const logs = await db.listLogs();
  const refLog = test.ref ? null : await refLogFor(test, logs);
  const names = buildProgram({ stored: await db.getProgram(), sourceId: 'b0-actuel' }).exercises;
  const parts = cy.testExerciseIds(test).map((id) => {
    const sets = test.ref?.[id]
      ? test.ref[id].reps.map((r) => ({ load: test.ref[id].load, reps: r }))
      : (refLog?.sets || []).filter((s) => s.exerciseId === id);
    if (!sets.length) return null;
    const load = Math.max(...sets.map((s) => Number(s.load) || 0));
    return `${names[id]?.name || id} ${String(load).replace('.', ',')} kg × ${sets.map((s) => s.reps).join('/')}`;
  }).filter(Boolean);
  if (!parts.length) return '';
  const when = refLog?.date && !refLog.isReference ? ` (${refLog.date.slice(8, 10)}/${refLog.date.slice(5, 7)})` : refLog?.isReference ? ' (références du 01/10)' : '';
  return `À battre${when} : ${parts.join(' · ')}`;
}
