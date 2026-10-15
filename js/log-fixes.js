// Corrections ponctuelles de séances déjà enregistrées, appliquées une seule fois au démarrage.
// Sert quand un exercice fait en salle n'existait pas encore dans l'app.

const sets = (exerciseId, load, reps, ts) => reps.map((r, i) => ({ exerciseId, setIndex: i, load, reps: r, ts }));

export const LOG_FIXES = [
  {
    // Pec/Dos du 14/10 : poulies prises, remplacées par écarté couché + tirage bûcheron, non saisissables
    id: '2026-10-15-pec-dos-halteres',
    find: (logs) => logs
      .filter((l) => l.status === 'done' && l.sessionId === 'pec-dos' && l.date >= '2026-10-12' && l.date <= '2026-10-15')
      .sort((a, b) => (b.date + (b.startedAt || 0)).localeCompare(a.date + (a.startedAt || 0)))[0] || null,
    apply(log) {
      const has = (id) => log.sets.some((s) => s.exerciseId === id);
      if (has('ecarte-banc') || has('tirage-un-bras')) return false;
      const ts = log.endedAt || log.startedAt || 0;
      log.sets.push(...sets('ecarte-banc', 18, [10, 10, 11], ts), ...sets('tirage-un-bras', 26, [10, 12, 10], ts));
      log.note = [log.note, 'Poulies prises : écarté couché et tirage bûcheron ajoutés après coup'].filter(Boolean).join('\n');
      return true;
    },
  },
  {
    // Même séance : reverse crunch fait (environ 3 × 15), non saisi
    id: '2026-10-15-pec-dos-reverse-crunch',
    find: (logs) => LOG_FIXES[0].find(logs),
    apply(log) {
      if (log.sets.some((s) => s.exerciseId === 'reverse-crunch')) return false;
      log.sets.push(...sets('reverse-crunch', 0, [15, 15, 15], log.endedAt || log.startedAt || 0));
      return true;
    },
  },
];

// Applique les corrections en attente. Une correction dont la séance est introuvable sur cet
// appareil reste en attente (elle peut arriver plus tard par la sauvegarde en ligne).
export async function applyLogFixes(db) {
  const done = (await db.getSetting('logFixes', [])) || [];
  const pending = LOG_FIXES.filter((f) => !done.includes(f.id));
  if (!pending.length) return 0;
  const logs = await db.listLogs();
  let changed = 0;
  for (const fix of pending) {
    const log = fix.find(logs);
    if (!log) continue;
    if (fix.apply(log)) { await db.saveLog(log); changed++; }
    done.push(fix.id);
  }
  await db.setSetting('logFixes', done);
  return changed;
}
