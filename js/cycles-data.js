// Cycles d'entraînement du 07/10/2026 au Hyrox duo mixte (voir CYCLES.md, qui fait foi).
// Données seules. Les dates des blocs Moteur et Duo sont calculées par resolveCycles (cycles.js).

export const CYCLES_DEFAULTS = {
  semiDate: '2026-11-22',
  hyroxDate: '2027-02-13', // provisoire tant que le réglage kv 'hyroxDate' est vide
  moteurStart: '2027-01-04',
};

// Cours Hyrox : le jeudi, sauf exceptions. Pas de cours du 23/10 au 22/11 (le 22/10 est le dernier avant le semi).
export const HYROX_CLASS = {
  weekday: 4,
  extra: ['2026-10-12'],
  skip: ['2026-10-15'],
  pauses: [['2026-10-23', '2026-11-22'], ['2026-12-21', '2026-12-27']],
  minDaysBeforeRace: 3,
};

const E = (id, name, sets, repMin, repMax, increment, loadType, more = {}) =>
  ({ id, name, sets, repMin, repMax, increment, loadType, undulates: false, unit: 'kg', ...more });
const BW = (id, name, sets, repMin, repMax, more = {}) => E(id, name, sets, repMin, repMax, 0, 'bodyweight', { unit: 'reps', ...more });
const T = (id, name, sec) => BW(id, name, 1, sec, sec, { repUnit: 's', repStep: 5, note: 'Saisis le temps en secondes' });
const ONE = "Charge d'un haltère";

