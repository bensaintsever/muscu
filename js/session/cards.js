// HTML de l'écran de séance. S = état de la séance (voir view.js).
import { esc, fmtN, fmtDate, fmtLoad, fmtSets, fmtElapsed, weekLabel, weekChip, ICONS } from '../ui.js';
import { mediaHTML } from '../media.js';
import { targetReps } from './prefill.js';
import { partnerStep, stepCount } from './steps.js';

export function stepperHTML(S, field, value, ex, prefix = '') {
  const isLoad = field === 'load';
  const label = isLoad ? (ex.loadType === 'bodyweight' ? 'Lest' : 'Charge') : (S.hold && S.curStep()?.kind === 'interval' ? 'Reps de thrusters' : 'Répétitions');
  return `<div class="stepper">
    <div class="lbl">${label}</div>
    <button type="button" data-step="${field}:-1" aria-label="Diminuer">&minus;</button>
    <div class="field">
      <input id="${prefix}in-${field}" data-field="${field}" type="text" inputmode="${isLoad ? 'decimal' : 'numeric'}"
        enterkeyhint="done" autocomplete="off" value="${esc(fmtN(value))}" aria-label="${label}">
      ${isLoad ? '<span class="unit">kg</span>' : ''}
    </div>
    <button type="button" data-step="${field}:1" aria-label="Augmenter">+</button>
  </div>`;
}

function targetHTML(S, st) {
  const ex = S.exOf(st.ex);
  const t = S.targets[st.ex];
  if (!t) return '<div class="target"><div class="lbl">Cible</div><div class="val muted">…</div></div>';
  const reps = targetReps(ex, t, st.set);
  const loadTxt = ex.unit === 'reps' ? '' : (t.load == null ? 'charge libre' : fmtLoad(ex, t.load));
  const val = loadTxt ? `${loadTxt} × ${reps}` : `${reps} reps`;
  const all = (t.reps || []).length > 1 ? ` · objectif ${t.reps.join(' / ')}` : '';
  return `<div class="target act-${esc(t.action)}">
    <div class="lbl">Pour progresser</div>
    <div class="val">${esc(val)}</div>
    <div class="reason">${esc(t.reason || '')}${esc(all)}</div>
  </div>`;
}

function lastHTML(S, st) {
  const ex = S.exOf(st.ex);
  const last = S.histories[st.ex]?.at(-1);
  if (!last) return S.targets[st.ex] ? '<div class="lastline">Première fois sur cet exercice</div>' : '';
  const tag = last.weekType && !['lourde', 'normale'].includes(last.weekType) && !last.isReference ? ` (sem. ${weekLabel(last.weekType).toLowerCase()})` : '';
  return `<div class="lastline">Dernière fois, ${esc(fmtDate(last.date, { day: 'numeric', month: 'short' }))}${esc(tag)} : <b>${esc(fmtSets(ex, last.sets))}</b></div>`;
}

function doneSetsHTML(S, exId) {
  const ex = S.exOf(exId);
  const sets = S.setsOf(exId);
  if (!sets.length) return '';
  return `<div class="done-sets">${sets.map((s) => `
    <button class="done-set" data-a="edit" data-ex="${esc(exId)}" data-set="${s.setIndex}" aria-label="Corriger la série ${s.setIndex + 1}">
      ${ICONS.check}<span class="i">S${s.setIndex + 1}</span>${ex.unit === 'reps' ? `${s.reps} reps` : `${esc(fmtN(s.load))} × ${s.reps}`}
    </button>`).join('')}</div>`;
}

// Superset : charge à préparer pour l'autre exercice de la paire
function partnerHTML(S, st) {
  if (st.block.type !== 'superset') return '';
  const rows = st.block.exercises.filter((id) => id !== st.ex && S.exOf(id)).map((id) => {
    const ex = S.exOf(id);
    const pst = partnerStep(S.steps, st, id);
    if (!pst) return '';
    const what = S.planLabel(id, pst.set);
    return `<div class="partner"><span class="k">Prépare aussi</span><span class="n">${esc(ex.name)}</span><b class="tnum">${esc(what)}</b></div>`;
  });
  return rows.join('');
}

