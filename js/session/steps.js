// Logique pure de la séance : suite des étapes, reprise, offres.
// Aucune dépendance au DOM ni à IndexedDB (importable dans Node).

// Une étape = une série à faire : { blockIdx, block, ex, set, kind, rest, hold?, idx, key }.
// Superset : A1 B1 (repos) A2 B2 (repos)… ; le repos suit le dernier exo du tour.
// Circuit : comme un superset à N exos (`rounds` tours), `restBetween` entre deux exos, `rest` en fin de tour.
// EMOM : une étape par minute ; le repos (fin de la minute) est calculé à la validation.
export function buildSteps(session, program, log) {
  const skipped = new Set(log.skipped || []);
  const extra = log.extraSets || {};
  const steps = [];
  session.blocks.forEach((block, bi) => {
    const exs = block.exercises.filter((id) => program.exercises[id] && !skipped.has(id));
    const planned = (id) => (block.type === 'circuit' && block.rounds ? block.rounds
      : block.type === 'emom' ? block.minutes || 10 : program.exercises[id].sets || 0);
    const counts = exs.map((id) => Math.max(0, planned(id) + (extra[id] || 0)));
    const rest = block.rest ?? session.rest ?? 90;
    if (block.type === 'interval' || block.type === 'emom') {
      const kind = block.type;
      exs.forEach((id, j) => {
        for (let i = 0; i < counts[j]; i++) {
          steps.push(kind === 'interval'
            ? { blockIdx: bi, block, ex: id, set: i, kind, hold: block.holdSec || 20, rest }
            : { blockIdx: bi, block, ex: id, set: i, kind, rest: 0 });
        }
      });
      return;
    }
    const between = block.type === 'circuit' ? block.restBetween || 0 : 0;
    const max = Math.max(0, ...counts);
    for (let i = 0; i < max; i++) {
      let last = null;
      exs.forEach((id, j) => {
        if (i < counts[j]) { last = { blockIdx: bi, block, ex: id, set: i, kind: 'set', rest: between }; steps.push(last); }
      });
      if (last) last.rest = rest;
    }
  });
  steps.forEach((s, i) => { s.idx = i; s.key = `${s.ex}#${s.set}`; });
  return steps;
}

// Durée estimée d'une séance en minutes : échauffement, temps d'effort par série, repos.
export function estimateMinutes(session, program) {
  const steps = buildSteps(session, program, { sets: [] });
  let sec = 5 * 60;
  for (const st of steps) {
    const ex = program.exercises[st.ex];
    if (st.kind === 'emom') { sec += 60; continue; }
    if (st.kind === 'interval') { sec += st.hold + 35 + st.rest; continue; }
    let work = 40;
    if (ex.repUnit === 's') work = ex.repMin;
    else if (ex.repUnit === 'm') work = st.ex === 'course-tapis' ? ex.repMin * 0.33 : ex.repMin * 1.2;
    sec += work + st.rest;
  }
  sec += Math.max(0, session.blocks.length - 1) * 60;
  // Séries de montée en charge avant les exercices lourds (repos de 2 min et plus)
  sec += session.blocks.filter((b) => b.type === 'single' && (b.rest ?? session.rest) >= 120).length * 180;
  return Math.round(sec / 60);
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
