/* Plume — noyau de connexion au compte en ligne (Supabase : GoTrue pour les comptes, PostgREST pour les données).
   Un seul fichier pour les deux mondes : le processus principal d'Electron (require) et la version navigateur
   (inséré dans web/native-web.js par web/build.js). Aucune bibliothèque : de simples appels fetch.
   Les jetons de session ne quittent jamais ce module : l'interface ne reçoit que « connecté ou non » et l'adresse courriel. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlumeCloudCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABLES = ['plume_documents', 'plume_profile'];
  const METHODS = ['GET', 'POST', 'PATCH'];
  const OFFLINE = 'Connexion impossible. Vérifiez votre accès à Internet.';

  /** Messages d'erreur de GoTrue / PostgREST, en français. */
  function explain(status, body) {
    const b = body && typeof body === 'object' ? body : {};
    const code = String(b.error_code || b.code || b.error || '').toLowerCase();
    const msg = String(b.msg || b.message || b.error_description || '');
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Courriel ou mot de passe incorrect.';
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) return 'Adresse courriel non confirmée : ouvrez le message de confirmation reçu par courriel.';
    if (code === 'user_already_exists' || code === 'email_exists' || /already registered/i.test(msg)) return 'Un compte existe déjà avec ce courriel. Connectez-vous plutôt.';
    if (code === 'weak_password' || /password should be at least|weak password/i.test(msg)) return 'Mot de passe trop faible : choisissez-en un plus long (8 caractères ou plus).';
    if (code === 'signup_disabled' || /signups? (are )?not allowed|signup is disabled/i.test(msg)) return 'La création de comptes est désactivée pour ce service.';
    if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || status === 429) return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    if (code === 'validation_failed' || /unable to validate email|invalid email/i.test(msg)) return 'Adresse courriel invalide.';
    if (/invalid api key|no api key/i.test(msg)) return 'La configuration du service en ligne est invalide (clé refusée). Mettez Plume à jour ou contactez son auteur.';
    if (code === 'user_banned') return 'Ce compte est suspendu.';
    if (status === 401 || status === 403) return 'Session expirée : reconnectez-vous.';
    if (status >= 500) return 'Le service en ligne ne répond pas pour l’instant (erreur ' + status + '). Réessayez dans un moment.';
    return msg || 'Échec de la requête (' + status + ').';
  }

  function cleanUrl(u) {
    try {
      const x = new URL(String(u || '').trim());
      const local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(x.hostname);
      if (x.protocol !== 'https:' && !(local && x.protocol === 'http:')) return '';
      return x.origin;
    } catch (_) { return ''; }
  }

  /**
   * @param {object} o
   * @param {string} o.url        adresse du projet (https://xxxx.supabase.co)
   * @param {string} o.key        clé « anon / publishable » (publique par conception)
   * @param {Function} o.fetch    fetch du contexte (net.fetch dans Electron, window.fetch dans le navigateur)
   * @param {Function} o.load     () => session | null   (peut être asynchrone)
   * @param {Function} o.save     (session | null) => void   (peut être asynchrone)
   */
  return function createCloud(o) {
    const base = cleanUrl(o.url);
    const key = String(o.key || '').trim();
    const configured = !!(base && key);
    const doFetch = o.fetch;
    let session;               // undefined = pas encore lu
    let loading = null;
    let refreshing = null;

    async function getSession() {
      if (session !== undefined) return session;
      if (!loading) loading = Promise.resolve(o.load ? o.load() : null).then((s) => { session = s && s.access_token ? s : null; }, () => { session = null; });
      await loading;
      return session;
    }
    async function setSession(s) {
      session = s || null;
      try { await (o.save && o.save(session)); } catch (_) { /* le stockage peut être indisponible : la session vit alors en mémoire */ }
    }

    const toSession = (b) => {
      const now = Math.floor(Date.now() / 1000);
      return {
        access_token: b.access_token, refresh_token: b.refresh_token,
        expires_at: Number(b.expires_at) || now + (Number(b.expires_in) || 3600),
        user: { id: b.user && b.user.id, email: b.user && b.user.email },
      };
    };

    async function raw(method, path, { headers, body, token, timeout } = {}) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeout || 30000) : null;
      try {
        const res = await doFetch(base + path, {
          method,
          headers: Object.assign({ apikey: key, 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, headers || {}),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl ? ctl.signal : undefined,
        });
        let data = null;
        const text = await res.text();
        if (text) { try { data = JSON.parse(text); } catch (_) { data = text; } }
        return { status: res.status, ok: res.ok, data };
      } catch (_) {
        return { status: 0, ok: false, data: null, offline: true };
      } finally { if (timer) clearTimeout(timer); }
    }

    const view = (s) => ({ configured, signedIn: !!s, email: s && s.user ? s.user.email || '' : '', userId: s && s.user ? s.user.id || '' : '' });

    async function status() { return view(await getSession()); }

    async function refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const s = await getSession();
        if (!s || !s.refresh_token) return false;
        const r = await raw('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } });
        if (r.offline || r.status >= 500) return 'offline';           // on garde la session : on réessaiera
        if (r.ok && r.data && r.data.access_token) { await setSession(toSession(r.data)); return true; }
        await setSession(null);                                        // jeton refusé : la session est terminée
        return false;
      })().finally(() => { refreshing = null; });
      return refreshing;
    }

    async function signIn(email, password) {
      if (!configured) return { ok: false, error: 'Le service en ligne n’est pas configuré.' };
      const r = await raw('POST', '/auth/v1/token?grant_type=password', { body: { email: String(email || '').trim(), password: String(password || '') } });
      if (r.offline) return { ok: false, offline: true, error: OFFLINE };
      if (!r.ok || !r.data || !r.data.access_token) return { ok: false, error: explain(r.status, r.data) };
      await setSession(toSession(r.data));
      return { ok: true, status: await status() };
    }

    async function signUp(email, password) {
      if (!configured) return { ok: false, error: 'Le service en ligne n’est pas configuré.' };
      const r = await raw('POST', '/auth/v1/signup', { body: { email: String(email || '').trim(), password: String(password || '') } });
      if (r.offline) return { ok: false, offline: true, error: OFFLINE };
      if (!r.ok) return { ok: false, error: explain(r.status, r.data) };
      if (r.data && r.data.access_token) { await setSession(toSession(r.data)); return { ok: true, status: await status() }; }
      return { ok: true, needsConfirm: true };                         // la confirmation par courriel est activée sur le projet
    }

    async function recover(email) {
      if (!configured) return { ok: false, error: 'Le service en ligne n’est pas configuré.' };
      const r = await raw('POST', '/auth/v1/recover', { body: { email: String(email || '').trim() } });
      if (r.offline) return { ok: false, offline: true, error: OFFLINE };
      return r.ok ? { ok: true } : { ok: false, error: explain(r.status, r.data) };
    }

    async function signOut() {
      const s = await getSession();
      await setSession(null);
      if (s && s.access_token) raw('POST', '/auth/v1/logout', { token: s.access_token, timeout: 8000 }).catch(() => {});   // sans attendre : la session locale est déjà effacée
      return { ok: true };
    }

    /** Requête vers une table de Plume (et seulement celles-là). `query` est un objet {colonne: filtre}. */
    async function request(req) {
      const q = req || {};
      const method = String(q.method || 'GET').toUpperCase();
      if (!configured) return { ok: false, status: 0, error: 'Le service en ligne n’est pas configuré.' };
      if (!METHODS.includes(method) || !TABLES.includes(q.table)) return { ok: false, status: 0, error: 'Requête refusée.' };
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(q.query || {})) {
        if (!/^[a-z_]{1,32}$/.test(k)) return { ok: false, status: 0, error: 'Requête refusée.' };
        params.append(k, String(v));
      }
      const path = '/rest/v1/' + q.table + (params.toString() ? '?' + params.toString() : '');
      const prefer = q.prefer ? String(q.prefer).replace(/[^A-Za-z0-9=,_\-]/g, '') : '';
      for (let attempt = 0; attempt < 2; attempt++) {
        let s = await getSession();
        if (!s) return { ok: false, status: 401, auth: true, error: 'Non connecté.' };
        if (s.expires_at - Math.floor(Date.now() / 1000) < 60) {
          const rf = await refresh();
          if (rf === false) return { ok: false, status: 401, auth: true, error: 'Session expirée : reconnectez-vous.' };
          s = await getSession();
          if (!s) return { ok: false, status: 401, auth: true, error: 'Session expirée : reconnectez-vous.' };
        }
        const r = await raw(method, path, { token: s.access_token, headers: prefer ? { prefer } : {}, body: q.body, timeout: q.timeout });
        if (r.offline) return { ok: false, status: 0, offline: true, error: OFFLINE };
        if (r.status === 401 && attempt === 0) {                       // jeton refusé : un seul renouvellement, puis on rejoue
          const rf = await refresh();
          if (rf === true) continue;
          if (rf === false) return { ok: false, status: 401, auth: true, error: 'Session expirée : reconnectez-vous.' };
        }
        if (!r.ok) {
          const code = r.data && r.data.code ? String(r.data.code) : '';
          return { ok: false, status: r.status, code, conflict: r.status === 409 || code === '23505', error: explain(r.status, r.data), auth: r.status === 401 };
        }
        return { ok: true, status: r.status, data: r.data };
      }
      return { ok: false, status: 401, auth: true, error: 'Session expirée : reconnectez-vous.' };
    }

    return { configured, status, signIn, signUp, recover, signOut, request };
  };
});
