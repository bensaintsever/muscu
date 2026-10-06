// Moteur des cycles : dates des blocs, séance prévue un jour donné, défis, comptes à rebours.
// Fonctions pures (dates en chaînes 'AAAA-MM-JJ'), importables dans Node.
import { CYCLES, CYCLES_DEFAULTS, HYROX_CLASS } from './cycles-data.js';
import { PROGRAM } from './program.js';
import { weekInfo } from './progression.js';

const DAY = 86400000;
const toNum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const toISO = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (iso, n) => toISO(toNum(iso) + n);
export const diffDays = (from, to) => toNum(to) - toNum(from);
export const weekdayOf = (iso) => ((new Date(toNum(iso) * DAY).getUTCDay() + 6) % 7) + 1;
export const mondayOf = (iso) => addDays(iso, 1 - weekdayOf(iso));

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

// Semaines d'un bloc à dates fixes ou générées depuis `start` (gabarit = semaines du bloc, la 1re répétée en tête si besoin).
function makeWeeks(def, start, end) {
  if (def.relative === 'apres') return [];
  if (!def.relative && def.weeks?.length) {
    return def.weeks.map((w) => ({ ...clone(w), end: addDays(w.start, 6) }));
  }
  const n = Math.max(1, Math.round((diffDays(start, end) + 1) / 7));
  const tpl = def.weeks || [];
  // Plus de semaines que le gabarit : la 1re est répétée en tête ; moins : on garde les dernières.
  const shift = tpl.length - n;
  return Array.from({ length: n }, (_, i) => {
    const t = tpl.length ? clone(tpl[Math.max(0, i + shift)]) : {};
    const ws = addDays(start, i * 7);
    return { ...t, index: i + 1, start: ws, end: addDays(ws, 6) };
  });
}

function dateOfRef(ref, weeks, race) {
  if (ref.date) return [ref.date];
  if (ref.race) return [race];
  if (ref.daysBeforeEvent) return ref.daysBeforeEvent.map((d) => addDays(race, -d));
  const w = ref.week === 'last' ? weeks.at(-1) : weeks[(ref.week || 1) - 1];
  return w ? [addDays(w.start, (ref.weekday || 1) - 1)] : [];
}

function finish(def, start, end, race, extra = {}) {
  const weeks = makeWeeks(def, start, end);
  const schedule = [];
  for (const e of def.schedule || []) {
    for (const date of dateOfRef(e, weeks, race)) {
      if (date >= start && date <= end) schedule.push({ ...clone(e), date, week: undefined, weekday: undefined, daysBeforeEvent: undefined });
    }
  }
  const cw = def.challenge?.week;
  const chWeeks = cw === 'last' ? [weeks.at(-1)] : cw ? [weeks[cw - 1]].filter(Boolean) : weeks;
  const tests = (def.challenge?.tests || []).map((t, i) => {
    const date = t.date || (t.race ? race : dateOfRef({ week: cw, weekday: t.weekday }, cw ? weeks : chWeeks, race)[0]);
    return { ...clone(t), id: t.id || `${def.id}:${i}`, blockId: def.id, date };
  }).filter((t) => t.date);
  return { ...clone(def), ...extra, start, end, weeks, schedule, tests };
}

