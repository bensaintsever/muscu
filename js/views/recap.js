// Vue Récap de fin de séance : durée, volume, comparaison, records, note libre.
import * as db from '../db.js';
import * as prog from '../progression.js';
import * as plans from '../plan.js';
import { testsForLog } from '../cycles.js';
import { esc, fmtN, fmtDate, fmtDuration, fmtVolume, volumeOf, weekChip, errorCard, repsTxt } from '../ui.js';

export async function renderRecap(root, { live, ctx, setCleanup }, logId) {
  const log = logId ? await db.getLog(logId) : null;
  if (!live()) return;
  if (!log) { root.className = 'view'; root.innerHTML = errorCard('Séance introuvable'); return; }
  if (log.status !== 'done') { ctx.navigate('#/session'); return; }
  const { plan, program, session } = await plans.sessionForLog(log);
  const allLogs = await db.listLogs();
  const exIds = [...new Set([...(session?.blocks || []).flatMap((b) => b.exercises), ...(log.sets || []).map((s) => s.exerciseId)])];
  const challenges = await Promise.all(testsForLog(plan.resolved, log, exIds)
    .map(async (test) => ({ test, result: await plans.evaluateForLog(test, log, allLogs) })));
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
    const timed = ex.repUnit === 'm' || ex.repUnit === 's';
    if (!before.length) badge = '<span class="chip">Première</span>';
    else if (timed) badge = '';
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
    const unit = ex.unit === 'reps' ? ` ${repsTxt(ex, '').trim()}` : (timed ? ` (${repsTxt(ex, '').trim()})` : '');
    return `<li class="list-item recap-ex">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><b class="wrap">${esc(ex.name)}</b>${badge}</div>
      <div class="sets">${esc(txt)}${esc(unit)}</div>
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
    ${challenges.length ? `<div class="section-title">Défi</div><ul class="list recap-challenges">${challenges.map(({ test, result }) => {
      const [cls, label] = result.status === 'success' ? ['ok', 'Réussi'] : result.status === 'reference' ? ['ok', 'Référence posée'] : ['warn', 'Pas encore'];
      return `<li class="list-item"><div class="grow"><b class="wrap">${esc(test.label)}</b>${result.detail ? `<div class="muted small">${esc(result.detail)}</div>` : ''}</div><span class="chip ${cls}">${label}</span></li>`;
    }).join('')}</ul>` : ''}
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
    try { await db.saveLog(log); } catch (e) { console.error(e); ctx.toast("La note n'a pas pu être enregistrée"); }
  };
  noteEl.addEventListener('input', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNote, 700); });
  noteEl.addEventListener('blur', saveNote);
  root.querySelector('[data-a="home"]').addEventListener('click', async () => { await saveNote(); ctx.navigate('#/'); });
  if (live()) setCleanup(() => { saveNote(); });
}
