// Programme actif d'un bloc, par couches (fonctions pures) :
// 1. catalogue (program.js + cycles-data.js) ; 2. programme enregistré (kv 'program', réglages globaux) ;
// 3. format du bloc (overrides) ; 4. retouches faites pendant ce bloc (kv 'cycleEdits').
// Avant le 12/10 (bloc « Programme actuel ») le programme enregistré est utilisé tel quel, comme avant.
import { PROGRAM } from './program.js';
import { CYCLES, EXERCISES } from './cycles-data.js';

export const EX_FIELDS = ['name', 'sets', 'repMin', 'repMax', 'increment', 'undulates', 'note'];

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const findDef = (cycles, id) => cycles.find((c) => c.id === id) || CYCLES.find((c) => c.id === id);

export function defaultExercise(id) {
  return clone(PROGRAM.exercises[id] || EXERCISES[id] || null);
}

// Tous les exercices connus, avec les réglages globaux enregistrés.
export function catalog(stored) {
  const out = {};
  for (const [id, e] of Object.entries(EXERCISES)) out[id] = clone(e);
  for (const [id, e] of Object.entries(PROGRAM.exercises)) out[id] = clone(e);
  for (const [id, e] of Object.entries(stored?.exercises || {})) out[id] = { ...(out[id] || {}), ...clone(e) };
  return out;
}

function baseSession(stored, id) {
  return clone((stored?.sessions || PROGRAM.sessions).find((s) => s.id === id) || PROGRAM.sessions.find((s) => s.id === id));
}

// Repos d'un bloc : retouche du bloc > repos prescrit par le cycle > repos réglé à la main sur le
// même groupe d'exercices dans le programme enregistré > repos de la séance.
function cycleSession(s, stored, be) {
  if (s.fromBase) return { ...baseSession(stored, s.id), weekday: s.weekday, fromBase: true };
  const out = clone(s);
  if (be?.sessionRest?.[s.id] != null) out.rest = be.sessionRest[s.id];
  const base = baseSession(stored, s.id);
  for (const b of out.blocks) {
    const key = `${s.id}:${b.id}`;
    if (be?.blockRest && key in be.blockRest) {
      if (be.blockRest[key] == null) delete b.rest; else b.rest = be.blockRest[key];
    } else if (b.rest == null) {
      const carry = base?.blocks?.find((x) => x.rest != null && sameSet(x.exercises, b.exercises));
      if (carry) b.rest = carry.rest;
    }
  }
  return out;
}

export function buildProgram({ stored, edits = {}, cycles = CYCLES, sourceId }) {
  const src = findDef(cycles, sourceId) || cycles[0];
  const be = edits?.[src.id] || {};
  const exercises = catalog(stored);
  if (!src.base) {
    for (const layer of [src.overrides, be.exercises]) {
      for (const [id, o] of Object.entries(layer || {})) if (exercises[id]) Object.assign(exercises[id], clone(o));
    }
  }
  const sessions = src.base
    ? clone(stored?.sessions || PROGRAM.sessions)
    : (src.sessions || []).map((s) => cycleSession(s, stored, be));
  for (const s of sessions) s.source = src.id;
  for (const b of src.borrow || []) {
    const other = buildProgram({ stored, edits, cycles, sourceId: b.from }).sessions.find((s) => s.id === b.sessionId);
    if (other) sessions.push({ ...other, weekday: null, borrowed: true, adjust: clone(b.adjust || {}) });
  }
  return { version: stored?.version ?? 1, exercises, sessions, cycleId: src.id };
}

// Inverse de buildProgram : range les modifications de Réglages dans la bonne couche.
// Champs fixés par le format du bloc → retouches du bloc ; le reste → programme enregistré.
export function splitEdits({ edited, stored, edits = {}, cycles = CYCLES, sourceId }) {
  const src = findDef(cycles, sourceId) || cycles[0];
  const current = buildProgram({ stored, edits, cycles, sourceId });
  const nextStored = clone(stored || PROGRAM);
  const nextEdits = clone(edits || {});
  const be = () => (nextEdits[src.id] ??= {});

  for (const s of edited.sessions || []) {
    if (s.borrowed) continue;
    const cur = current.sessions.find((x) => x.id === s.id && !x.borrowed);
    if (!cur) continue;
    const toStored = src.base || cur.fromBase;
    const storedS = nextStored.sessions.find((x) => x.id === s.id);
    if (s.rest !== cur.rest) {
      if (toStored && storedS) storedS.rest = s.rest;
      else (be().sessionRest ??= {})[s.id] = s.rest;
    }
    for (const b of s.blocks || []) {
      const cb = cur.blocks.find((x) => x.id === b.id);
      if (!cb || (b.rest ?? null) === (cb.rest ?? null)) continue;
      if (toStored && storedS) {
        const sb = storedS.blocks.find((x) => x.id === b.id);
        if (sb) { if (b.rest == null) delete sb.rest; else sb.rest = b.rest; }
      } else (be().blockRest ??= {})[`${s.id}:${b.id}`] = b.rest ?? null;
    }
  }

  for (const [id, ex] of Object.entries(edited.exercises || {})) {
    const cur = current.exercises[id];
    if (!cur) continue;
    for (const f of EX_FIELDS) {
      const v = f === 'note' ? (ex.note || '') : ex[f];
      const was = f === 'note' ? (cur.note || '') : cur[f];
      if (v === was) continue;
      if (!src.base && src.overrides?.[id] && f in src.overrides[id]) {
        ((be().exercises ??= {})[id] ??= {})[f] = v;
      } else {
        nextStored.exercises ??= {};
        nextStored.exercises[id] ??= defaultExercise(id) || clone(cur);
        nextStored.exercises[id][f] = v;
        if (!src.base && be().exercises?.[id] && f in be().exercises[id]) delete be().exercises[id][f];
      }
    }
  }
  if (nextEdits[src.id] && !Object.keys(nextEdits[src.id]).length) delete nextEdits[src.id];
  return { stored: nextStored, edits: nextEdits };
}

// Ajustements d'une séance précise : séries fixées, volume réduit, blocs ajoutés ou retirés, repos forcé.
export function applyAdjust(program, session, adjust = {}) {
  const s = clone(session);
  const exercises = { ...program.exercises };
  if (adjust.dropTypes?.length) s.blocks = s.blocks.filter((b) => !adjust.dropTypes.includes(b.type));
  if (adjust.extraBlocks?.length) s.blocks.push(...clone(adjust.extraBlocks));
  for (const b of s.blocks) if (adjust.blockRest?.[b.id] != null) b.rest = adjust.blockRest[b.id];
  const ids = new Set(s.blocks.flatMap((b) => b.exercises));
  for (const id of ids) {
    const ex = exercises[id];
    if (!ex) continue;
    if (adjust.sets) exercises[id] = { ...ex, sets: adjust.sets };
    else if (adjust.volume) exercises[id] = { ...ex, sets: Math.max(1, Math.round(ex.sets * adjust.volume)) };
  }
  return { program: { ...program, exercises }, session: s };
}
