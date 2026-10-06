// Point d'entrée : démarrage, routeur par hash, toast, navigation basse.
import * as db from './db.js';
import * as prog from './progression.js';
import * as plan from './plan.js';
import { today } from './clock.js';
import { errorCard, closeAllModals } from './ui.js';
import { renderHome } from './views/home.js';
import { renderRecap } from './views/recap.js';
import { renderSession } from './session/view.js';

const appEl = document.getElementById('app');
const navEl = document.getElementById('nav');
const toastEl = document.getElementById('toast');

const ctx = { db, prog, plan, today, navigate, toast, refresh };

let cleanup = null;
let routeToken = 0;

// ---------- Toast ----------

let toastTimer = null;
function toast(message, ms = 2600) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

// ---------- Routage ----------

function navigate(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) route();
  else location.hash = hash;
}

function refresh() { route(); }

function updateNav(name) {
  const key = { '': 'home', history: 'history', progress: 'progress', settings: 'settings' }[name];
  navEl.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
}

function mount() {
  const root = document.createElement('div');
  appEl.replaceChildren(root);
  return root;
}

async function route() {
  const token = ++routeToken;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  closeAllModals();
  const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p));
  document.body.classList.toggle('in-session', name === 'session');
  updateNav(name);
  window.scrollTo(0, 0);
  const root = mount();
  const live = () => token === routeToken;
  // Ce que reçoivent les vues internes : à elles de vérifier live() avant de poser leur nettoyage
  const view = { ctx, live, setCleanup: (fn) => { cleanup = fn; } };
  try {
    switch (name) {
      case '': await renderHome(root, view); break;
      case 'session': await renderSession(root, view); break;
      case 'recap': await renderRecap(root, view, arg); break;
      case 'history': await renderExternal(root, './history.js', 'renderHistory', arg); break;
      case 'progress': await renderExternal(root, './history.js', 'renderProgress', arg); break;
      case 'settings': await renderExternal(root, './settings.js', 'renderSettings'); break;
      default: navigate('#/');
    }
  } catch (e) {
    console.error(e);
    if (live()) { root.className = 'view'; root.innerHTML = errorCard('Cet écran a rencontré une erreur', e); }
  }
}

async function renderExternal(root, path, fn, arg) {
  let mod;
  try {
    mod = await import(path);
  } catch (e) {
    console.error(e);
    root.className = 'view';
    root.innerHTML = errorCard("Ce module n'a pas pu être chargé", e);
    return;
  }
  if (typeof mod[fn] !== 'function') {
    root.className = 'view';
    root.innerHTML = errorCard('Écran indisponible', new Error(`${fn} absent de ${path}`));
    return;
  }
  await (arg === undefined ? mod[fn](root, ctx) : mod[fn](root, ctx, arg));
  if (!root.classList.contains('view') && !root.querySelector(':scope > .view')) root.classList.add('view');
}

// ---------- Démarrage ----------

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  try {
    await db.init();
  } catch (e) {
    console.error(e);
    appEl.innerHTML = `<div class="view">${errorCard("Impossible d'ouvrir la base de données", e)}</div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}

boot();
