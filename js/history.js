// Vues Historique et Progression. Tout l'accès aux données passe par ctx.

/* ---------- Fonctions pures (exportées pour les tests) ---------- */

const DAY = 86400000;

export function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// « mer. 1 oct. »
export function fmtDay(s) {
  return parseDate(s).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// « 1 oct. »
export function fmtShort(s) {
  return parseDate(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function mondayOf(s) {
  const d = parseDate(s);
  const dow = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

export function fmtNum(n, max = 1) {
  if (n == null || !Number.isFinite(+n)) return '–';
  return (+n).toLocaleString('fr-FR', { maximumFractionDigits: max });
}

export function fmtDuration(ms) {
  if (!(ms > 0)) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export function logDuration(log) {
  return log && log.startedAt > 0 && log.endedAt > 0 && log.endedAt > log.startedAt
    ? log.endedAt - log.startedAt : 0;
}

// Charges distinctes dans l'ordre : « 26 » ou « 26/24 »
function loadsLabel(loads) {
  const uniq = [...new Set(loads.map((l) => +l || 0))];
  return uniq.map((l) => fmtNum(l, 2)).join('/');
}

// « 26 kg · 10/10/8 », « 10/10/8 reps », « PdC · 8/7/6 »
export function perfLabel(sets, unit) {
  if (!sets || !sets.length) return '';
  const reps = sets.map((s) => +s.reps || 0).join('/');
  if (unit === 'reps') return `${reps} reps`;
  const loads = sets.map((s) => +s.load || 0);
  if (loads.every((l) => l === 0)) return `PdC · ${reps}`;
  return `${loadsLabel(loads)} kg · ${reps}`;
}

export function setsVolume(sets) {
  return (sets || []).reduce((a, s) => a + (+s.load || 0) * (+s.reps || 0), 0);
}

export function isRepsMode(exercise, history) {
  if (exercise && exercise.unit === 'reps') return true;
  return (history || []).every((h) => (h.sets || []).every((s) => !((+s.load || 0) > 0)));
}

// Un point par séance d'historique (history : plus anciens d'abord)
export function buildPoints(history, e1rm) {
  return (history || [])
    .filter((h) => h && h.sets && h.sets.length)
    .map((h) => {
      const loads = h.sets.map((s) => +s.load || 0);
      const reps = h.sets.map((s) => +s.reps || 0);
      const best = Math.max(0, ...h.sets.map((s) => +e1rm(+s.load || 0, +s.reps || 0) || 0));
      return {
        logId: h.logId,
        date: h.date,
        t: parseDate(h.date).getTime(),
        weekType: h.weekType,
        isReference: !!h.isReference,
        loads,
        reps,
        maxLoad: Math.max(0, ...loads),
        e1rm: Math.round(best * 10) / 10,
        totalReps: reps.reduce((a, b) => a + b, 0),
        volume: setsVolume(h.sets),
      };
    });
}

function niceStep(span, target = 3) {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

// Géométrie du graphe. keys : séries à tracer, ex. ['e1rm', 'maxLoad'] ou ['totalReps'].
// Les valeurs <= 0 sont ignorées (séance au poids du corps dans une série en kg).
export function chartModel(points, keys, o = {}) {
  const W = o.w ?? 360, H = o.h ?? 200;
  const L = o.left ?? 34, R = o.right ?? 70, T = o.top ?? 12, B = o.bottom ?? 24;
  const plotted = keys.map((k) => ({ key: k, pts: points.filter((p) => +p[k] > 0) }));
  const all = plotted.flatMap((s) => s.pts.map((p) => +p[s.key]));
  if (!all.length) return null;

  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) {
    const d = Math.max(1, Math.abs(lo) * 0.1);
    lo -= d; hi += d;
  } else {
    const d = (hi - lo) * 0.12;
    lo -= d; hi += d;
  }
  if (lo < 0) lo = 0;
  const step = niceStep(hi - lo);
  const yTicks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) yTicks.push(Math.round(v * 1000) / 1000);

  const ts = points.map((p) => p.t);
  const t0 = Math.min(...ts), t1 = Math.max(...ts);
  const x = (t) => (t1 === t0 ? L + (W - L - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const r1 = (n) => Math.round(n * 10) / 10;

  const series = plotted.map((s) => ({
    key: s.key,
    pts: s.pts.map((p) => ({ x: r1(x(p.t)), y: r1(y(+p[s.key])), v: +p[s.key], p })),
  }));
  series.forEach((s) => {
    s.path = s.pts.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join(' ');
  });

  // Dates : première, dernière, et celle du milieu s'il y a la place
  const uniqT = [...new Set(ts)].sort((a, b) => a - b);
  const xTicks = [];
  if (uniqT.length === 1) xTicks.push({ t: uniqT[0], anchor: 'middle' });
  else {
    xTicks.push({ t: uniqT[0], anchor: 'start' });
    if (uniqT.length >= 3 && t1 - t0 >= 14 * DAY) {
      const mid = uniqT[Math.floor(uniqT.length / 2)];
      const xm = x(mid);
      if (xm - L > 60 && W - R - xm > 60) xTicks.push({ t: mid, anchor: 'middle' });
    }
    xTicks.push({ t: uniqT[uniqT.length - 1], anchor: 'end' });
  }

  // Étiquettes directes en bout de ligne, écartées si elles se chevauchent
  const labels = series.filter((s) => s.pts.length).map((s) => {
    const last = s.pts[s.pts.length - 1];
    return { key: s.key, x: last.x + 8, y: last.y, v: last.v };
  });
  if (labels.length === 2 && Math.abs(labels[0].y - labels[1].y) < 13) {
    const [a, b] = labels[0].y <= labels[1].y ? [labels[0], labels[1]] : [labels[1], labels[0]];
    const mid = (a.y + b.y) / 2;
    a.y = mid - 6.5; b.y = mid + 6.5;
  }
  labels.forEach((l) => { l.y = r1(Math.min(H - B, Math.max(T + 4, l.y))); });

  return {
    w: W, h: H, left: L, right: R, top: T, bottom: B,
    lo, hi, series, labels,
    yTicks: yTicks.map((v) => ({ v, y: r1(y(v)) })),
    xTicks: xTicks.map((k) => ({ ...k, x: r1(x(k.t)), date: isoDate(new Date(k.t)) })),
  };
}

// Points d'une sparkline (viewBox w × h)
export function sparkPoints(values, w = 72, h = 24, pad = 3) {
  const v = values.filter((n) => Number.isFinite(n) && n > 0);
  if (!v.length) return [];
  const lo = Math.min(...v), hi = Math.max(...v);
  return v.map((n, i) => ({
    x: Math.round((v.length === 1 ? w / 2 : pad + (i / (v.length - 1)) * (w - 2 * pad)) * 10) / 10,
    y: Math.round((hi === lo ? h / 2 : pad + (1 - (n - lo) / (hi - lo)) * (h - 2 * pad)) * 10) / 10,
  }));
}

/* ---------- Utilitaires DOM ---------- */

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}

function weekChip(ctx, type) {
  if (!type) return null;
  const label = ctx.prog.WEEK_TYPES?.[type]?.label || type;
  return el('span', { class: `chip ${type}`, text: label });
}

function sessionNames(program) {
  const m = {};
  for (const s of program?.sessions || []) m[s.id] = s.name;
  return m;
}

// Ordre des exercices d'une séance d'après ses blocs
function sessionExerciseIds(session) {
  const ids = [];
  for (const b of session?.blocks || []) for (const id of b.exercises || []) if (!ids.includes(id)) ids.push(id);
  return ids;
}

function fmtVolume(v) {
  return v > 0 ? `${fmtNum(Math.round(v), 0)} kg` : '';
}

function backLink(ctx, hash, label) {
  return el('button', { class: 'btn btn-ghost h-back', type: 'button', onclick: () => ctx.navigate(hash) }, `‹ ${label}`);
}

/* ---------- Historique ---------- */

export async function renderHistory(container, ctx, logId) {
  const program = await ctx.db.getProgram();
  if (logId) return renderLogDetail(container, ctx, program, logId);

  const logs = (await ctx.db.listLogs()).filter((l) => l.status === 'done');
  logs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.startedAt || 0) - (a.startedAt || 0));
  const names = sessionNames(program);

  const view = el('div', { class: 'view h-view' }, el('h1', { class: 'h1', text: 'Historique' }));

  const today = isoDate(new Date());
  const thisMonday = mondayOf(today);
  const monthPrefix = today.slice(0, 7);
  const real = logs.filter((l) => !l.isReference);
  const nWeek = real.filter((l) => l.date >= thisMonday && l.date <= today).length;
  const nMonth = real.filter((l) => (l.date || '').startsWith(monthPrefix)).length;
  view.append(el('div', { class: 'h-summary' },
    el('div', { class: 'h-stat' }, el('span', { class: 'h-stat-n', text: String(nWeek) }), el('span', { class: 'muted', text: nWeek > 1 ? 'séances cette semaine' : 'séance cette semaine' })),
    el('div', { class: 'h-stat' }, el('span', { class: 'h-stat-n', text: String(nMonth) }), el('span', { class: 'muted', text: nMonth > 1 ? 'séances ce mois' : 'séance ce mois' })),
  ));

  if (!logs.length) {
    view.append(el('p', { class: 'muted h-empty', text: 'Aucune séance terminée pour l\'instant.' }));
    container.append(view);
    return;
  }

  let currentWeek = null, list = null;
  for (const log of logs) {
    const wk = mondayOf(log.date);
    if (wk !== currentWeek) {
      currentWeek = wk;
      const info = safeWeekInfo(ctx, parseDate(wk));
      const title = wk === thisMonday ? 'Cette semaine' : `Semaine du ${fmtShort(wk)}`;
      view.append(el('h2', { class: 'h2 h-week' }, title, info?.week ? el('span', { class: 'muted', text: ` · ${info.week}` }) : null));
      list = el('div', { class: 'list' });
      view.append(list);
    }
    const dur = fmtDuration(logDuration(log));
    const vol = fmtVolume(safeVolume(ctx, log));
    const meta = [dur, vol].filter(Boolean).join(' · ');
    list.append(el('button', { class: 'list-item h-log', type: 'button', onclick: () => ctx.navigate('#/history/' + encodeURIComponent(log.id)) },
      el('div', { class: 'h-log-main' },
        el('div', { class: 'h-log-top' },
          el('span', { class: 'h-log-date', text: fmtDay(log.date) }),
          el('span', { class: 'h-log-name', text: names[log.sessionId] || log.sessionId }),
        ),
        el('div', { class: 'h-log-meta' },
          weekChip(ctx, log.weekType),
          log.isReference ? el('span', { class: 'h-ref', text: 'référence' }) : null,
          meta ? el('span', { class: 'muted h-num', text: meta }) : null,
        ),
      ),
      el('span', { class: 'h-chev', 'aria-hidden': 'true', text: '›' }),
    ));
  }
  container.append(view);
}

function safeWeekInfo(ctx, date) {
  try { return ctx.prog.weekInfo(date); } catch { return null; }
}

function safeVolume(ctx, log) {
  try { return +ctx.prog.sessionVolume(log) || 0; } catch { return setsVolume(log.sets); }
}

async function renderLogDetail(container, ctx, program, logId) {
  const log = await ctx.db.getLog(logId);
  const view = el('div', { class: 'view h-view' }, backLink(ctx, '#/history', 'Historique'));
  if (!log) {
    view.append(el('p', { class: 'muted h-empty', text: 'Séance introuvable.' }));
    container.append(view);
    return;
  }
  const session = (program?.sessions || []).find((s) => s.id === log.sessionId);
  const exercises = program?.exercises || {};

  view.append(
    el('h1', { class: 'h1', text: session?.name || log.sessionId }),
    el('div', { class: 'h-detail-meta' },
      el('span', { text: fmtDay(log.date) }),
      weekChip(ctx, log.weekType),
      log.isReference ? el('span', { class: 'h-ref', text: 'référence' }) : null,
    ),
  );

  const dur = fmtDuration(logDuration(log));
  const vol = safeVolume(ctx, log);
  view.append(el('div', { class: 'h-summary' },
    el('div', { class: 'h-stat' }, el('span', { class: 'h-stat-n', text: dur || '–' }), el('span', { class: 'muted', text: 'durée' })),
    el('div', { class: 'h-stat' }, el('span', { class: 'h-stat-n', text: vol > 0 ? fmtNum(Math.round(vol), 0) : '–' }), el('span', { class: 'muted', text: 'volume (kg)' })),
    el('div', { class: 'h-stat' }, el('span', { class: 'h-stat-n', text: String((log.sets || []).length) }), el('span', { class: 'muted', text: 'séries' })),
  ));

  // Séries groupées par exo, dans l'ordre du programme puis les autres
  const byEx = new Map();
  for (const s of log.sets || []) {
    if (!byEx.has(s.exerciseId)) byEx.set(s.exerciseId, []);
    byEx.get(s.exerciseId).push(s);
  }
  const order = sessionExerciseIds(session).filter((id) => byEx.has(id));
  for (const id of byEx.keys()) if (!order.includes(id)) order.push(id);

  if (!order.length) view.append(el('p', { class: 'muted', text: 'Aucune série enregistrée.' }));
  for (const id of order) {
    const ex = exercises[id] || { id, name: id, unit: 'kg' };
    const sets = byEx.get(id).slice().sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0));
    const best = Math.max(0, ...sets.map((s) => +ctx.prog.e1rm(+s.load || 0, +s.reps || 0) || 0));
    const repsOnly = ex.unit === 'reps' || sets.every((s) => !((+s.load || 0) > 0));
    const right = repsOnly
      ? `${sets.reduce((a, s) => a + (+s.reps || 0), 0)} reps`
      : best > 0 ? `e1RM ${fmtNum(best)} kg` : '';
    view.append(el('section', { class: 'card h-ex' },
      el('div', { class: 'h-ex-head' },
        el('button', { class: 'h-ex-name', type: 'button', onclick: () => ctx.navigate('#/progress/' + encodeURIComponent(id)) }, ex.name),
        right ? el('span', { class: 'h-ex-e1rm h-num', text: right }) : null,
      ),
      el('ol', { class: 'h-sets' }, sets.map((s, i) => el('li', { class: 'h-set' },
        el('span', { class: 'muted', text: `Série ${i + 1}` }),
        el('span', { class: 'h-num', text: repsOnly
          ? `${s.reps} reps`
          : `${(+s.load || 0) > 0 ? fmtNum(s.load, 2) + ' kg' : 'PdC'} × ${s.reps}` }),
      ))),
    ));
  }

  if (log.note) view.append(el('section', { class: 'card h-note' }, el('h2', { class: 'h2', text: 'Note' }), el('p', { text: log.note })));

  view.append(el('button', {
    class: 'btn btn-danger h-delete', type: 'button',
    onclick: async () => {
      if (!confirm(`Supprimer la séance du ${fmtDay(log.date)} ? C'est définitif.`)) return;
      try {
        await ctx.db.deleteLog(log.id);
        ctx.toast('Séance supprimée');
        ctx.navigate('#/history');
      } catch (e) {
        ctx.toast('Suppression impossible : ' + (e?.message || e));
      }
    },
  }, 'Supprimer la séance'));

  container.append(view);
}

/* ---------- Progression ---------- */

export async function renderProgress(container, ctx, exerciseId) {
  const program = await ctx.db.getProgram();
  if (exerciseId) return renderExercise(container, ctx, program, exerciseId);

  const view = el('div', { class: 'view h-view' }, el('h1', { class: 'h1', text: 'Progression' }));
  const exercises = program?.exercises || {};
  const groups = (program?.sessions || []).map((s) => ({ name: s.name, ids: sessionExerciseIds(s).filter((id) => exercises[id]) }));
  const seen = new Set(groups.flatMap((g) => g.ids));
  const orphans = Object.keys(exercises).filter((id) => !seen.has(id));
  if (orphans.length) groups.push({ name: 'Autres', ids: orphans });

  const allIds = groups.flatMap((g) => g.ids);
  const histories = await Promise.all(allIds.map((id) => ctx.db.getExerciseHistory(id).catch(() => [])));
  const histMap = Object.fromEntries(allIds.map((id, i) => [id, histories[i] || []]));

  for (const g of groups) {
    if (!g.ids.length) continue;
    view.append(el('h2', { class: 'h2 h-week', text: g.name }));
    const list = el('div', { class: 'list' });
    for (const id of g.ids) {
      const ex = exercises[id];
      const hist = histMap[id];
      const last = hist[hist.length - 1];
      const repsMode = isRepsMode(ex, hist);
      const pts = buildPoints(hist, ctx.prog.e1rm).filter((p) => !ex.undulates || !isLight(p.weekType));
      list.append(el('button', { class: 'list-item h-ex-row', type: 'button', onclick: () => ctx.navigate('#/progress/' + encodeURIComponent(id)) },
        el('div', { class: 'h-ex-row-main' },
          el('span', { class: 'h-ex-row-name', text: ex.name }),
          el('span', { class: 'muted h-num', text: last ? perfLabel(last.sets, ex.unit) : 'Pas encore de données' }),
        ),
        sparkline(pts.map((p) => (repsMode ? p.totalReps : p.e1rm))),
      ));
    }
    view.append(list);
  }
  if (!allIds.length) view.append(el('p', { class: 'muted h-empty', text: 'Aucun exercice dans le programme.' }));
  container.append(view);
}

const isLight = (wt) => wt === 'moyenne' || wt === 'legere';

function sparkline(values) {
  const pts = sparkPoints(values);
  const s = svg('svg', { class: 'h-spark', viewBox: '0 0 72 24', 'aria-hidden': 'true', focusable: 'false' });
  if (pts.length >= 2) {
    s.append(svg('polyline', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', class: 'h-spark-line' }));
  }
  if (pts.length) {
    const l = pts[pts.length - 1];
    s.append(svg('circle', { cx: l.x, cy: l.y, r: 2.5, class: 'h-spark-dot' }));
  }
  return s;
}

async function renderExercise(container, ctx, program, exerciseId) {
  const view = el('div', { class: 'view h-view' }, backLink(ctx, '#/progress', 'Exercices'));
  const ex = program?.exercises?.[exerciseId];
  if (!ex) {
    view.append(el('p', { class: 'muted h-empty', text: 'Exercice introuvable.' }));
    container.append(view);
    return;
  }
  const history = await ctx.db.getExerciseHistory(exerciseId);
  const repsMode = isRepsMode(ex, history);
  const points = buildPoints(history, ctx.prog.e1rm);

  view.append(el('h1', { class: 'h1', text: ex.name }));
  if (ex.note) view.append(el('p', { class: 'muted h-exnote', text: ex.note }));

  // Prochaine cible
  const override = await ctx.db.getSetting('weekTypeOverride', null);
  const weekType = override || safeWeekInfo(ctx, new Date())?.type || 'normale';
  let sug = null;
  try { sug = ctx.prog.suggest(ex, history, weekType); } catch { sug = null; }
  if (sug) {
    const reps = (sug.reps || []).join('/');
    const target = ex.unit === 'reps'
      ? `${reps} reps`
      : sug.load == null ? `Charge à définir · ${reps}`
        : `${(+sug.load || 0) > 0 ? fmtNum(sug.load, 2) + ' kg' : 'PdC'} · ${reps}`;
    view.append(el('section', { class: 'card h-target' },
      el('div', { class: 'h-target-head' },
        el('span', { class: 'muted', text: 'Prochaine cible' }),
        ex.undulates ? weekChip(ctx, weekType) : null,
      ),
      el('div', { class: 'h-target-val h-num', text: target }),
      sug.reason ? el('p', { class: 'muted h-target-why', text: sug.reason }) : null,
    ));
  }

  // Graphe
  const chartCard = el('section', { class: 'card h-chart-card' });
  const keys = repsMode ? ['totalReps'] : ['e1rm', 'maxLoad'];
  const plottable = points.filter((p) => keys.some((k) => p[k] > 0));
  if (plottable.length < 2) {
    chartCard.append(el('p', { class: 'muted h-nodata', text: 'Pas encore assez de données' }));
  } else {
    chartCard.append(drawChart(plottable, keys, repsMode, !!ex.undulates));
    if (ex.undulates && plottable.some((p) => isLight(p.weekType))) {
      chartCard.append(el('p', { class: 'muted h-chart-note' },
        'Points creux : semaines ',
        el('span', { class: 'h-c-moyenne', text: 'moyennes' }), ' et ',
        el('span', { class: 'h-c-legere', text: 'légères' }), '.'));
    }
  }
  view.append(chartCard);

  // Record
  if (points.length) {
    const key = repsMode ? 'totalReps' : 'e1rm';
    const best = points.reduce((a, p) => (p[key] > a[key] ? p : a), points[0]);
    if (best[key] > 0) {
      view.append(el('section', { class: 'card h-record' },
        el('span', { class: 'muted', text: repsMode ? 'Meilleur total de reps' : 'Record e1RM' }),
        el('span', { class: 'h-record-val h-num', text: repsMode ? `${best.totalReps} reps` : `${fmtNum(best.e1rm)} kg` }),
        el('span', { class: 'muted h-num', text: `${fmtDay(best.date)} · ${perfLabel(best.loads.map((l, i) => ({ load: l, reps: best.reps[i] })), ex.unit)}` }),
      ));
    }
  }

  // Dix dernières séances
  if (points.length) {
    const rows = points.slice(-10).reverse();
    view.append(el('h2', { class: 'h2', text: 'Dernières séances' }));
    view.append(el('div', { class: 'card h-table-wrap' }, el('table', { class: 'h-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: 'Date' }),
        repsMode ? null : el('th', { class: 'h-r', text: 'Charge' }),
        el('th', { text: 'Reps' }),
        el('th', { class: 'h-r', text: repsMode ? 'Total' : 'Volume' }),
      )),
      el('tbody', {}, rows.map((p) => el('tr', { class: p.logId ? 'h-tr-link' : null, onclick: p.logId ? () => ctx.navigate('#/history/' + encodeURIComponent(p.logId)) : null },
        el('td', {}, el('span', { text: fmtShort(p.date) }), ex.undulates && isLight(p.weekType)
          ? el('span', { class: `h-dot h-c-${p.weekType}`, title: ctx.prog.WEEK_TYPES?.[p.weekType]?.label || p.weekType, text: ' ●' }) : null),
        repsMode ? null : el('td', { class: 'h-r', text: p.maxLoad > 0 ? loadsLabel(p.loads) : 'PdC' }),
        el('td', { text: p.reps.join('/') }),
        el('td', { class: 'h-r', text: repsMode ? String(p.totalReps) : (p.volume > 0 ? fmtNum(Math.round(p.volume), 0) : '–') }),
      ))),
    )));
  } else {
    view.append(el('p', { class: 'muted h-empty', text: 'Aucune séance enregistrée pour cet exercice.' }));
  }

  container.append(view);
}

const SERIES_STYLE = {
  e1rm: { cls: 'h-s-main', label: 'e1RM', unit: ' kg' },
  maxLoad: { cls: 'h-s-sec', label: 'Charge', unit: ' kg' },
  totalReps: { cls: 'h-s-main', label: 'Reps', unit: '' },
};

function drawChart(points, keys, repsMode, undulates) {
  const m = chartModel(points, keys);
  const root = svg('svg', {
    class: 'h-chart', viewBox: `0 0 ${m.w} ${m.h}`, preserveAspectRatio: 'xMidYMid meet', role: 'img',
    'aria-label': repsMode ? 'Total de reps par séance' : 'Meilleur e1RM et charge max par séance',
  });
  const gGrid = svg('g', { class: 'h-grid' });
  for (const t of m.yTicks) {
    gGrid.append(
      svg('line', { x1: m.left, x2: m.w - m.right, y1: t.y, y2: t.y }),
      svg('text', { x: m.left - 6, y: t.y + 3.5, 'text-anchor': 'end' }, fmtNum(t.v)),
    );
  }
  for (const t of m.xTicks) {
    gGrid.append(svg('text', { x: t.x, y: m.h - 6, 'text-anchor': t.anchor }, fmtShort(t.date)));
  }
  root.append(gGrid);

  // Série secondaire d'abord, la principale par-dessus
  for (const s of m.series.slice().reverse()) {
    const st = SERIES_STYLE[s.key];
    const g = svg('g', { class: st.cls });
    // Les semaines allégées ne sont pas reliées : elles ne disent rien de la progression
    const full = undulates ? s.pts.filter((q) => !isLight(q.p.weekType)) : s.pts;
    if (full.length >= 2) g.append(svg('path', { d: full.map((q, i) => `${i ? 'L' : 'M'}${q.x},${q.y}`).join(' '), fill: 'none' }));
    for (const q of s.pts) {
      const wt = q.p.weekType;
      const hollow = undulates && isLight(wt);
      const main = st.cls === 'h-s-main';
      const c = svg('circle', {
        cx: q.x, cy: q.y, r: main ? (hollow ? 4 : 3.5) : 2.5,
        class: hollow ? `h-pt-hollow h-c-${wt}` : 'h-pt',
      });
      c.append(svg('title', {}, `${fmtShort(q.p.date)} : ${fmtNum(q.v)}${st.unit}`));
      g.append(c);
    }
    root.append(g);
  }
  for (const l of m.labels) {
    const st = SERIES_STYLE[l.key];
    root.append(svg('text', { class: `h-lbl ${st.cls}`, x: l.x, y: l.y + 4 }, `${st.label} ${fmtNum(l.v)}`));
  }
  return root;
}
