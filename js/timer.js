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

export function beep({ count = 2, freq = 880, dur = 0.12, gap = 0.1 } = {}) {
  if (!audio) return;
  try {
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime + 0.02;
    for (let i = 0; i < count; i++) {
      const t = t0 + i * (dur + gap);
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === count - 1 ? freq * 1.5 : freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  } catch { /* rien */ }
}

// Bip programmé d'avance dans le moteur audio : il part à l'heure même si la page
// est en arrière-plan et que ses minuteurs JS sont gelés.
let scheduled = [];

export function scheduleBeep(secondsFromNow) {
  cancelScheduledBeep();
  if (!audio || !(secondsFromNow > 0)) return;
  try {
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime + secondsFromNow;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.22;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 2 ? 1320 : 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.16);
      scheduled.push(osc);
    }
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
