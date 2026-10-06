# Muscu — app de suivi d'entraînement (PWA)

## Objectif

Une app installable sur Pixel 8 Pro (Chrome Android) qui :
1. guide la séance en cours (quel exo, quelle série, quelle charge viser, minuteur de repos) ;
2. enregistre chaque série (charge, reps) sans friction, avec le pouce, entre deux séries ;
3. montre où j'en suis : progression par exercice, historique des séances ;
4. applique la règle du plan semi : la charge de la séance jambes ondule (lourde / moyenne / légère) jusqu'au semi du 22/11/2026.

## Choix techniques

- **PWA statique**, HTML + CSS + JS en modules ES, **aucune étape de build, aucune dépendance CDN** (doit marcher hors ligne en salle).
- Données dans **IndexedDB** (local au téléphone) + `navigator.storage.persist()` + **export/import JSON** pour la sauvegarde.
- Hébergement visé : GitHub Pages (comme l'app du semi). À décider en fin de projet.
- Thème sombre, gros boutons (usage à une main, mains moites), viewport 412 px de large (Pixel 8 Pro).
- Minuteur de repos : basé sur un timestamp de fin (survit à la mise en veille / changement d'onglet), vibration + bip à la fin, Wake Lock pour garder l'écran allumé pendant la séance.
- Une séance en cours est sauvegardée à chaque série validée : si l'app est tuée, on reprend où on en était.

## Arborescence et propriétaires

| Fichier | Rôle | Propriétaire |
|---|---|---|
| `PLAN.md` | ce document, contrats | orchestrateur |
| `js/program.js` | programme initial + séance de référence | orchestrateur |
| `js/db.js` | stockage IndexedDB | agent **Data** |
| `js/progression.js` | calendrier d'ondulation, suggestions de charge (fonctions pures) | agent **Data** |
| `tests/progression.test.mjs` | tests Node de `progression.js` | agent **Data** |
| `index.html` | coquille, nav, conteneur des vues | agent **Séance** |
| `css/app.css` | styles (tokens de couleur sur `:root`) | agent **Séance** |
| `js/app.js` | point d'entrée : démarrage, routeur par hash, `ctx`, toast, nav | agent **Séance** |
| `js/ui.js` | helpers partagés : `esc`, formats (`fmt*`), `ICONS`, modales (`openModal`, `confirmDialog`), `errorCard` | agent **Séance** |
| `js/views/home.js` | vue Accueil, démarrage d'une séance | agent **Séance** |
| `js/views/recap.js` | récap de fin de séance | agent **Séance** |
| `js/session/view.js` | vue Séance en cours : état, validation, navigation entre séries, maintien wall ball | agent **Séance** |
| `js/session/steps.js` | logique pure de la séance : `buildSteps`, reprise, dernière série d'un exo, groupe affiché au repos | agent **Séance** |
| `js/session/prefill.js` | logique pure du pré-remplissage (séance précédente série par série, ondulation, charge modifiée) | agent **Séance** |
| `js/session/cards.js` | HTML de l'écran de séance (carte d'exo, steppers, cible, offre « + 1 série ») | agent **Séance** |
| `js/session/dialogs.js` | steppers, modales de correction d'une série et de vue d'ensemble | agent **Séance** |
| `js/session/rest.js` | écran de repos, ±15 s, bip programmé, offre de garder le repos ajusté | agent **Séance** |
| `tests/session.test.mjs` | tests Node de `steps.js`, `prefill.js` et des migrations | agent **Séance** |
| `js/timer.js` | minuteur de repos, wake lock, vibration, son | agent **Séance** |
| `js/media.js` | illustrations des exercices | agent **Séance** |
| `js/history.js` | vues Historique (liste des séances, détail) et Progression (graphe par exo) | agent **Suivi** |
| `js/settings.js` | vue Réglages : édition du programme, type de semaine forcé, export/import | agent **Suivi** |
| `manifest.webmanifest`, `sw.js`, `icons/` | installabilité, hors ligne | agent **Suivi** |

Chaque agent n'écrit **que** ses fichiers. Les interfaces ci-dessous sont le contrat.

## Modèle de données

### Programme (`js/program.js`, copié en base au premier lancement, éditable ensuite)

```js
{
  version: 1,
  exercises: {
    [id]: {
      id, name,
      sets,               // nombre de séries prévues
      repMin, repMax,     // fourchette de double progression
      increment,          // pas de charge en kg
      loadType,           // 'dumbbell' | 'barbell' | 'cable' | 'machine' | 'bodyweight'
      undulates,          // true = suit l'ondulation lourde/moyenne/légère
      unit: 'kg' | 'reps' // 'reps' pour les exos sans charge suivie (crunch)
      note?               // consigne courte affichée pendant la séance
    }
  },
  sessions: [
    {
      id: 'pec-dos' | 'epaule-bras' | 'jambes',
      name, weekday,      // 1 = lundi … 7 = dimanche (jour par défaut)
      rest,               // repos par défaut en secondes
      blocks: [
        { id, type: 'single',   exercises: [exId] },
        { id, type: 'superset', exercises: [exA, exB] },  // A puis B sans repos, puis repos
        { id, type: 'interval', exercises: [exId], holdSec, rest } // wall ball : maintien puis thrusters puis repos
      ]
    }
  ]
}
```

### Séance enregistrée (store `logs`)

```js
{
  id,                 // string unique
  sessionId,          // 'pec-dos' | ...
  date,               // 'YYYY-MM-DD'
  startedAt, endedAt, // ms epoch (endedAt null tant qu'en cours)
  status,             // 'in-progress' | 'done'
  weekType,           // 'lourde' | 'moyenne' | 'legere' | 'aucune' | 'normale'
  isReference?,       // true pour la séance saisie à la main au départ
  sets: [ { exerciseId, setIndex, load, reps, ts } ], // load en kg (0 si poids du corps)
  note?
}
```

## Contrat `js/db.js` (toutes les fonctions sont async, export nommé)

- `init()` : ouvre la base `muscu` (stores `logs`, `kv`), seed le programme et les séances de référence au premier lancement, demande `navigator.storage.persist()`.
- `getProgram()` / `saveProgram(program)`
- `resetProgram()` : remet le programme de `program.js`.
- `startLog(sessionId, weekType)` → log neuf `in-progress` (enregistré).
- `saveLog(log)` : put complet.
- `getActiveLog()` → log `in-progress` le plus récent ou `null`.
- `finishLog(id)` → passe en `done`, pose `endedAt`.
- `listLogs({ sessionId, limit } = {})` → logs `done`, plus récents d'abord.
- `getLog(id)`, `deleteLog(id)`
- `getExerciseHistory(exerciseId)` → `[{ logId, date, weekType, isReference, sets: [{ load, reps }] }]`, **plus anciens d'abord**, logs `done` seulement.
- `getSetting(key, fallback)` / `setSetting(key, value)` (store `kv`)
- `exportAll()` → `{ app: 'muscu', schema: 1, exportedAt, program, logs, settings }`
- `importAll(data)` : remplace tout après validation minimale ; lève une erreur lisible sinon.

Réglages connus : `weekTypeOverride` (null ou un type), `soundOn` (bool, défaut true).

## Contrat `js/progression.js` (pur, sans DOM ni IndexedDB, export nommé)

- `WEEK_TYPES` : `{ lourde: {label:'Lourde', factor:1}, moyenne: {label:'Moyenne', factor:0.85}, legere: {label:'Légère', factor:0.6}, aucune: {label:'Pas de jambes', factor:0}, normale: {label:'Normale', factor:1} }`
- `weekInfo(date)` → `{ week: 'S12' | null, type, label, note }` d'après le calendrier du plan semi (S1 = lundi 20/07/2026, S6 = 24/08) :
  - lourde : S5, S6, S9, S12, S15 ; moyenne : S7, S10, S13 ; légère : S8, S11, S14 ;
  - aucune : S16, S17 (Maroc), S18 (semaine du semi, course le 22/11) ;
  - à partir du lundi 23/11/2026 et avant S5 : `normale`.
  - `note` : une phrase courte (ex. « Semaine du semi, pas de jambes »).
- `sessionForDate(date, program)` → id de séance dont `weekday` correspond, sinon `null`.
- `roundLoad(load, increment)` → arrondi au pas inférieur le plus proche (jamais au-dessus).
- `e1rm(load, reps)` → Epley `load * (1 + reps / 30)`, 0 si load = 0.
- `suggest(exercise, history, weekType)` → `{ load, reps: number[], action, reason }`
  - `action` ∈ `'first' | 'increase' | 'hold' | 'undulate'`, `reason` = phrase française courte.
  - **Base** = dernière entrée d'historique faite à pleine charge (`weekType` ∈ lourde/normale, ou `isReference`). Les semaines moyennes/légères ne font pas progresser.
  - Pas d'historique → `first`, load null, reps = `repMin` par série.
  - **Double progression** : si toutes les séries de la base ≥ `repMax` → `increase` : load + increment, reps = `repMin` partout. Sinon `hold` : même charge, objectif = reps de la base + 1 sur chaque série sous `repMax` (plafonné à `repMax`), séries manquantes complétées à `repMin`.
  - Si `exercise.undulates` et `weekType` ∈ moyenne/légère → `undulate` : load = `roundLoad(baseLoad * factor, increment)`, reps = reps de la base (pas d'objectif de reps en plus).
  - `bodyweight` : load reste celui de la base (lest éventuel), seule la progression de reps s'applique ; si toutes ≥ repMax, `increase` propose + increment de lest.
- `sessionVolume(log)` → somme load × reps.

## Écrans

1. **Accueil** : type de semaine (badge + note), séance suggérée du jour en gros, les deux autres en dessous, bouton « Reprendre » si une séance est en cours, dernière séance de chaque type (date + volume).
2. **Séance** : en-tête (nom, chrono total, progression « bloc 2/4 »). Carte de l'exercice courant : nom, série « 2/3 », **cible** (charge × reps) avec la raison de la suggestion, **dernière fois** (charges/reps de la séance précédente). Steppers charge (± increment) et reps (± 1) préremplis avec la cible, très gros. Bouton « Valider la série ». Superset : alterne A1 → B1 → repos → A2 → B2 … Intervalle wall ball : compte à rebours du maintien, puis saisie des reps de thrusters, puis repos. Après validation, le **minuteur de repos** prend tout l'écran (temps restant énorme, +15 s / −15 s, Passer), vibre à la fin. Possibilité de revenir sur une série saisie et de la corriger, de sauter un exercice, d'ajouter une série.
3. **Récap de fin** : durée, volume, comparaison à la séance précédente du même type, records (meilleur e1RM par exo), note libre.
4. **Historique** : liste des séances (date, type, durée, volume), détail d'une séance, suppression.
5. **Progression** : choix d'un exercice, graphe SVG (meilleur e1RM par séance, et charge max), tableau des dernières séances ; les semaines moyennes/légères marquées différemment.
6. **Réglages** : édition du programme (séries, fourchette, pas, repos, ondulation), forcer le type de semaine, son on/off, export JSON (téléchargement), import JSON, réinitialisation.

Navigation basse : Accueil · Historique · Progression · Réglages (masquée pendant la séance).

## Étapes

1. Orchestrateur : `PLAN.md`, `js/program.js`. ✅
2. En parallèle : agent Data, agent Séance, agent Suivi.
3. Orchestrateur : intégration, tests au navigateur en taille Pixel 8 Pro (412 × 915), correction des écarts.
4. Décision d'hébergement (GitHub Pages) avec Benjamin.