// Calcule les dates de tous les blocs. Le Moteur s'étend du 04/01 à la veille du Duo ;
// moins de 2 semaines : il disparaît au profit du Duo ; plus de 5 : Moteur (3 sem.) puis Moteur II.
export function resolveCycles(cycles = CYCLES, { hyroxDate } = {}) {
  const race = hyroxDate || CYCLES_DEFAULTS.hyroxDate;
  const out = [];
  for (const c of cycles) if (!c.relative) out.push(finish(c, c.start, c.end, race));
  const moteur = cycles.find((c) => c.relative === 'moteur');
  const duo = cycles.find((c) => c.relative === 'duo');
  const apres = cycles.find((c) => c.relative === 'apres');
  const L0 = mondayOf(race);
  const mStart = CYCLES_DEFAULTS.moteurStart;
  let duoStart = addDays(L0, -14);
  const mWeeks = Math.round(diffDays(mStart, duoStart) / 7);
  if (mWeeks < 2) duoStart = mStart > L0 ? L0 : mStart;
  else if (moteur && mWeeks <= 5) out.push(finish(moteur, mStart, addDays(duoStart, -1), race));
  else if (moteur) {
    const split = addDays(mStart, 21);
    const first = { ...moteur, challenge: null, schedule: [] };
    out.push(finish(first, mStart, addDays(split, -1), race));
    out.push(finish({ ...moteur, id: 'b4b-moteur-2', name: 'Moteur II', sessionsFrom: moteur.id, intent: 'Même structure, ancres plus lourdes.' },
      split, addDays(duoStart, -1), race));
  }
  if (duo) out.push(finish(duo, duoStart, addDays(L0, 6), race, { event: { name: 'Hyrox duo mixte', date: race } }));
  if (apres) out.push(finish(apres, addDays(L0, 7), '2099-12-31', race));
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export function blockAt(resolved, iso) {
  return resolved.find((b) => b.start <= iso && iso <= b.end) || (iso < resolved[0].start ? resolved[0] : resolved.at(-1));
}

export function weekAt(block, iso) {
  const i = (block.weeks || []).findIndex((w) => w.start <= iso && iso <= w.end);
  return i < 0 ? null : { ...block.weeks[i], count: block.weeks.length };
}

const byId = (resolved, id) => resolved.find((b) => b.id === id);

// Bloc dont viennent les séances listées (Trêve semaine 2 : Fondations ; Moteur II : Moteur).
export function listSource(block, week) {
  return week?.sessionsFrom || block.sessionsFrom || block.id;
}

function sessionsOf(resolved, sourceId) {
  const src = byId(resolved, sourceId);
  if (!src) return [];
  return src.base ? PROGRAM.sessions : src.sessions || [];
}

export function semiDate() { return CYCLES_DEFAULTS.semiDate; }

// Type de semaine jambes : le plan semi (weekInfo) jusqu'au 22/11, puis la semaine du bloc.
export function legsFor(week, iso) {
  if (iso <= CYCLES_DEFAULTS.semiDate) return { weekType: weekInfo(iso).type, legFactor: undefined };
  return { weekType: week?.legs || 'normale', legFactor: week?.factor < 1 ? week.factor : undefined };
}

export function hyroxClassOn(iso, race = CYCLES_DEFAULTS.hyroxDate) {
  const h = HYROX_CLASS;
  if (h.skip.includes(iso)) return false;
  if (h.extra.includes(iso)) return true;
  if (weekdayOf(iso) !== h.weekday) return false;
  if (h.pauses.some(([a, b]) => a <= iso && iso <= b)) return false;
  const before = diffDays(iso, race);
  return !(before >= 0 && before < h.minDaysBeforeRace);
}

// Séance prévue un jour donné : remplacement ponctuel, sinon jour par défaut des séances du bloc.
export function dayPlan(resolved, iso, { race } = {}) {
  const block = blockAt(resolved, iso);
  const week = weekAt(block, iso);
  const source = listSource(block, week);
  const entry = (block.schedule || []).find((e) => e.date === iso) || null;
  let sessionId = null;
  let from = source;
  const adjust = { ...clone(week?.adjust || {}) };
  if (entry) {
    sessionId = entry.sessionId;
    if (entry.from) from = entry.from;
    Object.assign(adjust, clone(entry.adjust || {}));
  } else {
    const wd = weekdayOf(iso);
    const s = sessionsOf(resolved, source).find((x) => Number(x.weekday) === wd && !x.scheduledOnly);
    sessionId = s ? s.id : null;
  }
  return {
    iso, block, week, source, from, sessionId, adjust, note: entry?.note || null, scheduled: !!entry,
    ...legsFor(week, iso),
    hyrox: hyroxClassOn(iso, race),
  };
}

export function nextPlanned(resolved, iso, opts = {}, maxDays = 14) {
  for (let i = 1; i <= maxDays; i++) {
    const p = dayPlan(resolved, addDays(iso, i), opts);
    if (p.sessionId) return { ...p, inDays: i };
  }
  return null;
}

export const allTests = (resolved) => resolved.flatMap((b) => b.tests || []);

// Défis de la semaine qui contient `iso` (hors courses).
export function testsInWeek(resolved, iso) {
  const mon = mondayOf(iso);
  const sun = addDays(mon, 6);
  return allTests(resolved).filter((t) => t.kind !== 'event' && t.date >= mon && t.date <= sun);
}

export function nextChallenge(resolved, iso) {
  return allTests(resolved).filter((t) => t.kind !== 'event' && t.date >= iso).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
}

export function nextRace(iso, race = CYCLES_DEFAULTS.hyroxDate) {
  if (iso <= CYCLES_DEFAULTS.semiDate) return { name: 'Semi', date: CYCLES_DEFAULTS.semiDate, inDays: diffDays(iso, CYCLES_DEFAULTS.semiDate) };
  if (iso <= race) return { name: 'Hyrox', date: race, inDays: diffDays(iso, race) };
  return null;
}

export const testExerciseIds = (t) => t.exerciseIds || (t.exerciseId ? [t.exerciseId] : []);

// Défis qui s'appliquent à une séance : même semaine, même séance si précisée, exercices présents.
export function testsForLog(resolved, log, exerciseIds) {
  const ids = new Set(exerciseIds);
  return testsInWeek(resolved, log.date).filter((t) => (!t.sessionId || t.sessionId === log.sessionId)
    && testExerciseIds(t).length && testExerciseIds(t).every((id) => ids.has(id)));
}

const setsFor = (log, id) => (log?.sets || []).filter((s) => s.exerciseId === id);
const sum = (a) => a.reduce((x, y) => x + y, 0);

// Verdict d'un défi pour une séance : 'success' | 'fail' | 'reference' (premier chrono) | 'none' (pas tenté).
export function evaluateTest(test, log, { refLog = null, previousTimes = [] } = {}) {
  const ids = testExerciseIds(test);
  const sets = ids.flatMap((id) => setsFor(log, id));
  if (!sets.length) return { status: 'none' };
  const tg = test.target || {};
  if (test.kind === 'maxReps') {
    const best = Math.max(0, ...sets.filter((s) => (Number(s.load) || 0) <= (tg.load || 0)).map((s) => s.reps));
    return { status: best >= tg.reps ? 'success' : 'fail', value: best, detail: `${best} reps en une série` };
  }
  if (test.kind === 'loadForReps') {
    const ok = sets.filter((s) => s.load >= tg.load && s.reps >= tg.reps).length;
    return { status: ok >= (tg.sets || 1) ? 'success' : 'fail', value: ok, detail: `${ok}/${tg.sets || 1} série${(tg.sets || 1) > 1 ? 's' : ''} réussie${ok > 1 ? 's' : ''}` };
  }
  if (test.kind === 'beatSession') {
    let refTotal = 0;
    let curTotal = 0;
    let loadsOk = true;
    for (const id of ids) {
      const ref = test.ref?.[id]
        ? test.ref[id].reps.map((r) => ({ load: test.ref[id].load, reps: r }))
        : setsFor(refLog, id);
      if (!ref.length) return { status: 'none', detail: 'Séance de référence introuvable' };
      const refLoad = Math.max(...ref.map((s) => Number(s.load) || 0));
      refTotal += sum(ref.map((s) => s.reps));
      const mine = setsFor(log, id);
      if (!mine.some((s) => s.load >= refLoad)) loadsOk = false;
      curTotal += sum(mine.filter((s) => s.load >= refLoad).map((s) => s.reps));
    }
    return { status: loadsOk && curTotal > refTotal ? 'success' : 'fail', value: curTotal, detail: `${curTotal} reps contre ${refTotal}` };
  }
  if (test.kind === 'time') {
    const total = sum(sets.map((s) => Number(s.reps) || 0));
    const prev = previousTimes.filter((x) => x > 0);
    const detail = fmtTime(total);
    if (!prev.length) return { status: 'reference', value: total, detail };
    const best = Math.min(...prev);
    return { status: total < best ? 'success' : 'fail', value: total, detail: `${detail} (meilleur avant : ${fmtTime(best)})` };
  }
  return { status: 'none' };
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
