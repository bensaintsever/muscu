// Vue Accueil : bloc en cours, défis, séance du jour, reprise, démarrage d'une séance.
import * as db from '../db.js';
import * as prog from '../progression.js';
import * as plans from '../plan.js';
import * as cy from '../cycles.js';
import * as timer from '../timer.js';
import { today, todayISO } from '../clock.js';
import { applyAdjust } from '../layers.js';
import { estimateMinutes } from '../session/steps.js';
import { esc, fmtDate, fmtVolume, volumeOf, weekChip, WEEKDAYS, confirmDialog } from '../ui.js';
import { cycleCardHTML, challengeCardHTML, dayLineHTML } from './cycle-card.js';

const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

const hasUndulating = (session, program) =>
  session.blocks.some((b) => b.exercises.some((id) => program.exercises[id]?.undulates));

function sessionOf(plan, day) {
  const p = plans.programFor(plan, day.from);
  const session = p.sessions.find((s) => s.id === day.sessionId && !s.borrowed) || p.sessions.find((s) => s.id === day.sessionId);
  return session ? { session, program: p } : null;
}

export async function renderHome(root, { live, ctx }) {
  const now = today();
  const iso = todayISO();
  const [{ plan, day, program }, active, logs] = await Promise.all([plans.activeProgram(iso), db.getActiveLog(), db.listLogs()]);
  const weekTests = cy.testsInWeek(plan.resolved, iso);
  const verdicts = await Promise.all(weekTests.map((t) => plans.weekVerdict(t, logs).then((result) => ({ test: t, result }))));
  if (!live()) return;

  // Séance mise en avant : celle du jour, sinon la prochaine prévue
  let hero = null;
  if (day.sessionId) {
    const found = sessionOf(plan, day);
    if (found) hero = { ...found, day, planned: true, kicker: "Aujourd'hui", note: day.note };
  } else {
    const next = cy.nextPlanned(plan.resolved, iso, { race: plan.race });
    const found = next && sessionOf(plan, { ...next, ...(plan.override ? { weekType: plan.override } : {}) });
    if (found) {
      const when = next.inDays === 1 ? 'demain' : `${WEEKDAYS[cy.weekdayOf(next.iso)]} ${fmtDate(next.iso, { day: 'numeric', month: 'numeric' })}`;
      hero = { ...found, day: next, planned: true, kicker: `Prochaine séance : ${when}`, note: next.note };
    }
  }
  const entries = [];
  if (hero) entries.push(hero);
  for (const s of program.sessions) {
    if (s.scheduledOnly) continue;
    if (hero && s.id === hero.session.id) continue;
    entries.push({ session: s, program, day, planned: false });
  }

  const lastOf = (id) => logs.find((l) => l.sessionId === id) || null;
  const activeName = active ? (program.sessions.find((s) => s.id === active.sessionId)?.name || active.sessionId) : '';

  const card = (e, i) => {
    const s = e.session;
    const isHero = e === hero;
    const adj = applyAdjust(e.program, s, { ...(e.planned ? e.day.adjust : e.day.week?.adjust), ...(s.adjust || {}) });
    const ids = adj.session.blocks.flatMap((b) => b.exercises).filter((id) => adj.program.exercises[id]);
    const nSets = ids.reduce((a, id) => a + (adj.program.exercises[id]?.sets || 0), 0);
    const last = lastOf(s.id);
    const lastTxt = last ? `Dernière fois ${fmtDate(last.date)} · ${fmtVolume(volumeOf(last))}` : 'Jamais faite';
    const warn = day.weekType === 'aucune' && hasUndulating(s, e.program);
    const tags = [s.home ? 'Sans salle' : '', s.borrowed ? 'Reprise du bloc précédent' : ''].filter(Boolean).join(' · ');
    return `<button class="sess-card${isHero ? ' hero' : ''}" data-start="${i}">
      ${isHero ? `<div class="kicker">${esc(e.kicker)}</div>` : ''}
      <div class="name">${esc(s.name)}</div>
      <div class="meta">${plural(new Set(ids).size, 'exercice')} · ${plural(nSets, 'série')} · ~${estimateMinutes(adj.session, adj.program)} min</div>
      ${isHero && e.note ? `<div class="meta hero-note">${esc(e.note)}</div>` : ''}
      ${tags ? `<div class="meta">${esc(tags)}</div>` : ''}
      <div class="meta">${esc(lastTxt)}</div>
      ${warn ? '<div class="warn-line">Pas de jambes cette semaine</div>' : ''}
      ${isHero ? '<div class="go">Démarrer</div>' : ''}
    </button>`;
  };

  const semiWeek = iso <= cy.semiDate() ? prog.weekInfo(iso) : null;
  const weekLabel = semiWeek?.week || (day.week?.label ?? '');
  const note = plan.override ? '' : (semiWeek?.note || day.week?.note || '');

  root.className = 'view';
  root.innerHTML = `
    <div class="home-head">
      <div>
        <h1 class="h1">Muscu</h1>
        <div class="muted">${esc(now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      </div>
    </div>
    <div class="week">
      <span class="chip ${esc(day.weekType)}">${weekLabel ? `${esc(weekLabel)} · ` : ''}${esc(weekChip(day.weekType))}</span>
      ${plan.override ? '<span class="chip warn">forcée dans Réglages</span>' : ''}
    </div>
    ${note ? `<p class="week-note">${esc(note)}</p>` : ''}
    ${cycleCardHTML(plan, day)}
    ${challengeCardHTML(verdicts, iso)}
    ${dayLineHTML(day)}
    ${active ? `<button class="resume" data-resume>
        <span class="dot"></span>
        <span class="grow"><b style="font-size:19px">Reprendre la séance</b><br>
        <span class="muted small">${esc(activeName)} · ${active.sets.length} série${active.sets.length > 1 ? 's' : ''} faite${active.sets.length > 1 ? 's' : ''}</span></span>
      </button>` : ''}
    <div class="section-title">Séances</div>
    ${entries.map(card).join('')}
  `;

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-resume]')) { timer.unlockAudio(); ctx.navigate('#/session'); return; }
    const b = e.target.closest('[data-start]');
    if (!b) return;
    timer.unlockAudio();
    await startSession(ctx, entries[Number(b.dataset.start)], day, program);
  });
}

async function startSession(ctx, entry, day, program) {
  const { session } = entry;
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
  if (day.weekType === 'aucune' && hasUndulating(session, entry.program)) {
    const ok = await confirmDialog({
      title: 'Pas de jambes cette semaine',
      text: 'Le plan exclut la séance jambes cette semaine. La lancer quand même ?',
      ok: 'Lancer quand même',
    });
    if (!ok) return;
  }
  const extra = plans.startContext(entry.day, session, { planned: entry.planned });
  // Le type de semaine et la rampe sont ceux du jour où la séance est faite
  if (day.legFactor < 1) extra.legFactor = day.legFactor; else delete extra.legFactor;
  await db.startLog(session.id, day.weekType, extra);
  ctx.navigate('#/session');
}
