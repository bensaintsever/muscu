// Accueil : carte du bloc en cours (comptes à rebours) et carte des défis de la semaine.
import { esc, fmtDate } from '../ui.js';
import * as cy from '../cycles.js';

export function inDaysTxt(n) {
  if (n === 0) return "aujourd'hui";
  if (n === 1) return 'demain';
  return `dans ${n} jours`;
}

export function cycleCardHTML(plan, day) {
  const { block, week } = day;
  const idx = plan.resolved.indexOf(block);
  const nextBlock = plan.resolved[idx + 1];
  const chips = [];
  const inChallengeWeek = cy.testsInWeek(plan.resolved, day.iso).length > 0;
  const ch = cy.nextChallenge(plan.resolved, day.iso);
  if (ch && !inChallengeWeek) chips.push(`<span class="chip">Défi ${esc(inDaysTxt(cy.diffDays(day.iso, ch.date)))}</span>`);
  const race = cy.nextRace(day.iso, plan.race);
  if (race) {
    const prov = race.name === 'Hyrox' && plan.provisional ? ', date provisoire' : '';
    chips.push(`<span class="chip">${esc(race.name)} ${esc(inDaysTxt(race.inDays))}${prov}</span>`);
  }
  const lastWeek = !week || week.index === week.count;
  if (nextBlock && lastWeek && nextBlock.id !== 'apres') {
    chips.push(`<span class="chip">${esc(nextBlock.name)} ${esc(inDaysTxt(cy.diffDays(day.iso, nextBlock.start)))}</span>`);
  }
  const kicker = week && week.count > 1 ? `Bloc · semaine ${week.index}/${week.count}` : block.base ? 'Dernière semaine' : 'Bloc';
  return `<section class="card cycle-card">
    <div class="kicker">${esc(kicker)}</div>
    <div class="cycle-name">${esc(block.name)}</div>
    <p class="cycle-intent">${esc(block.intent || '')}</p>
    ${chips.length ? `<div class="cycle-chips">${chips.join('')}</div>` : ''}
  </section>`;
}

const VERDICT = {
  success: ['ok', 'Réussi'],
  fail: ['warn', 'Pas encore'],
  reference: ['ok', 'Référence posée'],
};

export function challengeCardHTML(rows, iso) {
  if (!rows.length) return '';
  const items = rows.map(({ test, result }) => {
    let [cls, txt] = VERDICT[result.status] || ['', ''];
    if (!txt) [cls, txt] = test.date < iso ? ['', 'Pas fait'] : test.date === iso ? ['normale', "Aujourd'hui"] : ['', 'À venir'];
    return `<li class="ch-item">
      <div class="grow"><div class="ch-label">${esc(test.label)}</div>
        <div class="muted small">${esc(fmtDate(test.date))}${result.detail ? ` · ${esc(result.detail)}` : ''}</div></div>
      <span class="chip ${cls}">${esc(txt)}</span>
    </li>`;
  }).join('');
  return `<section class="card challenge-card">
    <div class="kicker">Semaine défi</div>
    <ul class="ch-list">${items}</ul>
  </section>`;
}

export function dayLineHTML(day) {
  if (day.sessionId) return day.hyrox ? '<p class="day-line">Cours Hyrox ce soir</p>' : '';
  const txt = day.note || (day.hyrox ? 'Cours Hyrox' : '');
  return txt ? `<p class="day-line">Aujourd'hui : ${esc(txt)}</p>` : '';
}
