/* Plume — collaboration : fusion des modifications simultanées, curseurs des autres personnes, avatars des personnes présentes.
 *
 * Fusion : le document est découpé en blocs (les enfants de la page : paragraphes, titres, listes, tableaux…). Quand deux personnes
 * ont modifié le document en même temps, on compare chaque version à la dernière version commune (fusion à trois, comme git) :
 * les blocs modifiés d'un seul côté sont repris tels quels ; si le même bloc a été modifié des deux côtés, les deux versions sont
 * conservées l'une sous l'autre (rien n'est jamais perdu en silence).
 *
 * Présence : sans connexion permanente, chaque personne écrit toutes les ~2 s sa position (bloc + décalage de caractère) dans une
 * ligne éphémère ; les autres la lisent. Les positions sont donc rafraîchies toutes les 2 s environ, pas à la milliseconde. */
(function () {
  'use strict';
  const { h } = P;
  const ed = P.editor;
  const Y = P.sync;
  const ROLE = { owner: 'Propriétaire', edit: 'Édition', suggest: 'Suggestion', view: 'Lecture' };

  /* ---------------------------------------------------------------- comparaison et fusion */
  /**
   * Plus longue sous-suite commune de deux tableaux (algorithme de Myers : le temps dépend du nombre de différences, pas de la taille,
   * donc un document de milliers de paragraphes avec quelques modifications se compare instantanément).
   * Retourne une liste de paires [i, j] croissantes, ou null si les deux listes sont trop différentes pour qu'une fusion ait un sens.
   */
  function lcs(a, b, maxD) {
    const limit = maxD || 1500;
    const n = a.length, m = b.length;
    const out = [];
    let p = 0;
    while (p < n && p < m && a[p] === b[p]) { out.push([p, p]); p++; }
    let sa = n, sb = m;
    const tail = [];
    while (sa > p && sb > p && a[sa - 1] === b[sb - 1]) { sa--; sb--; tail.push([sa, sb]); }
    const N = sa - p, M = sb - p;
    if (N > 0 && M > 0) {
      const max = Math.min(N + M, limit);
      const off = max + 1;
      const V = new Int32Array(2 * max + 3);
      const trace = [];
      let found = -1;
      for (let d = 0; d <= max && found < 0; d++) {
        trace.push(V.slice(off - d - 1, off + d + 2));              // V au début de ce tour, pour k de -d-1 à d+1
        for (let k = -d; k <= d; k += 2) {
          let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1;
          let y = x - k;
          while (x < N && y < M && a[p + x] === b[p + y]) { x++; y++; }
          V[off + k] = x;
          if (x >= N && y >= M) { found = d; break; }
        }
      }
      if (found < 0) return null;
      const mid = [];
      let x = N, y = M;
      for (let d = found; d > 0; d--) {
        const snap = trace[d];
        const at = (kk) => snap[kk + d + 1];
        const k = x - y;
        const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
        const pk = down ? k + 1 : k - 1;
        const px = at(pk), py = px - pk;
        const xs = down ? px : px + 1, ys = xs - k;
        while (x > xs && y > ys) { x--; y--; mid.push([p + x, p + y]); }
        x = px; y = py;
      }
      while (x > 0 && y > 0) { x--; y--; mid.push([p + x, p + y]); }
      for (let k = mid.length - 1; k >= 0; k--) out.push(mid[k]);
    }
    for (let k = tail.length - 1; k >= 0; k--) out.push(tail[k]);
    return out;
  }

  const sameList = (x, y) => x.length === y.length && x.every((v, k) => v === y[k]);

  /** Les « blocs de différences » d'une version par rapport à la base : [{bs, be, xs, xe}] = base[bs, be) remplacé par version[xs, xe). */
  function hunks(n, m, pairs) {
    const out = [];
    let pi = -1, pj = -1;
    for (const [i, j] of pairs.concat([[n, m]])) {
      if (i > pi + 1 || j > pj + 1) out.push({ bs: pi + 1, be: i, xs: pj + 1, xe: j });
      pi = i; pj = j;
    }
    return out;
  }

  /**
   * Fusion à trois de listes de blocs : B = base commune, L = version d'ici, R = version distante.
   * Deux modifications se combinent si elles touchent des blocs différents (même voisins) ; si elles touchent le même bloc,
   * les deux versions sont conservées l'une sous l'autre et le conflit est compté. Retourne {blocks: null} si les versions sont
   * trop éloignées pour qu'une fusion ait un sens.
   */
  function merge3(B, L, R) {
    const lp = lcs(B, L), rp = lcs(B, R);
    if (!lp || !rp) return { blocks: null, conflicts: 0 };
    const lh = hunks(B.length, L.length, lp), rh = hunks(B.length, R.length, rp);
    const rep = (X, h) => X.slice(h.xs, h.xe);
    const clash = (x, y) => {
      const xi = x.bs === x.be, yi = y.bs === y.be;
      if (xi && yi) return false;                                   // deux insertions au même endroit : on garde les deux
      if (xi) return y.bs < x.bs && x.bs < y.be;
      if (yi) return x.bs < y.bs && y.bs < x.be;
      return x.bs < y.be && y.bs < x.be;
    };
    const inGroup = (h, gs, ge) => (h.bs === h.be ? gs < h.bs && h.bs < ge : h.bs < ge && gs < h.be);
    const region = (X, list, gs, ge) => {
      const o = [];
      let q = gs;
      for (const h of list) { o.push(...B.slice(q, h.bs), ...rep(X, h)); q = h.be; }
      o.push(...B.slice(q, ge));
      return o;
    };
    const out = [];
    let conflicts = 0, pos = 0, i = 0, j = 0;
    while (i < lh.length || j < rh.length) {
      const a = lh[i], b = rh[j];
      if (a && b && clash(a, b)) {
        let gs = Math.min(a.bs, b.bs), ge = Math.max(a.be, b.be);
        const gl = [], gr = [];
        for (let more = true; more;) {
          more = false;
          while (i < lh.length && (gl.length === 0 && lh[i] === a ? true : inGroup(lh[i], gs, ge))) { gl.push(lh[i]); gs = Math.min(gs, lh[i].bs); ge = Math.max(ge, lh[i].be); i++; more = true; }
          while (j < rh.length && (gr.length === 0 && rh[j] === b ? true : inGroup(rh[j], gs, ge))) { gr.push(rh[j]); gs = Math.min(gs, rh[j].bs); ge = Math.max(ge, rh[j].be); j++; more = true; }
        }
        out.push(...B.slice(pos, gs));
        const lr = region(L, gl, gs, ge), rr = region(R, gr, gs, ge);
        if (sameList(lr, rr)) out.push(...lr);
        else { out.push(...lr, ...rr); conflicts++; }
        pos = ge;
        continue;
      }
      let h, X;
      if (a && b && a.bs === b.bs && a.be === b.be && sameList(rep(L, a), rep(R, b))) { h = a; X = L; i++; j++; }      // exactement la même modification des deux côtés
      else if (!b || (a && (a.bs < b.bs || (a.bs === b.bs && (a.bs === a.be || b.bs !== b.be))))) { h = a; X = L; i++; }
      else { h = b; X = R; j++; }
      out.push(...B.slice(pos, h.bs), ...rep(X, h));
      pos = h.be;
    }
    out.push(...B.slice(pos));
    return { blocks: out, conflicts };
  }

  /** HTML d'un document → liste de blocs (un par enfant de la page). */
  function blocksOf(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    const out = [];
    d.childNodes.forEach((n) => {
      if (n.nodeType === 1) out.push(n.outerHTML);
      else if (n.nodeType === 3 && n.nodeValue) out.push(P.esc(n.nodeValue));
    });
    return out;
  }

  const J = (x) => JSON.stringify(x === undefined ? null : x);
  const scalar = (b, l, r) => (J(l) === J(b) ? r : l);

  function mergeById(b, l, r, key) {
    const idx = (a) => new Map((a || []).map((x) => [x[key], x]));
    const bm = idx(b), lm = idx(l), rm = idx(r);
    const ids = [];
    const seen = new Set();
    [l || [], r || []].forEach((list) => list.forEach((x) => { if (!seen.has(x[key])) { seen.add(x[key]); ids.push(x[key]); } }));
    const out = [];
    for (const id of ids) {
      const bx = bm.get(id), lx = lm.get(id), rx = rm.get(id);
      if (lx && rx) out.push(J(lx) === J(bx) ? rx : lx);
      else if (lx) { if (!(bx && J(lx) === J(bx))) out.push(lx); }        // supprimé ailleurs sans que je l'aie touché : il disparaît
      else if (rx) { if (!(bx && J(rx) === J(bx))) out.push(rx); }        // supprimé ici sans que l'autre l'ait touché : il disparaît
    }
    return out;
  }

  function mergeMap(b, l, r) {
    b = b || {}; l = l || {}; r = r || {};
    const out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
      const v = scalar(b[k], l[k], r[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  /** Ce qu'on garde de la dernière version synchronisée pour pouvoir fusionner plus tard. */
  function baseOf(data) {
    return JSON.parse(JSON.stringify({
      html: String(data.html || ''), title: data.title || 'Sans titre', comments: data.comments || [], variables: data.variables || {},
      styles: data.styles || {}, pageless: !!data.pageless, versions: (data.versions || []).map((v) => ({ id: v.id })),
    }));
  }

  /** Fusionne trois versions complètes d'un document ({html, title, comments, variables, styles, pageless, versions, assets}). */
  function mergeData(base, local, remote) {
    const m = merge3(blocksOf(base.html), blocksOf(local.html), blocksOf(remote.html));
    if (!m.blocks) return null;
    const out = Object.assign({}, local);
    out.html = m.blocks.join('');
    out.title = scalar(base.title, local.title, remote.title);
    out.pageless = scalar(base.pageless, local.pageless, remote.pageless);
    out.styles = scalar(base.styles, local.styles, remote.styles);
    out.comments = mergeById(base.comments, local.comments, remote.comments, 'id');
    out.variables = mergeMap(base.variables, local.variables, remote.variables);
    out.versions = mergeById(base.versions, local.versions, remote.versions, 'id').slice(-60);
    out.assets = Object.assign({}, remote.assets || {}, local.assets || {});
    return { data: out, conflicts: m.conflicts };
  }

  /* ---------------------------------------------------------------- position dans le texte (curseurs, sélection) */
  const kids = () => Array.from(ed.childNodes);
  function topIndex(node) {
    let n = node;
    while (n && n.parentNode !== ed) n = n.parentNode;
    return n ? kids().indexOf(n) : -1;
  }
  function textOffset(block, node, off) {
    try { const r = document.createRange(); r.selectNodeContents(block); r.setEnd(node, off); return r.toString().length; } catch (_) { return 0; }
  }
  /** [nœud, décalage] pour « n-ième caractère du bloc ». */
  function pointAt(block, off) {
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = off, last = null, n;
    while ((n = w.nextNode())) {
      last = n;
      if (left <= n.nodeValue.length) return [n, left];
      left -= n.nodeValue.length;
    }
    return last ? [last, last.nodeValue.length] : [block, 0];
  }
  const readPos = (node, off) => { const i = topIndex(node); return i < 0 ? null : [i, textOffset(kids()[i], node, off)]; };

  /** Sélection actuelle : { a: [bloc, décalage], f: [bloc, décalage] } ou null. */
  function readSelection() {
    const s = window.getSelection();
    if (!s || !s.rangeCount || !s.anchorNode || !ed.contains(s.anchorNode) || !s.focusNode || !ed.contains(s.focusNode)) return null;
    const a = readPos(s.anchorNode, s.anchorOffset), f = readPos(s.focusNode, s.focusOffset);
    return a && f ? { a, f } : null;
  }
  function rangeFor(c) {
    const ks = kids();
    if (!c || !Array.isArray(c.a) || !Array.isArray(c.f)) return null;
    const ba = ks[c.a[0]], bf = ks[c.f[0]];
    if (!ba || !bf) return null;
    const A = ba.nodeType === 3 ? [ba, Math.min(c.a[1], ba.nodeValue.length)] : pointAt(ba, Number(c.a[1]) || 0);
    const F = bf.nodeType === 3 ? [bf, Math.min(c.f[1], bf.nodeValue.length)] : pointAt(bf, Number(c.f[1]) || 0);
    try {
      const r = document.createRange();
      r.setStart(A[0], A[1]); r.setEnd(A[0], A[1]);
      const e = document.createRange();
      e.setStart(F[0], F[1]); e.setEnd(F[0], F[1]);
      const flip = r.compareBoundaryPoints(Range.START_TO_START, e) > 0;
      const out = document.createRange();
      const s0 = flip ? e : r, s1 = flip ? r : e;
      out.setStart(s0.startContainer, s0.startOffset);
      out.setEnd(s1.startContainer, s1.startOffset);
      return { range: out, focus: e };
    } catch (_) { return null; }
  }

  /* ---------------------------------------------------------------- application d'une version distante dans l'éditeur */
  const IMG_OK = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;
  function addAssets(assets) {
    if (!assets || typeof assets !== 'object') return;
    for (const [k, v] of Object.entries(assets)) if (/^[a-z0-9]+$/.test(k) && typeof v === 'string' && IMG_OK.test(v) && !P.state.assets[k]) P.state.assets[k] = v;
  }

  /**
   * Met l'éditeur à jour avec `html` (forme « empaquetée » des documents) en ne touchant que les blocs qui changent :
   * le curseur, la sélection et le défilement de la personne qui écrit ne bougent pas.
   */
  function patchEditor(html, assets) {
    addAssets(assets);
    const holder = document.createElement('div');
    holder.innerHTML = ed.innerHTML;
    holder.querySelectorAll('.active').forEach((n) => n.classList.remove('active'));
    if (P.pages) P.pages.strip(holder);
    const live = kids(), clean = Array.from(holder.childNodes);
    const tmp = {};
    const text = (n) => (n.nodeType === 1 ? n.outerHTML : n.nodeType === 3 ? P.esc(n.nodeValue) : '');
    const make = (blockHtml) => {
      const d = document.createElement('div');
      d.innerHTML = P.sanitize(P.unpack(blockHtml, P.state.assets));
      return Array.from(d.childNodes);
    };
    const next = blocksOf(html);
    const sel = readSelection();
    const hadFocus = ed.contains(document.activeElement) || document.activeElement === ed;
    let changed = false;

    if (live.length !== clean.length) {            // marques inattendues dans la page : on remplace tout, sans fioritures
      ed.innerHTML = P.sanitize(P.unpack(html, P.state.assets)) || '<p><br></p>';
      return true;
    }
    const cur = clean.map((n) => P.pack(text(n), tmp));
    const pairs = lcs(cur, next, 4000) || [];                 // trop différent : tout est remplacé d'un bloc
    const idxMap = new Map();                      // ancien indice de bloc → nouvel indice
    let pi = 0, pj = 0;
    const steps = pairs.concat([[cur.length, next.length]]);
    for (const [i, j] of steps) {
      if (i > pi || j > pj) {                      // un morceau remplacé : anciens blocs [pi, i) → nouveaux blocs [pj, j)
        const anchor = i < live.length ? live[i] : null;
        const fresh = [];
        for (let k = pj; k < j; k++) fresh.push(...make(next[k]));
        for (const n of fresh) ed.insertBefore(n, anchor);
        for (let k = pi; k < i; k++) live[k].remove();
        for (let k = pi; k < i; k++) idxMap.set(k, Math.max(0, Math.min(pj + (k - pi), j - 1, next.length - 1)));
        changed = true;
      }
      if (i < cur.length) idxMap.set(i, j);
      pi = i + 1; pj = j + 1;
    }
    if (!ed.childNodes.length) { ed.innerHTML = '<p><br></p>'; changed = true; }
    if (changed && sel && hadFocus) {
      const s = window.getSelection();
      const outside = !s.rangeCount || !s.anchorNode || !ed.contains(s.anchorNode) || s.anchorNode === ed;
      if (outside) {                               // le bloc où l'on écrivait a été remplacé : on remet le curseur au même endroit du bloc correspondant
        const ks = kids();
        const put = (p) => { const b = ks[Math.min(idxMap.has(p[0]) ? idxMap.get(p[0]) : p[0], ks.length - 1)]; return b ? pointAt(b, p[1]) : null; };
        const A = put(sel.a), F = put(sel.f);
        if (A && F) { try { s.setBaseAndExtent(A[0], A[1], F[0], F[1]); } catch (_) { /* position devenue invalide : le curseur reste où il est */ } }
      }
    }
    return changed;
  }

  /* ---------------------------------------------------------------- curseurs et présence */
  let others = [];                 // [{id, name, color, role, cursor}]
  let layer = null;
  let localCursor = null, sentCursor = '';
  let lastDoc = '';
  let timer = null, busy = false;
  const known = new Map();         // doc → {n: nombre de personnes avec qui il est partagé, at}

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    const sc = P.$('#scroller');
    layer = h('div', { id: 'remote-layer', 'aria-hidden': 'true' });
    if (sc) sc.append(layer);
    return layer;
  }

  function renderRemote() {
    const L = ensureLayer();
    L.replaceChildren();
    const sc = P.$('#scroller');
    if (!sc || document.body.dataset.view !== 'doc') return;
    const sr = sc.getBoundingClientRect();
    for (const p of others) {
      const r = p.cursor && rangeFor(p.cursor);
      if (!r) continue;
      const col = P.safeColor(p.color, p.name);
      const at = (rect) => ({ x: rect.left - sr.left + sc.scrollLeft, y: rect.top - sr.top + sc.scrollTop });
      if (!r.range.collapsed) {
        for (const q of Array.from(r.range.getClientRects())) {
          if (q.width < 1 || q.height < 1) continue;
          const o = at(q);
          L.append(h('div', { class: 'rs', style: `left:${o.x}px;top:${o.y}px;width:${q.width}px;height:${q.height}px;--c:${col}` }));
        }
      }
      let cr = Array.from(r.focus.getClientRects()).pop();
      if (!cr || (!cr.width && !cr.height)) {
        const node = r.focus.startContainer;
        const el = node.nodeType === 1 ? node : node.parentElement;
        const br = el && el.getBoundingClientRect();
        if (br) cr = { left: br.left, top: br.top, height: Math.min(br.height, 22) || 18 };
      }
      if (!cr) continue;
      const o = at(cr);
      L.append(h('div', { class: 'rc', style: `left:${o.x}px;top:${o.y}px;height:${Math.round(cr.height || 18)}px;--c:${col}`, title: p.name + ' · ' + (ROLE[p.role] || '') },
        h('span', { class: 'rc-flag', text: p.name })));
    }
  }

  function renderStack() {
    const box = P.$('#presence');
    if (!box) return;
    box.replaceChildren();
    const list = others.slice(0, 4);
    list.forEach((p) => box.append(h('span', { class: 'pres-av', title: p.name + ' · ' + (ROLE[p.role] || ''), style: 'background:' + P.safeColor(p.color, p.name), text: P.initials(p.name) })));
    if (others.length > list.length) box.append(h('span', { class: 'pres-av more', title: others.slice(4).map((p) => p.name).join(', '), text: '+' + (others.length - list.length) }));
    box.hidden = !others.length;
  }

  function setOthers(list) {
    const sig = J(list.map((p) => [p.id, p.name, p.role, p.cursor]));
    if (sig === J(others.map((p) => [p.id, p.name, p.role, p.cursor]))) return false;
    others = list;
    renderStack();
    renderRemote();
    return true;
  }

  async function leave(docId) {
    if (!docId) return;
    try { await Y.presenceLeave(docId); } catch (_) { /* la ligne expire d'elle-même */ }
  }

  let selTimer = 0;
  function selectionChanged() {
    // Seulement quand le document est partagé, et au plus une lecture par 150 ms : parcourir les blocs à chaque mouvement du curseur ralentit les longs documents.
    if (selTimer || !(P.app && P.app.collabInfo && P.app.collabInfo())) return;
    selTimer = setTimeout(() => { selTimer = 0; const c = readSelection(); if (c) localCursor = c; }, 150);
  }
  document.addEventListener('selectionchange', selectionChanged);

  /** Une passe : écrit ma position, lit celle des autres, récupère les modifications du document. */
  async function pass() {
    const info = P.app && P.app.collabInfo ? P.app.collabInfo() : null;
    if (!info || !Y || !Y.can()) {
      if (lastDoc) { const d = lastDoc; lastDoc = ''; leave(d); }
      if (others.length) setOthers([]);
      return 6000;
    }
    if (lastDoc && lastDoc !== info.docId) { const d = lastDoc; lastDoc = ''; leave(d); setOthers([]); }
    const k = known.get(info.docId);
    if (info.role === 'owner' && !(k && k.n > 0 && Date.now() - k.at < 30000)) {
      // propriétaire : on ne diffuse rien tant que le document n'est partagé avec personne (vérifié toutes les 30 s)
      if (!k || Date.now() - k.at >= 30000) {
        const l = await Y.listShares(info.docId);
        if (l) known.set(info.docId, { n: l.length, at: Date.now() });
      }
      const k2 = known.get(info.docId);
      if (!k2 || !k2.n) { if (others.length) setOthers([]); if (lastDoc) { const d = lastDoc; lastDoc = ''; leave(d); } return 6000; }
    }
    const switched = lastDoc !== info.docId;
    lastDoc = info.docId;
    const name = Y.sharedName || P.state.author || 'Moi';
    if (switched) localCursor = null;
    const cur = localCursor;
    const put = await Y.presencePut(info.docId, { name, color: P.avatarHue(name), role: info.mode === 'view' ? 'view' : info.role === 'owner' ? 'edit' : info.role, cursor: cur });
    sentCursor = J(cur);
    if (!put.ok) return 5000;
    const rows = await Y.presenceList(info.docId);
    if (rows) {
      const now = Date.parse(put.now) || Date.now();
      const me = Y.account.userId;
      const fresh = rows.filter((x) => x.user_id !== me && now - (Date.parse(x.updated_at) || 0) < 15000)
        .map((x) => ({ id: x.user_id, name: String(x.name || 'Quelqu’un').slice(0, 60), color: x.color, role: x.role, cursor: x.cursor }));
      setOthers(fresh);
    }
    if (P.app.liveRefresh) { try { await P.app.liveRefresh(); } catch (_) { /* la prochaine passe réessaie */ } }
    return others.length || document.hasFocus() ? 2000 : 6000;
  }

  async function loop() {
    if (busy) return;
    busy = true;
    let wait = 4000;
    try { wait = await pass(); } catch (_) { wait = 5000; } finally { busy = false; }
    if (document.visibilityState === 'hidden') wait = Math.max(wait, 8000);
    clearTimeout(timer);
    timer = setTimeout(loop, wait);
  }
  /** Relance une passe tout de suite (après un partage, un changement d'onglet…). */
  function poke() { clearTimeout(timer); timer = setTimeout(loop, 50); }

  window.addEventListener('resize', () => { if (others.length) renderRemote(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poke(); });
  window.addEventListener('beforeunload', () => { if (lastDoc) { try { Y.presenceLeave(lastDoc); } catch (_) { /* ignoré */ } } });
  if (P.pages) { const prev = P.pages.onChange; P.pages.onChange = (n) => { if (prev) prev(n); if (others.length) renderRemote(); }; }

  /** Le nombre de personnes avec qui ce document est partagé a changé (dialogue Partager). */
  function noteShares(docId, n) { known.set(docId, { n, at: Date.now() }); poke(); }
  function forget(docId) { if (docId === lastDoc) { lastDoc = ''; leave(docId); setOthers([]); } }

  timer = setTimeout(loop, 3000);

  P.collab = { lcs, merge3, blocksOf, mergeData, baseOf, patchEditor, addAssets, readSelection, noteShares, forget, poke, people: () => others.slice(), ROLE, renderRemote };
})();
