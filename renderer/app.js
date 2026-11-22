/* Plume — application : onglets de documents, fichiers, modes, panneaux, exports, mot de passe, récupération. */
(function () {
  'use strict';
  const { $, $$, h, esc } = P;
  const ed = P.editor;
  const state = P.state;
  const scroller = $('#scroller');
  const cfg = () => P.settings;

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const fileTitle = (p) => String(p || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const safeName = () => (state.title || 'Sans titre').replace(/[\\/:*?"<>|]/g, '_');
  const samePath = (a, b) => !!a && !!b && String(a).replace(/\//g, '\\').toLowerCase() === String(b).replace(/\//g, '\\').toLowerCase();

  const app = (P.app = { info: {} });

  /* ---------- Auteur ---------- */
  const loadAuthor = () => { try { return localStorage.getItem('plume.author') || ''; } catch (_) { return ''; } };
  function setAuthor(name) {
    state.author = name;
    try { localStorage.setItem('plume.author', name); } catch (_) { /* ignoré */ }
    P.paintAvatars();
  }
  async function askAuthor(first) {
    const r = await P.modal({
      title: first ? 'Bienvenue dans Plume' : 'Votre nom',
      message: 'Ce nom accompagne vos commentaires, vos suggestions et les versions du document.',
      fields: [{ id: 'name', label: 'Nom', value: state.author || '' }],
      ok: 'Enregistrer',
    });
    if (r && r.values.name.trim()) setAuthor(r.values.name.trim().slice(0, 60));
    else if (first && !state.author) setAuthor('Moi');
  }
  app.setAuthor = setAuthor;
  app.askAuthor = askAuthor;

  /* ---------- Onglets : un onglet « Accueil » fixe + un onglet par document ---------- */
  const DOC_KEYS = ['path', 'title', 'dirty', 'password', 'pageless', 'mode', 'variables', 'comments', 'versions', 'assets'];
  const tabs = [];            // { id, st: état du document, html, scroll }
  let activeId = 'home';

  const blankDoc = () => ({ path: null, title: 'Sans titre', dirty: false, password: null, pageless: false, mode: 'edit', variables: {}, comments: [], versions: [], assets: {} });
  const tabById = (id) => tabs.find((t) => t.id === id) || null;
  const current = () => tabById(activeId);
  const src = (t) => (t.id === activeId ? state : t.st);       // l'onglet actif vit dans l'état « vivant »
  const inDoc = () => activeId !== 'home' && !!current();
  app.inDoc = inDoc;

  function captureActive() {
    const t = current();
    if (!t) return;
    for (const k of DOC_KEYS) t.st[k] = state[k];
    t.html = ed.innerHTML;
    t.scroll = scroller.scrollTop;
  }

  function showView(v) {
    $('#home').hidden = v !== 'home';
    $('#docview').hidden = v !== 'doc';
    document.body.dataset.view = v;
  }

  function loadTab(t) {
    for (const k of DOC_KEYS) state[k] = t.st[k];
    P.resetSel();
    ed.innerHTML = t.html;
    $('#title').value = state.title;
    $('#findbar').hidden = true;
    setPageless(state.pageless);
    setMode(state.mode);
    refreshChrome();
    P.renderPanel();
    renderOutline();
    scroller.scrollTop = t.scroll || 0;
    P.updateCounts();
  }

  function tabTitle(t) { return src(t).title || 'Sans titre'; }

  function tabEl(t) {
    const s = src(t);
    const el = h('div', { class: 'tab' + (t.id === activeId ? ' active' : ''), role: 'tab', tabindex: '0', 'aria-selected': String(t.id === activeId),
      title: tabTitle(t) + (s.path ? '\n' + s.path : ''),
      onclick: () => activate(t.id),
      onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t.id); } },
    },
    P.svgIcon(s.password ? 'i-lock' : 'i-doc', 'sm'),
    h('span', { class: 'tab-title', text: tabTitle(t) }),
    s.dirty ? h('span', { class: 'tab-dot', title: 'Modifications non enregistrées' }) : null,
    h('button', { type: 'button', class: 'tab-x', title: 'Fermer l’onglet (Ctrl+W)', 'aria-label': 'Fermer l’onglet', tabindex: '-1',
      onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, P.svgIcon('i-close')));
    el.dataset.id = t.id;
    el.firstChild.setAttribute('class', 'ic sm tab-ic');
    return el;
  }

  function renderTabs() {
    const box = $('#tabs');
    $$('.tab[data-id]', box).forEach((n) => n.remove());
    const home = $('#tab-home');
    home.classList.toggle('active', activeId === 'home');
    home.setAttribute('aria-selected', String(activeId === 'home'));
    tabs.forEach((t) => box.append(tabEl(t)));
    const act = $('.tab.active', box);
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function patchTab() {
    const t = current();
    if (!t) return;
    const old = $(`.tab[data-id="${CSS.escape(t.id)}"]`);
    if (old) old.replaceWith(tabEl(t));
  }

  function activate(id) {
    if (id === activeId) return;
    P.pop.close();
    captureActive();
    if (id !== 'home' && !tabById(id)) id = 'home';
    activeId = id;
    if (id === 'home') {
      showView('home');
      document.title = 'Plume';
      renderTabs();
      if (P.home) P.home.refresh();
      return;
    }
    loadTab(tabById(id));
    showView('doc');
    renderTabs();
    ed.focus();
  }
  app.activate = activate;
  app.goHome = () => activate('home');

  /** Crée un onglet vide, le rend actif, puis appelle init() qui charge le contenu dans l'éditeur. */
  function openTab(init) {
    captureActive();
    const prevId = activeId;
    const t = { id: P.uid(), st: blankDoc(), html: '<p><br></p>', scroll: 0 };
    tabs.push(t);
    activeId = t.id;
    loadTab(t);
    showView('doc');
    try {
      init();
    } catch (err) {
      tabs.splice(tabs.indexOf(t), 1);
      activeId = prevId;
      const prev = tabById(prevId);
      if (prev) { loadTab(prev); showView('doc'); } else showView('home');
      renderTabs();
      P.toast('Impossible d’ouvrir ce fichier : ' + (err && err.message ? err.message : err), 6000);
      return null;
    }
    renderTabs();
    ed.focus();
    return t;
  }

  function cycle(dir) {
    const order = ['home'].concat(tabs.map((t) => t.id));
    const i = order.indexOf(activeId);
    activate(order[(i + dir + order.length) % order.length]);
  }

  const anyDirty = () => { captureActive(); return tabs.some((t) => t.st.dirty); };

  async function closeTab(id) {
    const t = tabById(id);
    if (!t) return false;
    if (src(t).dirty) {
      if (id !== activeId) activate(id);
      if (!(await confirmDiscard())) return false;
    }
    const i = tabs.findIndex((x) => x.id === id);
    if (i < 0) return true;
    const wasActive = id === activeId;
    tabs.splice(i, 1);
    if (wasActive) {
      activeId = '__closed__';
      const next = tabs[i] || tabs[i - 1];
      activate(next ? next.id : 'home');
    } else renderTabs();
    syncRecovery(true);
    return true;
  }
  app.closeTab = closeTab;
  app.closeActive = () => (inDoc() ? closeTab(activeId) : false);

  $('#tab-home').addEventListener('click', () => activate('home'));
  $('#tab-new').addEventListener('click', () => newDoc());
  $('#doc-logo').addEventListener('click', () => activate('home'));

  /* ---------- Barre de titre du document, état ---------- */
  let rev = 0;
  function refreshChrome() {
    if (!inDoc()) { document.title = 'Plume'; return; }
    const t = state.title || 'Sans titre';
    document.title = (state.dirty ? '• ' : '') + t + ' — Plume';
    $('#savestate').textContent = state.dirty ? 'Modifications non enregistrées' : state.path ? 'Enregistré' : 'Nouveau document';
    $('#st-lock').textContent = state.password ? '🔒 Chiffré' : '';
    $('#st-lock').title = state.password ? 'Document chiffré (AES-256). Pas de récupération automatique pour un document chiffré.' : '';
    patchTab();
  }

  let panelTimer = null;
  P.onDirty = () => {
    rev++;
    refreshChrome();
    clearTimeout(panelTimer);
    panelTimer = setTimeout(() => {
      renderOutline();
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('#sidebody')) return;   // ne pas voler le focus d'un champ du panneau
      P.renderPanel();
    }, 400);
  };

  $('#title').addEventListener('input', (e) => { state.title = e.target.value; P.markDirty(); });
  $('#title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });

  /* ---------- Modes ---------- */
  const MODES = {
    edit: { label: 'Édition', icon: 'i-edit', desc: 'Modifier le document directement', status: 'Édition' },
    suggest: { label: 'Suggestion', icon: 'i-suggest', desc: 'Vos modifications sont proposées, pas appliquées', status: 'Suggestion : vos modifications sont proposées, pas appliquées' },
    view: { label: 'Lecture', icon: 'i-eye', desc: 'Lecture seule, sans modification possible', status: 'Lecture seule' },
  };
  app.MODES = MODES;
  function setMode(m) {
    if (!MODES[m]) m = 'edit';
    state.mode = m;
    ed.contentEditable = m === 'view' ? 'false' : 'true';
    document.body.dataset.mode = m;
    $('#st-mode').textContent = MODES[m].status;
    $('#mode-label').textContent = MODES[m].label;
    $('#mode-ic use').setAttribute('href', '#' + MODES[m].icon);
    P.renderPanel();
  }
  app.setMode = setMode;

  $('#modebtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (P.pop.isOpen() && P.pop.anchor() === btn) { P.pop.close(); return; }
    P.menu.open(Object.keys(MODES).map((k) => ({
      label: MODES[k].label, desc: MODES[k].desc, icon: MODES[k].icon, checked: () => state.mode === k, action: () => setMode(k),
    })), { anchor: btn, align: 'right' });
  });

  function setPageless(on) {
    state.pageless = !!on;
    document.body.classList.toggle('pageless', !!on);
    P.updateCounts();
  }
  app.setPageless = (on) => { setPageless(on); P.markDirty(); };
  app.togglePageless = () => app.setPageless(!state.pageless);

  /* ---------- Plan (à gauche) et panneau latéral (à droite) ---------- */
  const outline = $('#outline');
  function renderOutline() {
    if (outline.hidden) return;
    const body = $('#outline-body');
    body.replaceChildren();
    P.panels.outline(body);
  }
  app.syncOutline = () => { outline.hidden = !cfg().get('outline'); renderOutline(); };
  $('#outline-close').addEventListener('click', () => cfg().set('outline', false));

  let tab = 'comments';
  const side = $('#side');
  const rail = $('#siderail');
  const handle = $('#side-handle');
  let collapsed = false;      // panneau réduit en rail d'icônes (état de la session)

  /* Rail d'icônes : le panneau réduit reste à portée de clic, avec les compteurs de commentaires et de suggestions. */
  const RAIL = [['comments', 'i-comment', 'Commentaires'], ['suggestions', 'i-suggest', 'Suggestions'], ['versions', 'i-history', 'Versions'],
    ['variables', 'i-at', 'Variables'], ['assistant', 'i-sparkle', 'Assistant IA']];
  RAIL.forEach(([id, icon, label]) => rail.append(h('button', { type: 'button', class: 'rail-btn', 'data-tab': id, title: label, 'aria-label': label },
    P.svgIcon(icon), h('span', { class: 'rail-badge', hidden: true }))));
  rail.append(h('button', { type: 'button', class: 'rail-btn rail-close', title: 'Fermer le panneau', 'aria-label': 'Fermer le panneau', onclick: () => { side.hidden = true; } }, P.svgIcon('i-close', 'sm')));

  function paintRail() {
    $$('#siderail .rail-btn[data-tab]').forEach((b) => {
      const id = b.dataset.tab;
      b.classList.toggle('on', id === tab);
      const n = id === 'comments' ? P.openCommentCount() : id === 'suggestions' ? P.suggestionCount() : 0;
      const badge = b.querySelector('.rail-badge');
      badge.hidden = !n;
      badge.textContent = n > 99 ? '99+' : String(n || '');
    });
  }
  function setCollapsed(v) {
    collapsed = !!v;
    side.classList.toggle('collapsed', collapsed);
    handle.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Développer le panneau' : 'Réduire le panneau';
    handle.title = label;
    handle.setAttribute('aria-label', label);
    // un panneau réduit ne doit plus prendre le focus clavier
    $('#sidetabs').inert = collapsed;
    $('#sidebody').inert = collapsed;
    rail.inert = !collapsed;
    paintRail();
  }
  app.setSideCollapsed = setCollapsed;
  app.sideCollapsed = () => collapsed;
  setCollapsed(false);
  // panneau réduit : les compteurs du rail suivent les modifications du document
  let railTimer = 0;
  ed.addEventListener('input', () => { if (!collapsed || side.hidden) return; clearTimeout(railTimer); railTimer = setTimeout(paintRail, 250); });

  /* Largeur du panneau : on le tire par son bord gauche. Trop étroit, il se rétracte en rail ; tiré vers la gauche, il se redéploie. */
  const resizer = $('#side-resizer');
  const SIDE_MIN = 384, SIDE_MAX = 760, DOC_MIN = 420;
  const COLLAPSE_BELOW = 280, EXPAND_ABOVE = 320;          // hystérésis : évite le clignotement autour du seuil
  let sideW = SIDE_MIN;
  try { const v = Number(localStorage.getItem('plume.sideW')); if (v >= SIDE_MIN && v <= 1200) sideW = v; } catch (_) { /* stockage indisponible */ }
  function fitSide() {
    const ws = $('#workspace').getBoundingClientRect().width;
    const ol = $('#outline');
    const ow = ol && !ol.hidden ? ol.getBoundingClientRect().width : 0;
    const room = ws ? ws - ow - DOC_MIN : SIDE_MAX;           // le document garde toujours au moins DOC_MIN px
    const eff = Math.round(Math.max(SIDE_MIN, Math.min(sideW, SIDE_MAX, room)));
    side.style.setProperty('--side-w', eff + 'px');
    resizer.setAttribute('aria-valuenow', String(eff));
    return eff;
  }
  app.fitSide = fitSide;
  fitSide();
  window.addEventListener('resize', fitSide);
  const saveW = () => { try { localStorage.setItem('plume.sideW', String(Math.round(sideW))); } catch (_) { /* stockage indisponible */ } };
  const toggleCollapsed = () => { if (collapsed) { setCollapsed(false); P.renderPanel(); } else setCollapsed(true); };

  let drag = null, dragged = false;
  function beginDrag(e, viaHandle) {
    if (e.button !== 0 || side.hidden) return;
    drag = { x: e.clientX, id: e.pointerId, el: e.currentTarget, live: !viaHandle };   // la poignée n'entame le glissement qu'après quelques pixels
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* ignoré */ }
    if (!viaHandle) e.preventDefault();
  }
  function moveDrag(e) {
    if (!drag) return;
    if (!drag.live) { if (Math.abs(e.clientX - drag.x) < 5) return; drag.live = true; }
    dragged = true;
    document.body.classList.add('side-resizing');
    const want = $('#workspace').getBoundingClientRect().right - e.clientX;      // largeur voulue par la position de la souris
    if (collapsed) {
      if (want < EXPAND_ABOVE) return;
      document.body.classList.add('side-dragging');                                // pas d'animation pendant le suivi
      setCollapsed(false); sideW = want; fitSide(); P.renderPanel();
    } else if (want < COLLAPSE_BELOW) {
      document.body.classList.remove('side-dragging');                             // la rétractation, elle, est animée
      setCollapsed(true);
    } else {
      document.body.classList.add('side-dragging');
      sideW = want; fitSide();
    }
  }
  function endDrag() {
    if (!drag) return;
    try { drag.el.releasePointerCapture(drag.id); } catch (_) { /* ignoré */ }
    const moved = drag.live;
    drag = null;
    document.body.classList.remove('side-resizing', 'side-dragging');
    if (moved) saveW();
    setTimeout(() => { dragged = false; }, 0);                                      // le « click » qui suit un glissement est ignoré
  }
  for (const [el, viaHandle] of [[resizer, false], [handle, true]]) {
    el.addEventListener('pointerdown', (e) => beginDrag(e, viaHandle));
    el.addEventListener('pointermove', moveDrag);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  }
  resizer.addEventListener('dblclick', toggleCollapsed);
  resizer.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === 'ArrowLeft') { if (collapsed) toggleCollapsed(); sideW = fitSide() + step; fitSide(); saveW(); }
    else if (e.key === 'ArrowRight') { if (!collapsed) { sideW = Math.max(SIDE_MIN, fitSide() - step); fitSide(); saveW(); } }
    else if (e.key === 'Enter' || e.key === ' ') toggleCollapsed();
    else return;
    e.preventDefault();
  });
  handle.addEventListener('click', () => { if (dragged) return; toggleCollapsed(); });
  rail.addEventListener('click', (e) => { const b = e.target.closest('.rail-btn[data-tab]'); if (b) P.showPanel(b.dataset.tab); });

  P.showPanel = (name) => { if (name) tab = name; side.hidden = false; if (collapsed) setCollapsed(false); fitSide(); P.renderPanel(); };
  P.renderPanel = () => {
    paintRail();
    if (side.hidden || collapsed) return;
    $$('#sidetabs button[data-tab]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === tab);
      if (!b.dataset.label) b.dataset.label = b.textContent;
      let n = 0;
      if (b.dataset.tab === 'comments') n = P.openCommentCount();
      else if (b.dataset.tab === 'suggestions') n = P.suggestionCount();
      b.textContent = b.dataset.label + (n ? ` (${n})` : '');
    });
    const body = $('#sidebody');
    body.replaceChildren();
    const fn = P.panels[tab];
    if (fn) fn(body);
  };
  // le bouton de la barre ferme le panneau s'il est déjà affiché sur cet onglet ; réduit, il le redéveloppe
  const togglePanel = (name) => { if (!side.hidden && !collapsed && tab === name) side.hidden = true; else P.showPanel(name); };
  app.togglePanel = togglePanel;
  $('#btn-history').addEventListener('click', () => togglePanel('versions'));
  $('#btn-comments').addEventListener('click', () => togglePanel('comments'));
  $('#side-close').addEventListener('click', () => { side.hidden = true; });
  $('#sidetabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) P.showPanel(b.dataset.tab); });

  /* ---------- Zoom de la page ---------- */
  const ZOOMS = [50, 75, 90, 100, 125, 150, 200];
  app.zoomStep = (dir) => {
    const cur = cfg().get('pageZoom');
    const i = dir === 0 ? ZOOMS.indexOf(100) : Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(cur) + dir));
    cfg().set('pageZoom', ZOOMS[i]);
  };
  $('#tb-zoom').addEventListener('change', (e) => cfg().set('pageZoom', parseInt(e.target.value, 10)));

  /* ---------- Barre d'outils : « plus d'outils » quand la fenêtre est étroite ---------- */
  (function toolbarOverflow() {
    const tbar = $('#toolbar'), tools = $('#tb-tools'), more = $('#tb-more'), modebtn = $('#modebtn');
    const check = () => {
      if (tbar.classList.contains('expanded')) return;
      // largeur naturelle des groupes (ils ne rétrécissent pas), indépendante de la place disponible
      const vis = Array.from(tools.children).filter((c) => c.offsetWidth > 0);
      const gap = parseFloat(getComputedStyle(tools).columnGap) || 0;
      const need = vis.reduce((sum, c) => sum + c.offsetWidth, 0) + gap * Math.max(0, vis.length - 1);
      const avail = tbar.clientWidth - modebtn.offsetWidth - more.offsetWidth - 40;
      more.hidden = need <= avail;
    };
    const later = () => { check(); requestAnimationFrame(check); };
    more.addEventListener('click', () => {
      const on = tbar.classList.toggle('expanded');
      more.setAttribute('aria-expanded', String(on));
      if (!on) check();
    });
    if (window.ResizeObserver) { const ro = new ResizeObserver(later); ro.observe(tbar); }
    window.addEventListener('resize', later);
  })();

  /* ---------- Documents récents ---------- */
  const previewText = () => (ed.innerText || ed.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 700);
  async function addRecent() {
    if (!state.path) return;
    try { await native.recents.add({ path: state.path, title: state.title, preview: previewText(), encrypted: !!state.password }); } catch (_) { /* ignoré */ }
  }

  /* ---------- Chargement ---------- */
  function afterLoad(o) {
    state.path = o.path || null;
    state.password = o.password || null;
    state.dirty = !!o.dirty;
    $('#title').value = state.title;
    setPageless(state.pageless);
    setMode(o.mode || 'edit');
    refreshChrome();
    P.renderPanel();
    renderOutline();
    if (P.updateTocs) P.updateTocs();
    scroller.scrollTop = 0;
    if (state.path && !state.dirty) addRecent();
  }

  function blankState() {
    state.title = 'Sans titre';
    state.variables = {};
    state.comments = [];
    state.versions = [];
    state.assets = {};
    state.pageless = false;
  }

  /** Lit un fichier (déchiffre si besoin). Retourne null si l'utilisateur annule. */
  async function prepare(f) {
    if (f.kind === 'plume') {
      let text = f.text;
      let password = null;
      if (f.encrypted) {
        for (;;) {
          const r = await P.modal({
            title: 'Document protégé',
            message: 'Entrez le mot de passe pour ouvrir « ' + fileTitle(f.path) + ' ».',
            fields: [{ id: 'pw', label: 'Mot de passe', type: 'password' }],
            ok: 'Ouvrir',
          });
          if (!r) return null;
          const d = await native.decrypt(f.b64, r.values.pw);
          if (d.error) { P.toast(d.error); continue; }
          text = d.text;
          password = r.values.pw;
          break;
        }
      }
      return { kind: 'plume', data: JSON.parse(text), password, path: f.path };
    }
    return { kind: f.kind === 'html' ? 'html' : 'text', text: f.text, path: f.path };
  }

  function applyPrepared(p) {
    const mode = cfg().get('openMode');
    if (p.kind === 'plume') {
      P.loadData(p.data);
      if (state.title === 'Sans titre' && p.path) state.title = fileTitle(p.path);
      afterLoad({ path: p.path, password: p.password, mode });
    } else if (p.kind === 'html') {
      const doc = new DOMParser().parseFromString(p.text, 'text/html');
      blankState();
      state.title = (doc.title || '').trim() || fileTitle(p.path) || 'Sans titre';
      ed.innerHTML = P.sanitize(doc.body ? doc.body.innerHTML : '', { pasted: true }) || '<p><br></p>';
      P.refreshVars();
      P.updateCounts();
      afterLoad({ path: null, dirty: true, mode });
    } else {
      blankState();
      state.title = fileTitle(p.path) || 'Sans titre';
      ed.innerHTML = String(p.text).replace(/\r\n?/g, '\n').split('\n').map((l) => '<p>' + (l ? esc(l) : '<br>') + '</p>').join('');
      P.updateCounts();
      afterLoad({ path: null, dirty: true, mode });
    }
  }

  /** Ouvre un fichier dans un nouvel onglet (ou active l'onglet où il est déjà ouvert). */
  async function openFile(f) {
    if (!f) return false;
    if (f.error) { P.toast(f.error, 5000); return false; }
    const existing = f.path && tabs.find((t) => samePath(src(t).path, f.path));
    if (existing) { activate(existing.id); return true; }
    let prepared;
    try { prepared = await prepare(f); } catch (err) { P.toast('Impossible d’ouvrir ce fichier : ' + (err && err.message ? err.message : err), 6000); return false; }
    if (!prepared) return false;
    return !!openTab(() => applyPrepared(prepared));
  }
  app.openFile = openFile;

  async function openRecent(p) {
    const existing = tabs.find((t) => samePath(src(t).path, p));
    if (existing) { activate(existing.id); return true; }
    let f;
    try { f = await native.recents.open(p); } catch (err) { P.toast('Impossible d’ouvrir ce document.', 5000); return false; }
    if (!f || f.error) {
      P.toast((f && f.error) || 'Impossible d’ouvrir ce document.', 5000);
      if (P.home) P.home.refresh();
      return false;
    }
    return openFile(f);
  }
  app.openRecent = openRecent;

  /** Nouveau document (vierge ou à partir d'un modèle) dans un nouvel onglet. */
  function newFromTemplate(tpl) {
    tpl = tpl || P.templates[0];
    const tab = openTab(() => {
      state.variables = Object.fromEntries((tpl.vars || []).map((n) => [n, '']));
      ed.innerHTML = P.sanitize(tpl.html()) || '<p><br></p>';
      if (P.fixChecklists) P.fixChecklists();
      P.refreshVars();
      state.title = tpl.docTitle || 'Sans titre';
      afterLoad({ path: null });
      P.updateCounts();
    });
    // Modèle à champs : on propose tout de suite de les remplir (un seul formulaire)
    if (tab && tpl.vars && tpl.vars.length && P.fillFields) setTimeout(() => P.fillFields({ fromTemplate: true }), 60);
    return tab;
  }
  app.newFromTemplate = newFromTemplate;
  const newDoc = () => newFromTemplate(P.templates[0]);
  app.newDoc = newDoc;

  async function openDoc() {
    const f = await native.open();
    if (f) await openFile(f);
  }
  app.openDoc = openDoc;

  /* ---------- Enregistrement ---------- */
  async function save(saveAs) {
    if (!inDoc()) return false;
    P.snapshot(null, true);
    const res = await native.save({
      path: state.path, content: JSON.stringify(P.serialize()), password: state.password || '',
      saveAs: !!saveAs, name: state.title,
    });
    if (!res) return false;
    if (res.error) { P.toast('Échec de l’enregistrement : ' + res.error, 6000); return false; }
    state.path = res.path;
    state.dirty = false;
    refreshChrome();
    P.renderPanel();
    P.toast('Enregistré');
    addRecent();
    syncRecovery(true);
    return true;
  }
  app.save = save;
  $('#btn-save').addEventListener('click', () => save(false));

  async function confirmDiscard() {
    if (!state.dirty) return true;
    const r = await P.modal({
      title: 'Modifications non enregistrées',
      message: 'Enregistrer les modifications de « ' + (state.title || 'Sans titre') + ' » ?',
      buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'no', label: 'Ne pas enregistrer' }, { id: 'yes', label: 'Enregistrer', primary: true }],
    });
    if (!r) return false;
    if (r.button === 'yes') return save(false);
    return true;
  }

  /* ---------- Exports ---------- */
  function report(res, label) {
    if (!res) return;
    if (res.error) P.toast('Échec de l’exportation : ' + res.error, 6000);
    else P.toast(label + ' : ' + fileTitle(res.path) + ' enregistré.');
  }

  async function exportDocx() {
    if (!inDoc() || !(await P.runDlp(true))) return;
    try {
      if (P.updateTocs) P.updateTocs();
      const bytes = PlumeDocx.build(ed, { author: state.author || 'Moi', title: state.title, comments: state.comments });
      report(await native.exportDocx(bytes, safeName()), 'Word');
    } catch (err) { P.toast('Échec de la conversion en Word : ' + (err && err.message ? err.message : err), 6000); }
  }

  async function exportPdf() {
    if (!inDoc() || !(await P.runDlp(true))) return;
    if (P.updateTocs) P.updateTocs();
    report(await native.exportPdf(safeName()), 'PDF');
  }

  const EXPORT_CSS = 'body{font:11pt Calibri,Arial,sans-serif;color:#202124;line-height:1.5;margin:0}main{max-width:780px;margin:32px auto;padding:0 24px}' +
    'h1{font-size:20pt}h2{font-size:16pt}h3{font-size:14pt}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}img{max-width:100%}' +
    'blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:14px;color:#555}ul.checklist{list-style:none;padding-left:4px}' +
    '.chip{background:#e8eef9;border-radius:10px;padding:0 6px}ins.sg-ins{color:#188038;text-decoration:underline}del.sg-del{color:#c5221f}' +
    '.pagebreak{border-top:1px dashed #bbb;margin:24px 0}' +
    '.callout{margin:12px 0;padding:10px 14px;border-radius:10px;border:1px solid #d0d7e2;border-left:5px solid #0a84ff;background:#eaf3ff}.callout>:first-child{margin-top:0}.callout>:last-child{margin-bottom:0}' +
    '.callout-tip{background:#e9f8ee;border-color:#cfe9d7;border-left-color:#30a14e}.callout-warn{background:#fff5e0;border-color:#f3e1b8;border-left-color:#ff9f0a}.callout-danger{background:#ffecea;border-color:#f3cdc9;border-left-color:#ff453a}' +
    '.toc{margin:14px 0;padding:12px 16px;border-radius:10px;background:#f5f5f7}.toc-title{font-weight:700;margin-bottom:6px}.toc-item{margin:2px 0}.toc-item a{color:inherit;text-decoration:none}.toc-item.lvl2{padding-left:16px}.toc-item.lvl3{padding-left:32px}' +
    'table.tbl-none td,table.tbl-none th{border-color:transparent}table.tbl-thick td,table.tbl-thick th{border-width:2px;border-color:#555}' +
    '.cmt.react{border-bottom:1px dotted #999}.cmt.react[data-emoji]::after{content:attr(data-emoji);font-size:.8em;margin-left:2px}';

  async function exportHtml() {
    if (!inDoc() || !(await P.runDlp(true))) return;
    if (P.updateTocs) P.updateTocs();
    const c = ed.cloneNode(true);
    c.querySelectorAll('.noexport').forEach((n) => n.remove());
    Array.from(c.querySelectorAll('h1, h2, h3')).filter((n) => !n.closest('.toc') && n.textContent.trim()).forEach((n, i) => { n.id = 'h' + i; });
    c.querySelectorAll('.toc-item').forEach((t) => { const l = document.createElement('a'); l.href = '#h' + t.dataset.h; l.textContent = t.textContent; t.replaceChildren(l); });
    c.querySelectorAll('.cmt').forEach((n) => P.unwrap(n));
    c.querySelectorAll('input[type="checkbox"]').forEach((i) => i.setAttribute('disabled', ''));
    c.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    const html = `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>${esc(state.title || 'Document')}</title><style>${EXPORT_CSS}</style></head><body><main>${c.innerHTML}</main></body></html>`;
    report(await native.exportHtml(html, safeName()), 'HTML');
  }

  async function exportMd() {
    if (!inDoc() || !(await P.runDlp(true))) return;
    if (P.updateTocs) P.updateTocs();
    try {
      const { md, images } = PlumeMd.build(ed);
      const res = await native.exportMd(md, images, safeName());
      if (res && !res.error && res.path && images.length) P.toast('Markdown : ' + fileTitle(res.path) + ' enregistré, avec ' + images.length + ' image' + (images.length > 1 ? 's' : '') + ' dans un dossier voisin.', 5000);
      else report(res, 'Markdown');
    } catch (err) { P.toast('Échec de l’exportation Markdown : ' + (err && err.message ? err.message : err), 6000); }
  }

  async function printDoc() {
    if (!inDoc() || !(await P.runDlp(true))) return;
    if (P.updateTocs) P.updateTocs();
    await native.print();
  }
  Object.assign(app, { exportDocx, exportPdf, exportHtml, exportMd, print: printDoc });

  /* ---------- Mot de passe ---------- */
  async function setPassword() {
    if (!inDoc()) return;
    const r = await P.modal({
      title: 'Protéger par mot de passe',
      message: state.password
        ? 'Ce document est chiffré. Laissez les deux champs vides pour retirer la protection.'
        : 'Le document sera chiffré (AES-256) à l’enregistrement. Sans le mot de passe il est impossible de le rouvrir : Plume ne peut pas le récupérer.',
      fields: [{ id: 'p1', label: 'Mot de passe', type: 'password' }, { id: 'p2', label: 'Confirmer', type: 'password' }],
      ok: 'Appliquer',
    });
    if (!r) return;
    if (r.values.p1 !== r.values.p2) { P.toast('Les deux mots de passe ne correspondent pas.'); return; }
    if (r.values.p1 && r.values.p1.length < 6) { P.toast('Choisissez au moins 6 caractères.'); return; }
    state.password = r.values.p1 || null;
    P.markDirty();     // la copie de secours est réécrite sans ce document (jamais de copie en clair d'un document chiffré)
    await save(false);
  }
  app.setPassword = setPassword;

  /* ---------- Plein écran, avatar, raccourcis ---------- */
  app.toggleFullscreen = () => { try { native.toggleFullscreen(); } catch (_) { /* ignoré */ } };
  $$('[data-profile]').forEach((b) => b.addEventListener('click', () => cfg().openProfile(b)));
  $('#btn-expand').addEventListener('click', () => cfg().set('compact', false));

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.overlay')) return;          // une boîte de dialogue est ouverte
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (key === 'F11') { e.preventDefault(); app.toggleFullscreen(); return; }
    if (e.altKey && key === 'Home') { e.preventDefault(); activate('home'); return; }
    if (!mod) return;
    if (key === 'Tab' || key === 'PageDown' || key === 'PageUp') { e.preventDefault(); cycle(key === 'PageUp' || (key === 'Tab' && e.shiftKey) ? -1 : 1); return; }
    if (e.altKey) return;                                    // Ctrl+Alt+M : géré par l'éditeur
    const k = key.toLowerCase();
    if (k === 'n' || k === 't') { e.preventDefault(); newDoc(); }
    else if (k === 'o') { e.preventDefault(); openDoc(); }
    else if (k === 's') { e.preventDefault(); if (inDoc()) save(e.shiftKey); }
    else if (k === 'p') { e.preventDefault(); printDoc(); }
    else if (k === 'w') { e.preventDefault(); app.closeActive(); }
    else if (k === 'f' && e.shiftKey) { e.preventDefault(); cfg().set('compact', !cfg().get('compact')); }
    else if (k === 'f' && !inDoc()) { e.preventDefault(); $('#home-q').focus(); }
    else if (k === '/') { e.preventDefault(); cfg().openDialog('shortcuts'); }
    else if (inDoc() && (key === '+' || key === '=')) { e.preventDefault(); app.zoomStep(1); }
    else if (inDoc() && (key === '-' || key === '_')) { e.preventDefault(); app.zoomStep(-1); }
    else if (inDoc() && key === '0') { e.preventDefault(); app.zoomStep(0); }
  }, true);

  native.onExternalOpen((f) => { openFile(f); });

  // Utilisé par le processus principal (fermeture de la fenêtre)
  window.plume = {
    isDirty: () => anyDirty(),
    save: async () => {
      captureActive();
      for (const t of tabs.filter((x) => x.st.dirty)) {
        activate(t.id);
        if (!(await save(false))) return false;
      }
      return true;
    },
    discardRecovery: async () => { recoveryOn = false; return native.recovery.clear(); },
  };

  /* ---------- Récupération automatique (tous les onglets modifiés) et versions automatiques ---------- */
  let writtenRev = 0;
  let recoveryOn = false;
  async function syncRecovery(force) {
    if (!force && rev === writtenRev) return;
    const mine = rev;
    try {
      captureActive();
      const dirty = cfg().get('autoRecovery') ? tabs.filter((t) => t.st.dirty && !t.st.password) : [];
      if (!dirty.length) {
        if (recoveryOn) { await native.recovery.clear(); recoveryOn = false; }
      } else {
        await native.recovery.write(JSON.stringify(dirty.map((t) => P.serializeDoc(t.st, t.html))));
        recoveryOn = true;
      }
      writtenRev = mine;
    } catch (_) { /* ignoré : réessai au prochain passage */ }
  }
  setInterval(() => syncRecovery(false), 5000);
  app.syncRecovery = syncRecovery;

  setInterval(() => {
    if (cfg().get('autoVersions') && inDoc() && state.dirty && P.snapshot(null, true) && tab === 'versions') P.renderPanel();
  }, 10 * 60 * 1000);

  /* ---------- Démarrage ---------- */
  async function restoreRecovery() {
    try {
      const rec = await native.recovery.read();
      if (!rec || typeof rec !== 'string') return;
      const parsed = JSON.parse(rec);
      const docs = (Array.isArray(parsed) ? parsed : [parsed]).filter((d) => d && d.format === 'plume' && typeof d.html === 'string');
      if (!docs.length) { await native.recovery.clear(); return; }
      const names = docs.map((d) => '« ' + (d.title || 'Sans titre') + ' »').join(', ');
      const ok = await P.confirm(
        docs.length > 1 ? 'Restaurer des documents non enregistrés ?' : 'Restaurer un document non enregistré ?',
        docs.length > 1
          ? 'Plume s’est fermé avant d’enregistrer ' + docs.length + ' documents : ' + names + '. Voulez-vous les récupérer ?'
          : 'Plume s’est fermé avant d’enregistrer ' + names + ' (' + fmtDate(docs[0].savedAt) + '). Voulez-vous le récupérer ?',
        'Restaurer');
      if (!ok) { await native.recovery.clear(); return; }
      for (const data of docs) openTab(() => { P.loadData(data); afterLoad({ path: null, dirty: true }); });
      rev++;
    } catch (_) { try { await native.recovery.clear(); } catch (__) { /* ignoré */ } }
  }

  app.start = async function () {
    setAuthor(loadAuthor());
    showView('home');
    renderTabs();
    refreshChrome();
    if (P.home) P.home.refresh();
    let init = {};
    try { init = (await native.init()) || {}; } catch (_) { /* ignoré */ }
    app.info = { version: init.version, electron: init.electron, chrome: init.chrome };
    if (!state.author) await askAuthor(true);
    await restoreRecovery();
    if (init.file) await openFile(init.file);
  };
})();
