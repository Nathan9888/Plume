/* Plume — révision : commentaires (avec assignation) et mode Suggestion (modifications suivies).
 *
 * Mode Suggestion : le texte tapé est enveloppé dans <ins class="sg-ins">, le texte supprimé dans
 * <del class="sg-del"> au lieu d'être retiré. Seuls le texte tapé, collé et supprimé est suivi ;
 * la mise en forme, les objets insérés et les sauts de paragraphe ne le sont pas. */
(function () {
  'use strict';
  const { h } = P;
  const ed = P.editor;
  const state = P.state;
  P.panels = P.panels || {};

  const author = () => state.author || 'Moi';
  const nowIso = () => new Date().toISOString();
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const short = (s, n) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const closestEl = (node, selector) => {
    const el = node && (node.nodeType === 3 ? node.parentElement : node);
    return el && el.closest ? el.closest(selector) : null;
  };
  const contacts = () => {
    try { return JSON.parse(localStorage.getItem('plume.contacts') || '[]'); } catch (_) { return []; }
  };
  const readOnly = () => state.mode === 'view';

  /* ===================== Commentaires ===================== */

  const anchors = (id) => ed.querySelectorAll(`.cmt[data-cid="${CSS.escape(String(id))}"]`);
  let filter = 'open';
  let activeId = null;

  P.addComment = async function () {
    if (readOnly()) return;
    P.saveSel();
    const r0 = P.currentRange();
    if (!r0 || r0.collapsed || !P.textSegments(r0).length) { P.toast('Sélectionnez d’abord le texte à commenter.'); return; }
    const r = await P.modal({
      title: 'Nouveau commentaire',
      fields: [
        { id: 'text', label: 'Commentaire', type: 'textarea', rows: 4 },
        { id: 'assignee', label: 'Assigner à (facultatif)', list: contacts().map((c) => c.name) },
      ],
      ok: 'Commenter',
    });
    if (!r || !r.values.text.trim()) return;
    const range = P.currentRange();
    const segs = range && !range.collapsed ? P.textSegments(range) : [];
    if (!segs.length) { P.toast('La sélection a changé : le commentaire n’a pas été ajouté.'); return; }
    const id = P.uid();
    P.wrapSegments(segs, () => h('span', { class: 'cmt', 'data-cid': id }));
    state.comments.push({
      id, text: r.values.text.trim(), author: author(), date: nowIso(),
      resolved: false, assignee: r.values.assignee.trim(), replies: [],
    });
    P.markDirty();
    filter = filter === 'resolved' ? 'open' : filter;
    P.showPanel('comments');
    P.focusComment(id);
  };

  P.focusComment = function (id, fromEditor) {
    activeId = id;
    ed.querySelectorAll('.cmt.active').forEach((n) => n.classList.remove('active'));
    const spans = anchors(id);
    spans.forEach((n) => n.classList.add('active'));
    if (fromEditor) {
      P.showPanel('comments');
      const card = document.querySelector(`#sidebody [data-cid="${CSS.escape(String(id))}"]`);
      if (card) card.scrollIntoView({ block: 'nearest' });
    } else if (spans[0]) {
      spans[0].scrollIntoView({ block: 'center' });
    }
    document.querySelectorAll('#sidebody .thread').forEach((c) => c.classList.toggle('active', c.dataset.cid === String(id)));
  };

  async function assign(c) {
    const r = await P.modal({
      title: 'Assigner le commentaire',
      message: 'La personne apparaît comme responsable de cette action. Laissez vide pour retirer l’assignation.',
      fields: [{ id: 'who', label: 'Nom', value: c.assignee || '', list: contacts().map((x) => x.name) }],
    });
    if (!r) return;
    c.assignee = r.values.who.trim();
    P.markDirty();
    P.renderPanel();
  }

  function notify(c) {
    const person = contacts().find((x) => x.name.toLowerCase() === String(c.assignee || '').toLowerCase());
    if (!person || !person.email) { P.toast('Aucun courriel enregistré pour ' + (c.assignee || 'cette personne') + ' (voir la puce « Personne »).'); return; }
    const quote = Array.from(anchors(c.id)).map((n) => n.textContent).join('');
    const subject = `Action demandée : ${state.title || 'Document'}`;
    const body = `${c.text}\n\nExtrait : « ${short(quote, 200)} »\nDocument : ${state.title || 'Sans titre'}\nDe : ${c.author}`;
    native.openExternal('mail', `mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(short(body, 1500))}`);
  }

  async function removeComment(c) {
    if (!(await P.confirm('Supprimer ce commentaire ?', 'Le commentaire et ses réponses seront supprimés. Le texte commenté n’est pas modifié.', 'Supprimer'))) return;
    anchors(c.id).forEach((n) => P.unwrap(n));
    state.comments = state.comments.filter((x) => x.id !== c.id);
    P.markDirty();
    P.renderPanel();
  }

  function threadCard(c) {
    const spans = anchors(c.id);
    const orphan = spans.length === 0;
    const quote = orphan ? '' : Array.from(spans).map((n) => n.textContent).join('');
    const ro = readOnly();
    const card = h('div', { class: 'card thread' + (c.resolved ? ' resolved' : '') + (orphan ? ' orphan' : '') + (activeId === c.id ? ' active' : ''), 'data-cid': c.id,
      onclick: (e) => { if (!e.target.closest('button, input')) P.focusComment(c.id); } });
    card.append(h('div', { class: 'head' }, h('span', { class: 'who', text: c.author || '—' }), h('span', { class: 'when', text: fmtDate(c.date) })));
    card.append(orphan
      ? h('div', { class: 'quote muted', text: 'Le texte commenté a été supprimé.' })
      : h('blockquote', { class: 'quote', text: '« ' + short(quote, 120) + ' »' }));
    card.append(h('div', { class: 'txt', text: c.text }));
    if (c.assignee) card.append(h('div', { class: 'assign' }, h('span', { class: 'pill', text: 'Assigné à ' + c.assignee })));
    for (const rep of c.replies || []) {
      card.append(h('div', { class: 'reply' },
        h('div', { class: 'head' }, h('span', { class: 'who', text: rep.author || '—' }), h('span', { class: 'when', text: fmtDate(rep.date) })),
        h('div', { class: 'txt', text: rep.text })));
    }
    if (!c.resolved && !ro) {
      const send = () => {
        const v = input.value.trim();
        if (!v) return;
        (c.replies = c.replies || []).push({ author: author(), text: v, date: nowIso() });
        P.markDirty();
        P.renderPanel();
      };
      const input = h('input', { type: 'text', class: 'reply-in', placeholder: 'Répondre…', spellcheck: 'true',
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } } });
      card.append(h('div', { class: 'reply-form' }, input, h('button', { class: 'sm', type: 'button', text: 'Répondre', onclick: send })));
    }
    const acts = h('div', { class: 'actions' });
    if (!ro) {
      acts.append(h('button', { class: 'sm', type: 'button', text: c.resolved ? 'Rouvrir' : 'Résoudre', onclick: () => {
        c.resolved = !c.resolved;
        anchors(c.id).forEach((n) => n.classList.toggle('resolved', c.resolved));
        P.markDirty();
        P.renderPanel();
      } }));
      acts.append(h('button', { class: 'sm', type: 'button', text: c.assignee ? 'Réassigner' : 'Assigner', onclick: () => assign(c) }));
      if (c.assignee) acts.append(h('button', { class: 'sm', type: 'button', text: '✉ Notifier', title: 'Ouvre un courriel dans votre messagerie', onclick: () => notify(c) }));
      acts.append(h('button', { class: 'sm danger', type: 'button', text: 'Supprimer', onclick: () => removeComment(c) }));
    }
    card.append(acts);
    return card;
  }

  P.panels.comments = function (body) {
    const sel = h('select', { class: 'filter', title: 'Filtrer', onchange: (e) => { filter = e.target.value; P.renderPanel(); } },
      [['open', 'Ouverts'], ['assigned', 'Assignés (actions)'], ['resolved', 'Résolus'], ['all', 'Tous']]
        .map(([v, l]) => h('option', { value: v, text: l, selected: v === filter })));
    body.append(h('div', { class: 'panel-bar' }, h('b', { text: 'Commentaires' }), sel));
    const shown = state.comments.filter((c) =>
      filter === 'all' || (filter === 'open' && !c.resolved) || (filter === 'resolved' && c.resolved) || (filter === 'assigned' && c.assignee && !c.resolved));
    if (!shown.length) {
      body.append(h('p', { class: 'empty', text: state.comments.length ? 'Aucun commentaire dans ce filtre.' : 'Sélectionnez du texte puis cliquez sur « Commenter » (Ctrl+Alt+M).' }));
      return;
    }
    // dans l'ordre d'apparition dans le document
    const pos = (c) => { const a = anchors(c.id)[0]; return a ? Array.from(ed.querySelectorAll('.cmt')).indexOf(a) : 1e9; };
    shown.slice().sort((a, b) => pos(a) - pos(b)).forEach((c) => body.append(threadCard(c)));
  };

  /* ===================== Mode Suggestion ===================== */

  const mkSug = (tag, cls) => h(tag, { class: cls, 'data-author': author(), 'data-date': nowIso() });
  const fireInput = (type, data) => ed.dispatchEvent(new InputEvent('input', { inputType: type, data: data == null ? null : data, bubbles: true }));

  function escapeDel(sel) {
    if (!sel.rangeCount) return;
    const del = closestEl(sel.anchorNode, 'del.sg-del');
    if (del && ed.contains(del)) {
      const r = document.createRange();
      r.setStartAfter(del);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  const ownIns = (node) => {
    const ins = closestEl(node, 'ins.sg-ins');
    return ins && ed.contains(ins) && ins.dataset.author === author() ? ins : null;
  };

  /** Marque la sélection comme supprimée (ou retire le texte de ses propres ajouts). */
  function markSelectionDeleted(backward) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0).cloneRange();
    const a = document.createElement('span');
    const b = document.createElement('span');
    const rEnd = range.cloneRange(); rEnd.collapse(false); rEnd.insertNode(b);
    const rStart = range.cloneRange(); rStart.collapse(true); rStart.insertNode(a);
    try {
      const inner = document.createRange();
      inner.setStartAfter(a);
      inner.setEndBefore(b);
      const toWrap = [];
      for (const s of P.textSegments(inner)) {
        const el = s.node.parentElement;
        if (!el || el.closest('del.sg-del')) continue;
        const ins = ownIns(el);
        if (ins) {
          s.node.deleteData(s.start, s.end - s.start);
          if (!ins.textContent && !ins.querySelector('br, img')) ins.remove();
        } else toWrap.push(s);
      }
      P.wrapSegments(toWrap, () => mkSug('del', 'sg-del'));
      const r = document.createRange();
      if (backward) r.setStartBefore(a); else r.setStartAfter(b);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } finally {
      a.remove();
      b.remove();
    }
    return true;
  }

  /** Insère du texte comme suggestion à la position du curseur. */
  P.insertSuggested = function (text) {
    text = String(text == null ? '' : text);
    if (!text) return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return;
    if (!sel.isCollapsed) markSelectionDeleted(false);
    escapeDel(sel);
    if (ownIns(sel.anchorNode)) { document.execCommand('insertText', false, text); return; }

    const range = sel.getRangeAt(0);
    // Prolonge l'ajout qui précède immédiatement, s'il est du même auteur
    let prev = null;
    const c = range.startContainer, o = range.startOffset;
    if (c.nodeType === 1) prev = c.childNodes[o - 1] || null;
    else if (c.nodeType === 3 && o === 0) prev = c.previousSibling;
    const target = prev && prev.nodeType === 1 && prev.matches('ins.sg-ins') && prev.dataset.author === author() ? prev : null;
    const ins = target || mkSug('ins', 'sg-ins');
    let last = null;
    text.split(/\r?\n/).forEach((line, i) => {
      if (i > 0) ins.append(document.createElement('br'));
      if (line) { last = document.createTextNode(line); ins.append(last); }
    });
    if (!target) range.insertNode(ins);
    const caret = document.createRange();
    if (last) caret.setStart(last, last.nodeValue.length); else caret.setStartAfter(ins);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    fireInput('insertText', text);
  };

  function handleDelete(type) {
    const sel = window.getSelection();
    const backward = !/Forward$/.test(type);
    if (sel.isCollapsed) {
      const gran = /Word/.test(type) ? 'word' : /Line/.test(type) ? 'lineboundary' : 'character';
      sel.modify('extend', backward ? 'backward' : 'forward', gran);
    }
    if (sel.isCollapsed) return;
    if (markSelectionDeleted(backward)) fireInput(type);
  }

  ed.addEventListener('beforeinput', (e) => {
    if (state.mode !== 'suggest') return;
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return;
    const t = e.inputType;

    if (t === 'insertText' || t === 'insertReplacementText') {
      const text = e.data != null ? e.data : (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
      if (sel.isCollapsed) {
        escapeDel(sel);
        if (ownIns(sel.anchorNode)) return;      // frappe normale dans sa propre suggestion
      }
      e.preventDefault();
      P.insertSuggested(text);
    } else if (t === 'insertParagraph' || t === 'insertLineBreak') {
      if (sel.isCollapsed) { escapeDel(sel); return; }
      e.preventDefault();
      markSelectionDeleted(false);
      document.execCommand(t === 'insertLineBreak' ? 'insertLineBreak' : 'insertParagraph');
    } else if (t.startsWith('delete')) {
      e.preventDefault();
      handleDelete(t);
    } else if (t === 'insertFromDrop' || t === 'insertFromPaste' || t === 'insertFromYank') {
      e.preventDefault();       // le collage passe par P.insertSuggested (voir editor.js)
    }
  }, true);

  /* ----- Accepter / refuser ----- */

  function afterChange() {
    ed.querySelectorAll('p, li, td, th, h1, h2, h3, blockquote').forEach((b) => { if (!b.firstChild) b.appendChild(document.createElement('br')); });
    if (!ed.firstElementChild) ed.innerHTML = '<p><br></p>';
    P.markDirty();
    P.updateCounts();
    P.renderPanel();
  }

  function resolve(el, accept) {
    const isIns = el.matches('ins.sg-ins');
    if (isIns === accept) P.unwrap(el);   // ajout accepté, ou suppression refusée : le texte reste
    else el.remove();                      // ajout refusé, ou suppression acceptée : le texte part
  }

  P.acceptAll = (accept) => {
    // en commençant par les éléments les plus imbriqués
    Array.from(ed.querySelectorAll('ins.sg-ins, del.sg-del')).reverse().forEach((el) => { if (el.isConnected) resolve(el, accept); });
    afterChange();
  };

  P.panels.suggestions = function (body) {
    const items = Array.from(ed.querySelectorAll('ins.sg-ins, del.sg-del'));
    body.append(h('div', { class: 'panel-bar' }, h('b', { text: 'Suggestions' }),
      items.length && !readOnly() ? h('span', { class: 'bar-btns' },
        h('button', { class: 'sm', type: 'button', text: 'Tout accepter', onclick: () => P.acceptAll(true) }),
        h('button', { class: 'sm', type: 'button', text: 'Tout refuser', onclick: () => P.acceptAll(false) })) : null));
    if (!items.length) {
      body.append(h('p', { class: 'empty', text: 'Aucune suggestion. Choisissez le mode « Suggestion » en haut de la fenêtre : ce que vous tapez ou supprimez sera proposé, sans être appliqué avant votre accord.' }));
      return;
    }
    for (const el of items) {
      const isIns = el.matches('ins');
      const card = h('div', { class: 'card sug ' + (isIns ? 'sug-ins' : 'sug-del'), onclick: (e) => { if (!e.target.closest('button')) el.scrollIntoView({ block: 'center' }); } },
        h('div', { class: 'head' }, h('span', { class: 'who', text: el.dataset.author || '—' }), h('span', { class: 'when', text: fmtDate(el.dataset.date) })),
        h('div', { class: 'txt' }, h('b', { text: isIns ? 'Ajout : ' : 'Suppression : ' }), short(el.textContent, 140) || '(saut de ligne)'));
      if (!readOnly()) {
        card.append(h('div', { class: 'actions' },
          h('button', { class: 'sm', type: 'button', text: 'Accepter', onclick: () => { resolve(el, true); afterChange(); } }),
          h('button', { class: 'sm', type: 'button', text: 'Refuser', onclick: () => { resolve(el, false); afterChange(); } })));
      }
      body.append(card);
    }
  };

  P.suggestionCount = () => ed.querySelectorAll('ins.sg-ins, del.sg-del').length;
  P.openCommentCount = () => state.comments.filter((c) => !c.resolved).length;
})();
