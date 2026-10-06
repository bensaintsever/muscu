// Vue Réglages : type de semaine, son, date du Hyrox, programme du bloc en cours, sauvegarde, stockage.
import * as plans from './plan.js';
import { todayISO } from './clock.js';
import { hyroxSection } from './settings-cycles.js';
import { semiDate } from './cycles.js';

const DAY = 86400000;

/* ---------- Fonctions pures (exportées pour les tests) ---------- */

export function exportFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `muscu-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export function daysSince(ts, now = Date.now()) {
  if (!(ts > 0)) return null;
  return Math.floor((now - ts) / DAY);
}

// Lit un nombre saisi (virgule acceptée). NaN si vide ou invalide.
export function parseNum(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return NaN;
  return Number(s);
}

// Valide un brouillon de programme. Renvoie la liste des erreurs { path, msg }.
export function validateProgram(program) {
  const errors = [];
  const posInt = (n) => Number.isInteger(n) && n > 0;
  const restOk = (n) => Number.isInteger(n) && n >= 0;
  for (const s of program.sessions || []) {
    if (!restOk(s.rest)) errors.push({ path: `session:${s.id}:rest`, msg: `${s.name} : repos en secondes entières` });
    for (const b of s.blocks || []) {
      if (b.rest != null && !restOk(b.rest)) errors.push({ path: `block:${s.id}:${b.id}`, msg: `${s.name} : repos de bloc en secondes entières, ou vide` });
    }
  }
  for (const ex of Object.values(program.exercises || {})) {
    const p = `ex:${ex.id}:`;
    if (!String(ex.name || '').trim()) errors.push({ path: p + 'name', msg: 'Nom vide' });
    if (!posInt(ex.sets)) errors.push({ path: p + 'sets', msg: `${ex.name} : séries entières > 0` });
    if (!posInt(ex.repMin)) errors.push({ path: p + 'repMin', msg: `${ex.name} : reps min entières > 0` });
    if (!posInt(ex.repMax)) errors.push({ path: p + 'repMax', msg: `${ex.name} : reps max entières > 0` });
    if (posInt(ex.repMin) && posInt(ex.repMax) && ex.repMin > ex.repMax) {
      errors.push({ path: p + 'repMax', msg: `${ex.name} : reps min ≤ reps max` });
    }
    if (!(Number.isFinite(ex.increment) && ex.increment >= 0)) errors.push({ path: p + 'increment', msg: `${ex.name} : pas de charge ≥ 0` });
  }
  return errors;
}

/* ---------- DOM ---------- */

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

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

const WEEK_OPTIONS = [
  ['', 'Auto (calendrier)'],
  ['lourde', 'Lourde'],
  ['moyenne', 'Moyenne'],
  ['legere', 'Légère'],
  ['aucune', 'Pas de jambes'],
  ['normale', 'Normale'],
];

export async function renderSettings(container, ctx) {
  const view = el('div', { class: 'view s-view' }, el('h1', { class: 'h1', text: 'Réglages' }));
  container.append(view);

  const [{ plan, day, program }, override, soundOn, lastExportAt, hyroxSetting] = await Promise.all([
    plans.activeProgram(todayISO()),
    ctx.db.getSetting('weekTypeOverride', null),
    ctx.db.getSetting('soundOn', true),
    ctx.db.getSetting('lastExportAt', null),
    ctx.db.getSetting('hyroxDate', null),
  ]);
  // Info de semaine sans le forçage, pour l'afficher à côté
  const raw = { ...plans.dayOf({ ...plan, override: null }, todayISO()) };
  const semi = ctx.prog.weekInfo(todayISO());
  const inSemi = raw.iso <= semiDate();
  const info = { type: raw.weekType, week: inSemi ? semi.week : null, note: inSemi ? semi.note : (raw.week?.note || '') };

  view.append(
    weekSection(ctx, override, info),
    soundSection(ctx, soundOn !== false),
    hyroxSection(ctx, plan, hyroxSetting),
    programSection(ctx, plan, day, program),
    backupSection(ctx, lastExportAt),
    await storageSection(),
  );
}

/* Type de semaine */

function weekSection(ctx, override, info) {
  const label = (t) => ctx.prog.WEEK_TYPES?.[t]?.label || t;
  const status = el('div', { class: 's-week-status' });

  const paint = (ov) => {
    status.replaceChildren(...[
      el('div', { class: 's-week-line' },
        el('span', { class: `chip ${ov || info.type}`, text: label(ov || info.type) }),
        el('span', { class: 'muted', text: ov ? 'forcé' : (info.week ? `${info.week} du plan semi` : 'calendrier') }),
      ),
      ov && ov !== info.type ? el('p', { class: 'muted s-small', text: `Le calendrier dit : ${label(info.type)}.` }) : null,
      !ov && info.note ? el('p', { class: 'muted s-small', text: info.note }) : null,
    ].filter(Boolean));
  };
  paint(override);

  const select = el('select', { class: 's-select', id: 's-weektype', 'aria-label': 'Forcer le type de semaine' },
    WEEK_OPTIONS.map(([v, t]) => el('option', { value: v, text: t })));
  select.value = override || '';
  select.addEventListener('change', async () => {
    const v = select.value || null;
    try {
      await ctx.db.setSetting('weekTypeOverride', v);
      paint(v);
      ctx.toast(v ? `Semaine forcée : ${label(v)}` : 'Type de semaine automatique');
    } catch (e) {
      ctx.toast('Erreur : ' + (e?.message || e));
    }
  });

  return el('section', { class: 'card s-section' },
    el('h2', { class: 'h2', text: 'Type de semaine' }),
    status,
    el('label', { class: 's-field', for: 's-weektype' }, el('span', { class: 's-label', text: 'Forcer' }), select),
  );
}

/* Son */

function soundSection(ctx, on) {
  const input = el('input', { type: 'checkbox', class: 's-switch-input', id: 's-sound', role: 'switch' });
  input.checked = on;
  input.addEventListener('change', async () => {
    try {
      await ctx.db.setSetting('soundOn', input.checked);
      ctx.toast(input.checked ? 'Son activé' : 'Son coupé');
    } catch (e) {
      input.checked = !input.checked;
      ctx.toast('Erreur : ' + (e?.message || e));
    }
  });
  return el('section', { class: 'card s-section' },
    el('label', { class: 's-switch', for: 's-sound' },
      el('span', {}, el('span', { class: 's-switch-title', text: 'Son en fin de repos' }),
        el('span', { class: 'muted s-small s-block', text: 'La vibration reste active.' })),
      input,
      el('span', { class: 's-switch-track', 'aria-hidden': 'true' }),
    ),
  );
}

/* Programme */

function numInput(value, { path, mode = 'numeric', label, step, placeholder }) {
  return el('label', { class: 's-num' },
    el('span', { class: 's-label', text: label }),
    el('input', { type: 'text', inputmode: mode, value: value ?? '', 'data-path': path, class: 's-input', autocomplete: 'off', step, placeholder }),
  );
}

function programSection(ctx, plan, day, program) {
  const draft = structuredClone(program);
  const form = el('form', { class: 's-program', novalidate: true });

  // Séances reprises d'un autre bloc (Atlas) : elles se règlent dans leur bloc d'origine
  for (const s of (draft.sessions || []).filter((x) => !x.borrowed)) {
    const group = el('div', { class: 's-session' },
      el('div', { class: 's-session-head' },
        el('h3', { class: 's-session-name', text: s.name }),
        numInput(s.rest, { path: `session:${s.id}:rest`, label: 'Repos (s)' }),
      ),
    );
    const seen = new Set();
    for (const b of s.blocks || []) {
      const ids = (b.exercises || []).filter((id) => draft.exercises[id] && !seen.has(id));
      ids.forEach((id) => seen.add(id));
      if (!ids.length) continue;
      const kind = b.type === 'superset' ? 'Superset' : b.type === 'interval' ? 'Intervalle' : 'Exercice';
      group.append(el('div', { class: 's-block-head' },
        el('span', { class: 'muted s-small', text: `${kind} · repos après ${b.type === 'superset' ? 'la paire' : 'chaque série'}` }),
        numInput(b.rest, { path: `block:${s.id}:${b.id}`, label: `Repos (s)`, placeholder: String(s.rest ?? '') }),
      ));
    for (const id of ids) {
      const ex = draft.exercises[id];
      const p = `ex:${id}:`;
      const und = el('input', { type: 'checkbox', 'data-path': p + 'undulates', class: 's-check' });
      und.checked = !!ex.undulates;
      const unitLabel = ex.unit === 'reps' ? '' : ' kg';
      group.append(el('details', { class: 's-ex', 'data-ex': id },
        el('summary', { class: 's-ex-sum' },
          el('span', { class: 's-ex-name', text: ex.name }),
          el('span', { class: 'muted s-small s-num-tx', text: `${ex.sets} × ${ex.repMin}-${ex.repMax}${ex.increment ? ` · +${String(ex.increment).replace('.', ',')}${unitLabel}` : ''}` }),
        ),
        el('div', { class: 's-ex-body' },
          el('label', { class: 's-field s-field-col' }, el('span', { class: 's-label', text: 'Nom' }),
            el('input', { type: 'text', value: ex.name, 'data-path': p + 'name', class: 's-input', autocomplete: 'off' })),
          el('div', { class: 's-grid' },
            numInput(ex.sets, { path: p + 'sets', label: 'Séries' }),
            numInput(ex.repMin, { path: p + 'repMin', label: 'Reps min' }),
            numInput(ex.repMax, { path: p + 'repMax', label: 'Reps max' }),
            numInput(String(ex.increment ?? 0).replace('.', ','), { path: p + 'increment', mode: 'decimal', label: 'Pas (kg)' }),
          ),
          el('label', { class: 's-check-row' }, und, el('span', { text: 'Suit l\'ondulation lourde / moyenne / légère' })),
          el('label', { class: 's-field s-field-col' }, el('span', { class: 's-label', text: 'Note' }),
            el('textarea', { 'data-path': p + 'note', class: 's-input s-textarea', rows: 2 }, ex.note || '')),
        ),
      ));
    }
    }
    form.append(group);
  }

  const errorBox = el('div', { class: 's-errors', role: 'alert' });

  const collect = () => {
    const next = structuredClone(program);
    for (const input of form.querySelectorAll('[data-path]')) {
      const [kind, id, field] = input.dataset.path.split(':');
      if (kind === 'session') {
        const s = next.sessions.find((x) => x.id === id);
        if (s) s[field] = parseNum(input.value);
      } else if (kind === 'block') {
        const b = next.sessions.find((x) => x.id === id)?.blocks?.find((x) => x.id === field);
        if (!b) continue;
        if (String(input.value).trim() === '') delete b.rest;
        else b.rest = parseNum(input.value);
      } else {
        const ex = next.exercises[id];
        if (!ex) continue;
        if (field === 'undulates') ex.undulates = input.checked;
        else if (field === 'name') ex.name = input.value.trim();
        else if (field === 'note') {
          const t = input.value.trim();
          if (t) ex.note = t; else delete ex.note;
        } else ex[field] = parseNum(input.value);
      }
    }
    return next;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('.s-invalid').forEach((n) => n.classList.remove('s-invalid'));
    const next = collect();
    const errors = validateProgram(next);
    if (errors.length) {
      for (const err of errors) {
        const input = form.querySelector(`[data-path="${err.path}"]`);
        if (!input) continue;
        input.classList.add('s-invalid');
        const det = input.closest('details');
        if (det) det.open = true;
      }
      errorBox.replaceChildren(el('ul', {}, errors.slice(0, 5).map((x) => el('li', { text: x.msg }))));
      form.querySelector('.s-invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      ctx.toast(errors.length > 1 ? `${errors.length} champs à corriger` : errors[0].msg);
      return;
    }
    errorBox.replaceChildren();
    try {
      await plans.saveEdits(plan, program.cycleId, next);
      program = next;
      ctx.toast('Programme enregistré');
      // Résumés des accordéons à jour
      for (const det of form.querySelectorAll('details[data-ex]')) {
        const ex = next.exercises[det.dataset.ex];
        const unitLabel = ex.unit === 'reps' ? '' : ' kg';
        det.querySelector('.s-ex-name').textContent = ex.name;
        det.querySelector('.s-num-tx').textContent = `${ex.sets} × ${ex.repMin}-${ex.repMax}${ex.increment ? ` · +${String(ex.increment).replace('.', ',')}${unitLabel}` : ''}`;
      }
    } catch (err) {
      ctx.toast('Enregistrement impossible : ' + (err?.message || err));
    }
  });

  form.append(
    errorBox,
    el('button', { type: 'submit', class: 'btn btn-primary s-full', text: 'Enregistrer le programme' }),
  );

  const reset = el('button', {
    type: 'button', class: 'btn btn-ghost s-full s-reset',
    onclick: async () => {
      if (!confirm('Remettre le programme d\'origine ? Tes réglages de séries, reps, pas et repos seront perdus, dans tous les blocs. L\'historique est conservé.')) return;
      try {
        await plans.resetAll();
        ctx.toast('Programme réinitialisé');
        ctx.refresh();
      } catch (err) {
        ctx.toast('Erreur : ' + (err?.message || err));
      }
    },
  }, 'Réinitialiser le programme');

  return el('section', { class: 'card s-section' },
    el('h2', { class: 'h2', text: 'Programme' }),
    el('p', { class: 'muted s-small', text: `Bloc en cours : ${day.block.name}. Touche un exercice pour le modifier, puis enregistre. Les repos et le format des ancres valent pour ce bloc ; nom, pas et note suivent l'exercice dans tous les blocs.` }),
    form,
    reset,
  );
}

