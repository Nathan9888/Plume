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
  let myShares = new Map();                // doc_id → {role, owner_id} : documents que d'autres ont partagés avec moi
  const people = new Map();                // user_id → {id, name, color} : noms de l'annuaire déjà connus
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
    docs = new Map(); myShares = new Map(); cursor = ''; profileStamp = '';
    try {
      const o = JSON.parse(localStorage.getItem(LS) || 'null');
      if (o && o.owner && o.owner === owner) {
        docs = new Map((o.docs || []).map((d) => [d.id, d]));
        myShares = new Map((o.shares || []).map((x) => [x.doc_id, { role: x.role, owner_id: x.owner_id }]));
        (o.people || []).forEach((x) => people.set(x.id, x));
        cursor = o.cursor || '';
        profileStamp = o.profileStamp || '';
      }
    } catch (_) { /* cache illisible : on repart de zéro */ }
  }
  function saveCache() {
    try { localStorage.setItem(LS, JSON.stringify({ owner, cursor, profileStamp, docs: Array.from(docs.values()), shares: Array.from(myShares, ([doc_id, v]) => ({ doc_id, role: v.role, owner_id: v.owner_id })), people: Array.from(people.values()) })); } catch (_) { /* stockage plein ou bloqué */ }
  }
  function clearCache() {
    docs = new Map(); myShares = new Map(); people.clear(); registered = ''; Y.sharedName = ''; cursor = ''; profileStamp = '';
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
  async function req(r, quiet) {
    if (quiet) {                                  // présence et curseurs : un échange toutes les 2 s ne doit pas animer l'état de synchronisation
      let q;
      try { q = await native.cloud.request(r); } catch (e) { q = { ok: false, status: 0, error: String((e && e.message) || e) }; }
      if (!q || typeof q !== 'object') q = { ok: false, status: 0, error: 'Réponse inattendue.' };
      if (q.auth) lostSession(q.error);
      return q;
    }
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
  const metaOf = (r) => ({ id: r.id, user_id: r.user_id || '', title: r.title || 'Sans titre', preview: r.preview || '', rev: r.rev, updated_at: r.updated_at, created_at: r.created_at, device: r.device || '' });
  const COLS = 'id,user_id,title,preview,rev,deleted,device,created_at,updated_at';

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
    const r = await req({ method: 'GET', table: 'plume_documents', query: { select: 'id,user_id,title,body,rev,deleted,updated_at', id: 'eq.' + id } });
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
    docs.set(id, Object.assign({}, old, { id, user_id: old.user_id || Y.account.userId, title: doc.title || 'Sans titre', preview: doc.preview || '', rev, updated_at: row && row.updated_at ? row.updated_at : old.updated_at, created_at: (row && row.created_at) || old.created_at, device: kindName() }));
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

  /* ---------- Partage : annuaire des noms, rôles, personnes ---------- */
  let registered = '';
  const uniq = (a) => Array.from(new Set(a.filter(Boolean)));
  const inList = (ids) => 'in.(' + ids.join(',') + ')';
  Y.isMine = (meta) => !meta || !meta.user_id || meta.user_id === Y.account.userId;
  Y.sharedDocs = () => Y.docs().filter((d) => !Y.isMine(d));
  /** Mon rôle sur un document : 'owner' | 'edit' | 'suggest' | 'view' | null (inconnu). */
  Y.roleOf = (id) => {
    const d = docs.get(id);
    if (!d) return null;
    if (Y.isMine(d)) return 'owner';
    const s = myShares.get(id);
    return s ? s.role : 'view';
  };
  Y.person = (id) => people.get(id) || null;
  Y.sharedName = '';

  async function loadPeople(ids) {
    const need = uniq(ids).filter((id) => !people.has(id));
    if (!need.length) return;
    const r = await req({ method: 'GET', table: 'plume_directory', query: { select: 'user_id,name,color', user_id: inList(need) } }, true);
    if (!r.ok || !Array.isArray(r.data)) return;
    for (const x of r.data) people.set(x.user_id, { id: x.user_id, name: x.name, color: x.color });
    saveCache();
  }
  Y.loadPeople = loadPeople;

  /** Publie mon nom dans l'annuaire pour qu'on puisse partager avec moi. Si le nom est pris, un numéro est ajouté. */
  async function registerName() {
    if (!Y.can()) return;
    const base = String((P.state && P.state.author) || '').trim().slice(0, 60);
    if (!base || (registered === base && Y.sharedName)) return;
    let name = base;
    for (let n = 1; n <= 30; n++) {
      const color = P.avatarHue ? P.avatarHue(name) : '#4f8cff';
      const r = await req({ method: 'POST', table: 'plume_directory', prefer: 'resolution=merge-duplicates,return=representation', query: { on_conflict: 'user_id', select: 'user_id,name,color' }, body: { name, color } }, true);
      if (r.ok) {
        registered = base; Y.sharedName = name;
        if (Y.account.userId) people.set(Y.account.userId, { id: Y.account.userId, name, color });
        emit('people');
        return;
      }
      if (!r.conflict) return;
      name = base + ' ' + (n + 1);
    }
  }
  Y.registerName = registerName;

  /** Les documents que d'autres ont partagés avec moi : nouveaux, changement de rôle, accès retiré. */
  async function pullShares() {
    if (!Y.can()) return;
    const r = await req({ method: 'GET', table: 'plume_shares', query: { select: 'doc_id,owner_id,role', user_id: 'eq.' + Y.account.userId } }, true);
    if (!r.ok || !Array.isArray(r.data)) return;
    const next = new Map(r.data.map((x) => [x.doc_id, { role: x.role, owner_id: x.owner_id }]));
    const changes = [];
    for (const [id, v] of next) { const old = myShares.get(id); if (!old) changes.push({ id, role: v.role, kind: 'new' }); else if (old.role !== v.role) changes.push({ id, role: v.role, kind: 'role', before: old.role }); }
    const lost = [];
    for (const [id, d] of docs) if (!Y.isMine(d) && !next.has(id)) lost.push({ id, title: d.title });
    myShares = next;
    const missing = Array.from(next.keys()).filter((id) => !docs.has(id));
    if (missing.length) {
      const m = await req({ method: 'GET', table: 'plume_documents', query: { select: COLS, id: inList(missing) } }, true);
      if (m.ok && Array.isArray(m.data)) for (const row of m.data) { if (!row.deleted) docs.set(row.id, metaOf(row)); }
    }
    for (const x of lost) docs.delete(x.id);
    await loadPeople(Array.from(next.values()).map((v) => v.owner_id));
    if (changes.length || lost.length || missing.length) {
      saveCache();
      emit('docs');
      emit('shares');
      if (Y.onShares) { try { Y.onShares({ changes, lost }); } catch (_) { /* l'interface gère ses erreurs */ } }
    }
  }

  const clean = (q) => String(q || '').trim().toLowerCase().replace(/[*,()%"\\]/g, '');
  /** Cherche des personnes par leur nom (au moins 2 lettres). */
  Y.search = async (q) => {
    const k = clean(q);
    if (k.length < 2) return [];
    const r = await req({ method: 'GET', table: 'plume_directory', query: { select: 'user_id,name,color', name_key: 'like.' + k + '*', order: 'name_key.asc', limit: '8' } }, true);
    if (!r.ok || !Array.isArray(r.data)) return null;
    const out = r.data.filter((x) => x.user_id !== Y.account.userId).map((x) => ({ id: x.user_id, name: x.name, color: x.color }));
    out.forEach((x) => people.set(x.id, x));
    return out;
  };
  /** Personnes avec qui ce document est partagé (propriétaire seulement) : [{id, name, color, role}] ou null. */
  Y.listShares = async (docId) => {
    const r = await req({ method: 'GET', table: 'plume_shares', query: { select: 'user_id,role', doc_id: 'eq.' + docId, order: 'created_at.asc' } }, true);
    if (!r.ok || !Array.isArray(r.data)) return null;
    await loadPeople(r.data.map((x) => x.user_id));
    return r.data.map((x) => { const p = people.get(x.user_id) || {}; return { id: x.user_id, name: p.name || 'Utilisateur', color: p.color || '', role: x.role }; });
  };
  Y.addShare = async (docId, userId, role) => {
    const r = await req({ method: 'POST', table: 'plume_shares', prefer: 'resolution=merge-duplicates,return=representation', query: { on_conflict: 'doc_id,user_id', select: 'user_id' }, body: { doc_id: docId, user_id: userId, role } });
    return r.ok ? { ok: true } : { error: r.error || 'Échec du partage.', offline: r.offline };
  };
  Y.setRole = async (docId, userId, role) => {
    const r = await req({ method: 'PATCH', table: 'plume_shares', prefer: 'return=representation', query: { doc_id: 'eq.' + docId, user_id: 'eq.' + userId, select: 'user_id' }, body: { role } });
    return r.ok && Array.isArray(r.data) && r.data.length ? { ok: true } : { error: r.error || 'Échec du changement de rôle.', offline: r.offline };
  };
  Y.unshare = async (docId, userId) => {
    const r = await req({ method: 'DELETE', table: 'plume_shares', query: { doc_id: 'eq.' + docId, user_id: 'eq.' + userId } });
    return r.ok ? { ok: true } : { error: r.error || 'Échec du retrait.', offline: r.offline };
  };
  /** Quitter un document partagé avec moi. */
  Y.leave = async (docId) => {
    const r = await Y.unshare(docId, Y.account.userId);
    if (r.ok) { docs.delete(docId); myShares.delete(docId); saveCache(); emit('docs'); emit('shares'); }
    return r;
  };

  /* ---------- Présence (curseurs en direct) : échanges discrets, sans animer l'état de synchronisation ---------- */
  Y.presencePut = async (docId, o) => {
    const r = await req({ method: 'POST', table: 'plume_presence', prefer: 'resolution=merge-duplicates,return=representation', query: { on_conflict: 'doc_id,user_id', select: 'updated_at' },
      body: { doc_id: docId, name: o.name, color: o.color, role: o.role, cursor: o.cursor || null } }, true);
    return r.ok && Array.isArray(r.data) && r.data[0] ? { ok: true, now: String(r.data[0].updated_at) } : { error: r.error, offline: r.offline };
  };
  Y.presenceList = async (docId) => {
    const r = await req({ method: 'GET', table: 'plume_presence', query: { select: 'user_id,name,color,role,cursor,updated_at', doc_id: 'eq.' + docId } }, true);
    return r.ok && Array.isArray(r.data) ? r.data : null;
  };
  Y.presenceLeave = (docId) => req({ method: 'DELETE', table: 'plume_presence', query: { doc_id: 'eq.' + docId, user_id: 'eq.' + Y.account.userId } }, true).catch(() => {});
  /** Révision et suppression d'un document, sans corps (pour savoir s'il a changé ailleurs). */
  Y.docRev = async (id) => {
    const r = await req({ method: 'GET', table: 'plume_documents', query: { select: 'id,rev,deleted,updated_at', id: 'eq.' + id } }, true);
    if (!r.ok || !Array.isArray(r.data)) return null;
    return r.data[0] || { id, deleted: true, rev: 0 };
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
        await pullShares();
        await registerName();
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
