// Logique pure de la séance : suite des étapes, reprise, offres.
// Aucune dépendance au DOM ni à IndexedDB (importable dans Node).

// Une étape = une série à faire : { blockIdx, block, ex, set, kind, rest, hold?, idx, key }.
// Superset : A1 B1 (repos) A2 B2 (repos)… ; le repos suit le dernier exo du tour.
export function buildSteps(session, program, log) {
  const skipped = new Set(log.skipped || []);
  const extra = log.extraSets || {};
  const steps = [];
  session.blocks.forEach((block, bi) => {
    const exs = block.exercises.filter((id) => program.exercises[id] && !skipped.has(id));
    const counts = exs.map((id) => Math.max(0, (program.exercises[id].sets || 0) + (extra[id] || 0)));
    const rest = block.rest ?? session.rest ?? 90;
    if (block.type === 'interval') {
      exs.forEach((id, j) => {
        for (let i = 0; i < counts[j]; i++) steps.push({ blockIdx: bi, block, ex: id, set: i, kind: 'interval', hold: block.holdSec || 20, rest });
      });
      return;
    }
    const max = Math.max(0, ...counts);
    for (let i = 0; i < max; i++) {
      let last = null;
      exs.forEach((id, j) => {
        if (i < counts[j]) { last = { blockIdx: bi, block, ex: id, set: i, kind: 'set', rest: 0 }; steps.push(last); }
      });
      if (last) last.rest = rest;
    }
  });
  steps.forEach((s, i) => { s.idx = i; s.key = `${s.ex}#${s.set}`; });
  return steps;
}

export const isStepDone = (log, st) => log.sets.some((s) => s.exerciseId === st.ex && s.setIndex === st.set);

export const setsOf = (log, exId) => log.sets.filter((s) => s.exerciseId === exId).sort((a, b) => a.setIndex - b.setIndex);

export const stepCount = (steps, exId) => steps.filter((s) => s.ex === exId).length;

// Première étape non faite à partir de `from`, en repartant du début si besoin (reprise, saut).
export function firstUndone(steps, log, from = 0, wrap = true) {
  const n = steps.length;
  for (let k = 0; k < (wrap ? n : n - from); k++) {
    const st = steps[(from + k) % n];
    if (!isStepDone(log, st)) return st;
  }
  return null;
}

// Après avoir passé un exo : la suite à partir de son bloc.
export function stepAfterSkip(steps, log, blockIdx) {
  const startIdx = steps.findIndex((s) => s.blockIdx >= blockIdx);
  return firstUndone(steps, log, startIdx < 0 ? 0 : startIdx);
}

// Plus aucune série prévue après celle-ci pour cet exo : on propose « + 1 série ».
export const isLastSetOf = (steps, st) => !steps.some((s) => s.ex === st.ex && s.set > st.set);

// Exos à montrer pendant le repos : pour un superset, ceux du tour qui restent à faire.
export function restGroup(steps, log, st) {
  if (!st) return [];
  if (st.block.type !== 'superset') return [st];
  return st.block.exercises
    .map((id) => steps.find((s) => s.ex === id && s.set === st.set && !isStepDone(log, s)))
    .filter(Boolean);
}

// Superset : l'étape de l'autre exo au même tour, sinon sa dernière série.
export const partnerStep = (steps, st, exId) =>
  steps.find((s) => s.ex === exId && s.set === st.set)
  || [...steps].reverse().find((s) => s.ex === exId);
