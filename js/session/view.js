// Vue Séance en cours : état, navigation entre les séries, validation, maintien wall ball.
// La logique pure est dans steps.js et prefill.js, le HTML dans cards.js, le repos dans rest.js.
import * as db from '../db.js';
import * as prog from '../progression.js';
import * as plans from '../plan.js';
import { testsForLog } from '../cycles.js';
import { detectRecord, recordExcluded } from '../records.js';
import * as timer from '../timer.js';
import { fmtLoad, fmtElapsed, closeAllModals, confirmDialog, repsTxt } from '../ui.js';
import { buildSteps, isStepDone, setsOf, firstUndone, stepAfterSkip, isLastSetOf } from './steps.js';
import { plannedInput } from './prefill.js';
import { screenHTML } from './cards.js';
import { wireSteppers, openEdit, openOverview } from './dialogs.js';
import { nextPreviewHTML, offerRestChange, beginRest, stopRestUI, resumeRestOnLoad } from './rest.js';

export async function renderSession(root, { live, ctx, setCleanup }) {
  const { toast, navigate } = ctx;
  const log = await db.getActiveLog();
  if (!live()) return;
  if (!log) { toast('Aucune séance en cours'); navigate('#/'); return; }
  const [{ plan, program, session }, soundOn] = await Promise.all([plans.sessionForLog(log), db.getSetting('soundOn', true)]);
  if (!live()) return;
  if (!session) throw new Error(`Séance « ${log.sessionId} » introuvable dans le programme`);
  log.sets = log.sets || [];
  // Facteurs du jour figés au démarrage : rampe jambes, reprise à 90 %, etc.
  const factors = { legFactor: log.legFactor, loadFactor: log.adjust?.loadFactor };
  const exIds = [...new Set(session.blocks.flatMap((b) => b.exercises))];
  let tests = [];
  try { tests = await Promise.all(testsForLog(plan.resolved, log, exIds).map(async (t) => ({ test: t, ref: await plans.refText(t) }))); } catch (e) { console.error(e); }

  // État partagé avec cards.js, dialogs.js et rest.js
  const S = {
    root, live, ctx, log, program, session, soundOn,
    steps: [], cur: null, input: null, hold: null,
    targets: {}, histories: {}, busy: false, restEl: null, offerExtra: null, tests,
  };
  const exOf = (id) => program.exercises[id];
  S.exOf = exOf;
  S.isDone = (st) => isStepDone(log, st);
  S.setsOf = (exId) => setsOf(log, exId);
  S.rebuild = () => { S.steps = buildSteps(session, program, log); };
  S.curStep = () => S.steps.find((s) => s.key === S.cur) || null;
  S.firstUndone = (from = 0) => firstUndone(S.steps, log, from);

  S.ensureTarget = async (exId) => {
    if (S.targets[exId]) return S.targets[exId];
    const ex = exOf(exId);
    let hist = [];
    try { hist = await db.getExerciseHistory(exId); } catch (e) { console.error(e); }
    let t;
    try { t = prog.suggest(ex, hist, log.weekType, factors); } catch (e) {
      console.error(e);
      t = { load: null, reps: [], action: 'first', reason: 'Suggestion indisponible' };
    }
    S.histories[exId] = hist;
    S.targets[exId] = t;
    return t;
  };

  S.plannedInput = (exId, setIdx) => plannedInput({
    exId, ex: exOf(exId), setIdx,
    history: S.histories[exId], target: S.targets[exId], sets: log.sets, weekType: log.weekType, factors,
  });

  S.planLabel = (exId, setIdx) => {
    const ex = exOf(exId);
    const p = S.plannedInput(exId, setIdx);
    return ex.unit === 'reps' ? repsTxt(ex, p.reps) : `${fmtLoad(ex, p.load)} × ${repsTxt(ex, p.reps)}`;
  };

  // ----- Rendu -----

  S.draw = () => {
    if (!live()) return;
    root.className = 'view';
    root.innerHTML = screenHTML(S);
  };

  S.go = async () => {
    const st = S.curStep();
    if (st) {
      await S.ensureTarget(st.ex);
      if (st.block.type === 'superset') {
        await Promise.all(st.block.exercises.filter((id) => exOf(id)).map((id) => S.ensureTarget(id).catch(() => {})));
      }
      if (!S.input) {
        S.input = S.plannedInput(st.ex, st.set);
        if (st.kind === 'emom' && st.block.repsPerMinute) S.input.reps = st.block.repsPerMinute;
      }
    }
    S.draw();
  };

  S.moveTo = (st) => {
    stopHold();
    S.cur = st ? st.key : null;
    S.input = null;
    S.hold = null;
  };

  // ----- Actions -----

  async function validate() {
    const st = S.curStep();
    if (!st || S.busy) return;
    document.activeElement?.blur?.();
    const ex = exOf(st.ex);
    const load = ex.unit === 'reps' ? 0 : Math.max(0, Number(S.input.load) || 0);
    const reps = Math.max(0, Math.round(Number(S.input.reps) || 0));
    S.busy = true;
    try {
      log.sets = log.sets.filter((s) => !(s.exerciseId === st.ex && s.setIndex === st.set));
      const earlier = log.sets.filter((s) => s.exerciseId === st.ex);
      log.sets.push({ exerciseId: st.ex, setIndex: st.set, load, reps, ts: Date.now() });
      await db.saveLog(log);
      const record = recordExcluded(ex, log) ? null : detectRecord(ex, { load, reps }, S.histories[st.ex], earlier);
      if (record) { timer.vibrate([60, 40, 60, 40, 160]); toast(record.text, 3500); } else timer.vibrate(40);
      await offerRestChange(S);
      // Les étapes ont pu être reconstruites (repos du bloc modifié) : on reprend la version à jour
      const done = S.steps.find((s) => s.key === st.key) || st;
      // Dernière série de l'exo : on propose discrètement d'en ajouter une, jusqu'à la prochaine validation
      S.offerExtra = isLastSetOf(S.steps, st) ? st.ex : null;
      const next = S.firstUndone(done.idx + 1);
      if (!next) {
        // Fin de séance : on laisse la place à une série de plus avant de terminer
        if (S.offerExtra) { S.moveTo(null); S.draw(); return; }
        await finish(false); return;
      }
      S.moveTo(next);
      S.ensureTarget(next.ex).catch(() => {});
      const rest = done.kind === 'emom' ? emomRest(done) : done.rest;
      if (rest > 0) await beginRest(S, rest, done.blockIdx);
      await S.go();
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
        stopRestUI(S, false);
        await db.deleteLog(log.id);
        navigate('#/');
        return;
      }
      const ok = await confirmDialog({ title: 'Terminer la séance ?', text: `${log.sets.length} série(s) enregistrée(s).`, ok: 'Terminer' });
      if (!ok) return;
    }
    stopRestUI(S, false);
    stopHold();
    log.restEndsAt = null;
    log.restTotal = null;
    await db.saveLog(log);
    await db.finishLog(log.id);
    navigate(`#/recap/${encodeURIComponent(log.id)}`);
  }

  S.addSet = async (exId) => {
    log.extraSets = { ...(log.extraSets || {}), [exId]: (log.extraSets?.[exId] || 0) + 1 };
    await db.saveLog(log);
    S.rebuild();
    toast(`Série ajoutée : ${exOf(exId).name}`);
  };

  S.acceptExtra = async () => {
    const exId = S.offerExtra;
    if (!exId) return;
    S.offerExtra = null;
    await S.addSet(exId);
    const cur = S.curStep();
    const added = [...S.steps].reverse().find((s) => s.ex === exId);
    // Superset en cours dans le même bloc : la série ajoutée viendra à son tour ; sinon on y va directement
    if (!cur || !added || cur.blockIdx !== added.blockIdx) S.moveTo(added || cur);
    if (S.restEl) {
      const nx = S.restEl.querySelector('.rest-next');
      if (nx && S.curStep()) { await S.ensureTarget(S.curStep().ex).catch(() => {}); nx.innerHTML = nextPreviewHTML(S); }
      // Le repos a pu se terminer pendant l'attente ci-dessus
      S.restEl?.querySelector('.extra-offer')?.remove();
    }
    await S.go();
  };

  async function skipExercise() {
    const st = S.curStep();
    if (!st) return;
    const ok = await confirmDialog({ title: `Passer ${exOf(st.ex).name} ?`, text: "Les séries déjà faites sont gardées. Tu pourras le reprendre depuis la vue d'ensemble.", ok: 'Passer' });
    if (!ok) return;
    log.skipped = [...new Set([...(log.skipped || []), st.ex])];
    await db.saveLog(log);
    S.rebuild();
    S.moveTo(stepAfterSkip(S.steps, log, st.blockIdx));
    await S.go();
  }

  // ----- EMOM : la minute démarre au premier appui, le repos va jusqu'à la minute suivante -----

  function emomRest(st) {
    const start = log.emom?.[st.block.id];
    if (!start) return 0;
    return Math.max(0, Math.ceil((start + (st.set + 1) * 60000 - Date.now()) / 1000));
  }

  async function startEmom() {
    const st = S.curStep();
    if (!st) return;
    timer.unlockAudio();
    timer.vibrate(200);
    log.emom = { ...(log.emom || {}), [st.block.id]: Date.now() - st.set * 60000 };
    await db.saveLog(log);
    S.draw();
  }

  S.saveBlockRest = (blockIdx, seconds) => {
    const block = session.blocks[blockIdx];
    if (block) block.rest = seconds;
    return plans.saveBlockRest(log, session.id, block?.id, seconds);
  };

  // ----- Maintien (wall ball) -----

  function stopHold() {
    S.hold?.cd?.stop();
  }

  function startHold() {
    const st = S.curStep();
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
        S.draw();
      },
    });
    S.hold = { phase: 'running', cd };
    S.draw();
    cd.start(Date.now() + st.hold * 1000);
  }

  // ----- Événements -----

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'validate') validate();
    else if (a === 'extra') S.acceptExtra();
    else if (a === 'home') navigate('#/');
    else if (a === 'finish') finish(true);
    else if (a === 'overview') openOverview(S);
    else if (a === 'skip') skipExercise();
    else if (a === 'addset') { const st = S.curStep(); if (st) { await S.addSet(st.ex); await S.go(); } }
    else if (a === 'edit') openEdit(S, b.dataset.ex, Number(b.dataset.set));
    else if (a === 'hold-start') startHold();
    else if (a === 'emom-start') startEmom();
    else if (a === 'hold-stop' || a === 'hold-skip') { stopHold(); S.hold = { phase: 'done' }; S.draw(); }
  });
  wireSteppers(root, () => S.input, () => { const st = S.curStep(); return st ? exOf(st.ex) : null; });

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
  setCleanup(teardown);

  // ----- Démarrage / reprise -----

  timer.requestWakeLock();
  S.rebuild();
  S.moveTo(S.firstUndone(0));
  await S.go();
  if (!live()) return;
  resumeRestOnLoad(S);
}
