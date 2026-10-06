// Steppers et modales de la séance : correction d'une série, vue d'ensemble.
import * as db from '../db.js';
import * as timer from '../timer.js';
import { esc, fmtN, round2, parseNum, ICONS, openModal } from '../ui.js';
import { stepperHTML } from './cards.js';

export function wireSteppers(el, getState, getEx) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const [field, dir] = b.dataset.step.split(':');
    const state = getState();
    const ex = getEx();
    if (!state || !ex) return;
    const step = field === 'load' ? (ex.increment > 0 ? ex.increment : 1) : 1;
    state[field] = Math.max(0, round2((Number(state[field]) || 0) + Number(dir) * step));
    const input = b.parentElement.querySelector('input');
    if (input) input.value = fmtN(state[field]);
    timer.vibrate(10);
  });
  el.addEventListener('input', (e) => {
    const f = e.target.dataset?.field;
    if (!f) return;
    const n = parseNum(e.target.value);
    const state = getState();
    if (state && n != null) state[f] = Math.max(0, f === 'reps' ? Math.round(n) : round2(n));
  });
  el.addEventListener('focusin', (e) => { if (e.target.dataset?.field) e.target.select(); });
  el.addEventListener('focusout', (e) => {
    const f = e.target.dataset?.field;
    const state = getState();
    if (f && state) e.target.value = fmtN(state[f]);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.field) e.target.blur(); });
}

export function openEdit(S, exId, setIndex) {
  const { log } = S;
  const ex = S.exOf(exId);
  const set = log.sets.find((s) => s.exerciseId === exId && s.setIndex === setIndex);
  if (!set) return;
  const state = { load: set.load, reps: set.reps };
  const m = openModal(`
    <div class="h2">Corriger la série ${setIndex + 1}</div>
    <div class="muted">${esc(ex.name)}</div>
    <div class="steppers">${ex.unit === 'reps' ? '' : stepperHTML(S, 'load', state.load, ex, 'e-')}${stepperHTML(S, 'reps', state.reps, ex, 'e-')}</div>
    <div class="actions">
      <button class="btn btn-primary btn-lg" data-a="save">Enregistrer</button>
      <div class="actions two" style="margin-top:0">
        <button class="btn btn-danger" data-a="del">Supprimer</button>
        <button class="btn btn-ghost" data-a="cancel">Annuler</button>
      </div>
    </div>`, async (a, _b, close) => {
    if (a === 'cancel') close();
    else if (a === 'save') {
      document.activeElement?.blur?.();
      set.load = ex.unit === 'reps' ? 0 : state.load;
      set.reps = Math.round(state.reps);
      await db.saveLog(log);
      close();
      S.ctx.toast('Série corrigée');
      await S.go();
    } else if (a === 'del') {
      log.sets = log.sets.filter((s) => s !== set);
      await db.saveLog(log);
      close();
      if (!S.curStep()) S.moveTo(S.firstUndone(0));
      S.ctx.toast('Série supprimée');
      await S.go();
    }
  });
  wireSteppers(m.el, () => state, () => ex);
}

export function openOverview(S) {
  const { log, session } = S;
  const st = S.curStep();
  const skipped = new Set(log.skipped || []);
  const blocks = session.blocks.map((block, bi) => {
    const steps = S.steps.filter((s) => s.blockIdx === bi);
    const allSkipped = block.exercises.every((id) => skipped.has(id));
    const done = steps.every(S.isDone);
    const current = st && st.blockIdx === bi;
    const cls = current ? 'current' : done ? 'done' : '';
    const label = block.type === 'superset' ? 'Superset' : block.type === 'interval' ? 'Intervalle' : 'Exercice';
    const rows = block.exercises.filter((id) => S.exOf(id)).map((id) => {
      const planned = S.steps.filter((s) => s.ex === id).length;
      const made = S.setsOf(id).length;
      const isSkipped = skipped.has(id);
      return `<div class="ov-ex${isSkipped ? ' skipped' : ''}">
        <span class="nm">${esc(S.exOf(id).name)}</span>
        <span class="ct">${isSkipped ? 'passé' : `${made}/${planned}`}</span>
        ${isSkipped
          ? `<button class="btn btn-sm btn-ghost" data-a="unskip" data-ex="${esc(id)}">Reprendre</button>`
          : `<button class="btn btn-sm btn-ghost" data-a="plus" data-ex="${esc(id)}" aria-label="Ajouter une série à ${esc(S.exOf(id).name)}">+ 1</button>`}
      </div>`;
    }).join('');
    return `<div class="ov-block ${cls}">
      <button class="ov-head" data-a="jump" data-block="${bi}">
        <span class="ov-state">${done && !current ? ICONS.check : bi + 1}</span>
        <span class="grow"><span class="ov-title">Bloc ${bi + 1} · ${label}</span><br>
        <span class="muted small">${current ? 'En cours' : allSkipped ? 'Passé' : done ? 'Fait' : 'À faire'}</span></span>
      </button>
      ${rows}
    </div>`;
  }).join('');
  openModal(`<div class="h2">${esc(session.name)}</div>
    <div class="muted small">Touchez un bloc pour y aller.</div>
    <div style="margin-top:8px">${blocks}</div>
    <div class="actions"><button class="btn btn-ghost" data-a="close">Fermer</button></div>`,
  async (a, b, close) => {
    if (a === 'close') close();
    else if (a === 'jump') {
      const bi = Number(b.dataset.block);
      const target = S.steps.find((s) => s.blockIdx === bi && !S.isDone(s));
      if (!target) { S.ctx.toast('Bloc terminé. Ajoute une série avec « + 1 ».'); return; }
      close();
      S.moveTo(target);
      await S.go();
    } else if (a === 'plus') {
      const id = b.dataset.ex;
      await S.addSet(id);
      close();
      const cur = S.curStep();
      if (!cur || cur.ex !== id) S.moveTo(S.steps.find((s) => s.ex === id && !S.isDone(s)));
      await S.go();
    } else if (a === 'unskip') {
      const id = b.dataset.ex;
      log.skipped = (log.skipped || []).filter((x) => x !== id);
      await db.saveLog(log);
      S.rebuild();
      close();
      const target = S.steps.find((s) => s.ex === id && !S.isDone(s));
      if (target) S.moveTo(target);
      await S.go();
    }
  });
}
