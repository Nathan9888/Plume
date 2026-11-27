/* Plume — barre de menus (Fichier, Édition, Affichage…) et composant de menu déroulant réutilisable. */
(function () {
  'use strict';
  const { $, h } = P;
  const state = P.state;
  const ed = P.editor;
  const A = () => P.app;
  const C = () => P.settings;
  const ro = () => state.mode === 'view';

  /* ---------- Composant de menu ---------- */
  const val = (v) => (typeof v === 'function' ? v() : v);
  const cssFamily = (n) => '"' + String(n).replace(/["\\;{}]/g, '') + '", system-ui, sans-serif';

  /**
   * items : [{label, hint, icon, desc, checked, disabled, action, items}] ou '-' pour un séparateur.
   * opts  : {anchor, align, x, y, onClose, onLeft, onRight}
   * Les boutons ne prennent jamais le focus : la sélection du document reste en place.
   */
  function open(items, opts) {
    opts = opts || {};
    const levels = [];

    function makeLevel(list) {
      const lv = { el: h('div', { class: 'menu', role: 'menu' }), rows: [], hl: -1, child: null };
      for (const it of list) {
        if (it === '-') { lv.el.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
        if (it.caption) { lv.el.append(h('div', { class: 'menu-cap', role: 'presentation', text: it.caption })); continue; }
        const dis = !!val(it.disabled);
        const chk = !!val(it.checked);
        const hasSub = !!it.items;
        const b = h('button', { type: 'button', class: 'menu-item' + (chk ? ' checked' : '') + (it.desc ? ' two' : ''), role: 'menuitem', disabled: dis },
          h('span', { class: 'mi-lead' }, chk ? P.svgIcon('i-check', 'sm') : it.icon ? P.svgIcon(it.icon, 'sm') : null),
          h('span', { class: 'mi-label', style: it.style || (it.font ? 'font-family:' + cssFamily(it.font) + ';font-size:14px' : null) }, it.label, it.desc ? h('span', { class: 'mi-desc', text: it.desc }) : null),
          it.hint ? h('span', { class: 'mi-hint', text: it.hint }) : null,
          hasSub ? h('span', { class: 'mi-sub' }, P.svgIcon('i-chev-right', 'sm')) : null);
        const row = { b, it, dis, hasSub };
        const idx = lv.rows.length;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('mouseenter', () => {
          if (dis) return;
          setHl(lv, idx);
          if (hasSub) openSub(lv, idx); else closeSub(lv);
        });
        b.addEventListener('click', () => activate(lv, idx));
        lv.rows.push(row);
        lv.el.append(b);
      }
      return lv;
    }

    function setHl(lv, i) {
      lv.hl = i;
      lv.rows.forEach((r, k) => r.b.classList.toggle('hl', k === i));
    }

    function closeSub(lv) {
      if (!lv.child) return;
      closeSub(lv.child);
      P.pop.drop(lv.child.el);
      levels.splice(levels.indexOf(lv.child), 1);
      lv.child = null;
    }

    function openSub(lv, i) {
      const row = lv.rows[i];
      if (lv.child && lv.child.owner === i) return;
      closeSub(lv);
      const list = val(row.it.items) || [];
      const child = makeLevel(list);
      child.owner = i;
      P.pop.add(child.el);
      levels.push(child);
      lv.child = child;
      const r = row.b.getBoundingClientRect();
      const w = child.el.offsetWidth;
      let x = r.right - 4;
      if (x + w > window.innerWidth - 8) x = r.left - w + 4;
      P.pop.place(child.el, { x, y: r.top - 7 });
      return child;
    }

    function activate(lv, i) {
      const row = lv.rows[i];
      if (!row || row.dis) return;
      if (row.hasSub && !row.it.action) { openSub(lv, i); return; }
      P.pop.close();
      if (row.it.action) {
        try {
          const r = row.it.action();
          if (r && typeof r.catch === 'function') r.catch((err) => P.toast('Erreur : ' + (err && err.message ? err.message : err), 5000));
        } catch (err) { P.toast('Erreur : ' + (err && err.message ? err.message : err), 5000); }
      }
    }

    const move = (lv, dir) => {
      const n = lv.rows.length;
      if (!n) return;
      let i = lv.hl < 0 && dir < 0 ? 0 : lv.hl;
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (!lv.rows[i].dis) { setHl(lv, i); lv.rows[i].b.scrollIntoView({ block: 'nearest' }); return; }
      }
    };

    function onKey(e) {
      const lv = levels[levels.length - 1];
      if (!lv) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); move(lv, 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(lv, -1); }
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const row = lv.rows[lv.hl];
        if (row && row.hasSub && !row.dis) { const c = openSub(lv, lv.hl); if (c) move(c, 1); }
        else if (opts.onRight) opts.onRight();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (levels.length > 1) { const parent = levels[levels.length - 2]; closeSub(parent); }
        else if (opts.onLeft) opts.onLeft();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (lv.hl >= 0) { e.preventDefault(); e.stopPropagation(); activate(lv, lv.hl); }
      }
    }

    const root = makeLevel(items);
    levels.push(root);
    P.pop.open(root.el, { anchor: opts.anchor, align: opts.align, x: opts.x, y: opts.y, onClose: opts.onClose, onKey });
    return root.el;
  }

  /* ---------- Outils pour les définitions ---------- */
  const fmt = (cmd, css) => () => P.exec(cmd, null, css);
  const act = (name) => () => { const f = P.actions[name]; if (f) f(); };
  const toEditor = () => { const a = document.activeElement; if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) P.restoreSel(); };
  const clip = (cmd) => () => { toEditor(); try { native.editCmd(cmd); } catch (_) { /* ignoré */ } };

  function stats() {
    const text = ed.innerText || '';
    const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    const noSpace = text.replace(/\s/g, '').length;
    const paras = Array.from(ed.querySelectorAll('p, h1, h2, h3, li, blockquote, td, th')).filter((n) => n.textContent.trim()).length;
    const pages = state.pageless ? '—' : String(P.pageCount());
    P.modal({
      title: 'Statistiques du document',
      message: [`Mots : ${words}`, `Caractères (avec espaces) : ${text.replace(/\n/g, '').length}`, `Caractères (sans espaces) : ${noSpace}`,
        `Paragraphes et éléments de liste : ${paras}`, `Pages : ${pages}`,
        `Commentaires ouverts : ${P.openCommentCount()}`, `Suggestions en attente : ${P.suggestionCount()}`].join('\n'),
      buttons: [{ id: 'ok', label: 'Fermer', primary: true }],
    });
  }

  const recentItems = () => {
    const list = (P.home && P.home.recents()) || [];
    const items = list.slice(0, 8).map((r) => ({ label: r.title || 'Sans titre', action: () => A().openRecent(r.path) }));
    if (!items.length) items.push({ label: 'Aucun document récent', disabled: true });
    items.push('-', { label: 'Afficher tous les documents récents', action: () => A().goHome() });
    return items;
  };

  /* ---------- Définition des menus ---------- */
  const MENUS = [
    { label: 'Fichier', items: () => [
      { label: 'Nouveau document', hint: 'Ctrl+N', icon: 'i-doc', action: () => A().newDoc() },
      { label: 'Nouveau à partir d’un modèle…', action: () => { A().goHome(); if (P.home) P.home.showTemplates(); } },
      { label: 'Ouvrir…', hint: 'Ctrl+O', icon: 'i-folder', action: () => A().openDoc() },
      { label: 'Ouvrir un document récent', items: recentItems },
      '-',
      { label: 'Enregistrer', hint: 'Ctrl+S', icon: 'i-save', action: () => A().save(false) },
      ...(A().canCloud && A().canCloud() && !(A().isCloud && A().isCloud()) ? [{ label: 'Enregistrer en ligne', icon: 'i-cloud', action: () => A().saveOnline() }] : []),
      { label: A().isCloud && A().isCloud() ? 'Enregistrer une copie sur l’ordinateur…' : 'Enregistrer sous…', hint: 'F12', action: () => A().save(true) },
      '-',
      { label: 'Télécharger', items: [
        { label: 'Microsoft Word (.docx)', action: () => A().exportDocx() },
        { label: 'Document PDF (.pdf)', action: () => A().exportPdf() },
        { label: 'Page Web (.html)', action: () => A().exportHtml() },
        { label: 'Markdown (.md)', action: () => A().exportMd() },
      ] },
      { label: 'Historique des versions', icon: 'i-history', items: [
        { label: 'Nommer la version actuelle…', disabled: ro, action: () => P.nameVersion() },
        { label: 'Afficher l’historique des versions', action: () => P.showPanel('versions') },
      ] },
      '-',
      ...(A().canCloud && P.sync && P.sync.account.configured ? [{ label: 'Partager…', icon: 'i-person-plus', action: () => P.share && P.share.open() }, '-'] : []),
      { label: 'Protéger par mot de passe…', icon: 'i-lock', action: () => A().setPassword() },
      { label: 'Imprimer', hint: 'Ctrl+P', icon: 'i-print', action: () => A().print() },
      '-',
      { label: 'Fermer l’onglet', hint: 'Ctrl+W', action: () => A().closeActive() },
    ] },
    { label: 'Édition', items: () => [
      { label: 'Annuler', hint: 'Ctrl+Z', icon: 'i-undo', disabled: ro, action: fmt('undo') },
      { label: 'Rétablir', hint: 'Ctrl+Y', icon: 'i-redo', disabled: ro, action: fmt('redo') },
      '-',
      { label: 'Couper', hint: 'Ctrl+X', disabled: ro, action: clip('cut') },
      { label: 'Copier', hint: 'Ctrl+C', action: clip('copy') },
      { label: 'Coller', hint: 'Ctrl+V', disabled: ro, action: clip('paste') },
      { label: 'Tout sélectionner', hint: 'Ctrl+A', action: clip('selectAll') },
      '-',
      { label: 'Rechercher et remplacer…', hint: 'Ctrl+H', icon: 'i-search', action: () => P.openFind() },
    ] },
    { label: 'Affichage', items: () => [
      { label: 'Mode', items: Object.keys(A().MODES).map((k) => ({ label: A().MODES[k].label, icon: A().MODES[k].icon, checked: () => state.mode === k, action: () => A().setMode(k) })) },
      '-',
      { label: 'Mode sans pages', checked: () => state.pageless, action: () => A().togglePageless() },
      { label: 'Afficher le plan du document', icon: 'i-outline', checked: () => C().get('outline'), action: () => C().set('outline', !C().get('outline')) },
      { label: 'Repères de saut de page', checked: () => C().get('pageGuides'), action: () => C().set('pageGuides', !C().get('pageGuides')) },
      '-',
      { label: 'Zoom', items: [50, 75, 90, 100, 125, 150, 200].map((z) => ({ label: z + ' %', checked: () => C().get('pageZoom') === z, action: () => C().set('pageZoom', z) })) },
      '-',
      { label: 'Mode concentration', hint: 'Ctrl+Alt+C', desc: 'Masque tout sauf la page, avec le temps de lecture', checked: () => P.focus.isOn(), action: () => P.focus.toggle() },
      { label: 'Mode compact', hint: 'Ctrl+Maj+F', checked: () => C().get('compact'), action: () => C().set('compact', !C().get('compact')) },
      { label: 'Plein écran', hint: 'F11', icon: 'i-fullscreen', action: () => A().toggleFullscreen() },
    ] },
    { label: 'Insertion', items: () => [
      { label: 'Image…', icon: 'i-image', disabled: ro, action: act('image') },
      { label: 'Tableau…', icon: 'i-table', disabled: ro, action: act('table') },
      { label: 'Ligne horizontale', icon: 'i-hr', disabled: ro, action: act('hr') },
      { label: 'Saut de page', icon: 'i-pagebreak', disabled: ro, action: act('pagebreak') },
      '-',
      { label: 'Lien…', hint: 'Ctrl+K', icon: 'i-link', disabled: ro, action: act('link') },
      { label: 'Commentaire', hint: 'Ctrl+Alt+M', icon: 'i-comment', disabled: ro, action: act('comment') },
      { label: 'Liste de tâches', icon: 'i-checklist', disabled: ro, action: act('checklist') },
      { label: 'Encadré', disabled: ro, items: P.CALLOUTS.map((c) => ({ label: c.label, disabled: ro, checked: () => P.calloutKind() === c.kind, action: () => P.insertCallout(c.kind) })) },
      { label: 'Sommaire', hint: 'Automatique', disabled: ro, action: act('toc') },
      '-',
      { label: 'Puces intelligentes et blocs', hint: '@', icon: 'i-at', disabled: ro, action: act('at') },
      { label: 'Remplir les champs…', disabled: () => ro() || !Object.keys(state.variables).length, action: act('fields') },
    ] },
    { label: 'Format', items: () => [
      { label: 'Texte', items: [
        { label: 'Gras', hint: 'Ctrl+B', icon: 'i-bold', disabled: ro, action: fmt('bold') },
        { label: 'Italique', hint: 'Ctrl+I', icon: 'i-italic', disabled: ro, action: fmt('italic') },
        { label: 'Souligné', hint: 'Ctrl+U', icon: 'i-underline', disabled: ro, action: fmt('underline') },
        { label: 'Barré', icon: 'i-strike', disabled: ro, action: fmt('strikeThrough') },
        { label: 'Exposant', disabled: ro, action: fmt('superscript') },
        { label: 'Indice', disabled: ro, action: fmt('subscript') },
      ] },
      { label: 'Styles de paragraphe', items: () => P.styles.menuItems() },
      { label: 'Aligner', items: [['justifyLeft', 'À gauche', 'i-al-left'], ['justifyCenter', 'Au centre', 'i-al-center'], ['justifyRight', 'À droite', 'i-al-right'], ['justifyFull', 'Justifié', 'i-al-justify']]
        .map(([c, l, i]) => ({ label: l, icon: i, disabled: ro, action: fmt(c, true) })) },
      { label: 'Listes', items: [
        { label: 'Liste à puces', icon: 'i-list-bullet', disabled: ro, action: fmt('insertUnorderedList') },
        { label: 'Liste numérotée', icon: 'i-list-number', disabled: ro, action: fmt('insertOrderedList') },
        { label: 'Liste de tâches', icon: 'i-checklist', disabled: ro, action: act('checklist') },
      ] },
      { label: 'Augmenter le retrait', icon: 'i-indent-inc', disabled: ro, action: fmt('indent') },
      { label: 'Diminuer le retrait', icon: 'i-indent-dec', disabled: ro, action: fmt('outdent') },
      '-',
      { label: 'Tableau', icon: 'i-table', disabled: () => ro() || !P.inTable(), items: () => P.tables.menuItems() },
      { label: 'Image', icon: 'i-image', disabled: () => ro() || !(P.images && P.images.selected()), items: () => P.images.menuItems() },
      '-',
      { label: 'Effacer la mise en forme', hint: 'Ctrl+\\', icon: 'i-clear', disabled: ro, action: fmt('removeFormat') },
    ] },
    { label: 'Outils', items: () => [
      { label: 'Palette de commandes…', hint: 'Ctrl+Maj+P', icon: 'i-search', action: () => P.palette.open() },
      '-',
      { label: 'Orthographe et grammaire', icon: 'i-spell', items: () => [
        { label: 'Vérification de l’orthographe…', icon: 'i-spell', hint: 'Ctrl+Alt+X', action: () => P.actions.spellcard() },
        { label: 'Correcteur orthographique pendant la frappe', checked: () => C().get('spell'), action: () => C().set('spell', !C().get('spell')) },
      ] },
      { label: 'Nombre de mots', hint: 'Ctrl+Maj+C', icon: 'i-info', action: () => P.tools.wordCount() },
      { label: 'Rechercher et remplacer…', hint: 'Ctrl+H', icon: 'i-search', action: () => P.openFind() },
      '-',
      { label: 'Réviser les suggestions', icon: 'i-suggest', action: () => P.showPanel('suggestions') },
      { label: 'Définir', hint: 'Ctrl+Maj+Y', desc: 'Ouvre la définition du mot sélectionné (Wiktionnaire)', action: () => P.tools.define() },
      '-',
      { label: 'Saisie vocale', hint: 'Ctrl+Maj+S', icon: 'i-mic', desc: 'Dicter du texte au micro (Chrome, Edge ou Safari)', checked: () => P.tools.isVoiceOpen(), disabled: ro, action: () => P.tools.toggleVoice() },
      '-',
      { label: 'Assistant IA', icon: 'i-sparkle', items: () => P.ai.ui.docItems() },
      { label: 'Vérifier les données sensibles', icon: 'i-shield', action: act('dlp') },
      '-',
      { label: 'Paramètres…', icon: 'i-settings', action: () => C().openDialog('appearance') },
    ] },
    { label: 'Extensions', items: () => [
      { label: 'Variables du document…', action: () => P.showPanel('variables') },
      { label: 'Données sensibles (détection)', icon: 'i-shield', action: act('dlp') },
      '-',
      { label: 'Modules complémentaires : pas disponibles', disabled: true },
    ] },
    { label: 'Aide', items: () => [
      { label: 'Raccourcis clavier', hint: 'Ctrl+/', icon: 'i-keyboard', action: () => C().openDialog('shortcuts') },
      { label: 'Paramètres…', icon: 'i-settings', action: () => C().openDialog('appearance') },
      ...(typeof native !== 'undefined' && native.install && native.install.available()
        ? [{ label: 'Installer Plume comme application…', icon: 'i-monitor', action: () => native.install.prompt() }] : []),
      '-',
      { label: 'À propos de Plume', icon: 'i-info', action: () => C().openDialog('about') },
    ] },
  ];

  /* ---------- Barre de menus ---------- */
  function initBar() {
    const bar = $('#menubar');
    const buttons = [];
    let openIdx = -1;

    function show(i) {
      const b = buttons[i];
      openIdx = i;
      buttons.forEach((x) => x.classList.remove('open'));
      open(MENUS[i].items(), {
        anchor: b, align: 'left',
        onClose: () => { b.classList.remove('open'); if (openIdx === i) openIdx = -1; },
        onLeft: () => show((i + buttons.length - 1) % buttons.length),
        onRight: () => show((i + 1) % buttons.length),
      });
      b.classList.add('open');
    }

    MENUS.forEach((m, i) => {
      const b = h('button', { type: 'button', class: 'mb-item', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': 'false', text: m.label });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { if (P.pop.isOpen() && P.pop.anchor() === b) P.pop.close(); else show(i); });
      b.addEventListener('mouseenter', () => { if (openIdx >= 0 && openIdx !== i) show(i); });
      buttons.push(b);
      bar.append(b);
    });
  }

  P.menu = { open, initBar, MENUS };
})();
