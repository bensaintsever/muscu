import * as db from './db.js';
import * as prog from './progression.js';
import * as timer from './timer.js';

const appEl = document.getElementById('app');
const navEl = document.getElementById('nav');
const toastEl = document.getElementById('toast');

const ctx = { db, prog, navigate, toast, refresh };

let cleanup = null;
let routeToken = 0;
const openModals = new Set();

// ---------- Utilitaires ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fmtN = (n) => nf.format(Number(n) || 0);
const round2 = (n) => Math.round(n * 100) / 100;
const parseNum = (s) => {
  const n = parseFloat(String(s).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const WEEKDAYS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', opts);
}

function fmtDuration(ms) {
  if (!(ms > 0)) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const fmtVolume = (v) => `${fmtN(Math.round(v || 0))} kg`;

function fmtLoad(ex, load) {
  if (!ex || ex.unit === 'reps') return '';
  if (load == null) return '';
  if (ex.loadType === 'bodyweight') return load > 0 ? `PDC + ${fmtN(load)} kg` : 'PDC';
  return `${fmtN(load)} kg`;
}

// « 26 kg · 10 / 10 / 8 », ou détail série par série si les charges varient.
function fmtSets(ex, sets) {
  if (!sets?.length) return '';
  const reps = sets.map((s) => s.reps).join(' / ');
  if (ex.unit === 'reps') return `${reps} reps`;
  const loads = [...new Set(sets.map((s) => s.load))];
  if (loads.length === 1) return `${fmtLoad(ex, loads[0])} · ${reps}`;
  return sets.map((s) => `${fmtN(s.load)} × ${s.reps}`).join(' / ');
}

function weekLabel(type) {
  return prog.WEEK_TYPES?.[type]?.label ?? type ?? '';
}

function weekChip(type) {
  const label = weekLabel(type);
  return type === 'aucune' ? label : `Semaine ${String(label).toLowerCase()}`;
}

function volumeOf(log) {
  try { return prog.sessionVolume(log); } catch { return (log.sets || []).reduce((a, s) => a + (s.load || 0) * (s.reps || 0), 0); }
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

// ---------- Toast, modales ----------

let toastTimer = null;
function toast(message, ms = 2600) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function openModal(html, onAction) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { bd.remove(); openModals.delete(close); };
  bd.addEventListener('click', (e) => {
    if (e.target === bd) { close(); onAction?.('dismiss', null, close, bd); return; }
    const b = e.target.closest('[data-a]');
    if (b) onAction?.(b.dataset.a, b, close, bd);
  });
  document.body.append(bd);
  openModals.add(close);
  return { el: bd, close };
}

function closeAllModals() {
  [...openModals].forEach((c) => c());
}

function confirmDialog({ title, text = '', ok = 'Confirmer', cancel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    openModal(`
      <div class="h2">${esc(title)}</div>
      ${text ? `<p class="muted" style="margin:0">${esc(text)}</p>` : ''}
      <div class="actions two">
        <button class="btn btn-ghost" data-a="no">${esc(cancel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-a="yes">${esc(ok)}</button>
      </div>`, (a, _b, close) => {
      if (a === 'yes' || a === 'no' || a === 'dismiss') { close(); resolve(a === 'yes'); }
    });
  });
}

function errorCard(title, err) {
  return `<div class="card err">
    <div class="h2">${esc(title)}</div>
    <p class="muted" style="margin:0">Le reste de l'app fonctionne : la séance n'est pas touchée.</p>
    ${err ? `<pre>${esc(err.message || err)}</pre>` : ''}
    <div class="row" style="margin-top:12px">
      <a class="btn btn-ghost" href="#/">Accueil</a>
      <button class="btn" type="button" onclick="location.reload()">Recharger</button>
    </div>
  </div>`;
}

// ---------- Routage ----------

function navigate(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) route();
  else location.hash = hash;
}

function refresh() { route(); }

function updateNav(name) {
  const key = { '': 'home', history: 'history', progress: 'progress', settings: 'settings' }[name];
  navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}

function mount() {
  const root = document.createElement('div');
  appEl.replaceChildren(root);
  return root;
}

async function route() {
  const token = ++routeToken;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  closeAllModals();
  const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p));
  document.body.classList.toggle('in-session', name === 'session');
  updateNav(name);
  window.scrollTo(0, 0);
  const root = mount();
  const live = () => token === routeToken;
  try {
    switch (name) {
      case '': await renderHome(root, live); break;
      case 'session': await renderSession(root, live); break;
      case 'recap': await renderRecap(root, live, arg); break;
      case 'history': await renderExternal(root, './history.js', 'renderHistory', arg); break;
      case 'progress': await renderExternal(root, './history.js', 'renderProgress', arg); break;
      case 'settings': await renderExternal(root, './settings.js', 'renderSettings'); break;
      default: navigate('#/');
    }
  } catch (e) {
    console.error(e);
    if (live()) { root.className = 'view'; root.innerHTML = errorCard('Cet écran a rencontré une erreur', e); }
  }
}

