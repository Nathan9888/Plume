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
    ed.querySelectorAll('.chip, .pagebreak, .noexport').forEach((n) => { if (n.getAttribute('contenteditable') !== 'false') n.setAttribute('contenteditable', 'false'); });
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
    else if (b.dataset.tbl) tableOp(b.dataset.tbl);
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
  $('#tb-block').addEventListener('change', (e) => setBlock(e.target.value));
  $('#tb-font').addEventListener('change', (e) => P.exec('fontName', e.target.value, true));

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
    $('#tb-block').value = ['h1', 'h2', 'h3', 'blockquote'].includes(blk) ? blk : 'p';
    const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    if (el && el.nodeType === 1) {
      const cs = getComputedStyle(el);
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      const fsel = $('#tb-font');
      if (Array.from(fsel.options).some((o) => o.value === fam)) fsel.value = fam;
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
  let countTimer = null;
  P.updateCounts = function () {
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      const text = ed.textContent || '';
      const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
      $('#st-count').textContent = `${words} mot${words > 1 ? 's' : ''} · ${text.replace(/\s/g, '').length} caractères`;
      $('#st-pages').textContent = state.pageless ? '' : `≈ ${Math.max(1, Math.ceil((ed.offsetHeight - 192) / 864))} page(s)`;
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

  // ---------- Tableaux ----------
  const tableHTML = (rows, cols) =>
    '<table><tbody>' + ('<tr>' + '<td><br></td>'.repeat(cols) + '</tr>').repeat(rows) + '</tbody></table>';

  async function insertTable() {
    P.saveSel();
    const r = await P.modal({
      title: 'Insérer un tableau',
      fields: [
        { id: 'rows', label: 'Lignes', type: 'number', value: 3, min: 1, max: 50 },
        { id: 'cols', label: 'Colonnes', type: 'number', value: 3, min: 1, max: 12 },
      ],
    });
    if (!r) return;
    const rows = Math.max(1, Math.min(50, parseInt(r.values.rows, 10) || 3));
    const cols = Math.max(1, Math.min(12, parseInt(r.values.cols, 10) || 3));
    P.insertHTML(tableHTML(rows, cols) + '<p><br></p>');
  }

  function tableOp(op) {
    P.restoreSel();
    const cell = closestFromSel('td, th');
    const table = closestFromSel('table');
    if (!cell || !table) return;
    const row = cell.parentElement;
    const emptyLike = (c) => { const n = document.createElement(c.tagName === 'TH' ? 'td' : c.tagName); n.innerHTML = '<br>'; return n; };
    if (op === 'addRow') {
      const nr = document.createElement('tr');
      Array.from(row.cells).forEach((c) => nr.append(emptyLike(c)));
      row.after(nr);
    } else if (op === 'addCol') {
      const idx = cell.cellIndex;
      Array.from(table.rows).forEach((r) => { const c = r.cells[idx]; if (c) c.after(emptyLike(c)); });
    } else if (op === 'delRow') {
      if (table.rows.length <= 1) table.remove(); else row.remove();
    } else if (op === 'delCol') {
      const idx = cell.cellIndex;
      if (row.cells.length <= 1) table.remove();
      else Array.from(table.rows).forEach((r) => { if (r.cells[idx]) r.cells[idx].remove(); });
    } else if (op === 'delTable') {
      table.remove();
    }
    if (!ed.firstElementChild) ed.innerHTML = '<p><br></p>';
    P.markDirty();
    P.updateCounts();
    updateToolbar();
  }

  P.tableOp = tableOp;
  P.inTable = () => !!closestFromSel('td, th');

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
    at: () => { P.saveSel(); openAtMenu(null); },
    link: insertLink,
    image: insertImage,
    table: insertTable,
    hr: () => P.exec('insertHorizontalRule'),
    pagebreak: () => P.insertHTML('<div class="pagebreak" contenteditable="false"></div><p><br></p>'),
    checklist,
    comment: () => P.addComment && P.addComment(),
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

  // ---------- Menu @ ----------
  const AT_ITEMS = [
    { group: 'Puces intelligentes', icon: '👤', label: 'Personne', hint: 'Carte de contact', run: insertPerson },
    { group: 'Puces intelligentes', icon: '📅', label: "Date d'aujourd'hui", hint: '', run: () => insertDate(true) },
    { group: 'Puces intelligentes', icon: '📅', label: 'Date…', hint: 'Choisir une date', run: () => insertDate(false) },
    { group: 'Puces intelligentes', icon: '📎', label: 'Fichier', hint: 'Lien vers un fichier local', run: insertFile },
    { group: 'Puces intelligentes', icon: '📍', label: 'Lieu', hint: 'Ouvre une carte', run: insertPlace },
    { group: 'Puces intelligentes', icon: '🔗', label: 'Lien web', hint: '', run: insertUrlChip },
    { group: 'Puces intelligentes', icon: '{ }', label: 'Variable', hint: 'Valeur mise à jour partout', run: insertVariable },
    { group: 'Blocs', icon: '📝', label: 'Notes de réunion', hint: 'Date, participants, actions', run: blockMeeting },
    { group: 'Blocs', icon: '✉', label: 'Brouillon de courriel', hint: 'S’ouvre dans votre messagerie', run: blockMail },
    { group: 'Blocs', icon: '📊', label: 'Suivi de projet', hint: 'Tableau avec statuts', run: blockTracker },
    { group: 'Blocs', icon: '☑', label: 'Liste de tâches', hint: '', run: checklist },
    { group: 'Blocs', icon: '▦', label: 'Tableau', hint: '', run: insertTable },
    { group: 'Blocs', icon: '⤓', label: 'Saut de page', hint: '', run: actions.pagebreak },
  ];

  const menu = $('#atmenu');
  let at = null;       // {node, offset} position du « @ » saisi, ou null s'il vient du bouton
  let menuOpen = false;
  let visible = [];
  let idx = 0;

  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  function renderMenu(filter) {
    const f = norm(filter || '');
    visible = AT_ITEMS.filter((it) => !f || norm(it.label).includes(f) || norm(it.group).includes(f));
    if (idx >= visible.length) idx = 0;
    menu.replaceChildren();
    let lastGroup = null;
    visible.forEach((it, i) => {
      if (it.group !== lastGroup) { menu.append(h('div', { class: 'at-group', text: it.group })); lastGroup = it.group; }
      menu.append(h('div', {
        class: 'at-item' + (i === idx ? ' sel' : ''),
        role: 'option',
        onmousedown: (e) => { e.preventDefault(); choose(it); },
      }, h('span', { class: 'at-ico', text: it.icon }), h('span', { class: 'at-label', text: it.label }), h('span', { class: 'at-hint', text: it.hint })));
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

  function openAtMenu(anchor) {
    if (readOnly()) return;
    at = anchor;
    idx = 0;
    menuOpen = true;
    menu.hidden = false;
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
      sel.removeAllRanges();
      sel.addRange(r);
    }
    P.saveSel();
    closeAtMenu();
    await item.run();
  }

  function atOnInput(e) {
    if (e.inputType === 'insertText' && e.data === '@' && !menuOpen) {
      const sel = window.getSelection();
      const n = sel.anchorNode;
      const off = sel.anchorOffset;
      if (n && n.nodeType === 3 && n.nodeValue[off - 1] === '@' && (off === 1 || /\s/.test(n.nodeValue[off - 2]))) {
        openAtMenu({ node: n, offset: off - 1 });
      }
      return;
    }
    if (!menuOpen || !at) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.anchorNode !== at.node || at.node.nodeValue[at.offset] !== '@' || sel.anchorOffset <= at.offset) { closeAtMenu(); return; }
    const typed = at.node.nodeValue.slice(at.offset + 1, sel.anchorOffset);
    if (/\s/.test(typed)) { closeAtMenu(); return; }
    idx = 0;
    renderMenu(typed);
    placeMenu();
  }

  ed.addEventListener('keydown', (e) => {
    if (!menuOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % Math.max(1, visible.length); renderMenu(currentFilter()); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + visible.length) % Math.max(1, visible.length); renderMenu(currentFilter()); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (visible[idx]) choose(visible[idx]); else closeAtMenu(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAtMenu(); }
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
    P.markDirty();
    P.updateCounts();
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
    const html = cd.getData('text/html');
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

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
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
