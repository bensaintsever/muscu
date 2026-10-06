// Pré-remplissage des steppers. Fonctions pures, importables dans Node.
import { roundLoad, WEEK_TYPES } from '../progression.js';

const fullLoad = (h) => h.isReference || h.weekType === 'lourde' || h.weekType === 'normale';

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

// Séance de référence pour le pré-remplissage : la dernière faite, ou pour un exo qui ondule
// la dernière à pleine charge, ramenée au pourcentage de la semaine.
export function lastSetPlan(ex, history, weekType, setIdx) {
  const hist = history || [];
  if (!hist.length) return null;
  const light = ex.undulates && (weekType === 'moyenne' || weekType === 'legere');
  const base = ex.undulates ? [...hist].reverse().find(fullLoad) || hist.at(-1) : hist.at(-1);
  const set = base.sets?.[setIdx] ?? base.sets?.at(-1);
  if (!set) return null;
  let load = ex.unit === 'reps' ? 0 : (Number(set.load) || 0);
  if (light && load > 0) load = roundLoad(load * (WEEK_TYPES[weekType]?.factor ?? 1), ex.increment);
  return { load, reps: set.reps };
}

// Pré-remplissage : exactement la séance précédente, série par série. Seule exception :
// si la charge a été changée plus tôt dans la séance, on garde la nouvelle.
// sets = séries déjà enregistrées dans la séance en cours (log.sets).
export function plannedInput({ exId, ex, setIdx, history, target, sets = [], weekType }) {
  const plan = lastSetPlan(ex, history, weekType, setIdx);
  let load = plan ? plan.load : targetLoad(ex, target, history);
  const reps = plan ? plan.reps : targetReps(ex, target, setIdx);
  const prev = sets.filter((s) => s.exerciseId === exId && s.setIndex < setIdx).sort((a, b) => b.setIndex - a.setIndex)[0];
  if (prev && ex.unit !== 'reps') {
    const prevPlan = lastSetPlan(ex, history, weekType, prev.setIndex);
    if (!prevPlan || prev.load !== prevPlan.load) load = prev.load;
  }
  return { load: ex.unit === 'reps' ? 0 : load, reps };
}