async function renderExternal(root, path, fn, arg) {
  let mod;
  try {
    mod = await import(path);
  } catch (e) {
    console.error(e);
    root.className = 'view';
    root.innerHTML = errorCard("Ce module n'a pas pu être chargé", e);
    return;
  }
  if (typeof mod[fn] !== 'function') {
    root.className = 'view';
    root.innerHTML = errorCard('Écran indisponible', new Error(`${fn} absent de ${path}`));
    return;
  }
  await (arg === undefined ? mod[fn](root, ctx) : mod[fn](root, ctx, arg));
  if (!root.classList.contains('view') && !root.querySelector(':scope > .view')) root.classList.add('view');
}

// ---------- Accueil ----------

async function currentWeekType() {
  const override = await db.getSetting('weekTypeOverride', null);
  const info = prog.weekInfo(new Date());
  return { info, override, type: override || info.type };
}

function nextSessionId(program, today) {
  const wd = ((today.getDay() + 6) % 7) + 1;
  let best = null;
  let bestDist = 99;
  for (const s of program.sessions) {
    const dist = (s.weekday - wd + 7) % 7 || 7;
    if (dist < bestDist) { bestDist = dist; best = s; }
  }
  return best ? { id: best.id, dist: bestDist } : null;
}

const hasUndulating = (session, program) =>
  session.blocks.some((b) => b.exercises.some((id) => program.exercises[id]?.undulates));

async function renderHome(root, live) {
  const now = new Date();
  const [program, active, week] = await Promise.all([db.getProgram(), db.getActiveLog(), currentWeekType()]);
  const lasts = await Promise.all(program.sessions.map((s) => db.listLogs({ sessionId: s.id, limit: 1 }).then((l) => l[0] || null)));
  if (!live()) return;

  const lastById = Object.fromEntries(program.sessions.map((s, i) => [s.id, lasts[i]]));
  const todayId = prog.sessionForDate(now, program);
  let heroId = todayId;
  let heroKicker = "Aujourd'hui";
  if (!heroId) {
    const nx = nextSessionId(program, now);
    if (nx) {
      heroId = nx.id;
      const s = program.sessions.find((x) => x.id === nx.id);
      heroKicker = nx.dist === 1 ? 'Prochaine séance : demain' : `Prochaine séance : ${WEEKDAYS[s.weekday]}`;
    }
  }
  const ordered = [...program.sessions].sort((a, b) => (a.id === heroId ? -1 : b.id === heroId ? 1 : 0));
  const activeSession = active ? program.sessions.find((s) => s.id === active.sessionId) : null;

  const card = (s, hero) => {
    const last = lastById[s.id];
    const nEx = new Set(s.blocks.flatMap((b) => b.exercises)).size;
    const nSets = s.blocks.flatMap((b) => b.exercises).reduce((a, id) => a + (program.exercises[id]?.sets || 0), 0);
    const lastTxt = last ? `Dernière fois ${fmtDate(last.date)} · ${fmtVolume(volumeOf(last))}` : 'Jamais faite';
    const warn = week.type === 'aucune' && hasUndulating(s, program);
    return `<button class="sess-card${hero ? ' hero' : ''}" data-start="${esc(s.id)}">
      ${hero ? `<div class="kicker">${esc(heroKicker)}</div>` : ''}
      <div class="name">${esc(s.name)}</div>
      <div class="meta">${nEx} exercices · ${nSets} séries · repos ${s.rest} s</div>
      <div class="meta">${esc(lastTxt)}</div>
      ${warn ? '<div class="warn-line">Pas de jambes cette semaine (plan semi)</div>' : ''}
      ${hero ? '<div class="go">Démarrer</div>' : ''}
    </button>`;
  };

  root.className = 'view';
  root.innerHTML = `
    <div class="home-head">
      <div>
        <h1 class="h1">Muscu</h1>
        <div class="muted">${esc(now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      </div>
    </div>
    <div class="week">
      <span class="chip ${esc(week.type)}">${week.info.week ? `${esc(week.info.week)} · ` : ''}${esc(weekChip(week.type))}</span>
      ${week.override ? '<span class="chip warn">forcée dans Réglages</span>' : ''}
    </div>
    ${week.info.note && !week.override ? `<p class="week-note">${esc(week.info.note)}</p>` : ''}
    ${active ? `<button class="resume" data-resume>
        <span class="dot"></span>
        <span class="grow"><b style="font-size:19px">Reprendre la séance</b><br>
        <span class="muted small">${esc(activeSession?.name || active.sessionId)} · ${active.sets.length} série${active.sets.length > 1 ? 's' : ''} faite${active.sets.length > 1 ? 's' : ''}</span></span>
      </button>` : ''}
    <div class="section-title">Séances</div>
    ${ordered.map((s) => card(s, s.id === heroId)).join('')}
  `;

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-resume]')) { timer.unlockAudio(); navigate('#/session'); return; }
    const b = e.target.closest('[data-start]');
    if (!b) return;
    timer.unlockAudio();
    const session = program.sessions.find((s) => s.id === b.dataset.start);
    await startSession(session, program, week.type);
  });
}

