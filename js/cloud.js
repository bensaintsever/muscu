// Client Supabase minimal (fetch) : auth GoTrue par e-mail + mot de passe, lecture et upsert PostgREST.
// Le mot de passe ne fait que passer : seule la session (jetons) est conservée, via `storage`.

const TIMEOUT = 15000;
const REFRESH_MARGIN = 60; // secondes avant expiration
const PAGE = 1000;

export class CloudError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = 'CloudError';
    this.code = code; // 'network' | 'auth' | 'credentials' | 'input' | 'server'
    this.status = status;
  }
}

const NETWORK_MSG = 'Pas de connexion au serveur. Vérifie le réseau et réessaie.';

// Traduit une réponse d'erreur GoTrue / PostgREST en message lisible.
export function cloudError(status, body = {}) {
  const code = String(body.error_code || body.error || body.code || '');
  const raw = String(body.msg || body.error_description || body.message || '');
  const has = (s) => code.includes(s) || raw.toLowerCase().includes(s);
  if (has('invalid_credentials') || has('invalid login credentials') || (has('invalid_grant') && !has('refresh'))) {
    return new CloudError('credentials', 'E-mail ou mot de passe incorrect.', status);
  }
  if (has('email_not_confirmed') || has('email not confirmed')) {
    return new CloudError('credentials', 'Adresse pas encore confirmée : ouvre le lien reçu par e-mail, puis connecte-toi.', status);
  }
  if (has('user_already_exists') || has('already registered')) {
    return new CloudError('input', 'Un compte existe déjà avec cette adresse : connecte-toi.', status);
  }
  if (has('weak_password') || has('password should')) {
    return new CloudError('input', 'Mot de passe trop faible : choisis-en un plus long (8 caractères ou plus).', status);
  }
  if (has('rate_limit') || status === 429) {
    return new CloudError('input', 'Trop de tentatives. Attends quelques minutes avant de réessayer.', status);
  }
  if (has('email_address_invalid') || has('invalid format') || has('unable to validate email')) {
    return new CloudError('input', 'Adresse e-mail invalide.', status);
  }
  if (has('signup_disabled')) return new CloudError('input', 'Les inscriptions sont fermées sur ce projet.', status);
  if (has('refresh') || has('session_not_found') || has('bad_jwt') || status === 401) {
    return new CloudError('auth', 'Session expirée : reconnecte-toi.', status);
  }
  if (status === 403 || code === '42501') return new CloudError('auth', 'Accès refusé par le serveur : reconnecte-toi.', status);
  if (status >= 500) return new CloudError('server', `Le serveur ne répond pas correctement (erreur ${status}). Nouvel essai plus tard.`, status);
  return new CloudError('server', `Erreur inattendue du serveur (${status || '?'}).`, status);
}

