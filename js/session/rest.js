// Écran de repos : minuteur plein écran, ±15 s, bip programmé, aperçu de la suite,
// et offre de garder un repos ajusté. S = état de la séance (voir view.js).
import * as db from '../db.js';
import * as timer from '../timer.js';
import { esc, confirmDialog } from '../ui.js';
import { mediaHTML } from '../media.js';
import { restGroup, stepCount } from './steps.js';
import { extraOfferHTML } from './cards.js';

export function nextPreviewHTML(S) {
  const st = S.curStep();
  if (!st) return '';
  const ex = S.exOf(st.ex);
  // Superset : les exos de la paire qui restent à faire dans ce tour, chacun avec sa charge
  const group = restGroup(S.steps, S.log, st);
  const rows = group.map((g) => {
    const gx = S.exOf(g.ex);
    const total = stepCount(S.steps, g.ex);
    const thumb = group.length > 1 ? mediaHTML(g.ex, { size: 'mini', alt: gx.name }) : '';
    return `<div class="next-row">${thumb}<div class="n">${esc(gx.name)}</div>
      <div class="t">Série ${g.set + 1}/${total}</div><b class="next-load tnum">${esc(S.planLabel(g.ex, g.set))}</b></div>`;
  }).join('');
  return `<div class="card next-card${group.length > 1 ? ' multi' : ''}">${group.length > 1 ? '' : mediaHTML(st.ex, { size: 'mini', alt: ex.name })}<div class="next-txt"><div class="k">${group.length > 1 ? 'Ensuite · superset' : 'Ensuite'}</div>
    ${rows}</div></div>`;
}

// Repos ajusté avec ±15 s : proposé à la validation suivante comme nouveau repos du bloc
export async function offerRestChange(S) {
  const { log } = S;
  const p = log.pendingRest;
  if (!p) return;
  log.pendingRest = null;
  await db.saveLog(log);
  const block = S.session.blocks[p.blockIdx];
  if (!block) return;
  const names = block.exercises.map((id) => S.exOf(id)?.name).filter(Boolean).join(' + ');
  const ok = await confirmDialog({
    title: `Garder ${timer.fmtClock(p.seconds * 1000)} de repos ?`,
    text: `Tu as ajusté le repos après ${names}. L'appliquer à ce bloc, pour la suite de la séance et les prochaines ?`,
    ok: 'Appliquer', cancel: 'Non',
  });
  if (!ok) return;
  await S.saveBlockRest(p.blockIdx, p.seconds);
  S.rebuild();
  S.ctx.toast('Repos du bloc mis à jour');
}

export async function beginRest(S, seconds, blockIdx) {
  const { log } = S;
  try { S.soundOn = await db.getSetting('soundOn', true); } catch { /* garde la valeur */ }
  const endsAt = Date.now() + seconds * 1000;
  log.restEndsAt = endsAt;
  log.restTotal = seconds * 1000;
  log.restInfo = { blockIdx, planned: seconds, adjusted: seconds };
  await db.saveLog(log);
  showRest(S, endsAt, seconds * 1000);
}

export function stopRestUI(S, persist = true, keepBeep = false) {
  const { log } = S;
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

export function showRest(S, endsAt, totalMs) {
  const { log } = S;
  // Rappel affiché pendant le repos des ancres (renfo moyen fessier)
  const cue = S.session.blocks[log.restInfo?.blockIdx]?.cue;
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
    ${extraOfferHTML(S)}
    ${cue ? `<div class="rest-cue">${esc(cue)}</div>` : ''}
    <div class="rest-next">${nextPreviewHTML(S)}</div>
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

  const st = S.curStep();
  const need = st ? st.block.exercises.filter((id) => S.exOf(id) && !S.targets[id]) : [];
  if (need.length) {
    Promise.all(need.map((id) => S.ensureTarget(id))).then(() => {
      const nx = el.querySelector('.rest-next');
      if (nx) nx.innerHTML = nextPreviewHTML(S);
    }).catch(() => {});
  }

  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    timer.unlockAudio();
    if (a === 'skip') { stopRestUI(S, true); return; }
    if (a === 'extra') { S.acceptExtra(); return; }
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
        S.ctx.toast("C'est reparti");
      }
      stopRestUI(S, true, true);
      setTimeout(() => timer.cancelScheduledBeep(), 1500);
    },
  });
  if (S.soundOn) timer.scheduleBeep((endsAt - Date.now()) / 1000);
}

// Reprise après rechargement : repos encore en cours, ou terminé pendant l'absence.
export function resumeRestOnLoad(S) {
  const { log } = S;
  if (log.restEndsAt && log.restEndsAt > Date.now()) {
    showRest(S, log.restEndsAt, log.restTotal || Math.max(1000, log.restEndsAt - Date.now()));
  } else if (log.restEndsAt) {
    log.restEndsAt = null;
    log.restTotal = null;
    db.saveLog(log).catch(console.error);
  }
}
