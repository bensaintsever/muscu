// Vue Accueil : type de semaine, séance du jour, reprise, démarrage d'une séance.
import * as db from '../db.js';
import * as prog from '../progression.js';
import * as timer from '../timer.js';
import { esc, fmtDate, fmtVolume, volumeOf, weekChip, WEEKDAYS, confirmDialog } from '../ui.js';

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

export async function renderHome(root, { live, ctx }) {
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
    if (e.target.closest('[data-resume]')) { timer.unlockAudio(); ctx.navigate('#/session'); return; }
    const b = e.target.closest('[data-start]');
    if (!b) return;
    timer.unlockAudio();
    const session = program.sessions.find((s) => s.id === b.dataset.start);
    await startSession(ctx, session, program, week.type);
  });
}

async function startSession(ctx, session, program, weekType) {
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
  ctx.navigate('#/session');
}
