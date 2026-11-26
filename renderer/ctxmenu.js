/* Plume — menu contextuel (clic droit) dans le document : orthographe, presse-papiers, tableau, lien, commentaire. */
(function () {
  'use strict';
  const ed = P.editor;
  const state = P.state;
  const nat = () => (typeof native !== 'undefined' ? native : null);

  /** Mot sous le pointeur (lettres, chiffres, apostrophes, tirets), avec sa position dans le nœud texte. */
  function wordAt(x, y) {
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (!r || r.startContainer.nodeType !== 3 || !ed.contains(r.startContainer)) return null;
    const node = r.startContainer;
    if (node.parentElement && node.parentElement.closest('.chip, .noexport, .toc')) return null;
    const t = node.nodeValue;
    const isW = (ch) => /[\p{L}\p{M}\p{N}'’-]/u.test(ch);
    let a = r.startOffset, b = a;
    while (a > 0 && isW(t[a - 1])) a--;
    while (b < t.length && isW(t[b])) b++;
    while (a < b && /['’-]/.test(t[a])) a++;
    while (b > a && /['’-]/.test(t[b - 1])) b--;
    const text = t.slice(a, b);
    if (!text || /^[\p{N}\s-]+$/u.test(text)) return null;
    return { node, start: a, end: b, text };
  }

  function spellInfo(w) {
    if (!w || !P.spell || !P.settings.get('spell')) return null;
    try { return P.spell.isBad(w.text) ? { bad: true, suggestions: P.spell.suggest(w.text) } : null; } catch (_) { return null; }
  }

  function items(ctx) {
    const ro = state.mode === 'view';
    const hasSel = !!ctx.hasSel;
    const toEd = () => P.restoreSel();
    const edit = (cmd) => () => { toEd(); const n = nat(); if (n && n.editCmd) n.editCmd(cmd); };
    const act = (name) => () => { toEd(); if (P.actions[name]) P.actions[name](); };
    const list = [];

    if (ctx.spell) {
      const w = ctx.word;
      const sug = (ctx.spell.suggestions || []).slice(0, 5);
      sug.forEach((s) => list.push({ label: s, action: () => {
        const r = document.createRange();
        r.setStart(w.node, w.start);
        r.setEnd(w.node, w.end);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        document.execCommand('insertText', false, s);
      } }));
      if (!sug.length) list.push({ label: 'Aucune suggestion', disabled: true });
      list.push({ label: 'Ajouter au dictionnaire', action: () => { P.spell.add(w.text); P.toast('« ' + w.text + ' » ajouté au dictionnaire personnel.'); } }, '-');
    }

    list.push(
      { label: 'Couper', hint: 'Ctrl+X', disabled: ro || !hasSel, action: edit('cut') },
      { label: 'Copier', hint: 'Ctrl+C', disabled: !hasSel, action: edit('copy') },
      { label: 'Coller', hint: 'Ctrl+V', disabled: ro, action: edit('paste') },
      { label: 'Coller sans la mise en forme', hint: 'Ctrl+Maj+V', disabled: ro, action: () => { toEd(); P.pastePlain(); } },
      { label: 'Supprimer', disabled: ro || !hasSel, action: () => { toEd(); document.execCommand('delete'); P.markDirty(); } },
    );

    const ti = P.tableInfo && P.tableInfo();
    if (ti && !ro) {
      list.push('-', ...P.tables.menuItems());
    }
    if (P.images && P.images.selected()) {
      list.push('-', { label: 'Image', icon: 'i-image', items: () => P.images.menuItems() });
    }

    const fmt = (cmd) => () => P.exec(cmd, null, false);
    const aiSel = window.getSelection();
    const aiRange = aiSel.rangeCount && P.editor.contains(aiSel.getRangeAt(0).commonAncestorContainer) ? aiSel.getRangeAt(0).cloneRange() : null;
    list.push(
      '-',
      { label: 'Insérer un lien', hint: 'Ctrl+K', icon: 'i-link', disabled: ro, action: act('link') },
      { label: 'Commentaire', hint: 'Ctrl+Alt+M', icon: 'i-comment', disabled: ro || !hasSel, action: () => { toEd(); P.addComment(); } },
      { label: 'Assistant IA', icon: 'i-sparkle', disabled: ro, items: () => P.ai.ui.selectionItems(aiRange, hasSel) },
      '-',
      { label: 'Afficher d’autres actions', items: [
        { label: 'Mise en forme', items: [
          { label: 'Gras', hint: 'Ctrl+B', icon: 'i-bold', disabled: ro, action: fmt('bold') },
          { label: 'Italique', hint: 'Ctrl+I', icon: 'i-italic', disabled: ro, action: fmt('italic') },
          { label: 'Souligné', hint: 'Ctrl+U', icon: 'i-underline', disabled: ro, action: fmt('underline') },
          { label: 'Barré', icon: 'i-strike', disabled: ro, action: fmt('strikeThrough') },
          { label: 'Effacer la mise en forme', hint: 'Ctrl+\\', icon: 'i-clear', disabled: ro, action: fmt('removeFormat') },
        ] },
        { label: 'Style de paragraphe', items: () => P.styles.menuItems() },
        { label: 'Insérer', disabled: ro, items: [
          { label: 'Tableau…', icon: 'i-table', action: act('table') },
          { label: 'Image…', icon: 'i-image', action: act('image') },
          { label: 'Encadré', items: (P.CALLOUTS || []).map((c) => ({ label: c.label, action: () => P.insertCallout(c.kind) })) },
          { label: 'Sommaire', action: act('toc') },
          { label: 'Ligne horizontale', icon: 'i-hr', action: act('hr') },
          { label: 'Saut de page', icon: 'i-pagebreak', action: act('pagebreak') },
        ] },
        '-',
        { label: 'Tout sélectionner', hint: 'Ctrl+A', action: edit('selectAll') },
        { label: 'Rechercher et remplacer…', hint: 'Ctrl+H', icon: 'i-search', action: () => P.openFind() },
        { label: 'Palette de commandes…', hint: 'Ctrl+Maj+P', icon: 'i-search', action: () => P.palette.open() },
      ] },
    );
    return list;
  }

  document.addEventListener('contextmenu', (e) => {
    if (!P.app || !P.app.inDoc() || !e.target.closest || !e.target.closest('#page') || e.shiftKey) return;
    e.preventDefault();
    let x = e.clientX, y = e.clientY;
    const sel = window.getSelection();
    const keyboard = !x && !y;
    if (keyboard && sel.rangeCount) { const a = P.rangeAnchor(sel.getRangeAt(0)); x = a.left; y = a.bottom + 4; }

    // un clic droit hors de la sélection place le curseur à cet endroit (comme dans un traitement de texte)
    let inside = false;
    if (sel.rangeCount && !sel.isCollapsed && !keyboard) {
      const r = sel.getRangeAt(0);
      inside = Array.from(r.getClientRects()).some((q) => x >= q.left - 1 && x <= q.right + 1 && y >= q.top - 1 && y <= q.bottom + 1);
    }
    if (!inside && !keyboard && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r && ed.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); }
    }
    P.saveSel();

    const word = keyboard ? null : wordAt(x, y);
    const ctx = { hasSel: sel.rangeCount && !sel.isCollapsed, word, spell: spellInfo(word) };
    if (P.selbar) P.selbar.hide();
    P.menu.open(items(ctx), { x, y });
  }, true);

  // « Coller sans la mise en forme » : Ctrl+Maj+V, ou le menu ci-dessus
  let plain = false;
  P.pastePlain = () => { plain = true; setTimeout(() => { plain = false; }, 1500); const n = nat(); if (n && n.editCmd) n.editCmd('paste'); };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') { plain = true; setTimeout(() => { plain = false; }, 800); }
  }, true);
  P.takePlainPaste = () => { const v = plain; plain = false; return v; };
})();
