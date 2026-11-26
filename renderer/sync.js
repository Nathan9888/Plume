/* Plume — synchronisation avec le compte en ligne : bibliothèque de documents, réglages et nom.
   L'interface ne manipule jamais de jeton : elle passe par native.cloud (processus principal dans l'application Windows,
   fonctions du navigateur sinon). Ce module ne connaît ni les onglets ni l'éditeur ; app.js lui branche ses crochets. */
(function () {
  'use strict';
  const P = window.P;
  const native = window.native;
  const LS = 'plume.sync.v1';
  const SKEW = 5000;                       // recouvrement du curseur de lecture, contre les validations tardives
  const MAX_BODY = 12 * 1024 * 1024;
  const PAGE = 500;
  /* Réglages propres à l'appareil : jamais envoyés, jamais appliqués depuis un autre appareil. */
  const LOCAL_ONLY = new Set(['uiZoom', 'aiOn', 'aiGeminiOk', 'syncProfile']);

  const listeners = new Set();
  const emit = (t) => listeners.forEach((fn) => { try { fn(t); } catch (_) { /* un abonné défaillant ne bloque pas les autres */ } });

  let docs = new Map();                    // id → métadonnées (sans le corps)
  let cursor = '';                         // plus grand updated_at déjà lu
  let owner = '';                          // compte auquel appartient le cache
  let profileStamp = '';                   // updated_at du dernier profil envoyé ou appliqué
  let applying = false;
  let inflight = 0;
  let ticking = null;
  let pushTimer = null;

  const Y = (P.sync = {
    account: { configured: false, signedIn: false, email: '', userId: '', kind: '' },
    status: 'idle',                        // idle | syncing | offline | error
    error: '',
    last: 0,                               // dernier échange réussi (ms)
    onRemote: null,                        // (lignes modifiées ailleurs) => void, branché par app.js
    onTick: null,                          // appelé avant chaque lecture périodique (enregistrement automatique)
    LOCAL_ONLY,
  });
  Y.on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  Y.can = () => !!(Y.account.configured && Y.account.signedIn);

  /* ---------- Cache local de la liste (affichée même hors ligne) ---------- */
  function loadCache() {
    docs = new Map(); cursor = ''; profileStamp = '';
    try {
      const o = JSON.parse(localStorage.getItem(LS) || 'null');
      if (o && o.owner && o.owner === owner) {
        docs = new Map((o.docs || []).map((d) => [d.id, d]));
        cursor = o.cursor || '';
        profileStamp = o.profileStamp || '';
      }
    } catch (_) { /* cache illisible : on repart de zéro */ }
  }
  function saveCache() {
    try { localStorage.setItem(LS, JSON.stringify({ owner, cursor, profileStamp, docs: Array.from(docs.values()) })); } catch (_) { /* stockage plein ou bloqué */ }
  }
  function clearCache() {
    docs = new Map(); cursor = ''; profileStamp = '';
    try { localStorage.removeItem(LS); } catch (_) { /* ignoré */ }
  }

  const setStatus = (s, err) => {
    const e = err || '';
    if (Y.status === s && Y.error === e) return;
    Y.status = s; Y.error = e;
    emit('status');
  };

  function lostSession(msg) {
    if (!Y.account.signedIn) return;
    Y.account = Object.assign({}, Y.account, { signedIn: false });
    Y.lostMessage = msg || 'Votre session a expiré. Reconnectez-vous pour reprendre la synchronisation.';
    emit('auth');
  }

  /** Une requête vers les tables de Plume, avec suivi de l'état (en cours, hors ligne, erreur, session perdue). */
  async function req(r) {
    inflight++;
    if (inflight === 1) setStatus('syncing');
    let res;
    try { res = await native.cloud.request(r); } catch (e) { res = { ok: false, status: 0, error: String((e && e.message) || e) }; }
    if (!res || typeof res !== 'object') res = { ok: false, status: 0, error: 'Réponse inattendue.' };
    inflight--;
    if (res.auth) lostSession(res.error);
    if (res.ok) { Y.last = Date.now(); if (!inflight) setStatus('idle'); }
    else if (res.offline) setStatus('offline', res.error);
    else if (!res.auth) setStatus('error', res.error);
    else if (!inflight) setStatus('idle');
    return res;
  }

  const kindName = () => ({ exe: 'Plume (Windows)', html: 'Plume.html', site: 'Plume (site)' }[Y.account.kind] || 'Plume');
  const back = (iso) => { const t = Date.parse(iso); return isNaN(t) ? iso : new Date(t - SKEW).toISOString(); };
  const metaOf = (r) => ({ id: r.id, title: r.title || 'Sans titre', preview: r.preview || '', rev: r.rev, updated_at: r.updated_at, created_at: r.created_at, device: r.device || '' });
  const COLS = 'id,title,preview,rev,deleted,device,created_at,updated_at';

  /* ---------- Documents ---------- */
  Y.docs = () => Array.from(docs.values()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  Y.doc = (id) => docs.get(id) || null;

  function merge(row) {
    const old = docs.get(row.id);
    if (row.deleted) { if (old) { docs.delete(row.id); return true; } return false; }
    if (old && old.rev >= row.rev) return false;
    docs.set(row.id, metaOf(row));
    return true;
  }

  async function pullDocs() {
    const changed = [];
    let from = cursor ? back(cursor) : '';
    for (let page = 0; page < 40; page++) {
      const q = { select: COLS, order: 'updated_at.asc', limit: String(PAGE) };
      if (from) q.updated_at = 'gt.' + from;
      const r = await req({ method: 'GET', table: 'plume_documents', query: q });
      if (!r.ok) return false;
      const rows = Array.isArray(r.data) ? r.data : [];
      for (const row of rows) {
        const old = docs.get(row.id);
        const wasKnown = !!old;
        if (merge(row)) changed.push(Object.assign({ wasKnown }, row));
        if (!cursor || String(row.updated_at) > cursor) cursor = String(row.updated_at);
      }
      if (rows.length < PAGE) break;
      from = String(rows[rows.length - 1].updated_at);
    }
    saveCache();
    if (changed.length) {
      emit('docs');
      if (Y.onRemote) { try { Y.onRemote(changed); } catch (_) { /* l'interface gère ses propres erreurs */ } }
    }
    return true;
  }

  /** Corps complet d'un document. */
  Y.fetchDoc = async (id) => {
    const r = await req({ method: 'GET', table: 'plume_documents', query: { select: 'id,title,body,rev,deleted,updated_at', id: 'eq.' + id } });
    if (!r.ok) return { error: r.error || 'Impossible de lire ce document en ligne.', offline: r.offline, auth: r.auth };
    const row = Array.isArray(r.data) ? r.data[0] : null;
    if (!row || row.deleted) { if (docs.delete(id)) { saveCache(); emit('docs'); } return { missing: true, error: 'Ce document n’existe plus en ligne.' }; }
    return { ok: true, row };
  };

  async function metaNow(id) {
    const r = await req({ method: 'GET', table: 'plume_documents', query: { select: COLS, id: 'eq.' + id } });
    if (!r.ok) return { error: r.error, offline: r.offline, auth: r.auth };
    const row = Array.isArray(r.data) ? r.data[0] : null;
    return { ok: true, row: row && !row.deleted ? row : null };
  }

  function afterWrite(id, rev, row, doc) {
    const old = docs.get(id) || {};
    docs.set(id, Object.assign({}, old, { id, title: doc.title || 'Sans titre', preview: doc.preview || '', rev, updated_at: row && row.updated_at ? row.updated_at : old.updated_at, created_at: (row && row.created_at) || old.created_at, device: kindName() }));
    if (row && row.updated_at && (!cursor || String(row.updated_at) > cursor)) cursor = String(row.updated_at);
    saveCache();
    emit('docs');
  }

  /**
   * Crée (rev = 0) ou met à jour un document, avec contrôle de révision.
   * Résultats : {ok, rev} | {conflict, remote} | {error, offline, auth, tooBig}
   */
  Y.put = async (doc) => {
    if (!Y.can()) return { error: 'Connectez-vous pour enregistrer en ligne.', auth: true };
    const size = doc.body.length;
    if (size > MAX_BODY) return { tooBig: true, error: 'Ce document est trop volumineux pour la synchronisation (' + (size / 1048576).toFixed(1).replace('.', ',') + ' Mo ; maximum 12 Mo). Réduisez le poids de ses images.' };
    const device = kindName();
    let rev = doc.rev || 0;
    if (!rev) {
      const r = await req({ method: 'POST', table: 'plume_documents', prefer: 'return=representation', query: { select: 'id,rev,updated_at,created_at' },
        body: { id: doc.id, title: doc.title, preview: doc.preview, body: doc.body, rev: 1, device } });
      if (r.ok && Array.isArray(r.data) && r.data[0]) { afterWrite(doc.id, 1, r.data[0], doc); return { ok: true, rev: 1 }; }
      if (!r.conflict) return { error: r.error || 'Échec de l’enregistrement en ligne.', offline: r.offline, auth: r.auth };
      // la ligne existe déjà (une réponse perdue lors d'un essai précédent) : on poursuit comme une mise à jour
      const m = await metaNow(doc.id);
      if (!m.ok) return { error: m.error, offline: m.offline, auth: m.auth };
      if (!m.row) return { conflict: true, remote: null };
      rev = m.row.rev;
    }
    const r = await req({ method: 'PATCH', table: 'plume_documents', prefer: 'return=representation', query: { id: 'eq.' + doc.id, rev: 'eq.' + rev, select: 'id,rev,updated_at' },
      body: { title: doc.title, preview: doc.preview, body: doc.body, rev: rev + 1, device, deleted: false } });
    if (!r.ok) return { error: r.error || 'Échec de l’enregistrement en ligne.', offline: r.offline, auth: r.auth };
    if (Array.isArray(r.data) && r.data.length === 1) { afterWrite(doc.id, rev + 1, r.data[0], doc); return { ok: true, rev: rev + 1 }; }
    // aucune ligne modifiée : un autre appareil a enregistré entre-temps (ou le document a été supprimé)
    const m = await metaNow(doc.id);
    if (!m.ok) return { error: m.error, offline: m.offline, auth: m.auth };
    return { conflict: true, remote: m.row };
  };

  /** Suppression : on garde une stèle (deleted = true) pour que les autres appareils la voient. */
  Y.remove = async (id) => {
    const old = docs.get(id);
    const r = await req({ method: 'PATCH', table: 'plume_documents', prefer: 'return=representation', query: { id: 'eq.' + id, select: 'id' },
      body: { deleted: true, body: '', preview: '', rev: (old ? old.rev : 0) + 1, device: kindName() } });
    if (!r.ok) return { error: r.error || 'Échec de la suppression.', offline: r.offline };
    if (docs.delete(id)) { saveCache(); emit('docs'); }
    return { ok: true };
  };

  /* ---------- Profil et réglages ---------- */
  function localProfile() {
    const settings = {};
    for (const d of P.settings.SCHEMA) {
      if (d.def === undefined || LOCAL_ONLY.has(d.key)) continue;
      settings[d.key] = P.settings.get(d.key);
    }
    return { author: (P.state && P.state.author) || '', settings };
  }

  function applyProfile(row) {
    applying = true;
    try {
      const s = row.settings && typeof row.settings === 'object' ? row.settings : {};
      for (const [k, v] of Object.entries(s)) if (!LOCAL_ONLY.has(k)) P.settings.set(k, v);       // set() refuse toute valeur invalide
      if (row.author && P.app && row.author !== P.state.author) P.app.setAuthor(String(row.author).slice(0, 60));
    } finally { applying = false; }
  }

  let pushPending = false;
  async function pushProfile() {
    pushPending = false;
    if (!Y.can() || !P.settings.get('syncProfile')) return;
    const p = localProfile();
    const r = await req({ method: 'POST', table: 'plume_profile', prefer: 'resolution=merge-duplicates,return=representation', query: { on_conflict: 'user_id', select: 'updated_at' },
      body: { author: p.author, settings: p.settings } });
    if (r.ok && Array.isArray(r.data) && r.data[0]) { profileStamp = String(r.data[0].updated_at); saveCache(); }
  }

  async function pullProfile() {
    if (!Y.can() || !P.settings.get('syncProfile')) return;
    const r = await req({ method: 'GET', table: 'plume_profile', query: { select: 'author,settings,updated_at' } });
    if (!r.ok) return;
    const row = Array.isArray(r.data) ? r.data[0] : null;
    if (!row) { await pushProfile(); return; }                // premier appareil du compte : on envoie les réglages d'ici
    if (String(row.updated_at) !== profileStamp) {
      if (pushPending) return;                                 // un réglage modifié ici n'est pas encore envoyé : il l'emporte
      applyProfile(row); profileStamp = String(row.updated_at); saveCache(); }
  }

  function schedulePush() {
    if (applying || !Y.can() || !P.settings.get('syncProfile')) return;
    clearTimeout(pushTimer);
    pushPending = true;
    pushTimer = setTimeout(pushProfile, 1500);
  }
  Y.profileChanged = schedulePush;
  if (P.settings && P.settings.onChange) P.settings.onChange((k) => { if (k !== '*' && LOCAL_ONLY.has(k)) return; schedulePush(); });

  /* ---------- Cycle de synchronisation ---------- */
  async function tick() {
    if (!Y.can()) return;
    if (ticking) return ticking;
    ticking = (async () => {
      try {
        if (Y.onTick) { try { await Y.onTick(); } catch (_) { /* ignoré */ } }
        if (!Y.can()) return;
        await pullDocs();
        await pullProfile();
      } finally { ticking = null; }
    })();
    return ticking;
  }
  Y.syncNow = () => tick();
  setInterval(() => { if (!document.hidden) tick(); }, 20000);
  window.addEventListener('focus', () => tick());
  window.addEventListener('online', () => tick());

  function begin() {
    owner = Y.account.userId || '';
    loadCache();
    emit('docs');
    tick();
  }

  /* ---------- Compte ---------- */
  Y.init = async () => {
    try { Y.account = Object.assign({ configured: false, signedIn: false, email: '', userId: '', kind: '' }, await native.cloud.status()); }
    catch (_) { Y.account = { configured: false, signedIn: false, email: '', userId: '', kind: '' }; }
    if (Y.account.configured && Y.account.signedIn) begin();
    return Y.account;
  };

  async function signedIn(res) {
    Y.account = Object.assign({ configured: true, kind: Y.account.kind }, res.status);
    Y.lostMessage = '';
    setStatus('idle');
    begin();
    emit('auth');
  }
  Y.signIn = async (email, password) => {
    const r = await native.cloud.signIn(email, password);
    if (r && r.ok) await signedIn(r);
    return r || { ok: false, error: 'Réponse inattendue.' };
  };
  Y.signUp = async (email, password) => {
    const r = await native.cloud.signUp(email, password);
    if (r && r.ok && r.status) await signedIn(r);
    return r || { ok: false, error: 'Réponse inattendue.' };
  };
  Y.recover = (email) => native.cloud.recover(email);
  Y.signOut = async () => {
    clearTimeout(pushTimer);
    if (pushPending && Y.can()) { try { await Promise.race([pushProfile(), new Promise((r) => setTimeout(r, 4000))]); } catch (_) { /* tant pis : le réglage reste sur cet appareil */ } }
    try { await native.cloud.signOut(); } catch (_) { /* la session locale est de toute façon abandonnée */ }
    clearCache();
    Y.account = Object.assign({}, Y.account, { signedIn: false, email: '', userId: '' });
    Y.lostMessage = '';
    setStatus('idle');
    emit('docs');
    emit('auth');
  };
})();
