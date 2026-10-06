// Réglages : date du Hyrox (les blocs Moteur et Duo se recalent à rebours).
import { CYCLES, CYCLES_DEFAULTS } from './cycles-data.js';
import { resolveCycles } from './cycles.js';

const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const short = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Résumé des blocs calés sur la course : « Moteur 04/01 → 24/01 (3 sem.) · Duo 25/01 → 14/02 ».
export function relativeSummary(hyroxDate) {
  return resolveCycles(CYCLES, { hyroxDate })
    .filter((b) => b.relative === 'moteur' || b.relative === 'duo' || b.id === 'b4b-moteur-2')
    .map((b) => `${b.name} ${short(b.start)} → ${short(b.end)} (${b.weeks.length} sem.)`)
    .join(' · ');
}

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  n.append(...kids.filter(Boolean));
  return n;
}

export function hyroxSection(ctx, plan, setting) {
  const status = h('p', { class: 'muted s-small' });
  const summary = h('p', { class: 'muted s-small' });
  const input = h('input', { type: 'date', id: 's-hyrox', class: 's-input', min: '2027-01-11', max: '2027-12-31' });
  const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost s-full', text: 'Revenir à la date provisoire' });

  const paint = (value) => {
    const date = value || CYCLES_DEFAULTS.hyroxDate;
    input.value = date;
    status.textContent = value ? `Course le ${fmt(date)}.` : `Date provisoire : ${fmt(date)}. Saisis la vraie date dès l'inscription.`;
    summary.textContent = relativeSummary(date);
    clearBtn.style.display = value ? '' : 'none';
  };
  paint(setting);

  input.addEventListener('change', async () => {
    const v = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : null;
    if (!v || v < '2027-01-11') { ctx.toast('Date à partir du 11/01/2027'); paint(setting); return; }
    try {
      await ctx.db.setSetting('hyroxDate', v);
      setting = v;
      paint(v);
      ctx.toast('Date du Hyrox enregistrée, blocs recalculés');
    } catch (e) { ctx.toast('Erreur : ' + (e?.message || e)); }
  });
  clearBtn.addEventListener('click', async () => {
    await ctx.db.setSetting('hyroxDate', null);
    setting = null;
    paint(null);
    ctx.toast('Date provisoire rétablie');
  });

  return h('section', { class: 'card s-section' },
    h('h2', { class: 'h2', text: 'Date du Hyrox' }),
    h('label', { class: 's-field', for: 's-hyrox' }, h('span', { class: 's-label', text: 'Duo mixte' }), input),
    status,
    summary,
    clearBtn,
  );
}
