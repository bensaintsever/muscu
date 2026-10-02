// Programme initial et séances de référence (saisie du 02/10/2026).
// Copié en base au premier lancement, éditable ensuite depuis Réglages.

export const PROGRAM = {
  version: 1,
  exercises: {
    // — Pec / Dos —
    'traction-pronation': { id: 'traction-pronation', name: 'Traction pronation', sets: 3, repMin: 6, repMax: 10, increment: 2.5, loadType: 'bodyweight', undulates: false, unit: 'kg', note: 'Charge = lest éventuel (0 au poids du corps)' },
    'dc-incline-halteres': { id: 'dc-incline-halteres', name: 'DC incliné haltères 15°', sets: 3, repMin: 8, repMax: 12, increment: 2, loadType: 'dumbbell', undulates: false, unit: 'kg' },
    'chest-row-incline': { id: 'chest-row-incline', name: 'Chest row banc incliné 45°', sets: 3, repMin: 10, repMax: 15, increment: 2, loadType: 'dumbbell', undulates: false, unit: 'kg' },
    'ecarte-banc': { id: 'ecarte-banc', name: 'Écarté couché haltères', sets: 3, repMin: 10, repMax: 15, increment: 2, loadType: 'dumbbell', undulates: false, unit: 'kg' },
    'tirage-un-bras': { id: 'tirage-un-bras', name: 'Tirage penché un bras haltère', sets: 3, repMin: 10, repMax: 15, increment: 2, loadType: 'dumbbell', undulates: false, unit: 'kg' },
    'ecarte-incline': { id: 'ecarte-incline', name: 'Écarté incliné haltères', sets: 3, repMin: 8, repMax: 12, increment: 2, loadType: 'dumbbell', undulates: false, unit: 'kg' },
    'crunch': { id: 'crunch', name: 'Crunch (bonus)', sets: 3, repMin: 15, repMax: 25, increment: 0, loadType: 'bodyweight', undulates: false, unit: 'reps' },

    // — Épaule / Bras —
    'developpe-barre': { id: 'developpe-barre', name: 'Développé au-dessus de la tête barre', sets: 4, repMin: 6, repMax: 10, increment: 2.5, loadType: 'barbell', undulates: false, unit: 'kg', note: 'Prise large, barre à disques' },
    'elevation-laterale': { id: 'elevation-laterale', name: 'Élévation latérale haltères', sets: 3, repMin: 10, repMax: 15, increment: 1, loadType: 'dumbbell', undulates: false, unit: 'kg' },
    'oiseau-incline': { id: 'oiseau-incline', name: 'Oiseau haltères banc incliné 30°', sets: 3, repMin: 10, repMax: 15, increment: 1, loadType: 'dumbbell', undulates: false, unit: 'kg' },
    'extension-triceps-haut': { id: 'extension-triceps-haut', name: 'Extension triceps au-dessus de la tête câble', sets: 3, repMin: 10, repMax: 15, increment: 2.5, loadType: 'cable', undulates: false, unit: 'kg' },
    'curl-cable': { id: 'curl-cable', name: 'Flexion biceps câble', sets: 3, repMin: 10, repMax: 15, increment: 2.5, loadType: 'cable', undulates: false, unit: 'kg' },
    'pushdown-cable': { id: 'pushdown-cable', name: 'Tirage triceps vers le bas câble', sets: 3, repMin: 10, repMax: 15, increment: 2.5, loadType: 'cable', undulates: false, unit: 'kg' },
    'curl-marteau-cable': { id: 'curl-marteau-cable', name: 'Flexion avant-bras prise marteau câble', sets: 3, repMin: 10, repMax: 15, increment: 2.5, loadType: 'cable', undulates: false, unit: 'kg' },

    // — Jambes (suit l'ondulation du plan semi) —
    'fentes-marchees': { id: 'fentes-marchees', name: 'Fentes marchées lestées', sets: 3, repMin: 10, repMax: 14, increment: 4, loadType: 'dumbbell', undulates: true, unit: 'kg', note: 'Charge totale des deux haltères' },
    'step-up': { id: 'step-up', name: 'Step-up lesté haltères', sets: 4, repMin: 10, repMax: 14, increment: 2, loadType: 'dumbbell', undulates: true, unit: 'kg', note: 'Genou d\'appui qui ne rentre pas, bassin stable' },
    'leg-curl': { id: 'leg-curl', name: 'Leg curl assis', sets: 3, repMin: 8, repMax: 12, increment: 5, loadType: 'machine', undulates: true, unit: 'kg' },
    'mollet-presse': { id: 'mollet-presse', name: 'Mollets à la presse', sets: 4, repMin: 12, repMax: 20, increment: 10, loadType: 'machine', undulates: true, unit: 'kg' },
    'wallball-thruster': { id: 'wallball-thruster', name: 'Simulation wall ball : maintien + thrusters', sets: 5, repMin: 12, repMax: 16, increment: 2, loadType: 'dumbbell', undulates: true, unit: 'kg', note: '20 s haltères au-dessus de la tête, puis thrusters max' },
  },
  sessions: [
    {
      id: 'pec-dos', name: 'Pec / Dos', weekday: 3, rest: 90,
      blocks: [
        { id: 'pd1', type: 'single', exercises: ['traction-pronation'] },
        { id: 'pd2', type: 'single', exercises: ['dc-incline-halteres'] },
        { id: 'pd3', type: 'superset', exercises: ['chest-row-incline', 'ecarte-banc'] },
        { id: 'pd4', type: 'superset', exercises: ['tirage-un-bras', 'ecarte-incline'] },
        { id: 'pd5', type: 'single', exercises: ['crunch'] },
      ],
    },
    {
      id: 'epaule-bras', name: 'Épaule / Bras', weekday: 5, rest: 75,
      blocks: [
        { id: 'eb1', type: 'single', exercises: ['developpe-barre'] },
        { id: 'eb2', type: 'superset', exercises: ['elevation-laterale', 'oiseau-incline'] },
        { id: 'eb3', type: 'superset', exercises: ['extension-triceps-haut', 'curl-cable'] },
        { id: 'eb4', type: 'superset', exercises: ['pushdown-cable', 'curl-marteau-cable'] },
      ],
    },
    {
      id: 'jambes', name: 'Jambes', weekday: 1, rest: 90,
      blocks: [
        { id: 'j1', type: 'single', exercises: ['fentes-marchees'] },
        { id: 'j2', type: 'single', exercises: ['step-up'] },
        { id: 'j3', type: 'single', exercises: ['leg-curl'] },
        { id: 'j4', type: 'single', exercises: ['mollet-presse'] },
        { id: 'j5', type: 'interval', exercises: ['wallball-thruster'], holdSec: 20, rest: 90 },
      ],
    },
  ],
};

