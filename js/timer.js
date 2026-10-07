// Minuteur de repos, compte à rebours, wake lock, vibration et son.
// Tout est calé sur un timestamp de fin : juste après mise en veille ou changement d'app.

export const END_PATTERN = [300, 150, 300, 150, 600];

export function vibrate(pattern) {
  try { if ('vibrate' in navigator) navigator.vibrate(pattern); } catch { /* rien */ }
}

// Compte à rebours générique (repos, maintien du wall ball).
export class Countdown {
  constructor({ onTick, onEnd } = {}) {
    this.onTick = onTick;
    this.onEnd = onEnd;
    this.endsAt = 0;
    this.total = 0;
    this.iv = null;
    this._vis = () => { if (document.visibilityState === 'visible') this.tick(); };
  }

  start(endsAt, totalMs) {
    this.stop();
    this.endsAt = endsAt;
    this.total = totalMs || Math.max(0, endsAt - Date.now());
    this.iv = setInterval(() => this.tick(), 200);
    document.addEventListener('visibilitychange', this._vis);
    this.tick();
    return this;
  }

  get remaining() { return Math.max(0, this.endsAt - Date.now()); }
  get running() { return this.iv !== null; }

  addTime(sec) {
    if (!this.running) return this.endsAt;
    const now = Date.now();
    this.endsAt = Math.max(now, this.endsAt + sec * 1000);
    this.total = Math.max(this.total + sec * 1000, this.endsAt - now, 1000);
    this.tick();
    return this.endsAt;
  }

  tick() {
    if (!this.running) return;
    const left = this.endsAt - Date.now();
    if (left <= 0) {
      this.stop();
      this.onTick?.(0, this.total);
      this.onEnd?.(-left);
      return;
    }
    this.onTick?.(left, this.total);
  }

  stop() {
    if (this.iv !== null) clearInterval(this.iv);
    this.iv = null;
    document.removeEventListener('visibilitychange', this._vis);
  }
}

// Repos : une seule instance à la fois.
let rest = null;

export function startRest(seconds, handlers) {
  return resumeRest(Date.now() + seconds * 1000, seconds * 1000, handlers);
}

export function resumeRest(endsAt, totalMs, handlers) {
  stopRest();
  rest = new Countdown(handlers);
  rest.start(endsAt, totalMs);
  return rest.endsAt;
}

export function addTime(sec) { return rest ? rest.addTime(sec) : 0; }

// Passe le repos sans alerte.
export function skip() { stopRest(); }

export function stopRest() {
  if (rest) rest.stop();
  rest = null;
}

export function restState() {
  return rest && rest.running ? { endsAt: rest.endsAt, total: rest.total } : null;
}

// Wake lock écran, redemandé au retour de visibilité tant qu'il est voulu.
let sentinel = null;
let wanted = false;

export async function requestWakeLock() {
  wanted = true;
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
  if (sentinel && !sentinel.released) return true;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock() {
  wanted = false;
  const s = sentinel;
  sentinel = null;
  try { await s?.release(); } catch { /* rien */ }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') requestWakeLock();
});

// Son : l'AudioContext doit être créé ou repris pendant un geste utilisateur.
let audio = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) audio = new AC();
    if (audio.state === 'suspended') audio.resume();
    // Tampon silencieux : finit de débloquer la sortie sur Android.
    const buf = audio.createBuffer(1, 1, 22050);
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(audio.destination);
    src.start(0);
  } catch { /* rien */ }
}

// Une note : oscillateur + enveloppe courte, éventuellement avec glissement de hauteur.
function note(out, t, { type = 'triangle', freq, to, dur, gain }) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + Math.min(0.08, dur / 2));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.setValueAtTime(gain, t + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return osc;
}

// Sortie commune : un compresseur pour que le « go » claque sans saturer.
function output() {
  const comp = audio.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 6;
  comp.attack.value = 0.002;
  comp.release.value = 0.15;
  const lp = audio.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5000;
  comp.connect(lp).connect(audio.destination);
  return comp;
}

// Trois tops de plus en plus forts (3, 2, 1), le dernier temps libre avant le départ.
function ticks(out, tEnd, now) {
  const oscs = [];
  [3, 2, 1].forEach((k, i) => {
    const t = tEnd - k;
    if (t > now + 0.01) oscs.push(note(out, t, { type: 'triangle', freq: 988, dur: 0.09, gain: 0.32 + i * 0.12 }));
  });
  return oscs;
}

// Le « go » : deux notes nettes qui montent (choisi par Benjamin parmi 4 variantes).
function go(out, t) {
  return [
    note(out, t, { type: 'sine', freq: 1175, dur: 0.15, gain: 0.62 }),
    note(out, t + 0.17, { type: 'sine', freq: 1760, dur: 0.5, gain: 0.7 }),
  ];
}

// Joue le « go » tout de suite (fin de maintien, ou repos sans son programmé).
export function beep() {
  if (!audio) return;
  try {
    if (audio.state === 'suspended') audio.resume();
    go(output(), audio.currentTime + 0.02);
  } catch { /* rien */ }
}

// Compte à rebours + « go » programmés d'avance dans le moteur audio : ils partent à l'heure
// même si la page est en arrière-plan et que ses minuteurs JS sont gelés.
let scheduled = [];

export function scheduleBeep(secondsFromNow) {
  cancelScheduledBeep();
  if (!audio || !(secondsFromNow > 0)) return;
  try {
    if (audio.state === 'suspended') audio.resume();
    const now = audio.currentTime;
    const tEnd = now + secondsFromNow;
    const out = output();
    scheduled = [...ticks(out, tEnd, now), ...go(out, tEnd)];
  } catch { scheduled = []; }
}

export function cancelScheduledBeep() {
  for (const o of scheduled) { try { o.stop(0); o.disconnect(); } catch { /* rien */ } }
  scheduled = [];
}

export const hasScheduledBeep = () => scheduled.length > 0;

// Alerte de fin (repos ou maintien).
export function alertEnd(soundOn = true) {
  vibrate(END_PATTERN);
  if (soundOn) beep();
}

export function fmtClock(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
