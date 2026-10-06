// Réglages : sauvegarde en ligne (connexion par e-mail et mot de passe, état de la synchronisation).
import * as sync from './sync-run.js';
import { statusText } from './sync.js';

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((c) => c != null && c !== false));
  return n;
}

export async function cloudSection(ctx) {
  const sec = h('section', { class: 'card s-section', id: 's-cloud' });
  const body = h('div');
  sec.append(h('h2', { class: 'h2', text: 'Sauvegarde en ligne' }), body);

  let mode = null;
  // force : redessiner même le formulaire de connexion (sinon on garderait ce qui est en cours de saisie)
  const paint = async (force = false) => {
    if (!sec.isConnected && body.childElementCount) { stop(); return; }
    const st = await sync.status();
    const next = st.session ? 'in' : 'out';
    if (next === 'out' && mode === 'out' && !force) return;
    mode = next;
    body.replaceChildren(...(st.session ? connected(ctx, st, paint) : signedOut(ctx, st, paint)));
  };
  // Pas de nettoyage de vue dans Réglages : l'abonnement s'arrête de lui-même quand la section disparaît
  const unsub = sync.subscribe(() => { if (!sec.isConnected) stop(); else if (!busy) paint(); });
  const tick = setInterval(() => { if (!sec.isConnected) stop(); else if (!busy) paint(); }, 30000);
  const stop = () => { unsub(); clearInterval(tick); };
  await paint();
  // Ouvrir les Réglages envoie ce qui attend
  sync.pushSoon(0);
  return sec;
}

let busy = false;

function connected(ctx, st, paint) {
  const { text, warn } = statusText(st);
  const save = h('button', {
    type: 'button', class: 'btn btn-primary',
    onclick: async () => {
      if (!navigator.onLine) { ctx.toast('Pas de réseau : la sauvegarde partira au retour de la connexion'); return; }
      save.disabled = true;
      const r = await sync.syncNow();
      save.disabled = false;
      if (r?.ok) {
        ctx.toast(r.applied ? `Sauvegardé, ${r.applied} élément${r.applied > 1 ? 's' : ''} récupéré${r.applied > 1 ? 's' : ''}` : 'Sauvegardé');
        if (r.applied) ctx.refresh();
      } else if (r?.error) ctx.toast(r.error.message, 4000);
    },
  }, 'Sauvegarder maintenant');
  const out = h('button', {
    type: 'button', class: 'btn btn-ghost',
    onclick: async () => {
      if (!confirm('Se déconnecter de la sauvegarde en ligne ? Les données restent sur ce téléphone.')) return;
      await sync.signOut();
      ctx.toast('Déconnecté. Les données restent sur ce téléphone.');
      paint(true);
    },
  }, 'Se déconnecter');
  return [
    h('p', { class: 's-small' }, h('span', { class: 'muted', text: 'Connecté : ' }), h('b', { text: st.session.user?.email || '' })),
    h('p', { class: 's-small ' + (warn ? 's-warn' : 'muted'), role: 'status', text: text }),
    h('div', { class: 's-actions' }, save, out),
  ];
}

function signedOut(ctx, st, paint) {
  const msg = h('p', { class: 's-small', role: 'status' });
  const say = (text, warn = false) => { msg.textContent = text; msg.className = 's-small ' + (warn ? 's-warn' : 'muted'); };
  if (st.error?.code === 'auth') say(st.error.message, true);

  const email = h('input', {
    type: 'email', id: 's-cloud-email', class: 's-input', autocomplete: 'email', inputmode: 'email',
    autocapitalize: 'off', spellcheck: 'false', required: true,
  });
  const password = h('input', {
    type: 'password', id: 's-cloud-pass', class: 's-input', autocomplete: 'current-password', required: true, minlength: '6',
  });
  const loginBtn = h('button', { type: 'submit', class: 'btn btn-primary', text: 'Se connecter' });
  const createBtn = h('button', { type: 'button', class: 'btn', text: 'Créer le compte' });

  const values = () => {
    const e = email.value.trim();
    const p = password.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { say('Saisis une adresse e-mail valide.', true); email.focus(); return null; }
    if (p.length < 6) { say('Mot de passe : 6 caractères minimum.', true); password.focus(); return null; }
    return [e, p];
  };
  const lock = (on) => { busy = on; loginBtn.disabled = on; createBtn.disabled = on; };

  const form = h('form', { class: 's-cloud-form', novalidate: true },
    h('label', { class: 's-field s-field-col', for: 's-cloud-email' }, h('span', { class: 's-label', text: 'E-mail' }), email),
    h('label', { class: 's-field s-field-col', for: 's-cloud-pass' }, h('span', { class: 's-label', text: 'Mot de passe' }), password),
    h('div', { class: 's-actions' }, loginBtn, createBtn),
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    password.setAttribute('autocomplete', 'current-password');
    const v = values();
    if (!v) return;
    lock(true);
    say('Connexion…');
    try {
      const r = await sync.signIn(...v);
      password.value = '';
      ctx.toast(r?.applied ? 'Connecté, données récupérées' : 'Connecté, sauvegarde en ligne activée');
      lock(false);
      if (r?.applied) ctx.refresh(); else paint();
    } catch (e) {
      lock(false);
      say(e?.message || String(e), true);
    }
  });
  createBtn.addEventListener('click', async () => {
    password.setAttribute('autocomplete', 'new-password');
    const v = values();
    if (!v) return;
    lock(true);
    say('Création du compte…');
    try {
      const r = await sync.signUp(...v);
      lock(false);
      if (r.session) { password.value = ''; await sync.syncNow(); paint(true); return; }
      say('Confirme ton adresse via l\'e-mail reçu, puis connecte-toi.');
    } catch (e) {
      lock(false);
      say(e?.message || String(e), true);
    }
  });

  return [
    h('p', { class: 'muted s-small', text: 'Connecte-toi pour sauvegarder séances et réglages en ligne et les retrouver sur un autre téléphone. Sans connexion, tout reste sur ce téléphone.' }),
    form,
    msg,
  ];
}
