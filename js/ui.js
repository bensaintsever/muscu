// Helpers partagés par les vues : échappement, formats, icônes, modales.
import * as prog from './progression.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
export const fmtN = (n) => nf.format(Number(n) || 0);
export const round2 = (n) => Math.round(n * 100) / 100;
export const parseNum = (s) => {
  const n = parseFloat(String(s).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
export const WEEKDAYS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', opts);
}

export function fmtDuration(ms) {
  if (!(ms > 0)) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const fmtVolume = (v) => `${fmtN(Math.round(v || 0))} kg`;

export function fmtLoad(ex, load) {
  if (!ex || ex.unit === 'reps') return '';
  if (load == null) return '';
  if (ex.loadType === 'bodyweight') return load > 0 ? `PDC + ${fmtN(load)} kg` : 'PDC';
  return `${fmtN(load)} kg`;
}

// « 26 kg · 10 / 10 / 8 », ou détail série par série si les charges varient.
export function fmtSets(ex, sets) {
  if (!sets?.length) return '';
  const reps = sets.map((s) => s.reps).join(' / ');
  if (ex.unit === 'reps') return `${reps} reps`;
  const loads = [...new Set(sets.map((s) => s.load))];
  if (loads.length === 1) return `${fmtLoad(ex, loads[0])} · ${reps}`;
  return sets.map((s) => `${fmtN(s.load)} × ${s.reps}`).join(' / ');
}

export function weekLabel(type) {
  return prog.WEEK_TYPES?.[type]?.label ?? type ?? '';
}

export function weekChip(type) {
  const label = weekLabel(type);
  return type === 'aucune' ? label : `Semaine ${String(label).toLowerCase()}`;
}

export function volumeOf(log) {
  try { return prog.sessionVolume(log); } catch { return (log.sets || []).reduce((a, s) => a + (s.load || 0) * (s.reps || 0), 0); }
}

export const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};

// ---------- Modales ----------

const openModals = new Set();

export function openModal(html, onAction) {
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

export function closeAllModals() {
  [...openModals].forEach((c) => c());
}

export function confirmDialog({ title, text = '', ok = 'Confirmer', cancel = 'Annuler', danger = false }) {
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

export function errorCard(title, err) {
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