const s = (exerciseId, load, reps) =>
  reps.map((r, i) => ({ exerciseId, setIndex: i, load, reps: r, ts: 0 }));

// Dernières perfs connues, saisies le 02/10/2026. Date réelle inconnue : posées au 01/10.
export const REFERENCE_LOGS = [
  {
    id: 'ref-pec-dos', sessionId: 'pec-dos', date: '2026-10-01', startedAt: 0, endedAt: 0,
    status: 'done', weekType: 'normale', isReference: true, note: 'Saisie initiale',
    sets: [
      ...s('dc-incline-halteres', 26, [10, 10, 8]),
      ...s('chest-row-incline', 22, [12, 13, 14]),
      ...s('ecarte-banc', 18, [10, 11, 10]),
      ...s('tirage-un-bras', 24, [14, 14, 14]),
      ...s('ecarte-incline', 16, [9, 8, 8]),
    ],
  },
  {
    id: 'ref-epaule-bras', sessionId: 'epaule-bras', date: '2026-10-01', startedAt: 0, endedAt: 0,
    status: 'done', weekType: 'normale', isReference: true, note: 'Saisie initiale',
    sets: [
      ...s('developpe-barre', 30, [8, 7, 5, 5]),
      ...s('elevation-laterale', 9, [9, 9, 9]),
      ...s('oiseau-incline', 10, [11, 13, 12]),
      ...s('extension-triceps-haut', 30, [12, 14, 13]),
      ...s('curl-cable', 20, [12, 12, 9]),
      ...s('pushdown-cable', 30, [13, 12, 12]),
      ...s('curl-marteau-cable', 20, [11, 13, 12]),
    ],
  },
  {
    id: 'ref-jambes', sessionId: 'jambes', date: '2026-10-01', startedAt: 0, endedAt: 0,
    status: 'done', weekType: 'normale', isReference: true, note: 'Saisie initiale',
    sets: [
      ...s('fentes-marchees', 40, [12, 12, 12]),
      ...s('step-up', 20, [12, 12, 12, 12]),
      ...s('leg-curl', 65, [9, 10, 10]),
      ...s('mollet-presse', 170, [15, 16, 17, 19]),
      ...s('wallball-thruster', 20, [14, 13, 13, 13, 13]),
    ],
  },
];
