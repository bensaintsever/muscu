// Calendrier d'ondulation et suggestions de charge.
// Fonctions pures : aucune dépendance au DOM ni à IndexedDB (importable dans Node).

export const WEEK_TYPES = {
  lourde: { label: 'Lourde', factor: 1 },
  moyenne: { label: 'Moyenne', factor: 0.85 },
  legere: { label: 'Légère', factor: 0.6 },
  aucune: { label: 'Pas de jambes', factor: 0 },
  normale: { label: 'Normale', factor: 1 },
};

// S1 = lundi 20/07/2026. Le plan semi s'arrête à S18 (course le 22/11/2026).
const PLAN_START = { y: 2026, m: 7, d: 20 };
const LAST_PLAN_WEEK = 18;

const WEEK_SCHEDULE = {
  5: 'lourde', 6: 'lourde', 7: 'moyenne', 8: 'legere',
  9: 'lourde', 10: 'moyenne', 11: 'legere',
  12: 'lourde', 13: 'moyenne', 14: 'legere',
  15: 'lourde', 16: 'aucune', 17: 'aucune', 18: 'aucune',
};

const WEEK_NOTES = {
  16: 'Pas de jambes cette semaine',
  17: 'Maroc, pas de jambes',
  18: 'Semaine du semi, pas de jambes',
};

const TYPE_NOTES = {
  lourde: 'Jambes à pleine charge, on cherche à progresser',
  moyenne: 'Jambes à 85 % de la charge, mêmes reps',
  legere: 'Jambes à 60 % de la charge, on récupère',
  aucune: 'Pas de jambes cette semaine',
  normale: 'Progression normale sur toutes les séances',
};

const FULL_LOAD_TYPES = new Set(['lourde', 'normale']);

// Accepte un objet Date ou une chaîne 'YYYY-MM-DD', renvoie {y, m, d} en date locale.
function toLocalParts(date) {
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!match) throw new Error(`Date invalide : ${date}`);
    return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  }
  const dt = date instanceof Date ? date : new Date(date);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

// Numéro de jour indépendant des fuseaux et changements d'heure.
function dayNumber({ y, m, d }) {
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

function isoWeekday(parts) {
  const wd = new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function weekInfo(date) {
  const parts = toLocalParts(date);
  const diff = dayNumber(parts) - dayNumber(PLAN_START);
  const n = Math.floor(diff / 7) + 1;
  const inPlan = n >= 1 && n <= LAST_PLAN_WEEK;
  const type = (inPlan && WEEK_SCHEDULE[n]) || 'normale';
  return {
    week: inPlan ? `S${n}` : null,
    type,
    label: WEEK_TYPES[type].label,
    note: (inPlan && WEEK_NOTES[n]) || TYPE_NOTES[type],
  };
}

export function sessionForDate(date, program) {
  const wd = isoWeekday(toLocalParts(date));
  const session = program?.sessions?.find((s) => Number(s.weekday) === wd);
  return session ? session.id : null;
}

// Supprime le bruit flottant (2.5 × 3 = 7.500000000001).
function clean(x) {
  return Math.round(x * 1000) / 1000;
}

export function roundLoad(load, increment) {
  if (load == null || !Number.isFinite(load)) return load;
  if (!increment) return load;
  const steps = Math.floor(clean(load / increment) + 1e-9);
  return clean(steps * increment);
}

export function e1rm(load, reps) {
  if (!load) return 0;
  return load * (1 + (reps || 0) / 30);
}

export function sessionVolume(log) {
  if (!log?.sets) return 0;
  return clean(log.sets.reduce((sum, s) => sum + (Number(s.load) || 0) * (Number(s.reps) || 0), 0));
}

function fmtKg(x) {
  return `${String(clean(x)).replace('.', ',')} kg`;
}

function fill(count, value) {
  return Array.from({ length: count }, () => value);
}

// Entrée de référence pour la progression.
// Les exos qui ondulent ne progressent que sur les séances à pleine charge
// (lourde, normale ou référence). Les autres progressent sur toute séance,
// quel que soit le type de semaine enregistré dans le log.
function findBase(exercise, history) {
  if (!history?.length) return null;
  if (!exercise.undulates) return history[history.length - 1];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.isReference || FULL_LOAD_TYPES.has(h.weekType)) return h;
  }
  // Aucune séance à pleine charge : on se rabat sur la plus récente.
  return history[history.length - 1];
}

export function suggest(exercise, history, weekType) {
  const { sets: count, repMin, repMax } = exercise;
  const increment = Number(exercise.increment) || 0;
  const repsOnly = exercise.unit === 'reps';
  const bodyweight = exercise.loadType === 'bodyweight';

  const base = findBase(exercise, (history || []).filter((h) => h?.sets?.length));

  if (!base) {
    return {
      load: repsOnly || bodyweight ? 0 : null,
      reps: fill(count, repMin),
      action: 'first',
      reason: bodyweight || repsOnly
        ? `Première fois : poids du corps, vise ${repMin} reps`
        : `Première fois : choisis une charge pour ${repMin} reps`,
    };
  }

  const baseReps = base.sets.map((s) => Number(s.reps) || 0);
  const baseLoad = repsOnly ? 0 : Math.max(0, ...base.sets.map((s) => Number(s.load) || 0));
  const repsAt = (i, fallback) => (i < baseReps.length ? baseReps[i] : fallback);

  const type = WEEK_TYPES[weekType] ? weekType : 'normale';
  if (exercise.undulates && (type === 'moyenne' || type === 'legere')) {
    const factor = WEEK_TYPES[type].factor;
    return {
      load: repsOnly ? 0 : roundLoad(baseLoad * factor, increment),
      reps: Array.from({ length: count }, (_, i) => repsAt(i, repMin)),
      action: 'undulate',
      reason: `Semaine ${WEEK_TYPES[type].label.toLowerCase()} : ${Math.round(factor * 100)} % de la charge de base`,
    };
  }

  const allAtMax = baseReps.length >= count && baseReps.slice(0, count).every((r) => r >= repMax);

  // Sans charge suivie (crunch), on ne peut que plafonner les reps.
  if (repsOnly) {
    return {
      load: 0,
      reps: Array.from({ length: count }, (_, i) => {
        const r = repsAt(i, null);
        return r == null ? repMin : Math.min(r + 1, repMax);
      }),
      action: 'hold',
      reason: allAtMax ? `Plafond atteint : ${repMax} reps partout` : 'Vise +1 rep par série',
    };
  }

  if (allAtMax) {
    const load = clean(baseLoad + increment);
    return {
      load,
      reps: fill(count, repMin),
      action: 'increase',
      reason: bodyweight && baseLoad === 0
        ? `Toutes les séries à ${repMax} : ajoute ${fmtKg(increment)} de lest`
        : `Toutes les séries à ${repMax} : on monte à ${fmtKg(load)}`,
    };
  }

  return {
    load: baseLoad,
    reps: Array.from({ length: count }, (_, i) => {
      const r = repsAt(i, null);
      return r == null ? repMin : Math.min(r + 1, repMax);
    }),
    action: 'hold',
    reason: bodyweight && baseLoad === 0 ? 'Poids du corps, vise +1 rep' : 'Même charge, vise +1 rep',
  };
}