/* Sauvegarde */

function backupSection(ctx, lastExportAt) {
  const status = el('div', { class: 's-backup-status' });
  const paint = (ts) => {
    const d = daysSince(ts);
    const late = d == null || d > 14;
    status.replaceChildren(
      el('p', { class: 's-small' + (late ? ' s-warn' : ' muted'), text: d == null
        ? 'Aucun export pour l\'instant. Pense à en faire un de temps en temps.'
        : `Dernier export : ${fmtDate(ts)}${d === 0 ? ' (aujourd\'hui)' : d === 1 ? ' (hier)' : ` (il y a ${d} jours)`}${d > 14 ? '. Un nouvel export serait prudent.' : ''}` }),
    );
  };
  paint(lastExportAt);

  const makeFile = async () => {
    const data = await ctx.db.exportAll();
    const json = JSON.stringify(data, null, 2);
    const name = exportFileName();
    return { name, blob: new Blob([json], { type: 'application/json' }) };
  };
  const markExported = async () => {
    const now = Date.now();
    try { await ctx.db.setSetting('lastExportAt', now); } catch { /* sans gravité */ }
    paint(now);
  };

  const exportBtn = el('button', {
    type: 'button', class: 'btn btn-primary',
    onclick: async () => {
      try {
        const { name, blob } = await makeFile();
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: name, class: 's-hidden' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        await markExported();
        ctx.toast(`Export téléchargé : ${name}`);
      } catch (err) {
        ctx.toast('Export impossible : ' + (err?.message || err));
      }
    },
  }, 'Exporter');

  let shareBtn = null;
  if (canShareFiles()) {
    shareBtn = el('button', {
      type: 'button', class: 'btn',
      onclick: async () => {
        try {
          const { name, blob } = await makeFile();
          const file = new File([blob], name, { type: 'application/json' });
          await navigator.share({ files: [file], title: name });
          await markExported();
          ctx.toast('Sauvegarde partagée');
        } catch (err) {
          if (err?.name !== 'AbortError') ctx.toast('Partage impossible : ' + (err?.message || err));
        }
      },
    }, 'Partager');
  }

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', class: 's-hidden', 'aria-hidden': 'true', tabindex: '-1' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      ctx.toast('Fichier illisible : ce n\'est pas du JSON valide');
      return;
    }
    const n = Array.isArray(data?.logs) ? data.logs.length : '?';
    const when = data?.exportedAt ? ` du ${fmtDate(typeof data.exportedAt === 'number' ? data.exportedAt : Date.parse(data.exportedAt))}` : '';
    if (!confirm(`Importer la sauvegarde${when} (${n} séances) ? Toutes les données actuelles seront remplacées.`)) return;
    try {
      await ctx.db.importAll(data);
      ctx.toast('Sauvegarde importée');
      ctx.refresh();
    } catch (err) {
      ctx.toast('Import refusé : ' + (err?.message || err));
    }
  });
  const importBtn = el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => fileInput.click() }, 'Importer');

  return el('section', { class: 'card s-section' },
    el('h2', { class: 'h2', text: 'Sauvegarde' }),
    el('p', { class: 'muted s-small', text: 'Les données restent sur ce téléphone. Un export JSON permet de les retrouver ailleurs.' }),
    status,
    el('div', { class: 's-actions' }, exportBtn, shareBtn, importBtn),
    fileInput,
  );
}