async function startSession(session, program, weekType) {
  const active = await db.getActiveLog();
  if (active) {
    const name = program.sessions.find((s) => s.id === active.sessionId)?.name || active.sessionId;
    const ok = await confirmDialog({
      title: 'Une séance est déjà en cours',
      text: `${name}, ${active.sets.length} série(s) enregistrée(s). L'abandonner (elle sera supprimée) et démarrer ${session.name} ?`,
      ok: 'Abandonner et démarrer', danger: true,
    });
    if (!ok) return;
    await db.deleteLog(active.id);
  }
  if (weekType === 'aucune' && hasUndulating(session, program)) {
    const ok = await confirmDialog({
      title: 'Pas de jambes cette semaine',
      text: 'Le plan semi exclut la séance jambes cette semaine. La lancer quand même ?',
      ok: 'Lancer quand même',
    });
    if (!ok) return;
  }
  await db.startLog(session.id, weekType);
  navigate('#/session');
}

// ---------- Séance ----------

function buildSteps(session, program, log) {
  const skipped = new Set(log.skipped || []);
  const extra = log.extraSets || {};
  const steps = [];
  session.blocks.forEach((block, bi) => {
    const exs = block.exercises.filter((id) => program.exercises[id] && !skipped.has(id));
    const counts = exs.map((id) => Math.max(0, (program.exercises[id].sets || 0) + (extra[id] || 0)));
    const rest = block.rest ?? session.rest ?? 90;
    if (block.type === 'interval') {
      exs.forEach((id, j) => {
        for (let i = 0; i < counts[j]; i++) steps.push({ blockIdx: bi, block, ex: id, set: i, kind: 'interval', hold: block.holdSec || 20, rest });
      });
      return;
    }
    const max = Math.max(0, ...counts);
    for (let i = 0; i < max; i++) {
      let last = null;
      exs.forEach((id, j) => {
        if (i < counts[j]) { last = { blockIdx: bi, block, ex: id, set: i, kind: 'set', rest: 0 }; steps.push(last); }
      });
      if (last) last.rest = rest;
    }
  });
  steps.forEach((s, i) => { s.idx = i; s.key = `${s.ex}#${s.set}`; });
  return steps;
}

