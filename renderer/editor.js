/* Plume — éditeur : mise en forme, puces intelligentes (@), blocs, tableaux, recherche, collage. */
(function () {
  'use strict';
  const { $, $$, h, esc } = P;
  const ed = P.editor;
  const state = P.state;

  const readOnly = () => state.mode === 'view';

  // ---------- Commandes de mise en forme ----------
  let pendingSizePt = null;

  function fixSizes() {
    if (pendingSizePt == null) return;
    const pt = pendingSizePt + 'pt';
    ed.querySelectorAll('font[size="7"]').forEach((f) => {
      const s = document.createElement('span');
      s.style.fontSize = pt;
      while (f.firstChild) s.appendChild(f.firstChild);
      f.replaceWith(s);
    });
    ed.querySelectorAll('span[style*="xxx-large"]').forEach((s) => { s.style.fontSize = pt; });
  }

  P.setFontSize = (pt) => setFontSize(pt);
  P.exec = function (cmd, val, css) {
    if (readOnly()) return;
    P.restoreSel();
    document.execCommand('styleWithCSS', false, !!css);
    document.execCommand(cmd, false, val == null ? null : val);
    P.markDirty();
    updateToolbar();
  };

  function setFontSize(pt) {
    if (readOnly()) return;
    P.restoreSel();
    pendingSizePt = pt;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, '7');
    fixSizes();
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) pendingSizePt = null; // sinon : appliqué à la prochaine frappe
    P.markDirty();
  }

  P.insertHTML = function (html) {
    if (readOnly()) return;
    P.restoreSel();
    document.execCommand('styleWithCSS', false, false);
    if (/class="chip/.test(html)) {
      // Un espace tapé juste avant la puce serait supprimé par Chromium : on le rend insécable.
      const sel = window.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (r && r.collapsed && r.startContainer.nodeType === 3 && r.startOffset > 0 && r.startContainer.nodeValue[r.startOffset - 1] === ' ') {
        const node = r.startContainer, off = r.startOffset;
        node.replaceData(off - 1, 1, ' ');
        const fixed = document.createRange();
        fixed.setStart(node, off);
        fixed.collapse(true);
        sel.removeAllRanges();
        sel.addRange(fixed);
      }
    }
    // Chromium place mal les éléments contenteditable="false" insérés en fin de paragraphe (ils sortent du <p>
    // et l'espace final disparaît) : on les insère comme éléments ordinaires, puis on remet l'attribut.
    document.execCommand('insertHTML', false, String(html).replace(/ contenteditable="false"/g, ''));
    ed.querySelectorAll('.chip, .pagebreak, .noexport, .toc').forEach((n) => { if (n.getAttribute('contenteditable') !== 'false') n.setAttribute('contenteditable', 'false'); });
    fixChecklists();
    P.markDirty();
    P.updateCounts();
  };

  // ---------- Barre d'outils ----------
  const tb = $('#toolbar');
  tb.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  tb.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || readOnly()) return;
    if (b.dataset.cmd) P.exec(b.dataset.cmd, null, /^justify/.test(b.dataset.cmd));
    else if (b.dataset.act) (actions[b.dataset.act] || (() => {}))();
    else if (b.dataset.size) stepSize(parseInt(b.dataset.size, 10));
  });

  function setBlock(v) {
    if (readOnly()) return;
    P.restoreSel();
    const inBq = closestFromSel('blockquote');
    if (v === 'p' && inBq) document.execCommand('outdent');
    else document.execCommand('formatBlock', false, '<' + v + '>');
    P.markDirty();
    updateToolbar();
  }
  P.setBlock = setBlock;
  $('#tb-font').addEventListener('change', (e) => { if (P.fonts) P.fonts.apply(e.target.value); else P.exec('fontName', e.target.value, true); });

  const sizeBox = $('#tb-size');
  const clampSize = (n) => Math.max(6, Math.min(96, n));
  function stepSize(dir) {
    const cur = parseInt(sizeBox.value, 10) || 11;
    const next = clampSize(cur + dir);
    sizeBox.value = String(next);
    setFontSize(next);
  }
  sizeBox.addEventListener('change', () => {
    const n = parseInt(sizeBox.value, 10);
    if (!isFinite(n)) { updateToolbar(); return; }
    sizeBox.value = String(clampSize(n));
    setFontSize(clampSize(n));
  });
  sizeBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sizeBox.dispatchEvent(new Event('change')); ed.focus(); }
  });
  $('#tb-color').addEventListener('input', (e) => { $('#ico-color').style.background = e.target.value; P.exec('foreColor', e.target.value, true); });
  $('#tb-hilite').addEventListener('input', (e) => { $('#ico-hilite').style.background = e.target.value; P.exec('hiliteColor', e.target.value, true); });

  function closestFromSel(selector) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return null;
    const n = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    const el = n && n.closest(selector);
    return el && ed.contains(el) ? el : null;
  }

  function updateToolbar() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return;
    const states = ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList'];
    $$('#toolbar [data-cmd]').forEach((b) => {
      if (!states.includes(b.dataset.cmd)) return;
      let on = false;
      try { on = document.queryCommandState(b.dataset.cmd); } catch (_) { /* ignoré */ }
      b.classList.toggle('on', !!on);
    });
    let blk = 'p';
    try { blk = String(document.queryCommandValue('formatBlock') || 'p').toLowerCase(); } catch (_) { /* ignoré */ }
    if (P.styles) P.styles.reflect(); else $('#tb-block').value = ['h1', 'h2', 'h3', 'blockquote'].includes(blk) ? blk : 'p';
    const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    if (el && el.nodeType === 1) {
      const cs = getComputedStyle(el);
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const fsel = $('#tb-font');
      if (P.fonts && fam) P.fonts.reflect(fam);
      else if (Array.from(fsel.options).some((o) => o.value === fam)) fsel.value = fam;
      const pt = String(Math.round(parseFloat(cs.fontSize) * 0.75));
      if (document.activeElement !== sizeBox) sizeBox.value = pt;
    }
    $('#tablebar').hidden = !closestFromSel('td, th');
  }
  P.updateToolbar = updateToolbar;
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (sel.rangeCount && ed.contains(sel.anchorNode)) updateToolbar();
  });

  // ---------- Statistiques ----------
  /** Temps de lecture estimé (≈ 230 mots par minute). */
  /** Nombre de mots du document (innerText : les blocs voisins restent séparés ; le sommaire généré n'est pas compté). */
  P.wordCount = () => {
    let t = ed.innerText || '';
    ed.querySelectorAll('.toc').forEach((n) => { t = t.replace(n.innerText || '', ' '); });
    return (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  };
  P.readingLabel = (words) => (words < 60 ? 'lecture : moins d’1 min' : `lecture ≈ ${Math.max(1, Math.round(words / 230))} min`);
  let countTimer = null;
  P.updateCounts = function () {
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      const text = ed.textContent || '';
      const words = P.wordCount();
      $('#st-count').textContent = `${words} mot${words > 1 ? 's' : ''} · ${text.replace(/\s/g, '').length} caractères · ${P.readingLabel(words)}`;
      if (P.focusRefresh) P.focusRefresh();
      $('#st-pages').textContent = state.pageless ? '' : P.pageLabel();
    }, 150);
  };

  // ---------- Listes de tâches ----------
  function fixChecklists() {
    ed.querySelectorAll('ul.checklist > li').forEach((li) => {
      const f = li.firstElementChild;
      if (f && f.tagName === 'INPUT') return;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('contenteditable', 'false');
      const sel = window.getSelection();
      const caretInLi = sel.rangeCount && sel.anchorNode === li && sel.anchorOffset === 0;
      li.insertBefore(cb, li.firstChild);
      if (caretInLi) { const r = document.createRange(); r.setStart(li, 1); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
    });
  }
  P.fixChecklists = fixChecklists;

  ed.addEventListener('change', (e) => {
    if (e.target.matches && e.target.matches('input[type="checkbox"]')) {
      e.target.toggleAttribute('checked', e.target.checked);
      P.markDirty();
    }
  });

  function checklist() {
    P.restoreSel();
    let ul = closestFromSel('ul');
    if (!ul) {
      document.execCommand('insertUnorderedList');
      ul = closestFromSel('ul');
    }
    if (!ul) return;
    ul.classList.toggle('checklist');
    if (ul.classList.contains('checklist')) fixChecklists();
    else ul.querySelectorAll(':scope > li > input[type="checkbox"]').forEach((i) => i.remove());
    P.markDirty();
  }

  // ---------- Tableaux : voir tables.js (P.tables, P.tableOp, P.inTable, P.tableInfo) ----------

  // ---------- Insertions simples ----------
  async function insertLink() {
    P.saveSel();
    const range = P.currentRange();
    const selected = range && !range.collapsed ? range.toString() : '';
    const existing = closestFromSel('a[href]');
    const r = await P.modal({
      title: 'Insérer un lien',
      fields: [
        { id: 'url', label: 'Adresse (URL ou courriel)', value: existing ? existing.getAttribute('href') : 'https://' },
        { id: 'text', label: 'Texte affiché (si rien n’est sélectionné)', value: selected },
      ],
    });
    if (!r) return;
    let url = r.values.url.trim();
    if (!url || url === 'https://') return;
    if (!/^(https?:|mailto:)/i.test(url)) url = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url) ? 'mailto:' + url : 'https://' + url;
    P.restoreSel();
    if (selected) { document.execCommand('styleWithCSS', false, false); document.execCommand('createLink', false, url); P.markDirty(); }
    else P.insertHTML(`<a href="${esc(url)}">${esc(r.values.text || url)}</a>`);
  }

  async function insertImage() {
    P.saveSel();
    const r = await native.pickImage();
    if (!r) return;
    if (r.error) { P.toast(r.error); return; }
    P.insertHTML(`<img src="${r.dataUrl}">`);
  }

  const actions = {
    at: () => { P.saveSel(); openAtMenu(null, '@'); },
    link: insertLink,
    image: insertImage,
    table: () => { if (P.tables) P.tables.picker(); },
    hr: () => P.exec('insertHorizontalRule'),
    pagebreak: () => P.insertHTML('<div class="pagebreak" contenteditable="false"></div><p><br></p>'),
    checklist,
    comment: () => P.addComment && P.addComment(),
    toc: insertToc,
    fields: () => fillFields(),
    find: () => openFind(),
    dlp: () => P.runDlp && P.runDlp(false),
    print: () => P.app && P.app.print(),
    spell: () => P.settings.set('spell', !P.settings.get('spell')),
  };
  P.actions = actions;

  // ---------- Puces intelligentes ----------
  const STATUS = [['todo', 'À faire'], ['doing', 'En cours'], ['done', 'Terminé'], ['blocked', 'Bloqué']];
  const longDate = (d) => d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  function chip(type, text, attrs) {
    const a = Object.entries(attrs || {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<span class="chip chip-${type}" contenteditable="false" data-type="${type}"${a}>${esc(text)}</span>&nbsp;`;
  }
  P.chip = chip;
  P.varChipHTML = (name) => chip('var', state.variables[name] || '«' + name + '»', { var: name });
  P.refreshVars = () => ed.querySelectorAll('.chip-var').forEach((c) => { const n = c.dataset.var; c.textContent = state.variables[n] || '«' + n + '»'; });

  const contacts = {
    all() { try { return JSON.parse(localStorage.getItem('plume.contacts') || '[]'); } catch (_) { return []; } },
    save(c) {
      if (!c.name) return;
      const list = this.all().filter((x) => x.name.toLowerCase() !== c.name.toLowerCase());
      list.unshift(c);
      try { localStorage.setItem('plume.contacts', JSON.stringify(list.slice(0, 200))); } catch (_) { /* ignoré */ }
    },
  };

  async function insertPerson() {
    const list = contacts.all();
    const r = await P.modal({
      title: 'Insérer une personne',
      fields: [
        { id: 'name', label: 'Nom', list: list.map((c) => c.name) },
        { id: 'email', label: 'Courriel', type: 'email' },
        { id: 'note', label: 'Rôle ou remarque (facultatif)' },
      ],
    });
    if (!r || !r.values.name.trim()) return;
    const name = r.values.name.trim();
    const known = list.find((c) => c.name.toLowerCase() === name.toLowerCase()) || {};
    const email = r.values.email.trim() || known.email || '';
    const note = r.values.note.trim() || known.note || '';
    contacts.save({ name, email, note });
    P.insertHTML(chip('person', name, { email, note }));
  }

  async function insertDate(today) {
    let d = new Date();
    if (!today) {
      const iso = new Date().toISOString().slice(0, 10);
      const r = await P.modal({ title: 'Insérer une date', fields: [{ id: 'd', label: 'Date', type: 'date', value: iso }] });
      if (!r || !r.values.d) return;
      const [y, m, day] = r.values.d.split('-').map(Number);
      d = new Date(y, m - 1, day, 12);
    }
    P.insertHTML(chip('date', longDate(d), { iso: d.toISOString().slice(0, 10) }));
  }

  async function insertFile() {
    P.saveSel();
    const f = await native.pickFile();
    if (!f) return;
    if (f.error) { P.toast(f.error); return; }
    P.insertHTML(chip('file', f.name, { path: f.path }));
  }

  async function insertPlace() {
    const r = await P.modal({ title: 'Insérer un lieu', fields: [{ id: 'q', label: 'Adresse ou nom du lieu' }] });
    if (!r || !r.values.q.trim()) return;
    const q = r.values.q.trim();
    P.insertHTML(chip('place', q, { href: 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(q) }));
  }

  async function insertUrlChip() {
    const r = await P.modal({
      title: 'Insérer un lien web',
      fields: [{ id: 'url', label: 'Adresse', value: 'https://' }, { id: 'label', label: 'Titre affiché (facultatif)' }],
    });
    if (!r) return;
    let url = r.values.url.trim();
    if (!url || url === 'https://') return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let label = r.values.label.trim();
    if (!label) { try { label = new URL(url).hostname; } catch (_) { label = url; } }
    P.insertHTML(chip('link', label, { href: url }));
  }

  async function insertVariable() {
    const names = Object.keys(state.variables);
    const r = await P.modal({
      title: 'Insérer une variable',
      message: 'Une variable se met à jour partout dans le document quand on change sa valeur (panneau Variables).',
      fields: [{ id: 'name', label: 'Nom (ex. Nom du client)', list: names }, { id: 'value', label: 'Valeur', value: '' }],
    });
    if (!r || !r.values.name.trim()) return;
    const name = r.values.name.trim();
    if (r.values.value.trim() || !(name in state.variables)) state.variables[name] = r.values.value.trim();
    P.insertHTML(P.varChipHTML(name));
    P.refreshVars();
    if (P.renderPanel) P.renderPanel();
  }

  // ---------- Blocs de construction ----------
  async function blockMeeting() {
    const iso = new Date().toISOString().slice(0, 10);
    const r = await P.modal({
      title: 'Notes de réunion',
      fields: [
        { id: 'title', label: 'Titre', value: 'Notes de réunion' },
        { id: 'date', label: 'Date', type: 'date', value: iso },
        { id: 'people', label: 'Participants (un par ligne ou séparés par des virgules ; courriel facultatif)', type: 'textarea', rows: 4 },
      ],
    });
    if (!r) return;
    const [y, m, d] = (r.values.date || iso).split('-').map(Number);
    const date = new Date(y, m - 1, d, 12);
    const people = r.values.people.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const mm = s.match(/[^\s<>(),;]+@[^\s<>(),;]+\.[^\s<>(),;]+/);
      const email = mm ? mm[0] : '';
      const name = s.replace(email, '').replace(/[<>()]/g, '').trim() || email;
      contacts.save({ name, email, note: '' });
      return chip('person', name, { email });
    }).join(' ');
    P.insertHTML(
      `<h2>${esc(r.values.title || 'Notes de réunion')}</h2>` +
      `<p><b>Date :</b> ${chip('date', longDate(date), { iso: r.values.date || iso })}</p>` +
      `<p><b>Participants :</b> ${people || '—'}</p>` +
      '<h3>Ordre du jour</h3><ul><li><br></li></ul>' +
      '<h3>Notes et décisions</h3><ul><li><br></li></ul>' +
      '<h3>Actions à mener</h3><ul class="checklist"><li><input type="checkbox" contenteditable="false">&nbsp;</li></ul><p><br></p>'
    );
  }

  async function blockMail() {
    const r = await P.modal({
      title: 'Brouillon de courriel',
      fields: [{ id: 'to', label: 'À' }, { id: 'subject', label: 'Objet' }],
    });
    if (!r) return;
    P.insertHTML(
      '<div class="block block-mail" data-block="mail">' +
      `<p><b>À :</b> <span data-f="to">${esc(r.values.to || 'destinataire@exemple.com')}</span></p>` +
      `<p><b>Objet :</b> <span data-f="subject">${esc(r.values.subject || 'Objet du message')}</span></p>` +
      '<div data-f="body"><p>Bonjour,</p><p><br></p><p>Cordialement,</p></div>' +
      '<div class="noexport" contenteditable="false"><button type="button" data-act="mail">✉ Ouvrir dans ma messagerie</button></div>' +
      '</div><p><br></p>'
    );
  }

  function blockTracker() {
    const row = '<tr><td><br></td><td><br></td><td><br></td><td>' + chip('status', 'À faire', { status: 'todo' }) + '</td></tr>';
    P.insertHTML(
      '<h3>Suivi de projet</h3><table><tbody><tr><th>Tâche</th><th>Responsable</th><th>Échéance</th><th>Statut</th></tr>' +
      row.repeat(3) + '</tbody></table><p><br></p>'
    );
  }

  function openMail(block) {
    const f = (n) => { const e = block.querySelector(`[data-f="${n}"]`); return e ? e.innerText.trim() : ''; };
    const url = `mailto:${encodeURIComponent(f('to'))}?subject=${encodeURIComponent(f('subject'))}&body=${encodeURIComponent(f('body'))}`;
    native.openExternal('mail', url);
  }

  // ---------- Encadrés ----------
  const CALLOUTS = [
    { kind: 'info', label: 'Info', glyph: 'i', tone: '#0a84ff', kw: 'note remarque information' },
    { kind: 'tip', label: 'Astuce', glyph: '✓', tone: '#30a14e', kw: 'conseil succes reussite ok' },
    { kind: 'warn', label: 'Attention', glyph: '!', tone: '#ff9f0a', kw: 'avertissement prudence' },
    { kind: 'danger', label: 'Important', glyph: '!', tone: '#ff453a', kw: 'danger erreur critique alerte' },
  ];
  P.CALLOUTS = CALLOUTS;
  const calloutKind = (el) => (CALLOUTS.find((c) => el.classList.contains('callout-' + c.kind)) || CALLOUTS[0]).kind;
  P.calloutKind = () => { const c = closestFromSel('.callout'); return c ? calloutKind(c) : null; };

  function placeCaret(node, off) {
    const r = document.createRange();
    r.setStart(node, off);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    P.saveSel();
  }

  /** Enfant direct de l'éditeur qui contient `node`. */
  function topBlock(node) {
    let n = node;
    while (n && n.parentNode !== ed) n = n.parentNode;
    return n && n.nodeType === 1 ? n : null;
  }

  function insertCallout(kind) {
    if (readOnly()) return;
    if (state.mode === 'suggest') { P.toast('Les encadrés ne sont pas disponibles en mode Suggestion.'); return; }
    P.restoreSel();
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) { P.toast('Placez d’abord le curseur dans le document.'); return; }
    const existing = closestFromSel('.callout');
    if (existing) {
      if (calloutKind(existing) === kind) {
        const first = existing.firstChild;
        const kids = Array.from(existing.childNodes);
        existing.replaceWith(...kids);
        if (first) placeCaret(first, 0);
      } else existing.className = 'callout callout-' + kind;
      P.markDirty();
      return;
    }
    if (closestFromSel('td, th, li')) { P.toast('Un encadré ne peut pas être placé dans un tableau ou une liste.'); return; }
    const r = sel.getRangeAt(0);
    const first = topBlock(r.startContainer), last = topBlock(r.endContainer);
    if (!first || !last) return;
    const run = [];
    for (let n = first; n; n = n.nextElementSibling) { run.push(n); if (n === last) break; }
    if (!run.length || run[run.length - 1] !== last || run.some((b) => !/^(P|H[1-6]|BLOCKQUOTE|PRE)$/.test(b.tagName))) {
      P.toast('Un encadré ne peut entourer que du texte (paragraphes, titres, citations).');
      return;
    }
    const only = run.length === 1 ? run[0] : null;
    if (only && only.tagName === 'P' && !only.textContent && !only.querySelector('img, .chip')) {
      // Paragraphe vide (cas du menu « / ») : insertion par execCommand, donc annulable avec Ctrl+Z
      only.innerHTML = '<br>';
      placeCaret(only, 0);
      const after = only.nextElementSibling;
      P.insertHTML(`<div class="callout callout-${kind}" data-new="1"><p><br></p></div>`);
      const co = ed.querySelector('.callout[data-new]');
      if (!co) return;
      co.removeAttribute('data-new');
      // Chromium laisse parfois un paragraphe vide après le bloc remplacé : on le retire
      const extra = co.nextElementSibling;
      if (extra && extra !== after && extra.tagName === 'P' && !extra.textContent && !extra.querySelector('img, .chip')) extra.remove();
      placeCaret(co.firstElementChild, 0);
    } else {
      // Texte existant : on déplace les blocs dans l'encadré (insertHTML fusionnerait les paragraphes voisins)
      const sc = r.startContainer, so = r.startOffset, ec = r.endContainer, eo = r.endOffset;
      const co = document.createElement('div');
      co.className = 'callout callout-' + kind;
      first.before(co);
      run.forEach((b) => co.append(b));
      const nr = document.createRange();
      nr.setStart(sc, so);
      nr.setEnd(ec, eo);
      sel.removeAllRanges();
      sel.addRange(nr);
      P.saveSel();
    }
    ensureTrailing();
    P.markDirty();
  }
  P.insertCallout = insertCallout;

  /** Garde toujours un paragraphe après un bloc final non éditable ou sans texte (encadré, sommaire, tableau…). */
  function ensureTrailing() {
    const last = ed.lastElementChild;
    if (last && last.matches('.callout, .toc, table, .block-mail, .pagebreak, hr')) {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      ed.append(p);
    }
  }

  ed.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || menuOpen || readOnly() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'Enter' && e.key !== 'Backspace')) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const co = closestFromSel('.callout');
    if (!co) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      const blk = closestFromSel('.callout > p');
      if (blk && blk === co.lastElementChild && !blk.textContent && !blk.querySelector('img, .chip')) {
        e.preventDefault();
        const next = document.createElement('p');
        next.innerHTML = '<br>';
        if (co.children.length === 1) co.replaceWith(next); else { blk.remove(); co.after(next); }
        placeCaret(next, 0);
        P.markDirty();
      }
    } else if (e.key === 'Backspace') {
      const top = closestFromSel('.callout > *');
      const pre = document.createRange();
      pre.setStart(co, 0);
      pre.setEnd(sel.anchorNode, sel.anchorOffset);
      if (top && top === co.firstElementChild && pre.toString() === '' && !pre.cloneContents().querySelector('img, .chip, input')) {
        e.preventDefault();
        const kids = Array.from(co.childNodes);
        const first = co.firstElementChild;
        co.replaceWith(...kids);
        if (first) placeCaret(first, 0);
        P.markDirty();
      }
    }
  });

  // ---------- Sommaire automatique ----------
  const tocHeadings = () => Array.from(ed.querySelectorAll('h1, h2, h3')).filter((n) => !n.closest('.toc') && n.textContent.trim());
  const tocEntries = () => tocHeadings().map((n, i) => ({ i, lvl: +n.tagName[1], text: n.textContent.trim().replace(/\s+/g, ' ') }));
  const tocBodyHTML = (list) => (list.length
    ? list.map((x) => `<p class="toc-item lvl${x.lvl}" data-h="${x.i}">${esc(x.text)}</p>`).join('')
    : '<p class="toc-empty">Aucun titre pour l’instant : utilisez « Titre 1 », « Titre 2 » ou « Titre 3 » et ils apparaîtront ici.</p>');

  /** Met à jour tous les sommaires du document ; renvoie true si quelque chose a changé. */
  function updateTocs() {
    const list = tocEntries();
    const sig = list.map((x) => `toc-item lvl${x.lvl}|${x.text}`).join('\n');
    let changed = false;
    ed.querySelectorAll('.toc').forEach((t) => {
      const body = t.querySelector('.toc-body');
      if (!body) return;
      const cur = Array.from(body.children).map((p) => `${p.className}|${p.textContent}`).join('\n');
      if (cur !== sig && !(list.length === 0 && body.querySelector('.toc-empty'))) { body.innerHTML = tocBodyHTML(list); changed = true; }
    });
    return changed;
  }
  P.updateTocs = updateTocs;

  function insertToc() {
    if (readOnly()) return;
    const have = ed.querySelector('.toc');
    if (have) { have.scrollIntoView({ block: 'center', behavior: 'smooth' }); P.toast('Ce document a déjà un sommaire : il se met à jour tout seul.'); return; }
    P.insertHTML('<div class="toc" contenteditable="false" data-block="toc" title="Sommaire automatique"><div class="toc-title">Sommaire</div><div class="toc-body">' + tocBodyHTML(tocEntries()) + '</div></div><p><br></p>');
    ensureTrailing();
  }
  let tocTimer = null;
  const scheduleToc = () => { if (ed.querySelector('.toc')) { clearTimeout(tocTimer); tocTimer = setTimeout(updateTocs, 350); } };
  // Tout changement du texte (frappe, annulation, remplacement, restauration d'une version…) rafraîchit le sommaire
  new MutationObserver((muts) => {
    if (!ed.querySelector('.toc')) return;
    const outside = muts.some((m) => { const t = m.target.nodeType === 3 ? m.target.parentElement : m.target; return !(t && t.closest && t.closest('.toc')); });
    if (outside) scheduleToc();
  }).observe(ed, { childList: true, characterData: true, subtree: true });

  // ---------- Champs du document ----------
  const SUGGESTED_FIELDS = ['Nom du client', 'Adresse du client', 'Date de livraison', 'Numéro de facture', 'Montant total', 'Nom du projet', 'Responsable du projet', 'Nom de l’entreprise'];

  function insertField(name) {
    if (!(name in state.variables)) state.variables[name] = '';
    P.insertHTML(P.varChipHTML(name));
    P.refreshVars();
    if (P.renderPanel) P.renderPanel();
  }

  /** Formulaire « Remplir les champs » : toutes les variables du document en une fois. */
  async function fillFields(opts) {
    const names = Object.keys(state.variables);
    if (!names.length) { P.toast('Ce document n’a pas encore de champs : tapez @ pour en insérer un.'); return; }
    const fromTpl = !!(opts && opts.fromTemplate);
    const r = await P.modal({
      title: 'Remplir les champs',
      message: fromTpl ? 'Ce modèle contient des champs. Renseignez-les maintenant : ils seront remplacés partout dans le document (modifiables ensuite dans le panneau Variables).'
        : 'Les valeurs saisies remplacent les champs partout dans le document.',
      fields: names.map((n, i) => ({ id: 'f' + i, label: n, value: state.variables[n] || '' })),
      ok: 'Appliquer',
      buttons: fromTpl ? [{ id: 'cancel', label: 'Plus tard' }, { id: 'ok', label: 'Appliquer', primary: true }] : null,
    });
    if (!r) return;
    names.forEach((n, i) => { state.variables[n] = String(r.values['f' + i] || '').trim(); });
    P.refreshVars();
    if (P.renderPanel) P.renderPanel();
    P.markDirty();
  }
  P.fillFields = fillFields;

  // ---------- Menus « @ » (puces, blocs, champs) et « / » (mise en forme et blocs) ----------
  const BLOCK_ITEMS = [
    { group: 'Blocs', icon: '📝', label: 'Notes de réunion', hint: 'Date, participants, actions', run: blockMeeting, kw: 'reunion compte rendu' },
    { group: 'Blocs', icon: '✉', label: 'Brouillon de courriel', hint: 'S’ouvre dans votre messagerie', run: blockMail, kw: 'email mail message' },
    { group: 'Blocs', icon: '📊', label: 'Suivi de projet', hint: 'Tableau avec statuts', run: blockTracker, kw: 'taches statut kanban' },
  ];

  function atItems() {
    const names = Object.keys(state.variables);
    const fields = names.map((n) => ({ group: 'Champs du document', icon: '{ }', label: n, hint: state.variables[n] || 'à remplir', run: () => insertField(n), kw: 'variable champ' }));
    if (names.length) fields.push({ group: 'Champs du document', icon: '☰', label: 'Remplir les champs…', hint: 'Tous à la fois', run: () => fillFields(), kw: 'variables formulaire' });
    const suggested = SUGGESTED_FIELDS.filter((n) => !(n in state.variables))
      .map((n) => ({ group: names.length ? 'Autres champs' : 'Champs prédéfinis', icon: '{ }', label: n, hint: 'Nouveau champ', run: () => insertField(n), kw: 'variable champ' }));
    return [
      ...fields,
      { group: 'Puces intelligentes', icon: '👤', label: 'Personne', hint: 'Carte de contact', run: insertPerson },
      { group: 'Puces intelligentes', icon: '📅', label: "Date d'aujourd'hui", hint: '', run: () => insertDate(true) },
      { group: 'Puces intelligentes', icon: '📅', label: 'Date…', hint: 'Choisir une date', run: () => insertDate(false) },
      { group: 'Puces intelligentes', icon: '📎', label: 'Fichier', hint: 'Lien vers un fichier local', run: insertFile },
      { group: 'Puces intelligentes', icon: '📍', label: 'Lieu', hint: 'Ouvre une carte', run: insertPlace },
      { group: 'Puces intelligentes', icon: '🔗', label: 'Lien web', hint: '', run: insertUrlChip },
      { group: 'Puces intelligentes', icon: '{ }', label: 'Variable', hint: 'Champ personnalisé', run: insertVariable },
      ...BLOCK_ITEMS,
      { group: 'Blocs', icon: '☑', label: 'Liste de tâches', hint: '', run: checklist },
      { group: 'Blocs', icon: '▦', label: 'Tableau', hint: '', run: insertTable },
      { group: 'Blocs', icon: '⤓', label: 'Saut de page', hint: '', run: actions.pagebreak },
      ...suggested,
    ];
  }

  function slashItems() {
    const T = (label, icon, run, kw, hint) => ({ group: 'Texte', icon, label, hint: hint || '', run, kw });
    return [
      T('Paragraphe', '¶', () => setBlock('p'), 'texte normal'),
      T('Titre 1', 'H1', () => setBlock('h1'), 'heading grand titre h1'),
      T('Titre 2', 'H2', () => setBlock('h2'), 'heading sous-titre h2'),
      T('Titre 3', 'H3', () => setBlock('h3'), 'heading h3'),
      T('Citation', '❝', () => setBlock('blockquote'), 'quote retrait'),
      { group: 'Listes', icon: '•', label: 'Liste à puces', hint: '', run: () => P.exec('insertUnorderedList'), kw: 'bullet ul' },
      { group: 'Listes', icon: '1.', label: 'Liste numérotée', hint: '', run: () => P.exec('insertOrderedList'), kw: 'ol numero' },
      { group: 'Listes', icon: '☑', label: 'Liste de tâches', hint: 'Cases à cocher', run: checklist, kw: 'todo checklist' },
      ...CALLOUTS.map((c) => ({ group: 'Encadrés', icon: c.glyph, tone: c.tone, label: c.label, hint: 'Encadré', run: () => insertCallout(c.kind), kw: 'callout encadre bloc ' + c.kw })),
      { group: 'Insérer', icon: '▦', label: 'Tableau', hint: '', run: insertTable, kw: 'table grille' },
      { group: 'Insérer', icon: '🖼', label: 'Image', hint: '', run: insertImage, kw: 'photo' },
      { group: 'Insérer', icon: '—', label: 'Ligne horizontale', hint: '', run: actions.hr, kw: 'separateur trait' },
      { group: 'Insérer', icon: '⤓', label: 'Saut de page', hint: '', run: actions.pagebreak, kw: 'page' },
      { group: 'Insérer', icon: '☰', label: 'Sommaire', hint: 'Mis à jour automatiquement', run: insertToc, kw: 'table des matieres toc plan' },
      { group: 'Insérer', icon: '🔗', label: 'Lien', hint: '', run: insertLink, kw: 'url hyperlien' },
      { group: 'Insérer', icon: '📅', label: "Date d'aujourd'hui", hint: '', run: () => insertDate(true), kw: 'jour' },
      { group: 'Insérer', icon: '👤', label: 'Personne', hint: 'Carte de contact', run: insertPerson, kw: 'mention contact' },
      { group: 'IA', icon: '✦', label: 'Demander à l’IA…', hint: 'Ctrl+Alt+J', run: () => P.ai && P.ai.ui.ask(), kw: 'ia ai intelligence artificielle ecrire rediger generer assistant' },
      { group: 'IA', icon: '✦', label: 'Continuer l’écriture', hint: 'IA', run: () => P.ai && P.ai.ui.start('continue', {}), kw: 'ia ai suite poursuivre' },
      { group: 'IA', icon: '✦', label: 'Idées pour continuer', hint: 'IA', run: () => P.ai && P.ai.ui.start('ideas', {}), kw: 'ia ai idees brainstorm pistes' },
      { group: 'IA', icon: '✦', label: 'Générer un plan', hint: 'IA', run: () => P.ai && P.ai.ui.start('outline', {}), kw: 'ia ai plan structure' },
      { group: 'IA', icon: '✦', label: 'Résumer le document', hint: 'IA', run: () => P.ai && P.ai.ui.start('summarize', {}), kw: 'ia ai resume' },
      ...BLOCK_ITEMS.map((b) => Object.assign({}, b, { group: 'Blocs' })),
    ];
  }

  const menu = $('#atmenu');
  let at = null;       // {node, offset} position du déclencheur saisi (« @ » ou « / »), ou null s'il vient du bouton
  let trig = '@';
  let menuOpen = false;
  let allItems = [];
  let visible = [];
  let idx = 0;

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function renderMenu(filter) {
    const f = norm(filter || '').trim();
    visible = allItems.filter((it) => !f || norm(it.label + ' ' + (it.kw || '') + ' ' + it.group).includes(f));
    if (idx >= visible.length) idx = 0;
    menu.replaceChildren();
    let lastGroup = null;
    visible.forEach((it, i) => {
      if (it.group !== lastGroup) { menu.append(h('div', { class: 'at-group', text: it.group })); lastGroup = it.group; }
      const ico = h('span', { class: 'at-ico', text: it.icon });
      if (it.tone) ico.style.setProperty('--tone', it.tone);
      menu.append(h('div', {
        class: 'at-item' + (i === idx ? ' sel' : ''),
        role: 'option',
        onmousedown: (e) => { e.preventDefault(); choose(it); },
      }, ico, h('span', { class: 'at-label', text: it.label }), h('span', { class: 'at-hint', text: it.hint || '' })));
    });
    if (!visible.length) menu.append(h('div', { class: 'at-empty', text: 'Aucun résultat' }));
    const sel = menu.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function placeMenu() {
    const sel = window.getSelection();
    let rect = null;
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0).cloneRange();
      r.collapse(true);
      rect = r.getClientRects()[0] || null;
      if (!rect) { const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement; rect = n.getBoundingClientRect(); }
    }
    rect = rect || { left: 200, bottom: 200 };
    menu.style.left = Math.max(8, Math.min(rect.left, innerWidth - 340)) + 'px';
    menu.style.top = Math.max(8, Math.min(rect.bottom + 4, innerHeight - 330)) + 'px';
  }

  function openAtMenu(anchor, t) {
    if (readOnly()) return;
    trig = t || '@';
    allItems = trig === '/' ? slashItems() : atItems();
    at = anchor;
    idx = 0;
    menuOpen = true;
    menu.hidden = false;
    menu.setAttribute('aria-label', trig === '/' ? 'Blocs et mise en forme' : 'Puces intelligentes, blocs et champs');
    renderMenu('');
    placeMenu();
  }

  function closeAtMenu() { menuOpen = false; at = null; menu.hidden = true; }

  async function choose(item) {
    const sel = window.getSelection();
    if (at && ed.contains(at.node)) {
      let endNode = sel.anchorNode, endOff = sel.anchorOffset;
      if (endNode !== at.node) { endNode = at.node; endOff = at.node.nodeValue.length; }
      const r = document.createRange();
      r.setStart(at.node, at.offset);
      r.setEnd(endNode, Math.max(endOff, at.offset));
      r.deleteContents();
      r.collapse(true);
      if (trig === '/') {
        // le bloc doit rester un paragraphe vide « réel » (avec <br>), sinon Chromium le replie à zéro de hauteur
        const blk = at.node.parentElement && at.node.parentElement.closest('p, h1, h2, h3, li, td, th, div, blockquote');
        if (blk && ed.contains(blk) && !blk.textContent && !blk.querySelector('img, br')) {
          blk.innerHTML = '<br>';
          r.setStart(blk, 0);
          r.collapse(true);
        }
      }
      sel.removeAllRanges();
      sel.addRange(r);
    }
    P.saveSel();
    closeAtMenu();
    await item.run();
  }

  function atOnInput(e) {
    if (e.inputType === 'insertText' && !menuOpen && (e.data === '@' || e.data === '/')) {
      const sel = window.getSelection();
      const n = sel.anchorNode;
      const off = sel.anchorOffset;
      if (!n || n.nodeType !== 3 || n.nodeValue[off - 1] !== e.data) return;
      if (e.data === '@' && (off === 1 || /\s/.test(n.nodeValue[off - 2]))) openAtMenu({ node: n, offset: off - 1 }, '@');
      else if (e.data === '/' && state.mode === 'edit' && off === 1 && n.nodeValue === '/') {
        // « / » ne s'active qu'au début d'un bloc vide (pas dans « 1/2 », « et/ou » ou une adresse)
        const blk = n.parentElement && n.parentElement.closest('p, h1, h2, h3, li, td, th, div, blockquote');
        if (blk && blk.textContent === '/') openAtMenu({ node: n, offset: 0 }, '/');
      }
      return;
    }
    if (!menuOpen || !at) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.anchorNode !== at.node || at.node.nodeValue[at.offset] !== trig || sel.anchorOffset <= at.offset) { closeAtMenu(); return; }
    const typed = at.node.nodeValue.slice(at.offset + 1, sel.anchorOffset);
    if (/^\s/.test(typed)) { closeAtMenu(); return; }   // « @ » ou « / » suivi d'une espace : c'est du texte ordinaire
    idx = 0;
    renderMenu(typed);
    if (!visible.length && /\s$/.test(typed)) { closeAtMenu(); return; }   // les noms à plusieurs mots sont permis tant qu'il reste des résultats
    placeMenu();
  }

  ed.addEventListener('keydown', (e) => {
    if (!menuOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % Math.max(1, visible.length); renderMenu(currentFilter()); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + visible.length) % Math.max(1, visible.length); renderMenu(currentFilter()); }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      if (visible[idx]) { e.preventDefault(); choose(visible[idx]); } else closeAtMenu();
    } else if (e.key === 'Escape') { e.preventDefault(); closeAtMenu(); }
  }, true);

  function currentFilter() {
    const sel = window.getSelection();
    if (!at || !sel.rangeCount || sel.anchorNode !== at.node) return '';
    return at.node.nodeValue.slice(at.offset + 1, sel.anchorOffset);
  }

  document.addEventListener('mousedown', (e) => { if (menuOpen && !e.target.closest('#atmenu')) closeAtMenu(); });
  ed.addEventListener('blur', () => { /* le menu se ferme au prochain clic ailleurs */ });

  // ---------- Événements de l'éditeur ----------
  ed.addEventListener('input', (e) => {
    if (!ed.firstElementChild) {
      ed.innerHTML = '<p><br></p>';
      const r = document.createRange();
      r.setStart(ed.firstChild, 0);
      r.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    if (pendingSizePt != null) { fixSizes(); pendingSizePt = null; }
    fixChecklists();
    ensureTrailing();
    P.markDirty();
    P.updateCounts();
    scheduleToc();
    atOnInput(e);
  });

  // Tooltips des puces et des liens
  const tip = $('#tip');
  function tipFor(el) {
    const d = el.dataset;
    if (el.matches('a[href]')) return [h('b', { text: el.getAttribute('href') }), h('div', { class: 'tip-sub', text: 'Ctrl+clic pour ouvrir' })];
    switch (d.type) {
      case 'person': return [h('b', { text: el.textContent }), d.email && h('div', { text: d.email }), d.note && h('div', { class: 'tip-sub', text: d.note }), h('div', { class: 'tip-sub', text: d.email ? 'Clic : écrire un courriel' : 'Aucun courriel enregistré' })];
      case 'file': return [h('b', { text: el.textContent }), h('div', { class: 'tip-sub', text: d.path }), h('div', { class: 'tip-sub', text: 'Clic : afficher dans le dossier' })];
      case 'place': return [h('b', { text: el.textContent }), h('div', { class: 'tip-sub', text: 'Clic : ouvrir la carte (Internet requis)' })];
      case 'link': return [h('b', { text: d.href }), h('div', { class: 'tip-sub', text: 'Clic : ouvrir dans le navigateur' })];
      case 'date': return [h('b', { text: d.iso || '' })];
      case 'var': return [h('b', { text: 'Variable : ' + d.var }), h('div', { class: 'tip-sub', text: 'Clic : modifier la valeur' })];
      case 'status': return [h('b', { text: 'Statut' }), h('div', { class: 'tip-sub', text: 'Clic : changer de statut' })];
      default: return null;
    }
  }
  ed.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('.chip, a[href]');
    if (!el) return;
    const content = tipFor(el);
    if (!content) return;
    tip.replaceChildren(...content.filter(Boolean));
    const r = el.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = Math.max(8, Math.min(r.left, innerWidth - 300)) + 'px';
    tip.style.top = (r.bottom + 6) + 'px';
  });
  ed.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('.chip, a[href]')) tip.hidden = true; });

  ed.addEventListener('click', async (e) => {
    const mailBtn = e.target.closest('button[data-act="mail"]');
    if (mailBtn) { openMail(mailBtn.closest('.block-mail')); return; }
    const ti = e.target.closest('.toc-item');
    if (ti) { const hd = tocHeadings()[+ti.dataset.h]; if (hd) hd.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    const c = e.target.closest('.chip');
    if (c) {
      const d = c.dataset;
      if (d.type === 'person' && d.email) native.openExternal('mail', 'mailto:' + d.email);
      else if ((d.type === 'link' || d.type === 'place') && d.href) native.openExternal('url', d.href);
      else if (d.type === 'file' && d.path) native.openExternal('reveal', d.path);
      else if (d.type === 'var') { P.showPanel && P.showPanel('variables'); }
      else if (d.type === 'status' && !readOnly()) {
        const i = (STATUS.findIndex((s) => s[0] === d.status) + 1) % STATUS.length;
        c.dataset.status = STATUS[i][0];
        c.textContent = STATUS[i][1];
        P.markDirty();
      }
      return;
    }
    const a = e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey)) {
      const href = a.getAttribute('href');
      native.openExternal(/^mailto:/i.test(href) ? 'mail' : 'url', href);
      return;
    }
    const cm = e.target.closest('.cmt');
    if (cm && P.focusComment) P.focusComment(cm.dataset.cid, true);
  });

  // ---------- Collage et glisser-déposer ----------
  const readAsDataURL = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
  const okImage = (f) => f && /^image\/(png|jpeg|gif)$/.test(f.type) && f.size <= 8 * 1024 * 1024;

  ed.addEventListener('paste', async (e) => {
    if (readOnly()) { e.preventDefault(); return; }
    const cd = e.clipboardData;
    if (!cd) return;
    const plain = P.takePlainPaste ? P.takePlainPaste() : false;   // Ctrl+Maj+V ou « Coller sans la mise en forme »
    const html = plain ? '' : cd.getData('text/html');
    const text = cd.getData('text/plain');
    const file = Array.from(cd.files || []).find(okImage);
    e.preventDefault();
    if (state.mode === 'suggest') { if (text && P.insertSuggested) P.insertSuggested(text); return; }
    if (file && !html) { P.insertHTML(`<img src="${await readAsDataURL(file)}">`); return; }
    document.execCommand('styleWithCSS', false, false);
    if (html) document.execCommand('insertHTML', false, P.sanitize(html, { pasted: true }));
    else document.execCommand('insertText', false, text);
    fixChecklists();
    P.markDirty();
  });

  /* Déplacer une image (ou du texte) dans le document avec la souris : le glisser-déposer natif du navigateur s'en charge, ce qui
     donne le repère d'insertion et une seule étape pour Ctrl+Z. Le reste (fichier déposé depuis l'ordinateur) passe par le code ci-dessous. */
  let innerDrag = false;
  ed.addEventListener('dragstart', (e) => {
    if (state.mode !== 'edit' || readOnly()) { e.preventDefault(); return; }       // lecture seule et suggestions : on ne déplace pas
    innerDrag = true;
    const t = e.target;
    if (t && t.tagName === 'IMG' && e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  ed.addEventListener('dragend', () => { innerDrag = false; });
  window.addEventListener('dragover', (e) => { if (innerDrag && ed.contains(e.target)) return; e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (innerDrag && ed.contains(e.target)) return;
    e.preventDefault();
    if (readOnly()) return;
    const file = Array.from((e.dataTransfer && e.dataTransfer.files) || []).find(okImage);
    if (!file) return;
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (r && ed.contains(r.startContainer)) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); P.saveSel(); }
    P.insertHTML(`<img src="${await readAsDataURL(file)}">`);
  });

  // ---------- Rechercher / remplacer ----------
  const fb = $('#findbar');
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function findMatches() {
    const q = $('#find-q').value;
    if (!q) return [];
    const re = new RegExp(escRe(q), 'gi');
    const out = [];
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && n.parentElement.closest('.noexport, .chip')) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(n.nodeValue))) { out.push({ node: n, start: m.index, end: m.index + m[0].length }); if (m[0].length === 0) re.lastIndex++; }
    }
    return out;
  }

  function countFind() {
    const n = findMatches().length;
    $('#find-count').textContent = $('#find-q').value ? `${n} résultat${n > 1 ? 's' : ''}` : '';
    return n;
  }

  function selectMatch(m) {
    const r = document.createRange();
    r.setStart(m.node, m.start);
    r.setEnd(m.node, m.end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    P.saveSel();
    if (m.node.parentElement) m.node.parentElement.scrollIntoView({ block: 'center' });
  }

  function findStep(back) {
    const ms = findMatches();
    $('#find-count').textContent = $('#find-q').value ? `${ms.length} résultat${ms.length > 1 ? 's' : ''}` : '';
    if (!ms.length) return false;
    const cur = P.currentRange();
    let pick = null;
    if (cur) {
      const probe = document.createRange();
      for (const m of back ? ms.slice().reverse() : ms) {
        probe.setStart(m.node, m.start);
        probe.setEnd(m.node, m.end);
        const cmp = back ? probe.compareBoundaryPoints(Range.START_TO_START, cur) : probe.compareBoundaryPoints(Range.START_TO_END, cur);
        if (back ? cmp < 0 : cmp > 0) { pick = m; break; }
      }
    }
    selectMatch(pick || (back ? ms[ms.length - 1] : ms[0]));
    return true;
  }

  function replaceOne() {
    if (readOnly()) return;
    const cur = P.currentRange();
    const q = $('#find-q').value;
    if (cur && q && cur.toString().toLowerCase() === q.toLowerCase()) {
      P.restoreSel();
      document.execCommand('insertText', false, $('#find-r').value);
      P.markDirty();
    }
    findStep(false);
  }

  function replaceAll() {
    if (readOnly()) return;
    if (state.mode === 'suggest') { P.toast('Remplacer tout n’est pas disponible en mode Suggestion.'); return; }
    const q = $('#find-q').value;
    if (!q) return;
    const repl = $('#find-r').value;
    const ms = findMatches();
    // de la fin vers le début pour ne pas décaler les positions
    for (let i = ms.length - 1; i >= 0; i--) ms[i].node.replaceData(ms[i].start, ms[i].end - ms[i].start, repl);
    if (ms.length) P.markDirty();
    P.toast(ms.length ? `${ms.length} remplacement${ms.length > 1 ? 's' : ''}` : 'Aucun résultat');
    countFind();
    P.updateCounts();
  }

  function openFind() {
    P.saveSel();
    fb.hidden = false;
    const s = String(window.getSelection());
    if (s && !s.includes('\n') && s.length < 100) $('#find-q').value = s;
    $('#find-q').focus();
    $('#find-q').select();
    countFind();
  }
  P.openFind = openFind;
  $('#find-q').addEventListener('input', countFind);
  $('#find-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey); } });
  $('#find-prev').addEventListener('click', () => findStep(true));
  $('#find-next').addEventListener('click', () => findStep(false));
  $('#find-rep').addEventListener('click', replaceOne);
  $('#find-all').addEventListener('click', replaceAll);
  $('#find-close').addEventListener('click', () => { fb.hidden = true; ed.focus(); });

  // ---------- Raccourcis ----------
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape' && !fb.hidden && !document.querySelector('.overlay')) { fb.hidden = true; ed.focus(); }
    if (!mod || (P.app && !P.app.inDoc())) return;
    const k = e.key.toLowerCase();
    if (k === 'k' && !e.altKey) { e.preventDefault(); if (!readOnly()) insertLink(); }
    else if (k === 'h' || (k === 'f' && !e.shiftKey && !e.altKey)) { e.preventDefault(); openFind(); }
    else if (e.key === '\\') { e.preventDefault(); if (!readOnly()) P.exec('removeFormat'); }
    else if (k === 'm' && e.altKey) { e.preventDefault(); if (P.addComment) P.addComment(); }
  });

  document.execCommand('defaultParagraphSeparator', false, 'p');
})();