// Contenu d'un JWT (sans vérification : sert seulement à lire id et e-mail).
export function jwtPayload(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(Array.from(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')),
      (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function toSession(body, nowMs) {
  if (!body?.access_token || !body.refresh_token) return null;
  const claims = jwtPayload(body.access_token) || {};
  const expiresAt = Number(body.expires_at) || Math.floor(nowMs / 1000) + (Number(body.expires_in) || 3600);
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: expiresAt,
    user: { id: body.user?.id || claims.sub, email: body.user?.email || claims.email || '' },
  };
}

// Lien de confirmation : Supabase renvoie vers l'app avec #access_token=…&refresh_token=… ou #error=…
export function parseAuthHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#\/?/, ''));
  if (p.get('error') || p.get('error_description')) {
    return { error: (p.get('error_description') || p.get('error')).replace(/\+/g, ' ') };
  }
  if (!p.get('access_token')) return null;
  return {
    access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
    expires_at: Number(p.get('expires_at')) || undefined, expires_in: Number(p.get('expires_in')) || undefined,
  };
}

export function createCloud({ url, key, table = 'muscu_items', storage, fetch: f, now = () => Date.now() }) {
  const doFetch = f || ((...a) => globalThis.fetch(...a));
  let refreshing = null;

  async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT) : null;
    let res;
    try {
      res = await doFetch(url + path, {
        method,
        headers: {
          apikey: key,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl?.signal,
      });
    } catch {
      throw new CloudError('network', NETWORK_MSG);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw cloudError(res.status, data || {});
    return { data, res };
  }

  async function keep(body) {
    const session = toSession(body, now());
    if (!session?.user?.id) throw new CloudError('server', 'Réponse de connexion incomplète.');
    await storage.save(session);
    return session;
  }

  async function refresh(session) {
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const { data } = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
          return await keep(data);
        } catch (e) {
          // Jeton refusé : la session est morte, il faut se reconnecter. Réseau absent : on garde tout.
          if (e.status >= 400 && e.status < 500 && e.status !== 429) {
            await storage.save(null);
            throw new CloudError('auth', 'Session expirée : reconnecte-toi.', e.status);
          }
          throw e;
        } finally {
          refreshing = null;
        }
      })();
    }
    return refreshing;
  }

  // Session valide (rafraîchie si elle expire dans moins d'une minute), ou null si déconnecté.
  async function getSession({ force = false } = {}) {
    const session = await storage.load();
    if (!session?.refresh_token) return null;
    if (force || session.expires_at - now() / 1000 < REFRESH_MARGIN) return refresh(session);
    return session;
  }

  // Requête authentifiée ; un 401 (horloge décalée, jeton révoqué) déclenche un rafraîchissement et un nouvel essai.
  async function authed(path, opts) {
    let session = await getSession();
    if (!session) throw new CloudError('auth', 'Pas connecté.');
    try {
      return await call(path, { ...opts, token: session.access_token });
    } catch (e) {
      if (e.status !== 401) throw e;
      session = await getSession({ force: true });
      return call(path, { ...opts, token: session.access_token });
    }
  }

  return {
    getSession,

    async signUp(email, password) {
      // Retour vers l'app elle-même après confirmation, pas vers l'adresse par défaut du projet
      const back = typeof location !== 'undefined' ? `?redirect_to=${encodeURIComponent(location.origin + location.pathname)}` : '';
      const { data } = await call(`/auth/v1/signup${back}`, { method: 'POST', body: { email, password } });
      if (data?.access_token) return { session: await keep(data), needsConfirmation: false };
      const user = data?.user || data;
      // Adresse déjà inscrite : GoTrue répond 200 avec un utilisateur sans identité (anti-énumération)
      if (Array.isArray(user?.identities) && user.identities.length === 0) {
        throw new CloudError('input', 'Un compte existe déjà avec cette adresse : connecte-toi (ou confirme-la via l\'e-mail reçu).');
      }
      return { session: null, needsConfirmation: true };
    },

    async signIn(email, password) {
      const { data } = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      return keep(data);
    },

    // Déconnexion locale immédiate ; la révocation côté serveur est faite au mieux.
    async signOut() {
      const session = await storage.load();
      await storage.save(null);
      if (session?.access_token) {
        try { await call('/auth/v1/logout', { method: 'POST', token: session.access_token }); } catch { /* sans gravité */ }
      }
    },

    async sessionFromHash(hash) {
      const parsed = parseAuthHash(hash);
      if (!parsed) return null;
      if (parsed.error) throw new CloudError('auth', `Lien de confirmation refusé : ${parsed.error}`);
      return keep(parsed);
    },

    // user_id est envoyé explicitement : toutes les colonnes de la clé de conflit sont dans la charge,
    // et la règle RLS refuse (403) toute ligne qui ne serait pas à l'utilisateur connecté.
    async upsert(rows) {
      if (!rows.length) return;
      await authed(`/rest/v1/${table}?on_conflict=user_id,kind,key`, {
        method: 'POST', body: rows,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    },

    async selectAll() {
      const all = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data } = await authed(`/rest/v1/${table}?select=*&order=kind.asc,key.asc&limit=${PAGE}&offset=${offset}`);
        const rows = Array.isArray(data) ? data : [];
        all.push(...rows);
        if (rows.length < PAGE) return all;
      }
    },
  };
}
