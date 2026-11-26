/* Plume — page d'accueil : galerie de modèles et documents récents. */
(function () {
  'use strict';
  const { $, h } = P;
  const cfg = () => P.settings;
  let recents = [];

  function fmtOpened(ts) {
    const d = new Date(ts);
    if (!ts || isNaN(d)) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'à ' + d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0');
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'hier';
    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }

  /* ---------- Modèles ---------- */
  function renderTemplates() {
    const grid = $('#tpl-grid');
    grid.replaceChildren();
    for (const tpl of P.templates) {
      const mini = h('div', { class: 'mini' });
      mini.innerHTML = P.sanitize(tpl.html());
      const b = h('button', { type: 'button', class: 'tpl', title: tpl.name, onclick: () => P.app.newFromTemplate(tpl) },
        h('div', { class: 'tpl-thumb' }, mini),
        h('div', { class: 'tpl-name', text: tpl.name }),
        h('div', { class: 'tpl-sub', text: tpl.sub || ' ' }));
      b.dataset.tpl = tpl.id;
      grid.append(b);
    }
    applyTplState();
  }

  function applyTplState() {
    const open = !!cfg().get('tplOpen');
    $('#tpl-grid').classList.toggle('collapsed', !open);
    $('#tpl-toggle').setAttribute('aria-expanded', String(open));
  }

  /* ---------- Documents récents ---------- */
  function previewEl(r) {
    if (r.encrypted) return h('div', { class: 'locked', title: 'Document protégé par mot de passe' }, P.svgIcon('i-lock'));
    const mini = h('div', { class: 'mini' });
    String(r.preview || '').split('\n').slice(0, 40).forEach((line, i) => {
      const p = h('p', {}, line || h('br'));
      if (i === 0) p.style.fontSize = '20pt';
      mini.append(p);
    });
    return mini;
  }

  function card(r) {
    const open = () => P.app.openRecent(r.path);
    const more = h('button', { type: 'button', class: 'icon-btn rmore', title: 'Plus d’actions', 'aria-label': 'Plus d’actions pour ' + r.title,
      onclick: (e) => {
        e.stopPropagation();
        if (P.pop.isOpen() && P.pop.anchor() === more) { P.pop.close(); return; }
        P.menu.open([
          { label: 'Ouvrir', icon: 'i-folder', action: open },
          { label: 'Afficher dans le dossier', disabled: !!r.missing, action: () => native.openExternal('reveal', r.path) },
          '-',
          { label: 'Retirer de la liste', icon: 'i-trash', action: async () => { try { await native.recents.remove(r.path); } catch (_) { /* ignoré */ } refresh(); } },
        ], { anchor: more, align: 'right' });
      } }, P.svgIcon('i-more'));
    more.addEventListener('mousedown', (e) => e.stopPropagation());
    const el = h('div', { class: 'rcard' + (r.missing ? ' missing' : ''), role: 'button', tabindex: '0', title: r.path,
      onclick: open, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } } },
    h('div', { class: 'rthumb' }, previewEl(r)),
    h('div', { class: 'rinfo' },
      h('div', { class: 'rtitle', text: r.title || 'Sans titre' }),
      h('div', { class: 'rmeta' }, P.svgIcon(r.encrypted ? 'i-lock' : 'i-doc', 'sm'), r.missing ? 'Fichier introuvable' : 'Ouvert ' + fmtOpened(r.openedAt))),
    more);
    return el;
  }

  /* ---------- Documents en ligne (compte) ---------- */
  const ago = (iso) => {
    const t = Date.parse(iso);
    if (isNaN(t)) return '';
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return 'à l’instant';
    if (sec < 3600) return 'il y a ' + Math.round(sec / 60) + ' min';
    return 'modifié ' + fmtOpened(t);
  };

  function cloudCard(d) {
    const open = () => P.app.openCloud(d.id);
    const more = h('button', { type: 'button', class: 'icon-btn rmore', title: 'Plus d’actions', 'aria-label': 'Plus d’actions pour ' + d.title,
      onclick: (e) => {
        e.stopPropagation();
        if (P.pop.isOpen() && P.pop.anchor() === more) { P.pop.close(); return; }
        P.menu.open([
          { label: 'Ouvrir', icon: 'i-folder', action: open },
          '-',
          { label: 'Supprimer du compte…', icon: 'i-trash', action: () => P.app.deleteCloud(d.id) },
        ], { anchor: more, align: 'right' });
      } }, P.svgIcon('i-more'));
    more.addEventListener('mousedown', (e) => e.stopPropagation());
    return h('div', { class: 'rcard cloud', role: 'button', tabindex: '0', title: d.title,
      onclick: open, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } } },
    h('div', { class: 'rthumb' }, previewEl({ preview: (d.title ? d.title + '\n' : '') + (d.preview || '') })),
    h('div', { class: 'rinfo' },
      h('div', { class: 'rtitle', text: d.title || 'Sans titre' }),
      h('div', { class: 'rmeta' }, P.svgIcon('i-cloud', 'sm'), ago(d.updated_at))),
    more);
  }

  function renderCloud() {
    const Y = P.sync;
    const sec = $('#cloud-sec');
    const on = !!(Y && Y.account.configured && Y.account.signedIn);
    sec.hidden = !on;
    if (!on) return;
    const box = $('#cloud-list');
    box.replaceChildren();
    box.classList.toggle('list', cfg().get('homeView') === 'list');
    let items = Y.docs();
    const q = $('#home-q').value.trim().toLowerCase();
    if (q) items = items.filter((d) => String(d.title || '').toLowerCase().includes(q) || String(d.preview || '').toLowerCase().includes(q));
    if (cfg().get('homeSort') === 'title') items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'fr', { sensitivity: 'base' }));
    $('#cloud-count').textContent = items.length ? String(items.length) : '';
    const st = $('#cloud-state');
    st.className = 'cloud-state' + (Y.status === 'offline' || Y.status === 'error' ? ' err' : '');
    st.textContent = Y.status === 'syncing' ? 'Synchronisation…' : Y.status === 'offline' ? 'Hors ligne' : Y.status === 'error' ? 'Synchronisation impossible' : Y.account.email || '';
    if (!items.length) {
      box.append(h('div', { class: 'home-empty soft' }, q ? ['Aucun document en ligne ne correspond à « ', h('b', { text: $('#home-q').value.trim() }), ' ».']
        : [h('b', { text: 'Aucun document en ligne.' }), ' Les nouveaux documents sont enregistrés automatiquement dans votre compte et apparaissent ici sur tous vos appareils.']));
      return;
    }
    items.forEach((d) => box.append(cloudCard(d)));
  }

  function renderRecents() {
    renderCloud();
    const box = $('#recent-list');
    box.replaceChildren();
    const view = cfg().get('homeView');
    box.classList.toggle('list', view === 'list');
    $('#home-sort').value = cfg().get('homeSort');
    $('#home-view use').setAttribute('href', view === 'list' ? '#i-grid' : '#i-rows');
    $('#home-view').title = view === 'list' ? 'Afficher en grille' : 'Afficher en liste';

    let items = recents.slice();
    const q = $('#home-q').value.trim().toLowerCase();
    if (q) items = items.filter((r) => String(r.title || '').toLowerCase().includes(q) || String(r.preview || '').toLowerCase().includes(q));
    if (cfg().get('homeSort') === 'title') items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'fr', { sensitivity: 'base' }));
    else items.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));

    if (!items.length) {
      box.append(h('div', { class: 'home-empty' },
        q ? ['Aucun document récent ne correspond à « ', h('b', { text: $('#home-q').value.trim() }), ' ».']
          : [h('b', { text: 'Aucun document récent.' }), ' Choisissez un modèle ci-dessus ou ouvrez un fichier avec le bouton dossier (Ctrl+O). Les documents enregistrés apparaissent ici.']));
      return;
    }
    items.forEach((r) => box.append(card(r)));
  }

  async function refresh() {
    let list = [];
    try { list = await native.recents.list(); } catch (_) { list = []; }
    recents = Array.isArray(list) ? list : [];
    renderRecents();
  }

  function showTemplates() {
    cfg().set('tplOpen', true);
    applyTplState();
    const first = $('#tpl-grid .tpl');
    if (first) first.focus();
  }

  function init() {
    renderTemplates();
    $('#tpl-toggle').addEventListener('click', () => { cfg().set('tplOpen', !cfg().get('tplOpen')); applyTplState(); });
    $('#home-q').addEventListener('input', renderRecents);
    $('#home-q').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; renderRecents(); } });
    $('#home-sort').addEventListener('change', (e) => { cfg().set('homeSort', e.target.value); renderRecents(); });
    $('#home-view').addEventListener('click', () => { cfg().set('homeView', cfg().get('homeView') === 'list' ? 'grid' : 'list'); renderRecents(); });
    $('#home-open').addEventListener('click', () => P.app.openDoc());
    cfg().onChange((k) => { if (k === '*') { applyTplState(); renderRecents(); } });
    if (P.sync) P.sync.on((t) => { if ((t === 'docs' || t === 'auth' || t === 'status') && !$('#home').hidden) renderCloud(); });
  }

  P.home = { init, refresh, showTemplates, recents: () => recents };
})();
