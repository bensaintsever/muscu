// Pré-remplissage des steppers. Fonctions pures, importables dans Node.
import { roundLoad, findBase, loadFactorFor } from '../progression.js';

// Reps visées par la suggestion pour cette série (target = résultat de suggest).
export function targetReps(ex, target, setIdx) {
  return target?.reps?.[setIdx] ?? target?.reps?.at?.(-1) ?? ex.repMin ?? 10;
}

export function targetLoad(ex, target, history) {
  if (ex.unit === 'reps') return 0;
  if (target?.load != null) return target.load;
  const last = history?.at(-1)?.sets?.at(-1);
  return last?.load ?? 0;
}

// Séance de référence pour le pré-remplissage : la dernière faite à pleine charge (même règle que
// suggest), ramenée au facteur du jour (semaine moyenne/légère, rampe, reprise).
// factors = { legFactor, loadFactor } du log.
export function lastSetPlan(ex, history, weekType, setIdx, factors = {}) {
  const hist = history || [];
  if (!hist.length) return null;
  const base = findBase(ex, hist);
  const set = base.sets?.[setIdx] ?? base.sets?.at(-1);
  if (!set) return null;
  let load = ex.unit === 'reps' ? 0 : (Number(set.load) || 0);
  const f = loadFactorFor(ex, weekType, factors);
  if (f < 1 && load > 0) load = roundLoad(load * f, ex.increment);
  return { load, reps: set.reps };
}

// Pré-remplissage : exactement la séance précédente, série par série. Seule exception :
// si la charge a été changée plus tôt dans la séance, on garde la nouvelle.
// sets = séries déjà enregistrées dans la séance en cours (log.sets).
export function plannedInput({ exId, ex, setIdx, history, target, sets = [], weekType, factors = {} }) {
  const plan = lastSetPlan(ex, history, weekType, setIdx, factors);
  let load = plan ? plan.load : targetLoad(ex, target, history);
  const reps = plan ? plan.reps : targetReps(ex, target, setIdx);
  const prev = sets.filter((s) => s.exerciseId === exId && s.setIndex < setIdx).sort((a, b) => b.setIndex - a.setIndex)[0];
  if (prev && ex.unit !== 'reps') {
    const prevPlan = lastSetPlan(ex, history, weekType, prev.setIndex, factors);
    if (!prevPlan || prev.load !== prevPlan.load) load = prev.load;
  }
  return { load: ex.unit === 'reps' ? 0 : load, reps };
}
