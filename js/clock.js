// Date du jour, centralisée. `?today=AAAA-MM-JJ` dans l'URL simule une autre date (tests au navigateur) :
// seule cette fonction la lit, l'heure reste l'heure réelle.

function simulated() {
  try {
    if (typeof location === 'undefined') return null;
    const v = new URLSearchParams(location.search).get('today');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  } catch {
    return null;
  }
}

export function today() {
  const now = new Date();
  const sim = simulated();
  if (!sim) return now;
  return new Date(sim.y, sim.m - 1, sim.d, now.getHours(), now.getMinutes(), now.getSeconds());
}

export function todayISO() {
  const d = today();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const isSimulated = () => simulated() !== null;
