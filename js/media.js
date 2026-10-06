// Illustrations animées : deux photos (départ / arrivée) en fondu enchaîné.
// Sources : free-exercise-db (github.com/yuhonas/free-exercise-db), domaine public (Unlicense) ;
// fentes marchées : vidéo wger.de (exercice 206, auteur Goulart, CC BY-SA), recadrée en boucle.

const AVAILABLE = new Set('chest-row-incline crunch curl-cable curl-marteau-cable dc-incline-halteres developpe-barre ecarte-banc ecarte-incline elevation-laterale extension-triceps-haut fentes-marchees leg-curl mollet-presse oiseau-incline pushdown-cable reverse-crunch step-up tirage-un-bras traction-pronation wallball-thruster'.split(' '));

// Point focal du recadrage quand la tête sort du cadre
const FOCUS = { 'traction-pronation': 'center 0%', 'step-up': 'center 10%' };

// Exercices illustrés par une vraie vidéo en boucle (0.jpg sert d'affiche et de vignette)
const VIDEO = new Set(['fentes-marchees']);

export const hasMedia = (exId) => AVAILABLE.has(exId);

export const mediaSrc = (exId, frame = 0) => `img/ex/${exId}/${frame}.jpg`;

// size : 'hero' (carte de séance), 'thumb' (vignette de liste), 'mini' (aperçu du repos)
export function mediaHTML(exId, { size = 'hero', alt = '' } = {}) {
  if (!hasMedia(exId)) return '';
  if (VIDEO.has(exId)) {
    const inner = size === 'thumb'
      ? `<img src="${mediaSrc(exId, 0)}" alt="" decoding="async" loading="lazy">`
      : `<video src="img/ex/${exId}/loop.mp4" poster="${mediaSrc(exId, 0)}" autoplay muted loop playsinline disablepictureinpicture preload="auto"></video>`;
    return `<div class="exm exm-${size}" role="img" aria-label="${alt.replace(/"/g, '&quot;')}">${inner}</div>`;
  }
  const pos = FOCUS[exId] ? ` style="object-position:${FOCUS[exId]}"` : '';
  return `<div class="exm exm-${size}" role="img" aria-label="${alt.replace(/"/g, '&quot;')}">
    <img src="${mediaSrc(exId, 0)}"${pos} alt="" decoding="async" loading="lazy">
    <img class="exm-b" src="${mediaSrc(exId, 1)}"${pos} alt="" decoding="async" loading="lazy">
  </div>`;
}
