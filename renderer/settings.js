/* Plume — paramètres (thème sombre, accent, zoom, correcteur…), carte de profil et fenêtre « Paramètres ». */
(function () {
  'use strict';
  const { h } = P;
  const KEY = 'plume.settings';
  const root = document.documentElement;
  const nat = () => (typeof native !== 'undefined' ? native : null);

  /* ---------- Raccourcis (aussi affichés dans les menus et dans l'aide) ---------- */
  P.SHORTCUTS = [
    ['Fichier', [
      ['Nouveau document', 'Ctrl+N'], ['Ouvrir…', 'Ctrl+O'], ['Enregistrer', 'Ctrl+S'], ['Enregistrer sous…', 'Ctrl+Maj+S'],
      ['Imprimer', 'Ctrl+P'], ['Fermer l’onglet', 'Ctrl+W'], ['Onglet suivant / précédent', 'Ctrl+Tab · Ctrl+Maj+Tab'], ['Accueil', 'Alt+Début'],
    ]],
    ['Mise en forme', [
      ['Gras · Italique · Souligné', 'Ctrl+B · Ctrl+I · Ctrl+U'], ['Insérer un lien', 'Ctrl+K'], ['Effacer la mise en forme', 'Ctrl+\\'],
      ['Annuler · Rétablir', 'Ctrl+Z · Ctrl+Y'], ['Commenter la sélection', 'Ctrl+Alt+M'], ['Vérification de l’orthographe', 'Ctrl+Alt+X'], ['Demander à l’IA', 'Ctrl+Alt+J'], ['Puces intelligentes, champs et blocs', '@'],
      ['Titres, listes, encadrés, tableau… (début d’une ligne vide)', '/'], ['Coller sans la mise en forme', 'Ctrl+Maj+V'], ['Menu contextuel', 'Clic droit · Maj+F10'],
    ]],
    ['Affichage', [
      ['Rechercher et remplacer', 'Ctrl+F · Ctrl+H'], ['Zoom de la page', 'Ctrl++ · Ctrl+− · Ctrl+0'], ['Mode compact', 'Ctrl+Maj+F'],
      ['Plein écran', 'F11'], ['Mode concentration', 'Ctrl+Maj+C · Échap pour quitter'], ['Palette de commandes', 'Ctrl+Maj+P'], ['Raccourcis clavier', 'Ctrl+/'],
    ]],
  ];

  /* ---------- Définition des paramètres ---------- */
  const SCHEMA = [
    { key: 'theme', section: 'appearance', grp: 'Thème et couleurs', quick: true, type: 'appearance', label: 'Thème', def: 'system',
      options: [['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système']] },
    { key: 'pageLight', section: 'appearance', grp: 'Thème et couleurs', quick: true, type: 'toggle', def: false, label: 'Page toujours blanche',
      desc: 'En thème sombre, garde la feuille du document blanche (aspect papier).' },
    { key: 'accent', section: 'appearance', grp: 'Thème et couleurs', quick: true, type: 'swatch', def: 'blue', label: 'Couleur d’accent',
      options: [['blue', 'Bleu'], ['purple', 'Violet'], ['pink', 'Rose'], ['red', 'Rouge'], ['orange', 'Orange'], ['green', 'Vert'], ['graphite', 'Graphite']] },
    { key: 'uiZoom', section: 'appearance', grp: 'Interface', quick: true, type: 'stepper', def: 100, label: 'Taille de l’interface',
      options: [80, 90, 100, 110, 125, 150], fmt: (v) => v + ' %' },
    { key: 'compact', section: 'appearance', grp: 'Interface', quick: true, type: 'toggle', def: false, label: 'Mode compact',
      desc: 'Masque les menus et la barre d’outils (Ctrl+Maj+F).' },
    { key: 'outline', section: 'appearance', grp: 'Interface', quick: true, type: 'toggle', def: true, label: 'Plan du document',
      desc: 'Affiche la liste des titres à gauche du document.' },
    { key: 'selBar', section: 'edit', grp: 'Édition', type: 'toggle', def: true, label: 'Pastille d’actions sous la sélection',
      desc: 'Mise en forme rapide, commentaire et émoji juste sous le texte sélectionné.' },
    { key: 'aiOn', section: 'ai', hidden: true, type: 'toggle', def: false, label: 'Assistant IA' },
    { key: 'aiProvider', section: 'ai', hidden: true, type: 'select', def: 'claude', label: 'Fournisseur d’IA',
      options: [['claude', 'Claude (Anthropic)'], ['gemini', 'Google Gemini']] },
    { key: 'aiGeminiOk', section: 'ai', hidden: true, type: 'toggle', def: false, label: 'Palier gratuit de Google compris' },
    { key: 'aiModel', section: 'ai', prov: 'claude', grp: 'Modèle', type: 'select', def: 'claude-sonnet-5-5', label: 'Modèle de Claude',
      options: [['claude-sonnet-5-5', 'Sonnet 5.5 : équilibré (recommandé)'], ['claude-haiku-5-5', 'Haiku 5.5 : rapide et économique'], ['claude-opus-5-5', 'Opus 5.5 : le plus puissant']] },
    { key: 'aiModelGemini', section: 'ai', prov: 'gemini', grp: 'Modèle', type: 'select', def: 'gemini-3.5-flash', label: 'Modèle Gemini',
      desc: 'Si un modèle n’est plus offert gratuitement ou est saturé, essayez-en un autre.',
      options: [['gemini-3.5-flash', '3.5 Flash : rapide et récent (recommandé)'], ['gemini-2.5-flash', '2.5 Flash : rapide et éprouvé'], ['gemini-3.1-flash-lite', '3.1 Flash-Lite : le plus léger'], ['gemini-2.5-pro', '2.5 Pro : le plus capable, plus lent']] },
    { key: 'aiDlp', section: 'ai', grp: 'Confidentialité', type: 'toggle', def: true, label: 'Vérifier les données sensibles avant l’envoi',
      desc: 'Prévient si le texte contient un numéro de carte, un NAS, un IBAN… et demande confirmation avant de l’envoyer.' },
    { key: 'aiNoEncrypted', section: 'ai', grp: 'Confidentialité', type: 'toggle', def: true, label: 'Ne jamais envoyer un document chiffré',
      desc: 'Bloque l’IA dans les documents protégés par un mot de passe.' },
    { key: 'aiSelbar', section: 'ai', grp: 'Où l’IA apparaît', type: 'toggle', def: true, label: 'Bouton ✦ sous la sélection',
      desc: 'Ajoute l’IA à la pastille d’actions affichée sous le texte sélectionné.' },
    { key: 'cursorOn', section: 'appearance', grp: 'Curseur', type: 'toggle', def: true, label: 'Curseur personnalisé',
      desc: 'Flèche, main, curseur de texte, roue d’attente… dessinés dans le style macOS, à l’intérieur de Plume.' },
    { key: 'cursorSize', section: 'appearance', grp: 'Curseur', type: 'stepper', def: 32, label: 'Taille du curseur',
      options: [20, 24, 28, 32, 40, 48, 56, 64], fmt: (v) => v + ' px' },
    { key: 'cursorColor', section: 'appearance', grp: 'Curseur', type: 'swatch', def: 'black', label: 'Couleur du curseur',
      options: [['black', 'Noir'], ['white', 'Blanc'], ['graphite', 'Graphite'], ['blue', 'Bleu'], ['purple', 'Violet'], ['pink', 'Rose'], ['red', 'Rouge'], ['orange', 'Orange'], ['green', 'Vert'], ['accent', 'Couleur d’accent']] },
    { key: 'cursorPreview', section: 'appearance', grp: 'Curseur', type: 'cursors', label: 'Aperçu' },
    { key: 'focusDim', section: 'appearance', grp: 'Mode concentration', type: 'toggle', def: true, label: 'Estomper les autres paragraphes',
      desc: 'En mode concentration (Ctrl+Maj+C), seul le paragraphe en cours reste bien visible.' },
    { key: 'wordCount', section: 'appearance', grp: 'Interface', type: 'toggle', def: true, label: 'Compteur de mots', desc: 'Dans la barre d’état, en bas de la fenêtre.' },
    { key: 'pageZoom', section: 'appearance', grp: 'Document', type: 'select', def: 100, label: 'Zoom des pages',
      desc: 'Niveau de zoom appliqué au document (aussi réglable dans la barre d’outils).',
      options: [[50, '50 %'], [75, '75 %'], [90, '90 %'], [100, '100 %'], [125, '125 %'], [150, '150 %'], [200, '200 %']] },
    { key: 'pageGuides', section: 'appearance', grp: 'Document', type: 'toggle', def: true, label: 'Repères de saut de page',
      desc: 'Trait fin tous les 11 po pour repérer où une page se termine.' },

    { key: 'spell', section: 'edit', grp: 'Orthographe', quick: true, type: 'toggle', def: true, label: 'Correcteur orthographique' },
    { key: 'spellLang', section: 'edit', grp: 'Orthographe', quick: true, type: 'select', def: 'both', label: 'Langue du correcteur',
      desc: 'Dictionnaires intégrés : aucune connexion Internet nécessaire. Un clic sur un mot souligné propose la correction.',
      options: [['both', 'Français et anglais'], ['fr', 'Français'], ['en', 'Anglais']] },
    { key: 'openMode', section: 'edit', grp: 'Ouverture', type: 'select', def: 'edit', label: 'Mode à l’ouverture d’un fichier',
      desc: 'Choisissez « Lecture seule » pour éviter de modifier un document par accident.',
      options: [['edit', 'Édition'], ['view', 'Lecture seule']] },

    { key: 'autoRecovery', section: 'files', grp: 'Sauvegarde', quick: true, type: 'toggle', def: true, label: 'Récupération automatique',
      desc: 'Copie de secours toutes les 5 s en cas de fermeture imprévue (jamais pour un document chiffré).' },
    { key: 'autoVersions', section: 'files', grp: 'Sauvegarde', quick: true, type: 'toggle', def: true, label: 'Versions automatiques',
      desc: 'Une version toutes les 10 minutes si le document a changé.' },

    { key: 'homeView', hidden: true, type: 'select', def: 'grid', options: [['grid', ''], ['list', '']] },
    { key: 'homeSort', hidden: true, type: 'select', def: 'recent', options: [['recent', ''], ['title', '']] },
    { key: 'tplOpen', hidden: true, type: 'toggle', def: false },
  ];
  const optVals = (d) => (d.options || []).map((o) => (Array.isArray(o) ? o[0] : o));
  const valid = (d, v) => (d.type === 'toggle' ? typeof v === 'boolean' : optVals(d).some((x) => x === v));

  const S = {};
  const listeners = new Set();

  function load() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { stored = {}; }
    for (const d of SCHEMA) S[d.key] = valid(d, stored[d.key]) ? stored[d.key] : d.def;
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) { /* stockage indisponible */ } }

  /* ---------- Application ---------- */
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const resolvedTheme = () => (S.theme === 'system' ? (mq.matches ? 'dark' : 'light') : S.theme);

  function syncOverlay() {
    const n = nat();
    if (!n || !n.setTheme) return;
    const cs = getComputedStyle(root);
    const v = (name) => cs.getPropertyValue(name).trim();
    try { n.setTheme({ color: v('--frame'), symbol: v('--overlay-symbol'), bg: v('--bg') }); } catch (_) { /* ignoré */ }
  }

  const APPLY = {
    theme() { root.dataset.theme = resolvedTheme(); syncOverlay(); },
    accent() { root.dataset.accent = S.accent; if (P.cursors && S.cursorColor === 'accent') P.cursors.refresh(); },
    aiSelbar() { if (P.selbar) P.selbar.refresh(); },
    cursorOn() { if (P.cursors) P.cursors.refresh(); },
    cursorSize() { if (P.cursors) P.cursors.refresh(); },
    cursorColor() { if (P.cursors) P.cursors.refresh(); },
    pageLight() { document.body.classList.toggle('page-light', S.pageLight); },
    uiZoom() { const n = nat(); if (n && n.setUiZoom) n.setUiZoom(S.uiZoom / 100); },
    compact() { document.body.classList.toggle('compact', S.compact); },
    outline() { if (P.app && P.app.syncOutline) P.app.syncOutline(); },
    pageZoom() { root.style.setProperty('--pz', String(S.pageZoom / 100)); const z = P.$('#tb-zoom'); if (z) z.value = String(S.pageZoom); },
    pageGuides() { document.body.classList.toggle('noguides', !S.pageGuides); },
    wordCount() { document.body.classList.toggle('nocount', !S.wordCount); },
    spell() { P.editor.spellcheck = false; const b = P.$('#tb-spell'); if (b) b.classList.toggle('on', S.spell); if (P.spell) P.spell.refresh(); },
    spellLang() { if (P.spell) P.spell.refresh(); },
  };

  function set(key, value) {
    const d = SCHEMA.find((x) => x.key === key);
    if (!d || !valid(d, value) || S[key] === value) return false;
    S[key] = value;
    persist();
    if (APPLY[key]) APPLY[key]();
    listeners.forEach((fn) => fn(key, value));
    return true;
  }

  function reset() {
    for (const d of SCHEMA) S[d.key] = d.def;
    persist();
    Object.keys(APPLY).forEach((k) => APPLY[k]());
    listeners.forEach((fn) => fn('*'));
  }

  P.settings = {
    SCHEMA,
    get: (k) => S[k],
    set,
    reset,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    applyAll() { Object.keys(APPLY).forEach((k) => APPLY[k]()); },
    resolvedTheme,
  };
  load();
  mq.addEventListener('change', () => { if (S.theme === 'system') APPLY.theme(); });

  /* ---------- Avatar ---------- */
  P.initials = (name) => (String(name || '').trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  P.avatarColor = (name) => {
    let n = 0;
    for (const ch of String(name || '?')) n = (n * 31 + ch.codePointAt(0)) % 360;
    return `linear-gradient(160deg, hsl(${n} 62% 62%), hsl(${n} 58% 44%))`;
  };
  P.paintAvatars = () => {
    const name = P.state.author;
    P.$$('.avatar, .pc-avatar').forEach((el) => {
      el.textContent = P.initials(name);
      el.style.background = P.avatarColor(name);
    });
  };

  /* ---------- Éléments d'interface réutilisables ---------- */
  function bind(el, key, update) {
    update();
    const fn = (k) => {
      if (!el.isConnected) { listeners.delete(fn); return; }
      if (k === key || k === '*') update();
    };
    listeners.add(fn);
  }

  function control(d) {
    const label = d.label || '';
    if (d.type === 'toggle') {
      const b = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-label': label, onclick: () => set(d.key, !S[d.key]) });
      bind(b, d.key, () => b.setAttribute('aria-checked', String(!!S[d.key])));
      return b;
    }
    if (d.type === 'segment') {
      const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      const btns = d.options.map(([v, text, icon]) => {
        const b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => set(d.key, v) },
          icon ? svgIcon(icon) : null, text);
        b.dataset.v = String(v);
        wrap.append(b);
        return b;
      });
      bind(wrap, d.key, () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(S[d.key])))));
      return wrap;
    }
    if (d.type === 'appearance') {
      const wrap = h('div', { class: 'appear', role: 'group', 'aria-label': label });
      const btns = d.options.map(([v, text]) => {
        const b = h('button', { type: 'button', class: 'ap-tile', 'aria-pressed': 'false', onclick: () => set(d.key, v) },
          h('span', { class: 'ap-prev' }), h('span', { class: 'ap-label', text }));
        b.firstChild.dataset.k = v;
        b.dataset.v = String(v);
        wrap.append(b);
        return b;
      });
      bind(wrap, d.key, () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(S[d.key])))));
      return wrap;
    }
    if (d.type === 'swatch') {
      const wrap = h('div', { class: 'swatches', role: 'group', 'aria-label': label });
      const btns = d.options.map(([v, text]) => {
        const b = h('button', { type: 'button', class: 'sw', title: text, 'aria-label': text, 'aria-pressed': 'false', onclick: () => set(d.key, v) });
        b.dataset.c = v;
        wrap.append(b);
        return b;
      });
      bind(wrap, d.key, () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === S[d.key]))));
      return wrap;
    }
    if (d.type === 'cursors') {
      const wrap = h('div', { class: 'cur-prev', role: 'img', 'aria-label': 'Aperçu des curseurs' });
      const fill = () => { if (P.cursors) P.cursors.preview(wrap); };
      ['cursorColor', 'cursorSize', 'cursorOn'].forEach((k) => bind(wrap, k, fill));
      return wrap;
    }
    if (d.type === 'stepper') {
      const out = h('output', { 'aria-live': 'polite' });
      const step = (dir) => {
        const list = d.options;
        const i = Math.max(0, Math.min(list.length - 1, list.indexOf(S[d.key]) + dir));
        set(d.key, list[i]);
      };
      const wrap = h('div', { class: 'stepper' },
        h('button', { type: 'button', title: 'Réduire', 'aria-label': 'Réduire ' + label, onclick: () => step(-1) }, svgIcon('i-minus', 'sm')),
        out,
        h('button', { type: 'button', title: 'Augmenter', 'aria-label': 'Augmenter ' + label, onclick: () => step(1) }, svgIcon('i-plus', 'sm')));
      bind(wrap, d.key, () => { out.textContent = d.fmt ? d.fmt(S[d.key]) : String(S[d.key]); });
      return wrap;
    }
    // select
    const sel = h('select', { 'aria-label': label },
      d.options.map(([v, text]) => h('option', { value: String(v), text })));
    sel.addEventListener('change', () => {
      const found = d.options.find(([v]) => String(v) === sel.value);
      if (found) set(d.key, found[0]);
    });
    bind(sel, d.key, () => { sel.value = String(S[d.key]); });
    return sel;
  }

  function svgIcon(id, size) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'ic' + (size ? ' ' + size : ''));
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', '#' + id);
    svg.append(use);
    return svg;
  }
  P.svgIcon = svgIcon;

  const rowOf = (d, cls) => h('div', { class: cls + (d.type === 'appearance' || d.type === 'cursors' ? ' stack' : '') }, h('div', { class: 'lbl' }, d.label, d.desc && cls === 'set-row' ? h('span', { class: 'desc', text: d.desc }) : null), control(d));

  /* ---------- Carte de profil (paramètres rapides) ---------- */
  P.settings.openProfile = function (anchor) {
    if (P.pop.isOpen() && P.pop.anchor() === anchor) { P.pop.close(); return; }
    const section = (title, keys) => {
      const box = h('div', { class: 'group' });
      SCHEMA.filter((d) => d.quick && d.section === keys).forEach((d) => box.append(rowOf(d, 'row')));
      return h('div', { class: 'pc-sec' }, h('h4', { text: title }), box);
    };
    const card = h('div', { class: 'pop-card', role: 'dialog', 'aria-label': 'Compte et paramètres' },
      h('div', { class: 'pc-head' },
        h('div', { class: 'pc-avatar' }),
        h('div', { class: 'pc-who' },
          h('div', { class: 'pc-name', text: P.state.author || 'Moi' }),
          h('div', { class: 'pc-sub', text: 'Compte local · vos données restent sur cet ordinateur' })),
        h('button', { type: 'button', class: 'chipbtn', text: 'Modifier le nom', onclick: () => { P.pop.close(); P.app.askAuthor(false); } })),
      section('Apparence', 'appearance'),
      section('Édition', 'edit'),
      section('Fichiers et données', 'files'),
      h('div', { class: 'pc-foot' },
        h('button', { type: 'button', class: 'chipbtn', onclick: () => { P.pop.close(); P.settings.openDialog('appearance'); } }, svgIcon('i-settings', 'sm'), 'Tous les paramètres'),
        h('button', { type: 'button', class: 'chipbtn', onclick: () => { P.pop.close(); P.settings.openDialog('shortcuts'); } }, svgIcon('i-keyboard', 'sm'), 'Raccourcis'),
        h('button', { type: 'button', class: 'chipbtn', onclick: () => { P.pop.close(); P.settings.openDialog('about'); } }, svgIcon('i-info', 'sm'), 'À propos')));
    P.pop.open(card, { anchor, align: 'right' });
    P.paintAvatars();
  };

  /* ---------- Section « Intelligence artificielle » : fournisseur, activation, clé API, essai de connexion ---------- */
  function aiTop(body) {
    const nt = nat();
    const pv = S.aiProvider === 'gemini' ? 'gemini' : 'claude';
    const gem = pv === 'gemini';
    const svc = gem ? 'Google Gemini' : 'Claude';
    const host = gem ? 'generativelanguage.googleapis.com' : 'api.anthropic.com';
    body.append(h('p', { class: 'lead', text: 'Plume peut vous aider à écrire : corriger, reformuler, résumer, proposer des idées, répondre à vos questions sur le document. Cela passe par l’API de Claude (Anthropic) ou de Google Gemini, au choix, avec votre propre clé : Plume n’a ni abonnement ni serveur et ne garde aucun échange.' }));

    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Fournisseur d’IA' });
    [['claude', 'Claude'], ['gemini', 'Google Gemini']].forEach(([v, text]) => {
      const b = h('button', { type: 'button', 'aria-pressed': String(v === pv), onclick: () => { if (set('aiProvider', v)) renderSection('ai', body); } }, text);
      b.dataset.v = v;
      seg.append(b);
    });
    body.append(h('div', { class: 'set-cap', text: 'Fournisseur' }), h('div', { class: 'set-group' },
      h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Service d’IA', h('span', { class: 'desc', text: gem ? 'Clé gratuite possible (Google AI Studio), avec des limites d’usage.' : 'Clé payante à l’usage (console Anthropic).' })), seg)));

    if (gem) {
      body.append(h('div', { class: 'ai-priv ai-warn' }, svgIcon('i-info'), h('div', {},
        h('b', { text: 'À savoir sur la clé gratuite de Google' }),
        h('p', { text: 'D’après Google, avec le palier gratuit, le contenu envoyé peut servir à améliorer ses produits ; ce n’est pas le cas avec un compte payant. Évitez d’y envoyer des informations confidentielles ou privées. Les limites d’usage gratuites (demandes par minute et par jour) sont fixées par Google, peuvent changer et peuvent être atteintes : un message vous l’indiquera.' }))));
    }
    body.append(h('div', { class: 'ai-priv' }, svgIcon('i-shield'), h('div', {},
      h('b', { text: 'Ce qui est envoyé' }),
      h('p', { text: 'Uniquement le texte concerné par l’action que vous lancez (la sélection ; le document entier pour le panneau Assistant et la relecture) et votre consigne, à ' + host + '. Jamais votre nom ni aucune autre donnée. Rien ne part tant que vous ne lancez pas une action d’IA.' }))));

    const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-label': 'Activer l’assistant IA' });
    bind(sw, 'aiOn', () => sw.setAttribute('aria-checked', String(!!S.aiOn)));
    sw.addEventListener('click', async () => {
      if (S.aiOn) { set('aiOn', false); return; }
      const r = await P.modal({ title: 'Activer l’assistant IA ?', message: 'Quand vous lancerez une action d’IA (améliorer, corriger, résumer, Assistant…), le texte concerné et votre consigne seront envoyés à l’API de ' + svc + ' (' + host + ') avec votre clé. Votre nom n’est jamais envoyé. Vous pouvez la désactiver à tout moment.', ok: 'Activer' });
      if (r) set('aiOn', true);
    });

    const state = h('span', { class: 'ai-keystate', role: 'status' });
    const input = h('input', { type: 'password', placeholder: gem ? 'AIza…' : 'sk-ant-…', autocomplete: 'off', spellcheck: 'false', 'aria-label': gem ? 'Clé API Google' : 'Clé API Claude' });
    const del = h('button', { type: 'button', class: 'chipbtn', text: 'Supprimer', hidden: true });
    const save = h('button', { type: 'button', class: 'chipbtn', text: 'Enregistrer' });
    const test = h('button', { type: 'button', class: 'chipbtn', text: 'Tester la connexion' });
    const note = h('div', { class: 'ai-keynote' });
    const refresh = async () => {
      let st = null;
      try { st = nt && nt.ai ? await nt.ai.status(pv) : null; } catch (_) { st = null; }
      if (!st) { state.textContent = 'IA indisponible ici.'; return; }
      state.textContent = st.hasKey ? 'Clé enregistrée' + (st.where === 'app' ? ' (chiffrée par Windows)' : ' (dans ce navigateur)') : 'Aucune clé enregistrée';
      state.dataset.ok = st.hasKey ? '1' : '0';
      del.hidden = !st.hasKey;
      test.disabled = !st.hasKey;
      note.textContent = st.where === 'browser' ? 'Dans la version navigateur, la clé est conservée dans le stockage de ce navigateur, sans coffre sécurisé : l’application Windows la protège mieux.' : '';
      note.hidden = !note.textContent;
    };
    save.addEventListener('click', async () => {
      const r = await nt.ai.setKey(input.value, pv);
      if (r && r.error) { P.toast(r.error); return; }
      input.value = '';
      P.toast('Clé enregistrée.');
      refresh();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
    del.addEventListener('click', async () => {
      if (!(await P.confirm('Supprimer la clé ' + (gem ? 'Google' : 'API') + ' ?', 'La clé sera effacée de cet ordinateur. ' + svc + ' ne fonctionnera plus tant que vous n’en saisirez pas une autre.', 'Supprimer'))) return;
      await nt.ai.clearKey(pv);
      P.toast('Clé supprimée.');
      refresh();
    });
    test.addEventListener('click', async () => {
      test.disabled = true;
      const old = test.textContent;
      test.textContent = 'Test en cours…';
      const r = await P.ai.complete({ messages: [{ role: 'user', content: 'Réponds uniquement par le mot : OK' }], maxTokens: 16 }).promise;
      test.textContent = old;
      test.disabled = false;
      P.toast(r.error ? r.error : 'Connexion réussie : la clé fonctionne.');
    });

    const keyDesc = gem
      ? 'Gratuite : créez-la dans Google AI Studio avec un compte Google. Elle n’est jamais affichée ni envoyée ailleurs qu’à Google.'
      : 'Créez-la dans la console Anthropic (compte et crédits à vous). Elle n’est jamais affichée ni envoyée ailleurs qu’à Anthropic.';
    const keyUrl = gem ? 'https://aistudio.google.com/apikey' : 'https://console.anthropic.com/settings/keys';
    body.append(h('div', { class: 'set-cap', text: 'Activation' }), h('div', { class: 'set-group' },
      h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Activer l’assistant IA', h('span', { class: 'desc', text: 'Désactivée par défaut. Active les actions d’IA dans tout l’éditeur.' })), sw),
      h('div', { class: 'set-row stack' }, h('div', { class: 'lbl' }, gem ? 'Clé API Google (gratuite)' : 'Clé API Claude', h('span', { class: 'desc', text: keyDesc })),
        h('div', { class: 'ai-key' }, input, save, del),
        h('div', { class: 'ai-keyrow' }, state, test,
          h('button', { type: 'button', class: 'chipbtn', text: gem ? 'Obtenir une clé gratuite' : 'Obtenir une clé', onclick: () => { try { nt.openExternal('url', keyUrl); } catch (_) { /* ignoré */ } } })),
        note)));
    refresh();
  }

  /* ---------- Fenêtre « Paramètres » ---------- */
  const SECTIONS = [
    ['account', 'Compte', 'i-person'],
    ['appearance', 'Apparence', 'i-sun'],
    ['edit', 'Édition', 'i-edit'],
    ['ai', 'Intelligence artificielle', 'i-sparkle'],
    ['files', 'Fichiers et données', 'i-folder'],
    ['shortcuts', 'Raccourcis clavier', 'i-keyboard'],
    ['about', 'À propos', 'i-info'],
  ];

  function shortcutsTable() {
    const table = h('table', { class: 'kbd-table' });
    for (const [group, items] of P.SHORTCUTS) {
      table.append(h('tbody', {}, h('tr', {}, h('td', { colspan: 2 }, h('h4', { text: group }))),
        items.map(([name, keys]) => h('tr', {}, h('td', { text: name }),
          h('td', {}, keys.split(' · ').map((k, i) => [i ? ' · ' : '', ...k.split('+').map((x, j, a) => [h('kbd', { text: x }), j < a.length - 1 ? ' + ' : ''])]))))));
    }
    return table;
  }

  function renderSection(id, body) {
    body.replaceChildren();
    const title = (SECTIONS.find((s) => s[0] === id) || [])[1];
    body.append(h('h2', { text: title }));
    if (id === 'account') {
      body.append(h('p', { class: 'lead', text: 'Plume est un logiciel local : il n’y a pas de compte en ligne. Ce nom accompagne vos commentaires, vos suggestions et les versions du document.' }));
      const input = h('input', { type: 'text', value: P.state.author || '', maxlength: '60', 'aria-label': 'Nom affiché', spellcheck: 'false' });
      const save = () => { const v = input.value.trim(); if (v) P.app.setAuthor(v.slice(0, 60)); };
      input.addEventListener('change', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      body.append(h('div', { class: 'set-group' },
        h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Nom affiché', h('span', { class: 'desc', text: 'Visible dans les commentaires et les suggestions.' })), input),
        h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Avatar', h('span', { class: 'desc', text: 'Calculé à partir de votre nom.' })), h('div', { class: 'pc-avatar' }))));
      P.paintAvatars();
    } else if (id === 'shortcuts') {
      body.append(shortcutsTable());
    } else if (id === 'about') {
      const info = (P.app && P.app.info) || {};
      body.append(h('div', { class: 'about-box' }, h('span', { class: 'brand-tile' }, svgIcon('i-feather')),
        h('div', {}, h('b', { text: 'Plume ' + (info.version || '') }),
          h('div', { class: 'muted', text: 'Traitement de texte local, simple et élégant.' }),
          h('div', { class: 'muted', text: [info.electron && 'Electron ' + info.electron, info.chrome && 'Chromium ' + info.chrome].filter(Boolean).join(' · ') }))));
      body.append(h('p', { class: 'lead', text: 'Vos documents restent sur votre ordinateur (fichiers .plume). Plume n’envoie rien sur Internet, sauf si vous activez l’assistant IA (Paramètres → Intelligence artificielle) : seul le texte que vous soumettez à l’IA part alors vers le service que vous avez choisi (Claude ou Google Gemini), avec votre propre clé.' }));
    } else {
      if (id === 'ai') aiTop(body);
      const groups = [];
      SCHEMA.filter((d) => !d.hidden && d.section === id && (!d.prov || d.prov === S.aiProvider)).forEach((d) => {
        let g = groups.find((x) => x.name === (d.grp || ''));
        if (!g) { g = { name: d.grp || '', box: h('div', { class: 'set-group' }) }; groups.push(g); }
        g.box.append(rowOf(d, 'set-row'));
      });
      groups.forEach((g) => { if (g.name) body.append(h('div', { class: 'set-cap', text: g.name })); body.append(g.box); });
      if (id === 'files') {
        body.append(h('div', { class: 'set-cap', text: 'Accueil' }), h('div', { class: 'set-group' },
          h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Documents récents', h('span', { class: 'desc', text: 'Efface la liste de l’accueil. Les fichiers ne sont pas supprimés.' })),
            h('button', { type: 'button', class: 'chipbtn', text: 'Vider la liste', onclick: async () => {
              try { await native.recents.clear(); } catch (_) { /* ignoré */ }
              if (P.home) P.home.refresh();
              P.toast('Liste des documents récents vidée.');
            } }))));
      }
      if (id === 'appearance') {
        body.append(h('div', { class: 'set-cap', text: 'Réinitialisation' }), h('div', { class: 'set-group' },
          h('div', { class: 'set-row' }, h('div', { class: 'lbl' }, 'Réinitialiser', h('span', { class: 'desc', text: 'Remet tous les paramètres à leur valeur d’origine.' })),
            h('button', { type: 'button', class: 'chipbtn', text: 'Réinitialiser les paramètres', onclick: async () => {
              if (await P.confirm('Réinitialiser les paramètres ?', 'Thème, couleur, zoom, correcteur et autres préférences reviennent à leur valeur d’origine. Vos documents ne sont pas touchés.', 'Réinitialiser')) { reset(); P.toast('Paramètres réinitialisés.'); }
            } }))));
      }
    }
  }

  P.settings.openDialog = function (initial) {
    P.pop.close();
    let current = SECTIONS.some((s) => s[0] === initial) ? initial : 'appearance';
    const body = h('div', { class: 'set-body' });
    const nav = h('nav', { class: 'set-nav', 'aria-label': 'Catégories' }, h('h3', { text: 'Paramètres' }));
    const buttons = SECTIONS.map(([id, label, icon]) => {
      const tile = h('span', { class: 'nav-ic' }, svgIcon(icon));
      tile.dataset.k = id;
      const b = h('button', { type: 'button', onclick: () => show(id) }, tile, label);
      b.dataset.s = id;
      nav.append(b);
      return b;
    });
    function show(id) {
      current = id;
      buttons.forEach((b) => b.setAttribute('aria-current', String(b.dataset.s === id)));
      renderSection(id, body);
    }
    const close = () => { document.removeEventListener('keydown', onKey, true); overlay.remove(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const dlg = h('div', { class: 'settings', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paramètres' }, nav, body,
      h('button', { type: 'button', class: 'icon-btn set-close', title: 'Fermer', 'aria-label': 'Fermer', onclick: close }, svgIcon('i-close')));
    const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay) close(); } }, dlg);
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    show(current);
    buttons.find((b) => b.dataset.s === current).focus();
  };
})();
