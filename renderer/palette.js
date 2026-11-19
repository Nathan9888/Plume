/* Plume — palette de commandes (Ctrl+Maj+P) : recherche instantanée de toutes les actions, des réglages, des modèles,
   des documents récents et des titres du document. Les commandes viennent des mêmes définitions que la barre de menus. */
(function () {
  'use strict';
  const { h } = P;
  const C = () => P.settings;
  const A = () => P.app;
  const val = (v) => (typeof v === 'function' ? v() : v);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const DOC_ONLY = new Set(['Enregistrer', 'Enregistrer sous…', 'Télécharger', 'Historique des versions', 'Protéger par mot de passe…', 'Imprimer']);
  const HOME_OK = new Set(['Paramètres…', 'Mode compact', 'Plein écran']);
  const PREFIX = { Mode: 'Mode', Zoom: 'Zoom', Aligner: 'Aligner', 'Styles de paragraphe': 'Style', 'Encadré': 'Encadré' };
  const SKIP = new Set(['Ouvrir un document récent', 'Palette de commandes…', 'Modules complémentaires : pas disponibles']);
  // Synonymes utiles pour retrouver une commande avec d'autres mots
  const KEYWORDS = [
    [/pdf|docx|word|html|markdown/i, 'exporter export télécharger enregistrer sous convertir'],
    [/imprimer/i, 'imprimante print'],
    [/mot de passe/i, 'chiffrer chiffrement sécurité protéger'],
    [/sombre|clair|thème/i, 'apparence mode theme'],
    [/tableau/i, 'grille lignes colonnes'],
    [/saut de page/i, 'page break'],
    [/lien/i, 'hyperlien url'],
    [/commentaire/i, 'note annoter'],
    [/suggestion/i, 'révision suivi modifications'],
    [/sommaire/i, 'table des matières toc'],
    [/encadré/i, 'callout note astuce attention info important bloc'],
    [/champs/i, 'variables formulaire remplir modèle'],
    [/concentration/i, 'focus zen lecture plein écran distraction temps de lecture'],
    [/markdown/i, 'md texte brut github'],
  ];
  const keywordsFor = (title) => KEYWORDS.filter(([re]) => re.test(title)).map((k) => k[1]).join(' ');

  /* ---------- Collecte ---------- */
  function menuCommands(inDoc) {
    const out = [];
    const seen = new Set();
    const push = (c) => { const k = norm(c.title); if (seen.has(k)) return; seen.add(k); out.push(c); };
    const walk = (items, path, top, parentLabel) => {
      for (const it of items) {
        if (it === '-' || SKIP.has(it.label)) continue;
        if (!inDoc && top !== 'Fichier' && top !== 'Aide' && !HOME_OK.has(it.label) && !it.items) continue;
        if (!inDoc && DOC_ONLY.has(it.label)) continue;
        if (it.items) {
          if (!inDoc && top !== 'Fichier' && top !== 'Aide') continue;
          walk(val(it.items) || [], path.concat(it.label), top, it.label);
          continue;
        }
        if (val(it.disabled)) continue;
        const title = PREFIX[parentLabel] ? PREFIX[parentLabel] + ' : ' + it.label : it.label;
        push({ kind: 'Commande', title, path: path.join(' › '), hint: it.hint, icon: it.icon, checked: !!val(it.checked), run: it.action, kw: keywordsFor(title) });
      }
    };
    P.menu.MENUS.forEach((m) => walk(m.items(), [m.label], m.label, ''));
    return out;
  }

  function extraCommands() {
    const cfg = C();
    const out = [];
    [['light', 'Clair', 'i-sun'], ['dark', 'Sombre', 'i-moon'], ['system', 'Système', 'i-monitor']].forEach(([v, l, i]) =>
      out.push({ kind: 'Réglage', title: 'Thème : ' + l, path: 'Apparence', icon: i, checked: cfg.get('theme') === v, run: () => cfg.set('theme', v), kw: 'apparence mode theme' }));
    [['blue', 'Bleu'], ['purple', 'Violet'], ['pink', 'Rose'], ['red', 'Rouge'], ['orange', 'Orange'], ['green', 'Vert'], ['graphite', 'Graphite']].forEach(([v, l]) =>
      out.push({ kind: 'Réglage', title: 'Couleur d’accent : ' + l, path: 'Apparence', checked: cfg.get('accent') === v, run: () => cfg.set('accent', v), kw: 'couleur couleurs accent' }));
    out.push({ kind: 'Réglage', title: 'Page toujours blanche', path: 'Apparence', checked: !!cfg.get('pageLight'), run: () => cfg.set('pageLight', !cfg.get('pageLight')), kw: 'papier sombre' });
    out.push({ kind: 'Réglage', title: 'Compteur de mots', path: 'Apparence', checked: !!cfg.get('wordCount'), run: () => cfg.set('wordCount', !cfg.get('wordCount')), kw: 'statistiques' });
    out.push({ kind: 'Réglage', title: 'Taille de l’interface : agrandir', path: 'Apparence', run: () => cfg.set('uiZoom', Math.min(150, (cfg.get('uiZoom') || 100) + 10)), kw: 'zoom plus grand' });
    out.push({ kind: 'Réglage', title: 'Taille de l’interface : réduire', path: 'Apparence', run: () => cfg.set('uiZoom', Math.max(80, (cfg.get('uiZoom') || 100) - 10)), kw: 'zoom plus petit' });
    out.push({ kind: 'Réglage', title: 'Vider la liste des documents récents', path: 'Accueil', icon: 'i-trash', run: async () => { try { await native.recents.clear(); } catch (_) { /* ignoré */ } if (P.home) P.home.refresh(); P.toast('Liste des documents récents vidée.'); } });
    return out;
  }

  function templateCommands() {
    return (P.templates || []).map((t) => ({ kind: 'Modèle', title: 'Nouveau : ' + t.name, path: 'Modèles', icon: 'i-doc', run: () => A().newFromTemplate(t), kw: 'créer modèle document' }));
  }

  function recentCommands() {
    const dirOf = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');
    return ((P.home && P.home.recents()) || []).filter((r) => !r.missing).map((r) =>
      ({ kind: 'Récent', title: r.title || 'Sans titre', path: dirOf(r.path), icon: r.encrypted ? 'i-lock' : 'i-doc', run: () => A().openRecent(r.path), kw: 'ouvrir récent' }));
  }

  function headingCommands() {
    const out = [];
    P.editor.querySelectorAll('h1, h2, h3').forEach((el) => {
      const text = el.textContent.trim();
      if (!text) return;
      out.push({ kind: 'Titre', title: 'Aller à : ' + text, path: 'Plan du document', icon: 'i-outline', kw: '', run: () => {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(true);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        P.editor.focus({ preventScroll: true });
      } });
    });
    return out;
  }

  /* ---------- Recherche ---------- */
  function subseq(text, tok) {
    let i = 0;
    for (const ch of text) { if (ch === tok[i]) i++; if (i === tok.length) return true; }
    return false;
  }

  function score(c, toks) {
    const t = norm(c.title);
    const rest = norm(c.path) + ' ' + norm(c.kw);
    let s = 0;
    for (const tok of toks) {
      let best = -1;
      const i = t.indexOf(tok);
      if (i >= 0) best = 100 - Math.min(i, 40) + (i === 0 || /[\s:\-–]/.test(t[i - 1]) ? 30 : 0);
      else if (rest.indexOf(tok) >= 0) best = 40;
      else if (tok.length >= 3 && subseq(t, tok)) best = 15;
      if (best < 0) return -1;
      s += best;
    }
    return s + (t.startsWith(toks[0]) ? 25 : 0) - t.length * 0.05 + (c.kind === 'Commande' || c.kind === 'Réglage' ? 3 : 0);
  }

  const QUICK = ['Nouveau document', 'Ouvrir…', 'Thème : Sombre', 'Thème : Clair', 'Paramètres…', 'Raccourcis clavier'];

  function search(all, query, recents) {
    const q = norm(query).trim();
    if (!q) {
      const quick = QUICK.map((t) => all.find((c) => c.title === t)).filter(Boolean);
      return [{ title: 'Suggestions', items: quick }, { title: 'Documents récents', items: recents.slice(0, 5) }].filter((g) => g.items.length);
    }
    const toks = q.split(/\s+/).filter(Boolean);
    const scored = [];
    all.forEach((c, i) => { const s = score(c, toks); if (s >= 0) scored.push({ c, s, i }); });
    scored.sort((a, b) => b.s - a.s || a.i - b.i);
    return [{ title: '', items: scored.slice(0, 60).map((x) => x.c) }];
  }

  /* ---------- Interface ---------- */
  let ui = null;

  function close(restore) {
    if (!ui) return;
    const { overlay, prev } = ui;
    ui = null;
    overlay.remove();
    if (restore !== false) {
      if (prev && P.editor.contains(prev)) P.restoreSel();
      else if (prev && prev.isConnected && prev.focus) prev.focus();
    }
  }

  function open() {
    if (ui) { close(); return; }
    if (document.querySelector('.overlay')) return;     // une boîte de dialogue est déjà ouverte
    if (P.pop && P.pop.isOpen()) P.pop.close();
    const inDoc = A().inDoc();
    if (inDoc) P.saveSel();
    const prev = inDoc ? P.editor : document.activeElement;

    const all = menuCommands(inDoc).concat(extraCommands(), templateCommands(), recentCommands(), inDoc ? headingCommands() : []);
    const recents = all.filter((c) => c.kind === 'Récent');

    const input = h('input', { type: 'text', class: 'pal-input', placeholder: 'Rechercher une commande, un réglage, un document…', spellcheck: 'false', autocomplete: 'off',
      role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list', 'aria-label': 'Palette de commandes' });
    const list = h('div', { class: 'pal-list', id: 'pal-list', role: 'listbox', 'aria-label': 'Résultats' });
    const panel = h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Palette de commandes' },
      h('div', { class: 'pal-search' }, P.svgIcon('i-search'), input, h('kbd', { text: 'Échap' })),
      list,
      h('div', { class: 'pal-foot' }, h('span', {}, h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), ' naviguer'), h('span', {}, h('kbd', { text: '↵' }), ' exécuter'), h('span', { class: 'pal-count' })));
    const overlay = h('div', { class: 'overlay pal-overlay' }, panel);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.append(overlay);
    ui = { overlay, prev };

    let rows = [];
    let sel = 0;

    function setSel(i, scroll) {
      if (!rows.length) { input.removeAttribute('aria-activedescendant'); return; }
      sel = (i + rows.length) % rows.length;
      rows.forEach((r, k) => { r.el.classList.toggle('sel', k === sel); r.el.setAttribute('aria-selected', String(k === sel)); });
      input.setAttribute('aria-activedescendant', rows[sel].el.id);
      if (scroll) rows[sel].el.scrollIntoView({ block: 'nearest' });
    }

    function run(c) {
      close();
      setTimeout(() => {
        try {
          const r = c.run();
          if (r && typeof r.catch === 'function') r.catch((err) => P.toast('Erreur : ' + (err && err.message ? err.message : err), 5000));
        } catch (err) { P.toast('Erreur : ' + (err && err.message ? err.message : err), 5000); }
      }, 0);
    }

    function render() {
      const groups = search(all, input.value, recents);
      list.replaceChildren();
      rows = [];
      const query = input.value.trim();
      groups.forEach((g) => {
        if (g.title) list.append(h('div', { class: 'pal-group', role: 'presentation', text: g.title }));
        g.items.forEach((c) => {
          const el = h('div', { class: 'pal-row', role: 'option', id: 'pal-o' + rows.length, 'aria-selected': 'false' },
            h('span', { class: 'pal-lead' }, c.checked ? P.svgIcon('i-check', 'sm') : c.icon ? P.svgIcon(c.icon, 'sm') : null),
            h('span', { class: 'pal-title', text: c.title }),
            c.path ? h('span', { class: 'pal-path', text: c.path }) : null,
            c.hint ? h('kbd', { class: 'pal-hint', text: c.hint }) : (query ? h('span', { class: 'pal-kind', text: c.kind }) : null));
          const idx = rows.length;
          el.addEventListener('mousemove', () => { if (sel !== idx) setSel(idx, false); });
          el.addEventListener('mousedown', (e) => e.preventDefault());
          el.addEventListener('click', () => run(c));
          rows.push({ el, c });
          list.append(el);
        });
      });
      if (!rows.length) list.append(h('div', { class: 'pal-empty', text: 'Aucun résultat pour « ' + query + ' »' }));
      ui && (panel.querySelector('.pal-count').textContent = query ? rows.length + (rows.length > 1 ? ' résultats' : ' résultat') : '');
      setSel(0, true);
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); setSel(sel + 1, true); }
      else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); setSel(sel - 1, true); }
      else if (e.key === 'Home' && !input.value) { e.preventDefault(); setSel(0, true); }
      else if (e.key === 'End' && !input.value) { e.preventDefault(); setSel(rows.length - 1, true); }
      else if (e.key === 'Enter') { e.preventDefault(); if (rows[sel]) run(rows[sel].c); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    render();
    input.focus();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); e.stopPropagation(); open(); }
  }, true);

  P.palette = { open, close: () => close(), isOpen: () => !!ui };
})();