// Exercices apparus avec les cycles (ceux du programme d'origine restent dans program.js).
export const EXERCISES = Object.fromEntries([
  // Bloc 1
  E('tirage-poulie-haute-1bras', 'Tirage poulie haute un bras, à genoux', 3, 10, 12, 2.5, 'cable'),
  E('ecarte-poulie', 'Écarté poulie vis-à-vis', 3, 12, 15, 2.5, 'cable'),
  BW('pompes', 'Pompes', 3, 10, 25, { note: 'Max moins 2 reps (RIR 2), gainage serré' }),
  E('pallof-press', 'Pallof press câble', 3, 10, 12, 2.5, 'cable', { note: 'Par côté. Le buste ne tourne pas' }),
  E('face-pull', 'Face pull corde', 3, 12, 15, 2.5, 'cable'),
  E('barre-front-halteres', 'Barre au front haltères, banc incliné', 3, 8, 12, 2, 'dumbbell', { note: `Même banc incliné que le curl. ${ONE}`, start: { load: 10 } }),
  E('curl-incline', 'Curl incliné haltères', 3, 8, 12, 2, 'dumbbell', { note: ONE, start: { load: 10 } }),
  E('pushdown-corde', 'Pushdown corde', 3, 10, 15, 2.5, 'cable', { start: { load: 25 } }),
  E('curl-marteau-halteres', 'Curl marteau haltères', 3, 10, 12, 2, 'dumbbell', { note: ONE, start: { load: 12 } }),
  // Bloc 2 et Trêve (sans salle)
  BW('pompes-piquees', 'Pompes piquées', 3, 6, 10, { note: 'Fesses en l\'air, travail des épaules' }),
  BW('rowing-elastique', 'Rowing élastique un bras', 3, 12, 15, { note: 'Par bras. Élastique accroché à une poignée de porte ou un poteau' }),
  BW('elevation-elastique', 'Élévation latérale élastique', 3, 15, 20),
  BW('pull-apart', 'Pull-apart élastique', 2, 15, 20, { note: 'Élastique écarté devant la poitrine' }),
  BW('pompes-serrees', 'Pompes serrées', 3, 8, 20, { note: 'Max moins 2 reps' }),
  BW('curl-elastique', 'Curl élastique', 3, 12, 20),
  BW('extension-elastique', 'Extension triceps élastique au-dessus de la tête', 3, 12, 20),
  BW('dead-bug', 'Dead bug', 3, 10, 10, { note: 'Par côté, lombaires collées au sol' }),
  BW('fentes-bulgares-pdc', 'Fentes bulgares poids du corps', 3, 10, 10, { note: 'Par jambe, pied arrière sur une chaise' }),
  BW('squat-elastique', 'Squat élastique', 3, 15, 15, { note: 'Élastique sous les pieds' }),
  BW('fentes-pdc', 'Fentes marchées poids du corps', 3, 20, 20, { repUnit: 'm', repStep: 5 }),
  // Bloc 3
  E('presse', 'Presse à cuisses', 3, 10, 12, 10, 'machine', { note: 'Pas de rebond en bas, genoux dans l\'axe' }),
  E('hip-thrust', 'Hip thrust barre', 3, 8, 12, 2.5, 'barbell', { start: { load: 40 } }),
  E('farmer-carry', 'Farmer carry haltères', 3, 40, 40, 2, 'dumbbell', { repUnit: 'm', repStep: 10, note: `${ONE}. Distance en mètres`, start: { load: 18 } }),
  BW('wallball-reel', 'Wall balls 6 kg (maison)', 3, 15, 30, { note: 'Cible à 3 m. Ajoute 5 reps par série chaque semaine' }),
  E('rowing-barre', 'Rowing barre penché, prise pronation', 3, 8, 10, 2.5, 'barbell', { start: { load: 40 } }),
  E('pompes-lestees', 'Pompes lestées', 3, 8, 12, 2.5, 'bodyweight', { note: 'Charge = disque sur le dos', start: { load: 5 } }),
  E('suitcase-carry', 'Suitcase carry', 3, 30, 30, 2, 'dumbbell', { repUnit: 'm', repStep: 10, note: 'Un haltère, une main, buste droit. Distance par bras', start: { load: 24 } }),
  E('curl-barre', 'Curl barre droite', 3, 8, 12, 2.5, 'barbell', { start: { load: 25 } }),
  E('barre-front-barre', 'Barre au front barre droite', 3, 8, 12, 2.5, 'barbell', { start: { load: 20 } }),
  T('wallball-50', '50 wall balls 6 kg, chrono', 180),
  // Bloc 4
  E('rowing-poulie-basse', 'Rowing poulie basse assis, prise neutre', 4, 8, 10, 2.5, 'cable'),
  E('sdt-roumain', 'Soulevé de terre roumain haltères', 3, 8, 10, 2, 'dumbbell', { note: `${ONE}. Dos plat, hanches vers l'arrière`, start: { load: 20 } }),
  E('traction-neutre', 'Traction prise neutre', 3, 8, 12, 2.5, 'bodyweight', { note: 'Charge = lest éventuel (0 au poids du corps)' }),
  BW('burpees', 'Burpees sans saut en longueur', 3, 10, 10),
  T('fentes-100m', '100 m de fentes marchées 20 kg, chrono', 150),
  T('wallball-100', '100 wall balls 6 kg, chrono', 360),
  // Bloc 5
  BW('course-tapis', 'Course sur tapis', 3, 400, 400, { repUnit: 'm', repStep: 100 }),
  E('thruster-circuit', 'Thrusters (circuit)', 3, 20, 20, 2, 'dumbbell', { note: 'Charge totale des deux haltères', start: { load: 20 } }),
  E('farmer-circuit', 'Farmer carry (circuit)', 3, 40, 40, 2, 'dumbbell', { repUnit: 'm', repStep: 10, note: ONE, start: { load: 24 } }),
  E('fentes-circuit', 'Fentes marchées 20 kg (circuit)', 3, 20, 20, 2, 'dumbbell', { repUnit: 'm', repStep: 5, note: 'Charge totale', start: { load: 20 } }),
  T('rg-fentes', '1 km + 50 m de fentes marchées 20 kg', 420),
  T('rg-farmer', '1 km + 100 m de farmer carry 2 × 24 kg', 420),
  T('rg-thrusters', '1 km + 50 thrusters 2 × 10 kg', 480),
  T('rg-burpees', '1 km + 30 burpees', 420),
].map((e) => [e.id, e]));