async function renderSession(root, live) {
  const log = await db.getActiveLog();
  if (!live()) return;
  if (!log) { toast('Aucune séance en cours'); navigate('#/'); return; }
  const [program, soundOn] = await Promise.all([db.getProgram(), db.getSetting('soundOn', true)]);
  if (!live()) return;
  const session = program.sessions.find((s) => s.id === log.sessionId);
  if (!session) throw new Error(`Séance « ${log.sessionId} » introuvable dans le programme`);
  log.sets = log.sets || [];

  const S = {
    log, program, session, soundOn,
    steps: [], cur: null, input: null, hold: null,
    targets: {}, histories: {}, busy: false, restEl: null,
  };
  const exOf = (id) => program.exercises[id];
  const isDone = (st) => log.sets.some((s) => s.exerciseId === st.ex && s.setIndex === st.set);
  const setsOf = (exId) => log.sets.filter((s) => s.exerciseId === exId).sort((a, b) => a.setIndex - b.setIndex);
  const rebuild = () => { S.steps = buildSteps(session, program, log); };
  const curStep = () => S.steps.find((s) => s.key === S.cur) || null;

  function firstUndone(from = 0, wrap = true) {
    const n = S.steps.length;
    for (let k = 0; k < (wrap ? n : n - from); k++) {
      const st = S.steps[(from + k) % n];
      if (!isDone(st)) return st;
    }
    return null;
  }

  async function ensureTarget(exId) {
    if (S.targets[exId]) return S.targets[exId];
    const ex = exOf(exId);
    let hist = [];
    try { hist = await db.getExerciseHistory(exId); } catch (e) { console.error(e); }
    let t;
    try { t = prog.suggest(ex, hist, log.weekType); } catch (e) {
      console.error(e);
      t = { load: null, reps: [], action: 'first', reason: 'Suggestion indisponible' };
    }
    S.histories[exId] = hist;
    S.targets[exId] = t;
    return t;
  }

  function targetReps(st) {
    const t = S.targets[st.ex];
    const ex = exOf(st.ex);
    return t?.reps?.[st.set] ?? t?.reps?.at?.(-1) ?? ex.repMin ?? 10;
  }

  function targetLoad(st) {
    const ex = exOf(st.ex);
    if (ex.unit === 'reps') return 0;
    const t = S.targets[st.ex];
    if (t?.load != null) return t.load;
    const last = S.histories[st.ex]?.at(-1)?.sets?.at(-1);
    return last?.load ?? 0;
  }

  function defaultInput(st) {
    const ex = exOf(st.ex);
    const prev = [...log.sets].reverse().find((s) => s.exerciseId === st.ex);
    const load = ex.unit === 'reps' ? 0 : (prev ? prev.load : targetLoad(st));
    return { load, reps: targetReps(st) };
  }

  // ----- Rendu principal -----

  function stepperHTML(field, value, ex, prefix = '') {
    const isLoad = field === 'load';
    const label = isLoad ? (ex.loadType === 'bodyweight' ? 'Lest' : 'Charge') : (S.hold && curStep()?.kind === 'interval' ? 'Reps de thrusters' : 'Répétitions');
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

  function targetHTML(st) {
    const ex = exOf(st.ex);
    const t = S.targets[st.ex];
    if (!t) return '<div class="target"><div class="lbl">Cible</div><div class="val muted">…</div></div>';
    const reps = targetReps(st);
    const loadTxt = ex.unit === 'reps' ? '' : (t.load == null ? 'charge libre' : fmtLoad(ex, t.load));
    const val = loadTxt ? `${loadTxt} × ${reps}` : `${reps} reps`;
    const all = (t.reps || []).length > 1 ? ` · objectif ${t.reps.join(' / ')}` : '';
    return `<div class="target act-${esc(t.action)}">
      <div class="lbl">Cible</div>
      <div class="val">${esc(val)}</div>
      <div class="reason">${esc(t.reason || '')}${esc(all)}</div>
    </div>`;
  }

  function lastHTML(st) {
    const ex = exOf(st.ex);
    const last = S.histories[st.ex]?.at(-1);
    if (!last) return S.targets[st.ex] ? '<div class="lastline">Première fois sur cet exercice</div>' : '';
    const tag = last.weekType && !['lourde', 'normale'].includes(last.weekType) && !last.isReference ? ` (sem. ${weekLabel(last.weekType).toLowerCase()})` : '';
    return `<div class="lastline">Dernière fois, ${esc(fmtDate(last.date, { day: 'numeric', month: 'short' }))}${esc(tag)} : <b>${esc(fmtSets(ex, last.sets))}</b></div>`;
  }

  function doneSetsHTML(exId) {
    const ex = exOf(exId);
    const sets = setsOf(exId);
    if (!sets.length) return '';
    return `<div class="done-sets">${sets.map((s) => `
      <button class="done-set" data-a="edit" data-ex="${esc(exId)}" data-set="${s.setIndex}" aria-label="Corriger la série ${s.setIndex + 1}">
        ${ICONS.check}<span class="i">S${s.setIndex + 1}</span>${ex.unit === 'reps' ? `${s.reps} reps` : `${esc(fmtN(s.load))} × ${s.reps}`}
      </button>`).join('')}</div>`;
  }

  function cardHTML(st) {
    const ex = exOf(st.ex);
    const total = S.steps.filter((s) => s.ex === st.ex).length;
    const tags = [];
    if (st.block.type === 'superset') {
      const pos = st.block.exercises.indexOf(st.ex);
      const other = st.block.exercises.filter((id) => id !== st.ex).map((id) => exOf(id)?.name).filter(Boolean);
      tags.push(`<span class="chip">Superset ${pos + 1}/${st.block.exercises.length}</span>`);
      if (other.length) tags.push(`<span class="chip">avec ${esc(other.join(', '))}</span>`);
    }
    if (st.kind === 'interval') tags.push('<span class="chip">Intervalle</span>');
    if (ex.undulates) tags.push(`<span class="chip ${esc(log.weekType)}">${esc(weekChip(log.weekType))}</span>`);

    let body = '';
    if (st.kind === 'interval') {
      const phase = S.hold?.phase || 'ready';
      if (phase === 'ready') {
        body = `<div class="steppers">${stepperHTML('load', S.input.load, ex)}</div>
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
        body = `<div class="steppers">${stepperHTML('reps', S.input.reps, ex)}${stepperHTML('load', S.input.load, ex)}</div>`;
      }
    } else {
      body = `<div class="steppers">${ex.unit === 'reps' ? '' : stepperHTML('load', S.input.load, ex)}${stepperHTML('reps', S.input.reps, ex)}</div>`;
    }

    return `<section class="card ex-card">
      ${tags.length ? `<div class="ex-tag">${tags.join('')}</div>` : ''}
      <h1 class="ex-name">${esc(ex.name)}</h1>
      <div class="ex-set">Série <b>${st.set + 1}</b>/${total}</div>
      ${ex.note ? `<div class="ex-note">${esc(ex.note)}</div>` : ''}
      ${targetHTML(st)}
      ${lastHTML(st)}
      ${body}
      ${doneSetsHTML(st.ex)}
      <div class="ex-actions">
        <button class="btn btn-ghost" data-a="addset">+ 1 série</button>
        <button class="btn btn-ghost" data-a="skip">Passer l'exercice</button>
      </div>
    </section>`;
  }

  function draw() {
    if (!live()) return;
    const st = curStep();
    const doneCount = S.steps.filter(isDone).length;
    const pct = S.steps.length ? Math.round((doneCount / S.steps.length) * 100) : 100;
    const blockTxt = st ? `Bloc ${st.blockIdx + 1}/${session.blocks.length}` : 'Terminé';
    const showValidate = st && (st.kind === 'set' || S.hold?.phase === 'done');
    root.className = 'view';
    root.innerHTML = `
      <header class="sess-head">
        <button class="btn icon-btn" data-a="home" aria-label="Retour à l'accueil">${ICONS.home}</button>
        <button class="btn icon-btn" data-a="overview" aria-label="Vue d'ensemble de la séance">${ICONS.list}</button>
        <div class="title"><b>${esc(session.name)}</b><span>${blockTxt} · <span id="chrono">${fmtElapsed(Date.now() - log.startedAt)}</span></span></div>
        <button class="btn btn-ghost end" data-a="finish">Terminer</button>
      </header>
      <div class="progress-bar" aria-hidden="true"><i style="width:${pct}%"></i></div>
      ${st ? cardHTML(st) : `<section class="card all-done">
          <div class="h2">Toutes les séries sont faites</div>
          <p class="muted">Ajoute une série depuis la vue d'ensemble, ou termine la séance.</p>
          <button class="btn btn-primary btn-lg btn-block" data-a="finish">Terminer la séance</button>
          <button class="btn btn-ghost btn-block" data-a="overview" style="margin-top:10px">Vue d'ensemble</button>
        </section>`}
      ${showValidate ? `<div class="validate-bar"><button class="btn btn-primary btn-block" data-a="validate">Valider la série</button></div>` : ''}
    `;
  }

  async function go() {
    const st = curStep();
    if (st) {
      await ensureTarget(st.ex);
      if (!S.input) S.input = defaultInput(st);
    }
    draw();
  }

  function moveTo(st) {
    stopHold();
    S.cur = st ? st.key : null;
    S.input = null;
    S.hold = null;
  }

  // ----- Steppers (vue et modale) -----

  function wireSteppers(el, getState, getEx) {
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

  // ----- Actions -----

  async function validate() {
    const st = curStep();
    if (!st || S.busy) return;
    document.activeElement?.blur?.();
    const ex = exOf(st.ex);
    const load = ex.unit === 'reps' ? 0 : Math.max(0, Number(S.input.load) || 0);
    const reps = Math.max(0, Math.round(Number(S.input.reps) || 0));
    S.busy = true;
    try {
      log.sets = log.sets.filter((s) => !(s.exerciseId === st.ex && s.setIndex === st.set));
      log.sets.push({ exerciseId: st.ex, setIndex: st.set, load, reps, ts: Date.now() });
      await db.saveLog(log);
      timer.vibrate(40);
      await offerRestChange();
      const done = S.steps.find((s) => s.key === st.key) || st;
      const next = firstUndone(done.idx + 1);
      if (!next) { await finish(false); return; }
      moveTo(next);
      ensureTarget(next.ex).catch(() => {});
      if (done.rest > 0) await beginRest(done.rest, done.blockIdx);
      await go();
    } catch (e) {
      console.error(e);
      toast("Échec de l'enregistrement, réessaie");
    } finally {
      S.busy = false;
    }
  }

  async function finish(ask = true) {
    if (ask) {
      if (!log.sets.length) {
        const ok = await confirmDialog({ title: 'Aucune série enregistrée', text: 'Abandonner cette séance ? Elle sera supprimée.', ok: 'Abandonner', danger: true });
        if (!ok) return;
        stopRestUI(false);
        await db.deleteLog(log.id);
        navigate('#/');
        return;
      }
      const ok = await confirmDialog({ title: 'Terminer la séance ?', text: `${log.sets.length} série(s) enregistrée(s).`, ok: 'Terminer' });
      if (!ok) return;
    }
    stopRestUI(false);
    stopHold();
    log.restEndsAt = null;
    log.restTotal = null;
    await db.saveLog(log);
    await db.finishLog(log.id);
    navigate(`#/recap/${encodeURIComponent(log.id)}`);
  }

  async function addSet(exId) {
    log.extraSets = { ...(log.extraSets || {}), [exId]: (log.extraSets?.[exId] || 0) + 1 };
    await db.saveLog(log);
    rebuild();
    toast(`Série ajoutée : ${exOf(exId).name}`);
  }

  async function skipExercise() {
    const st = curStep();
    if (!st) return;
    const ok = await confirmDialog({ title: `Passer ${exOf(st.ex).name} ?`, text: "Les séries déjà faites sont gardées. Tu pourras le reprendre depuis la vue d'ensemble.", ok: 'Passer' });
    if (!ok) return;
    log.skipped = [...new Set([...(log.skipped || []), st.ex])];
    await db.saveLog(log);
    rebuild();
    const startIdx = S.steps.findIndex((s) => s.blockIdx >= st.blockIdx);
    moveTo(firstUndone(startIdx < 0 ? 0 : startIdx));
    await go();
  }

  function openEdit(exId, setIndex) {
    const ex = exOf(exId);
    const set = log.sets.find((s) => s.exerciseId === exId && s.setIndex === setIndex);
    if (!set) return;
    const state = { load: set.load, reps: set.reps };
    const m = openModal(`
      <div class="h2">Corriger la série ${setIndex + 1}</div>
      <div class="muted">${esc(ex.name)}</div>
      <div class="steppers">${ex.unit === 'reps' ? '' : stepperHTML('load', state.load, ex, 'e-')}${stepperHTML('reps', state.reps, ex, 'e-')}</div>
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
        toast('Série corrigée');
        await go();
      } else if (a === 'del') {
        log.sets = log.sets.filter((s) => s !== set);
        await db.saveLog(log);
        close();
        if (!curStep()) moveTo(firstUndone(0));
        toast('Série supprimée');
        await go();
      }
    });
    wireSteppers(m.el, () => state, () => ex);
  }

  function openOverview() {
    const st = curStep();
    const skipped = new Set(log.skipped || []);
    const blocks = session.blocks.map((block, bi) => {
      const steps = S.steps.filter((s) => s.blockIdx === bi);
      const allSkipped = block.exercises.every((id) => skipped.has(id));
      const done = steps.every(isDone);
      const current = st && st.blockIdx === bi;
      const cls = current ? 'current' : done ? 'done' : '';
      const label = block.type === 'superset' ? 'Superset' : block.type === 'interval' ? 'Intervalle' : 'Exercice';
      const rows = block.exercises.filter((id) => exOf(id)).map((id) => {
        const planned = S.steps.filter((s) => s.ex === id).length;
        const made = setsOf(id).length;
        const isSkipped = skipped.has(id);
        return `<div class="ov-ex${isSkipped ? ' skipped' : ''}">
          <span class="nm">${esc(exOf(id).name)}</span>
          <span class="ct">${isSkipped ? 'passé' : `${made}/${planned}`}</span>
          ${isSkipped
            ? `<button class="btn btn-sm btn-ghost" data-a="unskip" data-ex="${esc(id)}">Reprendre</button>`
            : `<button class="btn btn-sm btn-ghost" data-a="plus" data-ex="${esc(id)}" aria-label="Ajouter une série à ${esc(exOf(id).name)}">+ 1</button>`}
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
        const target = S.steps.find((s) => s.blockIdx === bi && !isDone(s));
        if (!target) { toast('Bloc terminé. Ajoute une série avec « + 1 ».'); return; }
        close();
        moveTo(target);
        await go();
      } else if (a === 'plus') {
        const id = b.dataset.ex;
        await addSet(id);
        close();
        const cur = curStep();
        if (!cur || cur.ex !== id) moveTo(S.steps.find((s) => s.ex === id && !isDone(s)));
        await go();
      } else if (a === 'unskip') {
        const id = b.dataset.ex;
        log.skipped = (log.skipped || []).filter((x) => x !== id);
        await db.saveLog(log);
        rebuild();
        close();
        const target = S.steps.find((s) => s.ex === id && !isDone(s));
        if (target) moveTo(target);
        await go();
      }
    });
  }

  // ----- Maintien (wall ball) -----

  function stopHold() {
    S.hold?.cd?.stop();
  }

  function startHold() {
    const st = curStep();
    if (!st) return;
    timer.unlockAudio();
    timer.vibrate(200);
    const cd = new timer.Countdown({
      onTick: (left) => {
        const el = root.querySelector('#hold-time');
        if (el) el.textContent = String(Math.ceil(left / 1000));
      },
      onEnd: (late) => {
        if (late < 30000) timer.alertEnd(S.soundOn);
        S.hold = { phase: 'done' };
        draw();
      },
    });
    S.hold = { phase: 'running', cd };
    draw();
    cd.start(Date.now() + st.hold * 1000);
  }

  // ----- Repos -----

  function nextPreviewHTML() {
    const st = curStep();
    if (!st) return '';
    const ex = exOf(st.ex);
    const t = S.targets[st.ex];
    const total = S.steps.filter((s) => s.ex === st.ex).length;
    let tgt = '';
    if (t) {
      const reps = targetReps(st);
      const load = ex.unit === 'reps' ? '' : fmtLoad(ex, defaultInput(st).load);
      tgt = `Cible <b>${esc(load ? `${load} × ${reps}` : `${reps} reps`)}</b>`;
    }
    return `<div class="card"><div class="k">Ensuite</div>
      <div class="n">${esc(ex.name)}</div>
      <div class="t">Série ${st.set + 1}/${total}${tgt ? ` · ${tgt}` : ''}</div></div>`;
  }

  // Repos ajusté avec ±15 s : proposé à la validation suivante comme nouveau repos du bloc
  async function offerRestChange() {
    const p = log.pendingRest;
    if (!p) return;
    log.pendingRest = null;
    await db.saveLog(log);
    const block = session.blocks[p.blockIdx];
    if (!block) return;
    const names = block.exercises.map((id) => exOf(id)?.name).filter(Boolean).join(' + ');
    const ok = await confirmDialog({
      title: `Garder ${timer.fmtClock(p.seconds * 1000)} de repos ?`,
      text: `Tu as ajusté le repos après ${names}. L'appliquer à ce bloc, pour la suite de la séance et les prochaines ?`,
      ok: 'Appliquer', cancel: 'Non',
    });
    if (!ok) return;
    block.rest = p.seconds;
    await db.saveProgram(program);
    rebuild();
    toast('Repos du bloc mis à jour');
  }

  async function beginRest(seconds, blockIdx) {
    try { S.soundOn = await db.getSetting('soundOn', true); } catch { /* garde la valeur */ }
    const endsAt = Date.now() + seconds * 1000;
    log.restEndsAt = endsAt;
    log.restTotal = seconds * 1000;
    log.restInfo = { blockIdx, planned: seconds, adjusted: seconds };
    await db.saveLog(log);
    showRest(endsAt, seconds * 1000);
  }

  function stopRestUI(persist = true, keepBeep = false) {
    if (!keepBeep) timer.cancelScheduledBeep();
    timer.stopRest();
    S.restEl?.remove();
    S.restEl = null;
    if (persist && (log.restEndsAt || log.restInfo)) {
      const ri = log.restInfo;
      if (ri && ri.blockIdx != null && ri.adjusted > 0 && ri.adjusted !== ri.planned) {
        log.pendingRest = { blockIdx: ri.blockIdx, seconds: ri.adjusted };
      }
      log.restEndsAt = null;
      log.restTotal = null;
      log.restInfo = null;
      db.saveLog(log).catch(console.error);
    }
  }

  function showRest(endsAt, totalMs) {
    S.restEl?.remove();
    const C = 2 * Math.PI * 54;
    const el = document.createElement('div');
    el.className = 'rest';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Repos');
    el.innerHTML = `
      <div class="lbl">Repos</div>
      <div class="ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="54"/>
        <circle class="fg" cx="60" cy="60" r="54" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="0"/></svg>
        <div class="time" role="timer">${timer.fmtClock(Math.max(0, endsAt - Date.now()))}</div></div>
      <div class="rest-next">${nextPreviewHTML()}</div>
      <div class="rest-ctrl">
        <div class="rest-adj">
          <button class="btn" data-a="minus">&minus;15 s</button>
          <button class="btn" data-a="plus">+15 s</button>
        </div>
        <button class="btn btn-primary skip" data-a="skip">Passer</button>
      </div>`;
    document.body.append(el);
    S.restEl = el;
    const timeEl = el.querySelector('.time');
    const fg = el.querySelector('.fg');
    const ring = el.querySelector('.ring');

    const st = curStep();
    if (st && !S.targets[st.ex]) {
      ensureTarget(st.ex).then(() => {
        const nx = el.querySelector('.rest-next');
        if (nx) nx.innerHTML = nextPreviewHTML();
      }).catch(() => {});
    }

    el.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      timer.unlockAudio();
      if (a === 'skip') { stopRestUI(true); return; }
      const ends = timer.addTime(a === 'plus' ? 15 : -15);
      if (S.soundOn) timer.scheduleBeep((ends - Date.now()) / 1000);
      const rs = timer.restState();
      if (rs) {
        log.restEndsAt = ends;
        log.restTotal = rs.total;
        if (log.restInfo) log.restInfo.adjusted = Math.max(15, log.restInfo.adjusted + (a === 'plus' ? 15 : -15));
        db.saveLog(log).catch(console.error);
      }
    });

    timer.resumeRest(endsAt, totalMs, {
      onTick: (left, total) => {
        timeEl.textContent = timer.fmtClock(left);
        fg.setAttribute('stroke-dashoffset', String(C * (1 - (total ? left / total : 0))));
        ring.classList.toggle('soon', left <= 10000);
      },
      onEnd: (late) => {
        const beeped = timer.hasScheduledBeep();
        if (late < 30000) {
          timer.alertEnd(S.soundOn && !beeped);
          toast("C'est reparti");
        }
        stopRestUI(true, true);
        setTimeout(() => timer.cancelScheduledBeep(), 1500);
      },
    });
    if (S.soundOn) timer.scheduleBeep((endsAt - Date.now()) / 1000);
  }

  // ----- Événements -----

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'validate') validate();
    else if (a === 'home') navigate('#/');
    else if (a === 'finish') finish(true);
    else if (a === 'overview') openOverview();
    else if (a === 'skip') skipExercise();
    else if (a === 'addset') { const st = curStep(); if (st) { await addSet(st.ex); await go(); } }
    else if (a === 'edit') openEdit(b.dataset.ex, Number(b.dataset.set));
    else if (a === 'hold-start') startHold();
    else if (a === 'hold-stop' || a === 'hold-skip') { stopHold(); S.hold = { phase: 'done' }; draw(); }
  });
  wireSteppers(root, () => S.input, () => { const st = curStep(); return st ? exOf(st.ex) : null; });

  const unlock = () => timer.unlockAudio();
  document.addEventListener('pointerdown', unlock, { passive: true });
  const chrono = setInterval(() => {
    const el = root.querySelector('#chrono');
    if (el) el.textContent = fmtElapsed(Date.now() - log.startedAt);
  }, 1000);

  const teardown = () => {
    clearInterval(chrono);
    document.removeEventListener('pointerdown', unlock);
    stopHold();
    timer.stopRest();
    S.restEl?.remove();
    closeAllModals();
    timer.releaseWakeLock();
  };
  if (!live()) { teardown(); return; }
  cleanup = teardown;

  // ----- Démarrage / reprise -----

  timer.requestWakeLock();
  rebuild();
  moveTo(firstUndone(0));
  await go();
  if (!live()) return;
  if (log.restEndsAt && log.restEndsAt > Date.now()) {
    showRest(log.restEndsAt, log.restTotal || Math.max(1000, log.restEndsAt - Date.now()));
  } else if (log.restEndsAt) {
    log.restEndsAt = null;
    log.restTotal = null;
    db.saveLog(log).catch(console.error);
  }
}