function cardHTML(S, st) {
  const ex = S.exOf(st.ex);
  const total = stepCount(S.steps, st.ex);
  const tags = [];
  if (st.block.type === 'superset') {
    const pos = st.block.exercises.indexOf(st.ex);
    tags.push(`<span class="chip">Superset ${pos + 1}/${st.block.exercises.length}</span>`);
  }
  if (st.kind === 'interval') tags.push('<span class="chip">Intervalle</span>');
  if (ex.undulates) tags.push(`<span class="chip ${esc(S.log.weekType)}">${esc(weekChip(S.log.weekType))}</span>`);

  let body = '';
  if (st.kind === 'interval') {
    const phase = S.hold?.phase || 'ready';
    if (phase === 'ready') {
      body = `<div class="steppers">${stepperHTML(S, 'load', S.input.load, ex)}</div>
        <div class="hold">
          <div class="big tnum">${st.hold}</div><div class="sub">secondes de maintien</div>
          <button class="btn btn-primary btn-lg btn-block" data-a="hold-start">Démarrer le maintien</button>
          <button class="btn btn-ghost btn-block" data-a="hold-skip" style="margin-top:10px">Saisir les reps directement</button>
        </div>`;
    } else if (phase === 'running') {
      body = `<div class="hold">
          <div class="big tnum" id="hold-time">${Math.ceil((S.hold.cd?.remaining ?? st.hold * 1000) / 1000)}</div>
          <div class="sub">Haltères au-dessus de la tête</div>
          <button class="btn btn-ghost btn-block" data-a="hold-stop">Arrêter le maintien</button>
        </div>`;
    } else {
      body = `<div class="steppers">${stepperHTML(S, 'reps', S.input.reps, ex)}${stepperHTML(S, 'load', S.input.load, ex)}</div>`;
    }
  } else {
    body = `<div class="steppers">${ex.unit === 'reps' ? '' : stepperHTML(S, 'load', S.input.load, ex)}${stepperHTML(S, 'reps', S.input.reps, ex)}</div>`;
  }

  return `<section class="card ex-card">
    ${mediaHTML(st.ex, { size: 'hero', alt: ex.name })}
    ${tags.length ? `<div class="ex-tag">${tags.join('')}</div>` : ''}
    <h1 class="ex-name">${esc(ex.name)}</h1>
    <div class="ex-set">Série <b>${st.set + 1}</b>/${total}</div>
    ${ex.note ? `<div class="ex-note">${esc(ex.note)}</div>` : ''}
    ${targetHTML(S, st)}
    ${partnerHTML(S, st)}
    ${lastHTML(S, st)}
    ${body}
    ${doneSetsHTML(S, st.ex)}
    <div class="ex-actions">
      <button class="btn btn-ghost" data-a="addset">+ 1 série</button>
      <button class="btn btn-ghost" data-a="skip">Passer l'exercice</button>
    </div>
  </section>`;
}

export function extraOfferHTML(S) {
  const ex = S.offerExtra && S.exOf(S.offerExtra);
  if (!ex) return '';
  return `<div class="extra-offer"><span>Dernière série de <b>${esc(ex.name)}</b> faite</span>
    <button class="btn btn-ghost" data-a="extra">+ 1 série</button></div>`;
}

// Écran complet : en-tête, barre de progression, carte de l'exo courant, bouton de validation.
export function screenHTML(S) {
  const st = S.curStep();
  const doneCount = S.steps.filter(S.isDone).length;
  const pct = S.steps.length ? Math.round((doneCount / S.steps.length) * 100) : 100;
  const blockTxt = st ? `Bloc ${st.blockIdx + 1}/${S.session.blocks.length}` : 'Terminé';
  const showValidate = st && (st.kind === 'set' || S.hold?.phase === 'done');
  return `
    <header class="sess-head">
      <button class="btn icon-btn" data-a="home" aria-label="Retour à l'accueil">${ICONS.home}</button>
      <button class="btn icon-btn" data-a="overview" aria-label="Vue d'ensemble de la séance">${ICONS.list}</button>
      <div class="title"><b>${esc(S.session.name)}</b><span>${blockTxt} · <span id="chrono">${fmtElapsed(Date.now() - S.log.startedAt)}</span></span></div>
      <button class="btn btn-ghost end" data-a="finish">Terminer</button>
    </header>
    <div class="progress-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
    ${extraOfferHTML(S)}
    ${st ? cardHTML(S, st) : `<section class="card all-done">
        <div class="h2">Toutes les séries sont faites</div>
        <p class="muted">Ajoute une série depuis la vue d'ensemble, ou termine la séance.</p>
        <button class="btn btn-primary btn-lg btn-block" data-a="finish">Terminer la séance</button>
        <button class="btn btn-ghost btn-block" data-a="overview" style="margin-top:10px">Vue d'ensemble</button>
      </section>`}
    ${showValidate ? `<div class="validate-bar"><button class="btn btn-primary btn-block" data-a="validate">Valider la série</button></div>` : ''}
  `;
}