const RENFO = 'Pendant le repos : 1 série de renfo moyen fessier sur place (pelvic drop, gainage latéral ou monster walk)';
const one = (id, ex, rest, more = {}) => ({ id, type: 'single', exercises: [ex], ...(rest != null ? { rest } : {}), ...more });
const anchor = (id, ex) => one(id, ex, 120, { cue: RENFO });
const ss = (id, a, b, rest) => ({ id, type: 'superset', exercises: [a, b], ...(rest != null ? { rest } : {}) });
const wallball = (id, rest = 90) => ({ id, type: 'interval', exercises: ['wallball-thruster'], holdSec: 20, rest });
const session = (id, name, weekday, rest, blocks, more = {}) => ({ id, name, weekday, rest, blocks, ...more });
const maison = (weekday) => session('wallball-maison', 'Wall balls maison', weekday, 90, [one('w1', 'wallball-reel')], { home: true });
const chrono = (id, exId) => session(id, 'Wall balls, chrono', 6, 60, [one('c1', exId)], { home: true, scheduledOnly: true });

const atlasA = [{ id: 'a1', type: 'circuit', restBetween: 60, rest: 60, exercises: ['pompes', 'rowing-elastique', 'pompes-piquees', 'elevation-elastique', 'pull-apart'] }];
const atlasB = [{ id: 'a1', type: 'circuit', restBetween: 60, rest: 60, exercises: ['pompes-serrees', 'curl-elastique', 'extension-elastique', 'dead-bug', 'reverse-crunch'] }];