// ---------- Récap ----------

async function renderRecap(root, live, logId) {
  const log = logId ? await db.getLog(logId) : null;
  if (!live()) return;
  if (!log) { root.className = 'view'; root.innerHTML = errorCard('Séance introuvable'); return; }
  if (log.status !== 'done') { navigate('#/session'); return; }
  const program = await db.getProgram();
  const session = program.sessions.find((s) => s.id === log.sessionId);
  const recent = await db.listLogs({ sessionId: log.sessionId, limit: 50 });
  const idx = recent.findIndex((l) => l.id === log.id);
  const prev = idx >= 0 ? recent[idx + 1] : recent.find((l) => l.id !== log.id);

  const sets = log.sets || [];
  const order = [];
  (session?.blocks || []).forEach((b) => b.exercises.forEach((id) => { if (!order.includes(id)) order.push(id); }));
  sets.forEach((s) => { if (!order.includes(s.exerciseId)) order.push(s.exerciseId); });
  const doneIds = order.filter((id) => sets.some((s) => s.exerciseId === id));

  const score = (s) => (s.load > 0 ? prog.e1rm(s.load, s.reps) : 0);
  const rows = await Promise.all(doneIds.map(async (id) => {
    const ex = program.exercises[id] || { id, name: id, unit: 'kg' };
    const mine = sets.filter((s) => s.exerciseId === id).sort((a, b) => a.setIndex - b.setIndex);
    let hist = [];
    try { hist = (await db.getExerciseHistory(id)).filter((h) => h.logId !== log.id && h.date <= log.date); } catch { /* rien */ }
    const before = hist.flatMap((h) => h.sets || []);
    let badge = '';
    if (!before.length) badge = '<span class="chip">Première</span>';
    else {
      const best = Math.max(...mine.map(score));
      if (best > 0) {
        if (best > Math.max(0, ...before.map(score)) + 1e-9) badge = `<span class="chip record">Record e1RM ${fmtN(Math.round(best * 10) / 10)} kg</span>`;
      } else {
        const bw = before.filter((s) => !(s.load > 0)).map((s) => s.reps);
        const bestReps = Math.max(...mine.map((s) => s.reps));
        if (bw.length && bestReps > Math.max(...bw)) badge = `<span class="chip record">Record ${bestReps} reps</span>`;
      }
    }
    const txt = mine.map((s) => (ex.unit === 'reps' ? `${s.reps}` : `${fmtN(s.load)} × ${s.reps}`)).join(' · ');
    return `<li class="list-item recap-ex">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><b class="wrap">${esc(ex.name)}</b>${badge}</div>
      <div class="sets">${esc(txt)}${ex.unit === 'reps' ? ' reps' : ''}</div>
    </li>`;
  }));
  if (!live()) return;

  const vol = volumeOf(log);
  let cmp = '<span class="muted">Pas de séance précédente</span>';
  if (prev) {
    const pv = volumeOf(prev);
    const d = vol - pv;
    const pct = pv > 0 ? Math.round((d / pv) * 100) : null;
    const cls = d > 0 ? 'delta-up' : d < 0 ? 'delta-down' : '';
    cmp = `<span class="${cls}">${d >= 0 ? '+' : '−'}${fmtVolume(Math.abs(d))}${pct != null ? ` (${pct >= 0 ? '+' : '−'}${Math.abs(pct)} %)` : ''}</span>
      <div class="muted small" style="font-weight:400;font-size:14px">vs ${esc(fmtDate(prev.date))} · ${fmtVolume(pv)}</div>`;
  }
  const records = rows.filter((r) => r.includes('chip record')).length;

  root.className = 'view';
  root.innerHTML = `
    <div class="muted">${esc(fmtDate(log.date, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
    <h1 class="h1">${esc(session?.name || log.sessionId)} terminée</h1>
    <div class="week"><span class="chip ${esc(log.weekType)}">${esc(weekChip(log.weekType))}</span>
      ${records ? `<span class="chip record">${records} record${records > 1 ? 's' : ''}</span>` : ''}</div>
    <div class="recap-stats">
      <div class="stat"><div class="k">Durée</div><div class="v">${esc(fmtDuration((log.endedAt || 0) - (log.startedAt || 0)) || '–')}</div></div>
      <div class="stat"><div class="k">Volume</div><div class="v">${fmtVolume(vol)}</div></div>
      <div class="stat wide"><div class="k">Par rapport à la précédente</div><div class="v" style="font-size:22px">${cmp}</div></div>
    </div>
    <div class="section-title">Exercices · ${sets.length} séries</div>
    ${rows.length ? `<ul class="list">${rows.join('')}</ul>` : '<p class="muted">Aucune série.</p>'}
    <div class="section-title">Note</div>
    <textarea class="note" id="note" placeholder="Sensations, douleurs, matériel pris…">${esc(log.note || '')}</textarea>
    <button class="btn btn-primary btn-lg btn-block" data-a="home" style="margin-top:16px">Retour à l'accueil</button>
  `;

  const noteEl = root.querySelector('#note');
  let saveTimer = null;
  const saveNote = async () => {
    clearTimeout(saveTimer);
    const v = noteEl.value.trim();
    if ((log.note || '') === v) return;
    log.note = v;
    try { await db.saveLog(log); } catch (e) { console.error(e); toast("La note n'a pas pu être enregistrée"); }
  };
  noteEl.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNote, 700); });
  noteEl.addEventListener('blur', saveNote);
  root.querySelector('[data-a="home"]').addEventListener('click', async () => { await saveNote(); navigate('#/'); });
  if (live()) cleanup = () => { saveNote(); };
}

// ---------- Démarrage ----------

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  try {
    await db.init();
  } catch (e) {
    console.error(e);
    appEl.innerHTML = `<div class="view">${errorCard("Impossible d'ouvrir la base de données", e)}</div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
