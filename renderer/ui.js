/* Plume — socle partagé : état, utilitaires DOM, boîtes de dialogue, assainissement du HTML. */
(function () {
  'use strict';

  const P = (window.P = {});

  P.state = {
    path: null,
    title: 'Sans titre',
    dirty: false,
    password: null,       // mot de passe de chiffrement (en mémoire seulement)
    pageless: false,
    mode: 'edit',         // edit | suggest | view
    author: '',
    variables: {},        // nom -> valeur
    comments: [],         // {id, text, author, date, resolved, assignee, replies:[]}
    versions: [],         // {id, name, date, html, variables, auto}
  };

  P.$ = (sel, root) => (root || document).querySelector(sel);
  P.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  P.editor = P.$('#page');
  P.uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  P.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Création de nœuds DOM sans innerHTML : h('div', {class:'x', onclick: fn}, 'texte', autreNoeud) */
  P.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  // ---------- Notifications ----------
  let toastTimer = null;
  P.toast = function (msg, ms) {
    const t = P.$('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3000);
  };

  // ---------- Boîte de dialogue modale ----------
  /**
   * P.modal({title, message, fields:[{id,label,type,value,placeholder,options,list,required}], buttons})
   * -> Promise<{button, values}|null>   (null = annulé)
   */
  P.modal = function (opts) {
    return new Promise((resolve) => {
      const fields = opts.fields || [];
      const buttons = opts.buttons || [
        { id: 'cancel', label: 'Annuler' },
        { id: 'ok', label: opts.ok || 'OK', primary: true },
      ];
      const inputs = {};
      const form = P.h('form', { class: 'modal', novalidate: true });
      form.append(P.h('h3', { text: opts.title || '' }));
      if (opts.message) form.append(P.h('p', { class: 'msg', text: opts.message }));
      for (const f of fields) {
        let input;
        if (f.type === 'textarea') input = P.h('textarea', { rows: f.rows || 4, placeholder: f.placeholder || '' });
        else if (f.type === 'select') input = P.h('select', {}, (f.options || []).map((o) => P.h('option', { value: o.value, text: o.label })));
        else {
          input = P.h('input', { type: f.type || 'text', placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
          if (f.min != null) input.min = f.min;
          if (f.max != null) input.max = f.max;
        }
        if (f.list && f.list.length) {
          const dl = P.h('datalist', { id: 'dl-' + f.id }, f.list.map((v) => P.h('option', { value: v })));
          form.append(dl);
          input.setAttribute('list', 'dl-' + f.id);
        }
        if (f.value != null) input.value = f.value;
        inputs[f.id] = input;
        form.append(P.h('label', { class: 'field' }, P.h('span', { text: f.label || '' }), input));
      }
      const row = P.h('div', { class: 'btnrow' });
      let primary = null;
      const finish = (button) => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (button === 'cancel') return resolve(null);
        const values = {};
        for (const f of fields) values[f.id] = inputs[f.id].value;
        resolve({ button, values });
      };
      for (const b of buttons) {
        const btn = P.h('button', { type: 'button', class: b.primary ? 'primary' : '', text: b.label, onclick: () => finish(b.id) });
        if (b.primary) primary = b;
        row.append(btn);
      }
      form.append(row);
      form.addEventListener('submit', (e) => { e.preventDefault(); if (primary) finish(primary.id); });
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('cancel'); }
      };
      document.addEventListener('keydown', onKey, true);
      const overlay = P.h('div', { class: 'overlay' }, form);
      document.body.append(overlay);
      const first = fields.length ? inputs[fields[0].id] : row.querySelector('button.primary');
      if (first) first.focus();
      if (first && first.select) first.select();
    });
  };

  P.confirm = async function (title, message, okLabel) {
    const r = await P.modal({ title, message, ok: okLabel || 'OK' });
    return !!r;
  };

  // ---------- Fenêtres contextuelles (menus, carte de profil…) ----------
  /**
   * P.pop.open(element, {anchor, align, x, y, onClose, onKey}) : une seule fenêtre contextuelle à la fois.
   * Elle se ferme au clic à l'extérieur, avec Échap ou quand la fenêtre perd le focus.
   * P.pop.add(element) rattache un élément supplémentaire (sous-menu) qui sera retiré en même temps.
   */
  P.pop = (function () {
    let cur = null;
    const layer = () => P.$('#pop');

    function close() {
      if (!cur) return;
      const c = cur;
      cur = null;
      c.els.forEach((e) => e.remove());
      document.removeEventListener('mousedown', c.onDown, true);
      document.removeEventListener('keydown', c.onKey, true);
      window.removeEventListener('blur', c.onBlur);
      window.removeEventListener('resize', c.onBlur);
      if (c.anchor && c.anchor.setAttribute) c.anchor.setAttribute('aria-expanded', 'false');
      if (c.onClose) c.onClose();
    }

    function place(el, o) {
      el.style.visibility = 'hidden';
      const w = el.offsetWidth, hgt = el.offsetHeight;
      let x = o.x, y = o.y;
      if (o.anchor) {
        const r = o.anchor.getBoundingClientRect();
        x = o.align === 'right' ? r.right - w : r.left;
        y = r.bottom + 4;
      }
      x = Math.max(8, Math.min(x == null ? 8 : x, window.innerWidth - w - 8));
      y = Math.max(8, Math.min(y == null ? 8 : y, window.innerHeight - hgt - 8));
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.visibility = '';
    }

    function open(el, o) {
      o = o || {};
      close();
      layer().append(el);
      place(el, o);
      const c = { els: [el], anchor: o.anchor || null, onClose: o.onClose };
      c.onDown = (e) => {
        if (e.target.closest && (e.target.closest('#pop > *') || (c.anchor && c.anchor.contains(e.target)))) return;
        close();
      };
      c.onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (o.onKey) o.onKey(e);
      };
      c.onBlur = () => close();
      document.addEventListener('mousedown', c.onDown, true);
      document.addEventListener('keydown', c.onKey, true);
      window.addEventListener('blur', c.onBlur);
      window.addEventListener('resize', c.onBlur);
      if (c.anchor && c.anchor.setAttribute) c.anchor.setAttribute('aria-expanded', 'true');
      cur = c;
      return el;
    }

    return {
      open,
      close,
      place,
      add(el) { if (cur) { layer().append(el); cur.els.push(el); } return el; },
      drop(el) { if (cur) { cur.els = cur.els.filter((e) => e !== el); } el.remove(); },
      isOpen: () => !!cur,
      anchor: () => (cur ? cur.anchor : null),
    };
  })();

  // ---------- Assainissement du HTML ----------
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'SVG', 'MATH', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'FRAME', 'FRAMESET', 'APPLET', 'TITLE', 'HEAD']);
  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP', 'COL', 'IMG', 'SPAN', 'DIV', 'HR', 'BLOCKQUOTE', 'PRE', 'CODE',
    'SUB', 'SUP', 'FONT', 'INS', 'DEL', 'INPUT', 'BUTTON']);
  const STYLE_OK = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'background-color', 'font-size', 'font-family', 'text-align'];
  const CLASS_OK = /^(chip|chip-[a-z]+|cmt|resolved|active|sg-ins|sg-del|checklist|pagebreak|block|block-mail|noexport)$/;
  const ATTR_OK = new Set(['class', 'style', 'contenteditable', 'colspan', 'rowspan', 'width', 'height', 'align', 'alt', 'title', 'checked', 'type', 'href', 'src', 'color', 'face', 'size']);

  /**
   * Nettoie un fragment HTML.
   * opts.pasted : contenu collé depuis l'extérieur (pas de classes ni d'attributs data-*, pas de boutons).
   */
  P.sanitize = function (html, opts) {
    const pasted = !!(opts && opts.pasted);
    const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    const walk = (node) => {
      for (const el of Array.from(node.children)) {
        const tag = el.tagName.toUpperCase();
        if (DROP.has(tag)) { el.remove(); continue; }
        if (!ALLOWED.has(tag) || (pasted && (tag === 'INPUT' || tag === 'BUTTON'))) {
          walk(el);
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        // Google Docs enveloppe tout dans <b style="font-weight:normal">
        if ((tag === 'B' || tag === 'STRONG') && /normal/i.test(el.style.fontWeight || '')) {
          walk(el);
          el.replaceWith(...Array.from(el.childNodes));
          continue;
        }
        const keepStyle = {};
        for (const p of STYLE_OK) { const v = el.style.getPropertyValue(p); if (v) keepStyle[p] = v; }
        for (const a of Array.from(el.attributes)) {
          const n = a.name.toLowerCase();
          const isData = n.startsWith('data-');
          if (n.startsWith('on') || !(ATTR_OK.has(n) || isData) || (pasted && (isData || n === 'class' || n === 'contenteditable'))) el.removeAttribute(a.name);
        }
        if (Object.keys(keepStyle).length) el.setAttribute('style', Object.entries(keepStyle).map(([k, v]) => `${k}:${v}`).join(';'));
        else el.removeAttribute('style');
        // Un document venu d'ailleurs ne peut pas emprunter les classes de l'interface (ex. « overlay »)
        if (el.hasAttribute('class')) {
          const keep = el.getAttribute('class').split(/\s+/).filter((c) => CLASS_OK.test(c));
          if (keep.length) el.setAttribute('class', keep.join(' ')); else el.removeAttribute('class');
        }
        if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') el.removeAttribute('contenteditable');
        if (tag === 'A') {
          const href = el.getAttribute('href') || '';
          if (!/^(https?:|mailto:)/i.test(href)) el.removeAttribute('href');
        }
        if (tag === 'IMG') {
          const src = el.getAttribute('src') || '';
          if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src)) { el.remove(); continue; }
        }
        if (tag === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() !== 'checkbox') { el.remove(); continue; }
        if (tag === 'BUTTON' && !(el.dataset && el.dataset.act === 'mail')) { el.remove(); continue; }
        walk(el);
      }
    };
    walk(doc.body);
    doc.querySelectorAll('*').forEach((el) => { for (const a of Array.from(el.attributes)) if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name); });
    return doc.body.innerHTML;
  };

  // ---------- Sélection ----------
  let savedRange = null;
  P.saveSel = function () {
    const sel = window.getSelection();
    if (sel.rangeCount && P.editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  };
  P.restoreSel = function () {
    const sel = window.getSelection();
    // Éditeur déjà actif avec une sélection à jour : on la garde (la copie sauvegardée peut être en retard,
    // car « selectionchange » est asynchrone).
    if (document.activeElement === P.editor && sel.rangeCount && P.editor.contains(sel.anchorNode)) return;
    P.editor.focus();
    if (!savedRange) return;
    sel.removeAllRanges();
    sel.addRange(savedRange);
  };
  P.currentRange = function () {
    const sel = window.getSelection();
    if (sel.rangeCount && P.editor.contains(sel.anchorNode)) return sel.getRangeAt(0);
    return savedRange;
  };
  P.resetSel = function () { savedRange = null; };
  document.addEventListener('selectionchange', P.saveSel);

  /** Nœuds texte contenus dans une plage, avec les décalages utiles. */
  P.textSegments = function (range) {
    const sc = range.startContainer, ec = range.endContainer;
    if (sc === ec && sc.nodeType === 3) return range.endOffset > range.startOffset ? [{ node: sc, start: range.startOffset, end: range.endOffset }] : [];
    const out = [];
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!range.intersectsNode(n)) continue;
      if (n.parentElement && n.parentElement.closest('.noexport, .chip')) continue;
      const start = n === sc ? range.startOffset : 0;
      const end = n === ec ? range.endOffset : n.nodeValue.length;
      if (end > start) out.push({ node: n, start, end });
    }
    return out;
  };

  /** Enveloppe chaque segment de texte dans un élément créé par makeEl(). */
  P.wrapSegments = function (segments, makeEl) {
    const wrappers = [];
    for (const seg of segments) {
      let node = seg.node;
      if (seg.end < node.nodeValue.length) node.splitText(seg.end);
      if (seg.start > 0) node = node.splitText(seg.start);
      const w = makeEl();
      node.parentNode.insertBefore(w, node);
      w.appendChild(node);
      wrappers.push(w);
    }
    return wrappers;
  };

  P.unwrap = function (el) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    el.remove();
    parent.normalize();
  };

  // Notifie l'application d'un changement (remplacé par app.js)
  P.markDirty = function () { P.state.dirty = true; if (P.onDirty) P.onDirty(); };
})();