export const CYCLES = [
  {
    id: 'b0-actuel', name: 'Programme actuel', base: true,
    intent: 'Dernière semaine du programme d\'été. Le nouveau bloc démarre lundi 12/10.',
    start: '2026-01-01', end: '2026-10-11',
    weeks: [{ index: 1, start: '2026-10-05', label: 'S12' }],
    schedule: [
      { date: '2026-10-07', sessionId: 'jambes', note: 'Jambes lourde, RIR 1-2, rien à l\'échec : Hyrox demain' },
      { date: '2026-10-08', sessionId: null, note: 'Cours Hyrox à 19 h' },
      { date: '2026-10-09', sessionId: 'epaule-bras', note: 'Mini-défi : 2 min de repos au développé', adjust: { blockRest: { eb1: 120 } } },
    ],
    challenge: { tests: [
      { id: 'b0-developpe', date: '2026-10-09', exerciseId: 'developpe-barre', kind: 'beatSession',
        ref: { 'developpe-barre': { load: 30, reps: [8, 7, 5, 5] } },
        label: 'Développé : battre 30 kg × 8/7/5/5, viser 8/7/7/6' },
    ] },
  },
  {
    id: 'b1-derniere-charge', name: 'Dernière charge',
    intent: 'Finir la prépa semi proprement, remettre le développé en mouvement.',
    start: '2026-10-12', end: '2026-11-01',
    weeks: [
      { index: 1, start: '2026-10-12', label: 'S13', legs: 'moyenne' },
      { index: 2, start: '2026-10-19', label: 'S14', legs: 'legere' },
      { index: 3, start: '2026-10-26', label: 'S15', legs: 'lourde', isChallenge: true },
    ],
    schedule: [
      { date: '2026-10-12', sessionId: null, note: 'Cours Hyrox à la place des jambes' },
      { date: '2026-10-15', sessionId: 'jambes', note: 'Jambes moyenne déplacées au jeudi (Hyrox lundi)' },
      { date: '2026-10-22', sessionId: null, note: 'Dernier cours Hyrox avant le semi' },
    ],
    overrides: {
      'traction-pronation': { sets: 4, repMin: 6, repMax: 8 },
      'developpe-barre': { sets: 4, repMin: 5, repMax: 7 },
    },
    sessions: [
      { id: 'jambes', name: 'Jambes', weekday: 1, fromBase: true },
      session('pec-dos', 'Pec / Dos', 3, 90, [
        anchor('pd1', 'traction-pronation'),
        anchor('pd2', 'dc-incline-halteres'),
        ss('pd3', 'chest-row-incline', 'pompes'),
        ss('pd4', 'tirage-poulie-haute-1bras', 'ecarte-poulie', 75),
        one('pd5', 'pallof-press', 45),
      ]),
      session('epaule-bras', 'Épaule / Bras', 5, 75, [
        anchor('eb1', 'developpe-barre'),
        ss('eb2', 'elevation-laterale', 'face-pull'),
        ss('eb3', 'barre-front-halteres', 'curl-incline'),
        ss('eb4', 'pushdown-corde', 'curl-marteau-halteres', 60),
      ]),
    ],
    challenge: { tests: [
      { id: 'b1-jambes', date: '2026-10-26', sessionId: 'jambes', exerciseIds: ['fentes-marchees', 'step-up'], kind: 'beatSession',
        refDate: '2026-10-07', fallbackRef: 'ref-jambes',
        label: 'Fentes et step-up : plus de reps totales que le 07/10, même charge, RIR 2 minimum' },
      { id: 'b1-traction', date: '2026-10-28', sessionId: 'pec-dos', exerciseId: 'traction-pronation', kind: 'maxReps', target: { reps: 11 },
        label: 'Tractions pronation : 11 reps en une série, poids du corps' },
      { id: 'b1-developpe', date: '2026-10-30', sessionId: 'epaule-bras', exerciseId: 'developpe-barre', kind: 'loadForReps', target: { load: 32.5, reps: 6, sets: 4 },
        label: 'Développé debout 32,5 kg × 6 sur 4 séries' },
    ] },
  },
  {
    id: 'b2-atlas', name: 'Atlas',
    intent: 'Garder le haut du corps au Maroc, arriver frais au semi.',
    start: '2026-11-02', end: '2026-11-22',
    weeks: [
      { index: 1, start: '2026-11-02', label: 'S16' },
      { index: 2, start: '2026-11-09', label: 'S17' },
      { index: 3, start: '2026-11-16', label: 'S18' },
    ],
    sessions: [
      session('atlas-a', 'Atlas A (sans salle)', 3, 60, atlasA, { home: true }),
      session('atlas-b', 'Atlas B (sans salle)', 5, 60, atlasB, { home: true }),
    ],
    borrow: [
      { sessionId: 'epaule-bras', from: 'b1-derniere-charge', adjust: { loadFactor: 0.9 } },
      { sessionId: 'pec-dos', from: 'b1-derniere-charge', adjust: { sets: 2 } },
    ],
    schedule: [
      { date: '2026-11-02', sessionId: null, note: 'Maroc' },
      { date: '2026-11-04', sessionId: 'atlas-a', note: 'Maroc' },
      { date: '2026-11-06', sessionId: 'atlas-b', note: 'Maroc' },
      { date: '2026-11-09', sessionId: 'atlas-a', note: 'Test pompes : 1 série au maximum' },
      { date: '2026-11-11', sessionId: null, note: 'Voyage retour' },
      { date: '2026-11-13', sessionId: 'epaule-bras', from: 'b1-derniere-charge', adjust: { loadFactor: 0.9 }, note: 'Charges du bloc 1 moins 10 %, RIR 2-3' },
      { date: '2026-11-16', sessionId: null, note: 'Semaine du semi : pas de jambes, pas de cours Hyrox' },
      { date: '2026-11-18', sessionId: 'pec-dos', from: 'b1-derniere-charge', adjust: { sets: 2 }, note: 'Rappel : 2 séries par exercice, RIR 3-4, rien au max' },
      { date: '2026-11-20', sessionId: null, note: 'Repos, ou 15 min de mobilité épaules' },
      { date: '2026-11-22', sessionId: null, note: 'Semi' },
    ],
    challenge: { tests: [{ id: 'b2-semi', date: '2026-11-22', kind: 'event', label: 'Semi' }] },
  },
  {
    id: 'b3-fondations', name: 'Fondations',
    intent: 'La course descend, la barre remonte. Retrouver les charges, poser les bases Hyrox.',
    start: '2026-11-23', end: '2026-12-20',
    weeks: [
      { index: 1, start: '2026-11-23', legs: 'aucune', note: 'Semaine après le semi : pas de jambes' },
      { index: 2, start: '2026-11-30', legs: 'normale', factor: 0.6, note: 'Rampe jambes : 60 % des charges du 26/10' },
      { index: 3, start: '2026-12-07', legs: 'normale', factor: 0.8, note: 'Rampe jambes : 80 % des charges du 26/10' },
      { index: 4, start: '2026-12-14', legs: 'normale', factor: 1, isChallenge: true },
    ],
    overrides: {
      'traction-pronation': { sets: 4, repMin: 4, repMax: 6, note: 'Lest 5 kg si le défi du 28/10 a passé 11 reps, sinon 2,5 kg' },
      'dc-incline-halteres': { sets: 4, repMin: 6, repMax: 10 },
      'developpe-barre': { sets: 4, repMin: 4, repMax: 6 },
      'elevation-laterale': { repMin: 12, repMax: 15 },
      'oiseau-incline': { repMin: 12, repMax: 15 },
      'mollet-presse': { sets: 3 },
    },
    sessions: [
      session('jambes', 'Jambes', 1, 90, [
        one('j1', 'fentes-marchees', 120),
        ss('j2', 'presse', 'mollet-presse', 90),
        one('j3', 'leg-curl', 60),
        one('j4', 'hip-thrust', 75),
        one('j5', 'farmer-carry', 60),
        wallball('j6', 75),
      ]),
      session('pec-dos', 'Pec / Dos', 3, 90, [
        anchor('pd1', 'traction-pronation'),
        anchor('pd2', 'dc-incline-halteres'),
        ss('pd3', 'rowing-barre', 'pompes-lestees'),
        one('pd4', 'ecarte-incline', 60),
        one('pd5', 'suitcase-carry', 45),
      ]),
      session('epaule-bras', 'Épaule / Bras', 5, 75, [
        anchor('eb1', 'developpe-barre'),
        ss('eb2', 'elevation-laterale', 'oiseau-incline'),
        ss('eb3', 'curl-barre', 'barre-front-barre'),
        ss('eb4', 'extension-triceps-haut', 'curl-cable', 60),
      ]),
      maison(6),
      chrono('wallball-chrono-50', 'wallball-50'),
    ],
    schedule: [
      { date: '2026-11-23', sessionId: null, note: 'Lendemain du semi : pas de jambes' },
      { date: '2026-11-26', sessionId: null, note: 'Cours Hyrox allégé ou sauté, à la sensation' },
      { date: '2026-11-28', sessionId: null, note: 'Wall balls maison à partir du 05/12' },
      { date: '2026-12-19', sessionId: 'wallball-chrono-50' },
    ],
    challenge: { tests: [
      { id: 'b3-fentes', date: '2026-12-14', exerciseId: 'fentes-marchees', kind: 'loadForReps', target: { load: 40, reps: 12, sets: 3 },
        label: 'Fentes marchées : retrouver 40 kg × 3 × 12, RIR 1 au plus bas' },
      { id: 'b3-traction', date: '2026-12-16', exerciseId: 'traction-pronation', kind: 'loadForReps', target: { load: 7.5, reps: 5, sets: 1 },
        label: 'Traction pronation lestée 7,5 kg × 5' },
      { id: 'b3-developpe', date: '2026-12-18', exerciseId: 'developpe-barre', kind: 'loadForReps', target: { load: 35, reps: 5, sets: 1 },
        label: 'Développé debout 35 kg × 5' },
      { id: 'b3-wallball', date: '2026-12-19', exerciseId: 'wallball-50', kind: 'time', label: 'Premier chrono : 50 wall balls 6 kg' },
    ] },
  },
  {
    id: 'treve', name: 'Trêve',
    intent: 'Une semaine sans salle à Noël, une semaine de reprise.',
    start: '2026-12-21', end: '2027-01-03',
    weeks: [
      { index: 1, start: '2026-12-21', note: 'Sans salle, dates provisoires' },
      { index: 2, start: '2026-12-28', sessionsFrom: 'b3-fondations', adjust: { loadFactor: 0.9 }, note: 'Reprise : séances Fondations à 90 %, RIR 3' },
    ],
    sessions: [
      session('treve-a', 'Trêve A (sans salle)', 3, 60, [...atlasA, one('t2', 'fentes-bulgares-pdc', 60)], { home: true }),
      session('treve-b', 'Trêve B (sans salle)', 5, 60, [...atlasB, one('t2', 'squat-elastique', 60), one('t3', 'fentes-pdc', 60)], { home: true }),
    ],
  },
  {
    id: 'b4-moteur', name: 'Moteur', relative: 'moteur',
    intent: 'Les charges les plus hautes de l\'hiver, tenues dans la fatigue.',
    overrides: {
      'traction-pronation': { sets: 5, repMin: 3, repMax: 5 },
      'developpe-barre': { sets: 5, repMin: 3, repMax: 5 },
      'dc-incline-halteres': { sets: 4, repMin: 6, repMax: 8 },
      'fentes-marchees': { sets: 4, repMin: 12, repMax: 16 },
      'presse': { sets: 3, repMin: 6, repMax: 8 },
      'rowing-poulie-basse': { sets: 3 },
      'mollet-presse': { sets: 3 },
      'farmer-carry': { sets: 3, repMin: 50, repMax: 50 },
      'suitcase-carry': { sets: 2, repMin: 40, repMax: 40 },
      'pompes': { sets: 3, repMin: 15, repMax: 15 },
      'face-pull': { repMin: 15, repMax: 15 },
      'elevation-laterale': { repMin: 12, repMax: 15 },
      'wallball-reel': { repMin: 25, repMax: 30 },
    },
    sessions: [
      session('jambes', 'Jambes', 1, 90, [
        one('j1', 'fentes-marchees', 120),
        one('j2', 'presse', 120),
        ss('j3', 'sdt-roumain', 'mollet-presse', 75),
        one('j4', 'farmer-carry', 60),
        { id: 'j5', type: 'emom', exercises: ['wallball-thruster'], minutes: 10, repsPerMinute: 12 },
      ]),
      session('pec-dos', 'Pec / Dos', 3, 90, [
        anchor('pd1', 'traction-pronation'),
        anchor('pd2', 'dc-incline-halteres'),
        ss('pd3', 'rowing-poulie-basse', 'pompes'),
        one('pd4', 'traction-neutre', 60),
        one('pd5', 'suitcase-carry', 45),
      ]),
      session('epaule-bras', 'Épaule / Bras', 5, 75, [
        anchor('eb1', 'developpe-barre'),
        ss('eb2', 'elevation-laterale', 'face-pull'),
        ss('eb3', 'curl-incline', 'barre-front-halteres'),
        ss('eb4', 'pushdown-corde', 'curl-marteau-halteres', 60),
        one('eb5', 'burpees', 60),
      ]),
      maison(6),
      chrono('wallball-chrono-100', 'wallball-100'),
    ],
    schedule: [
      { week: 'last', weekday: 1, sessionId: 'jambes', note: 'Défi : fentes 44 kg, puis 100 m de fentes chronométrés',
        adjust: { extraBlocks: [one('jx', 'fentes-100m', 0)] } },
      { week: 'last', weekday: 6, sessionId: 'wallball-chrono-100' },
    ],
    challenge: { week: 'last', tests: [
      { id: 'b4-fentes', weekday: 1, exerciseId: 'fentes-marchees', kind: 'loadForReps', target: { load: 44, reps: 12, sets: 3 },
        label: 'Fentes marchées 44 kg × 3 × 12 (record), RIR 1' },
      { id: 'b4-fentes-100', weekday: 1, exerciseId: 'fentes-100m', kind: 'time', label: '100 m de fentes marchées 20 kg, chrono' },
      { id: 'b4-traction', weekday: 3, exerciseId: 'traction-pronation', kind: 'maxReps', target: { reps: 14 },
        label: 'Tractions pronation : 14 reps en une série, poids du corps' },
      { id: 'b4-developpe', weekday: 5, exerciseId: 'developpe-barre', kind: 'loadForReps', target: { load: 37.5, reps: 3, sets: 1 },
        label: 'Développé debout 37,5 kg × 3' },
      { id: 'b4-wallball', weekday: 6, exerciseId: 'wallball-100', kind: 'time', label: '100 wall balls 6 kg, chrono' },
    ] },
  },
  {
    id: 'b5-duo', name: 'Duo', relative: 'duo',
    intent: 'Enchaîner course et stations comme le jour J, arriver frais.',
    weeks: [
      { index: 1, legs: 'normale' },
      { index: 2, legs: 'normale', isChallenge: true, note: 'Répétition générale lundi' },
      { index: 3, legs: 'normale', adjust: { volume: 0.5, dropTypes: ['circuit'] }, note: 'Affûtage : volume divisé par deux' },
    ],
    overrides: {
      'traction-pronation': { sets: 3, repMin: 4, repMax: 6 },
      'developpe-barre': { sets: 3, repMin: 4, repMax: 6 },
      'dc-incline-halteres': { sets: 3, repMin: 6, repMax: 8 },
      'fentes-marchees': { sets: 3, repMin: 12, repMax: 12 },
      'presse': { sets: 3, repMin: 6, repMax: 8 },
      'rowing-poulie-basse': { sets: 3, repMin: 10, repMax: 10 },
      'pompes': { sets: 3, repMin: 15, repMax: 15 },
      'suitcase-carry': { sets: 2, repMin: 40, repMax: 40 },
      'face-pull': { repMin: 15, repMax: 15 },
      'elevation-laterale': { repMin: 12, repMax: 15 },
      'wallball-reel': { repMin: 25, repMax: 30 },
    },
    sessions: [
      session('jambes', 'Jambes', 1, 90, [
        one('j1', 'fentes-marchees', 120),
        one('j2', 'presse', 120),
        { id: 'j3', type: 'circuit', rounds: 3, restBetween: 0, rest: 120, exercises: ['course-tapis', 'thruster-circuit', 'farmer-circuit', 'fentes-circuit'] },
      ]),
      session('pec-dos', 'Pec / Dos', 3, 90, [
        anchor('pd1', 'traction-pronation'),
        anchor('pd2', 'dc-incline-halteres'),
        ss('pd3', 'rowing-poulie-basse', 'pompes'),
        one('pd4', 'suitcase-carry', 45),
        one('pd5', 'burpees', 60),
      ]),
      session('epaule-bras', 'Épaule / Bras', 5, 75, [
        anchor('eb1', 'developpe-barre'),
        ss('eb2', 'elevation-laterale', 'face-pull'),
        ss('eb3', 'curl-marteau-halteres', 'pushdown-corde', 60),
      ]),
      maison(6),
      session('repetition-generale', 'Répétition générale', 1, 0, [
        one('r1', 'rg-fentes', 0), one('r2', 'rg-farmer', 0), one('r3', 'rg-thrusters', 0), one('r4', 'rg-burpees', 0),
      ], { scheduledOnly: true, note: '4 × (1 km sur tapis + 1 station), chrono total' }),
      chrono('wallball-chrono-100', 'wallball-100'),
    ],
    schedule: [
      // Le premier remplacement trouvé pour une date l'emporte : la course d'abord.
      { daysBeforeEvent: [0], sessionId: null, note: 'Hyrox duo mixte' },
      { daysBeforeEvent: [1, 2], sessionId: null, note: 'Rien les 2 jours avant la course' },
      { week: 2, weekday: 1, sessionId: 'repetition-generale', note: 'Répétition générale, remplace la séance jambes' },
      { week: 2, weekday: 6, sessionId: 'wallball-chrono-100' },
      { week: 3, weekday: 6, sessionId: null, note: 'Pas de wall balls maison' },
    ],
    challenge: { week: 2, tests: [
      { id: 'b5-repetition', weekday: 1, exerciseIds: ['rg-fentes', 'rg-farmer', 'rg-thrusters', 'rg-burpees'], kind: 'time',
        label: 'Répétition générale : 4 × (1 km + station), chrono total' },
      { id: 'b5-wallball', weekday: 6, exerciseId: 'wallball-100', kind: 'time', label: '100 wall balls 6 kg, chrono' },
      { id: 'b5-hyrox', race: true, kind: 'event', label: 'Hyrox duo mixte' },
    ] },
  },
  {
    id: 'apres', name: 'Après le Hyrox', relative: 'apres', sessionsFrom: 'b4-moteur',
    intent: 'Cycle terminé. Séances du bloc Moteur en attendant le prochain cycle.',
  },
];