function canShareFiles() {
  try {
    if (!navigator.share || !navigator.canShare) return false;
    const f = new File(['{}'], 'test.json', { type: 'application/json' });
    return navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}

/* Stockage */

async function storageSection() {
  const sec = el('section', { class: 'card s-section' }, el('h2', { class: 'h2', text: 'Stockage' }));
  const line = el('p', { class: 's-small' });
  sec.append(line);

  const st = navigator.storage;
  if (!st?.persisted) {
    line.textContent = 'Ce navigateur ne précise pas si le stockage est persistant.';
    line.className = 's-small muted';
    return sec;
  }
  const paint = (ok) => {
    line.textContent = ok
      ? 'Stockage persistant : oui. Le navigateur ne videra pas les données de lui-même.'
      : 'Stockage persistant : non. Le navigateur peut effacer les données si l\'espace manque : exporte régulièrement.';
    line.className = 's-small ' + (ok ? 'muted' : 's-warn');
  };
  let persisted = false;
  try { persisted = await st.persisted(); } catch { /* inconnu */ }
  paint(persisted);

  if (st.estimate) {
    try {
      const { usage } = await st.estimate();
      if (usage > 0) {
        const txt = usage < 1024 * 1024
          ? `${Math.max(1, Math.round(usage / 1024))} Ko`
          : `${(usage / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
        sec.append(el('p', { class: 'muted s-small', text: `Espace utilisé : ${txt}` }));
      }
    } catch { /* sans gravité */ }
  }

  if (!persisted && st.persist) {
    const btn = el('button', {
      type: 'button', class: 'btn btn-ghost s-full',
      onclick: async () => {
        let ok = false;
        try { ok = await st.persist(); } catch { /* refusé */ }
        paint(ok);
        if (ok) btn.remove();
      },
    }, 'Demander le stockage persistant');
    sec.append(btn);
  }
  return sec;
}
