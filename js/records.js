// Records annoncés à la validation d'une série. Fonctions pures.
import { e1rm } from './progression.js';

const fmt = (x) => String(Math.round(x * 10) / 10).replace('.', ',');

// Pas de record pendant une séance allégée : semaine moyenne/légère ou rampe pour un exo qui ondule,
// facteur global réduit (reprise, rappel), ni pour les distances et les chronos.
export function recordExcluded(ex, log) {
  if (!ex || (ex.repUnit && ex.repUnit !== 'reps')) return true;
  if (log.adjust?.loadFactor < 1) return true;
  if (ex.undulates && (log.weekType === 'moyenne' || log.weekType === 'legere' || log.legFactor < 1)) return true;
  return false;
}

// set = série validée ; history = getExerciseHistory (séances terminées) ; earlier = séries déjà faites
// dans la séance en cours pour cet exercice. Renvoie null ou { kind, text }.
export function detectRecord(ex, set, history, earlier = []) {
  if (!history?.length) return null;
  const before = [...history.flatMap((h) => h.sets || []), ...earlier];
  if (!before.length) return null;
  const load = Number(set.load) || 0;
  if (ex.unit === 'reps' || load <= 0) {
    const bw = before.filter((s) => !((Number(s.load) || 0) > 0)).map((s) => s.reps);
    if (bw.length && set.reps > Math.max(...bw)) return { kind: 'reps', text: `Record : ${set.reps} reps` };
    return null;
  }
  const best = Math.max(0, ...before.map((s) => ((Number(s.load) || 0) > 0 ? e1rm(s.load, s.reps) : 0)));
  const cur = e1rm(load, set.reps);
  if (best > 0 && cur > best + 1e-9) return { kind: 'e1rm', text: `Record : 1RM estimée ${fmt(cur)} kg` };
  const same = before.filter((s) => Number(s.load) === load).map((s) => s.reps);
  if (same.length && set.reps > Math.max(...same)) return { kind: 'reps', text: `Record : ${set.reps} reps à ${fmt(load)} kg` };
  return null;
}
