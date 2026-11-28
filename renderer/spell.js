/* Plume — correcteur orthographique : soulignement ondulé, pastille au clic sur un mot, menu « ⋮ », carte « Orthographe ».
   Le moteur (hunspell.js) et les dictionnaires intégrés sont les mêmes dans la version Windows et dans la version navigateur. */
(function () {
  'use strict';
  const { $, h } = P;
  const ed = P.editor;
  const state = P.state;
  const S = P.settings;

  /* ---------- Dictionnaires et moteur ---------- */
  const engines = {};
  function engine(lang) {
    if (!engines[lang]) {
      const d = window.PlumeDicts && window.PlumeDicts[lang];
      if (!d || !window.PlumeHunspell) return null;
      engines[lang] = new window.PlumeHunspell.Hunspell(d.aff, d.dic);
    }
    return engines[lang];
  }
  const langs = () => (S.get('spellLang') === 'both' ? ['fr', 'en'] : [S.get('spellLang')]);

  const store = {
    get(k, def) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (_) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* stockage indisponible */ } },
  };
  const personal = new Set(store.get('plume.dict', []));
  const ignored = new Set();
  const autoRep = new Map(Object.entries(store.get('plume.autoreplace', {})));

  // Verdict par mot (casse comprise) : relire un document de plusieurs pages ne rappelle plus le moteur pour chaque mot déjà vu.
  const verdicts = new Map();
  let verdictKey = '';
  function isBad(word) {
    const k = word.toLowerCase();
    if (personal.has(k) || ignored.has(k)) return false;
    const key = langs().join('+') + '|' + personal.size + '|' + ignored.size;
    if (key !== verdictKey) { verdicts.clear(); verdictKey = key; }
    let v = verdicts.get(word);
    if (v !== undefined) return v;
    let have = false, ok = false;
    for (const l of langs()) {
      const e = engine(l);
      if (!e) continue;
      have = true;
      if (e.spell(word)) { ok = true; break; }
    }
    v = have && !ok;
    if (have) { if (verdicts.size > 20000) verdicts.clear(); verdicts.set(word, v); }
    return v;
  }

  function suggest(word) {
    const out = [];
    for (const l of langs()) {
      const e = engine(l);
      if (!e) continue;
      for (const s of e.suggest(word, 5)) if (!out.includes(s)) out.push(s);
      if (out.length >= 3) break;
    }
    return out.slice(0, 6);
  }

  /* ---------- Analyse du document ---------- */
  const WORD = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;
  const URLS = /(?:https?:\/\/|www\.)\S+|[^\s@]+@[^\s@]+\.[^\s@]+/g;
  const SKIP = '.chip, .noexport, .toc, code, pre, [contenteditable="false"]';
  let items = [];          // mots mal orthographiés : { node, start, end, word }
  let scanId = 0;
  let timer = 0;
  let lastInput = 0;

  function textNodes() {
    const out = [];
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() && !(n.parentElement && n.parentElement.closest(SKIP)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    while (walker.nextNode()) out.push(walker.currentNode);
    return out;
  }

  function scanNode(node, caret, found) {
    const text = node.nodeValue;
    const skips = [];
    let u;
    URLS.lastIndex = 0;
    while ((u = URLS.exec(text))) skips.push([u.index, u.index + u[0].length]);
    WORD.lastIndex = 0;
    let m;
    while ((m = WORD.exec(text))) {
      const start = m.index, end = start + m[0].length, w = m[0];
      if (w.length < 2) continue;
      if (/[\p{N}_]/u.test(text[start - 1] || '') || /[\p{N}_]/u.test(text[end] || '')) continue;
      if (skips.some(([a, b]) => start >= a && end <= b)) continue;
      if (/\p{Ll}\p{Lu}/u.test(w)) continue;                                   // iPhone, McDonald…
      if (caret && caret.node === node && caret.offset === end) continue;      // mot en cours de frappe
      if (!isBad(w)) continue;
      if (w.length <= 5 && w === w.toUpperCase()) continue;                    // sigles (PDF, HTML…)
      found.push({ node, start, end, word: w });
    }
  }

  /* Le soulignement n'est dessiné que près de la zone visible : le navigateur repeint chaque mot marqué à chaque frappe,
     et des milliers de repères sur plusieurs pages rendaient la saisie lente. La liste complète (carte « Orthographe ») reste intacte. */
  const REACH = 350, MAX_MARKS = 150;
  let paintTimer = 0;
  function paint() {
    clearTimeout(paintTimer); paintTimer = 0;
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return;
    if (!items.length) { CSS.highlights.delete('plume-spell'); return; }
    const sc = $('#scroller');
    const box = (sc || document.documentElement).getBoundingClientRect();
    const top = box.top - REACH, bottom = box.bottom + REACH;
    const seen = new Map();
    const ranges = [];
    for (const it of items) {
      const n = it.node;
      if (!n.isConnected || it.end > n.nodeValue.length || n.nodeValue.slice(it.start, it.end) !== it.word) continue;   // texte modifié depuis l'analyse
      const el = n.parentElement;
      if (!el) continue;
      let near = seen.get(el);
      if (near === undefined) { const r = el.getBoundingClientRect(); near = r.bottom >= top && r.top <= bottom; seen.set(el, near); }
      if (!near) continue;
      if (ranges.length >= MAX_MARKS) break;
      const r = new Range();
      r.setStart(n, it.start); r.setEnd(n, it.end);
      ranges.push(r);
    }
    if (ranges.length) CSS.highlights.set('plume-spell', new Highlight(...ranges)); else CSS.highlights.delete('plume-spell');
  }
  const paintSoon = () => { if (!paintTimer && items.length) paintTimer = setTimeout(paint, 120); };

  function clearAll() { scanId++; items = []; paint(); hidePill(); refreshCard(); }

  function scan() {
    clearTimeout(timer);
    const id = ++scanId;
    if (!S.get('spell') || !P.app.inDoc() || !ed.isConnected || ed.offsetParent === null) { items = []; paint(); refreshCard(); return; }
    const sel = window.getSelection();
    let caret = null;
    if (sel.rangeCount && sel.isCollapsed && sel.anchorNode && sel.anchorNode.nodeType === 3 && ed.contains(sel.anchorNode) && Date.now() - lastInput < 1800) {
      caret = { node: sel.anchorNode, offset: sel.anchorOffset };
    }
    const nodes = textNodes();
    const found = [];
    let i = 0;
    const step = () => {
      if (id !== scanId) return;
      const t0 = performance.now();
      while (i < nodes.length && performance.now() - t0 < 10) { if (nodes[i].isConnected) scanNode(nodes[i], caret, found); i++; }
      if (i < nodes.length) { setTimeout(step, 0); return; }
      items = found;
      paint();
      refreshCard();
      if (cur && !items.some((x) => x.node === cur.item.node && x.start === cur.item.start)) hidePill();
    };
    step();
  }
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(scan, ms == null ? 500 : ms); };

  /* ---------- Actions sur un mot ---------- */
  const matchCase = (orig, s) => s;   // le moteur applique déjà la casse du mot d'origine

  function selectItem(it) {
    const r = document.createRange();
    r.setStart(it.node, it.start);
    r.setEnd(it.node, it.end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return r;
  }
  function replaceWith(it, text) {
    ed.focus({ preventScroll: true });
    selectItem(it);
    document.execCommand('insertText', false, matchCase(it.word, text));
    hidePill();
  }
  function ignoreWord(it) { ignored.add(it.word.toLowerCase()); hidePill(); scan(); }
  function addToDictionary(it) {
    personal.add(it.word.toLowerCase());
    store.set('plume.dict', Array.from(personal));
    hidePill();
    scan();
    P.toast('« ' + it.word + ' » ajouté au dictionnaire personnel.');
  }
  function alwaysReplace(it, text) {
    autoRep.set(it.word.toLowerCase(), text);
    store.set('plume.autoreplace', Object.fromEntries(autoRep));
    replaceWith(it, text);
    P.toast('« ' + it.word + ' » sera toujours remplacé par « ' + text + ' ».');
  }
  function commentOn(it) { ed.focus({ preventScroll: true }); selectItem(it); hidePill(); if (P.addComment) P.addComment(); }

  /* ---------- Pastille ---------- */
  const pill = h('div', { id: 'spellpill', role: 'toolbar', 'aria-label': 'Correction orthographique', hidden: true });
  document.body.append(pill);
  let cur = null;   // { item, sugs }

  function itemAtCaret() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed || !sel.anchorNode || !ed.contains(sel.anchorNode)) return null;
    const n = sel.anchorNode, o = sel.anchorOffset;
    return items.find((it) => it.node === n && o >= it.start && o <= it.end) || null;
  }

  function hidePill() { cur = null; pill.hidden = true; pill.replaceChildren(); }

  function icon(id, tip, act, onclick) {
    const b = h('button', { type: 'button', class: 'sp-ic', 'data-tip': tip, 'aria-label': tip, onclick }, P.svgIcon(id));
    b.dataset.act = act;
    return b;
  }

  function showPill(it) {
    const sugs = suggest(it.word);
    cur = { item: it, sugs };
    pill.replaceChildren();
    pill.append(
      sugs.length
        ? h('button', { type: 'button', class: 'sp-sug', 'data-tip': 'Suggestion de correction orthographique', onclick: () => replaceWith(it, sugs[0]) }, sugs[0])
        : h('span', { class: 'sp-none', text: 'Aucune suggestion' }),
      icon('i-ignore', 'Ignorer', 'ignore', () => ignoreWord(it)),
      icon('i-comment', 'Ajouter un commentaire', 'comment', () => commentOn(it)),
      icon('i-dots-v', 'Autres options', 'more', (e) => openMore(it, sugs, e.currentTarget)));
    pill.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    pill.hidden = false;
    place(it);
  }

  function place(it) {
    const r = document.createRange();
    r.setStart(it.node, it.start);
    r.setEnd(it.node, it.end);
    const rect = r.getClientRects()[0] || r.getBoundingClientRect();
    const w = pill.offsetWidth, hh = pill.offsetHeight;
    let top = rect.top - hh - 8;
    if (top < 8) top = rect.bottom + 8;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left - 6));
    pill.style.left = left + 'px';
    pill.style.top = top + 'px';
  }

  function openMore(it, sugs, anchor) {
    const rect = anchor.getBoundingClientRect();
    const rest = sugs.slice(1, 5).map((s) => ({ label: s, action: () => replaceWith(it, s) }));
    const list = [];
    if (rest.length) list.push({ label: 'Autres suggestions', disabled: true }, ...rest, '-');
    list.push(
      sugs[0] ? { label: 'Toujours remplacer par « ' + sugs[0] + ' »', action: () => alwaysReplace(it, sugs[0]) } : { label: 'Toujours remplacer par…', disabled: true },
      { label: 'Ajouter au dictionnaire personnel', action: () => addToDictionary(it) },
      '-',
      { label: 'Vérification de l’orthographe', hint: 'Ctrl+Alt+X', action: () => { hidePill(); openCard(it); } },
      { label: 'Corriger la phrase avec l’IA', icon: 'i-sparkle', action: () => { hidePill(); const r = P.ai && P.ai.sentenceAround(it.node, it.start); if (r) P.ai.ui.start('fix', { range: r }); else P.toast('Phrase introuvable.'); } });
    P.menu.open(list, { x: rect.left, y: rect.bottom + 6 });
  }

  /* ---------- Carte « Orthographe » ---------- */
  const card = h('div', { id: 'spellcard', role: 'dialog', 'aria-label': 'Orthographe', hidden: true });
  document.body.append(card);
  let cardIdx = 0;

  const cardBtn = (id, tip, fn, cls) => h('button', { type: 'button', class: 'sc-ic ' + (cls || ''), title: tip, 'aria-label': tip, onclick: fn }, P.svgIcon(id));

  function renderCard() {
    card.replaceChildren();
    const n = items.length;
    if (cardIdx >= n) cardIdx = Math.max(0, n - 1);
    const it = items[cardIdx];
    card.append(h('div', { class: 'sc-head' },
      h('b', { text: 'Orthographe' }),
      n ? h('span', { class: 'sc-count', text: (cardIdx + 1) + ' sur ' + n }) : null,
      h('span', { class: 'sc-fill' }),
      cardBtn('i-chev-down', 'Faute précédente', () => go(-1), 'up'),
      cardBtn('i-chev-down', 'Faute suivante', () => go(1)),
      cardBtn('i-close', 'Fermer (Échap)', closeCard)));
    if (!it) {
      card.append(h('div', { class: 'sc-empty', text: 'Aucune suggestion à examiner.' }));
      card.append(h('button', { type: 'button', class: 'sc-ai', onclick: () => { closeCard(); P.ai.ui.review(); } }, P.svgIcon('i-sparkle', 'sm'), 'Relecture approfondie avec l’IA'));
    }
    else {
      const sugs = suggest(it.word);
      card.append(h('div', { class: 'sc-body' },
        h('div', { class: 'sc-word' }, h('s', { text: it.word }), sugs[0] ? [' → ', h('b', { text: sugs[0] })] : null),
        h('div', { class: 'sc-sugs' }, sugs.slice(0, 5).map((s) => h('button', { type: 'button', class: 'sc-sug', text: s, onclick: () => { replaceWith(it, s); } }))),
        h('div', { class: 'sc-acts' },
          h('button', { type: 'button', class: 'sc-act', text: 'Ignorer', onclick: () => ignoreWord(it) }),
          h('button', { type: 'button', class: 'sc-act', text: 'Ajouter au dictionnaire', onclick: () => addToDictionary(it) }))));
    }
    card.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
  }

  function go(dir) {
    if (!items.length) return;
    cardIdx = (cardIdx + dir + items.length) % items.length;
    reveal(items[cardIdx]);
    renderCard();
  }
  function reveal(it) {
    const r = selectItem(it);
    const el = r.startContainer.parentElement;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function refreshCard() { if (!card.hidden) renderCard(); }
  function openCard(it) {
    if (!P.app.inDoc()) return;
    if (!S.get('spell')) S.set('spell', true);
    card.hidden = false;
    const sc = $('#scroller');
    const rect = (sc || ed).getBoundingClientRect();
    card.style.top = Math.max(60, rect.top + 12) + 'px';
    card.style.right = Math.max(12, window.innerWidth - rect.right + 18) + 'px';
    scan(0);
    const find = () => { cardIdx = it ? Math.max(0, items.findIndex((x) => x.node === it.node && x.start === it.start)) : 0; renderCard(); if (items[cardIdx]) reveal(items[cardIdx]); };
    setTimeout(find, 60);
    renderCard();
  }
  function closeCard() { card.hidden = true; ed.focus({ preventScroll: true }); }
  function toggleCard() { if (card.hidden) openCard(); else closeCard(); }

  /* ---------- Événements ---------- */
  ed.addEventListener('mouseup', () => {
    setTimeout(() => {
      if (!S.get('spell') || state.mode === 'view') return;
      const it = itemAtCaret();
      if (it) showPill(it); else hidePill();
    }, 0);
  });
  ed.addEventListener('input', (e) => {
    lastInput = Date.now();
    hidePill();
    // « Toujours remplacer » : au moment où l'on tape un espace ou une ponctuation après le mot
    if (autoRep.size && e.inputType === 'insertText' && e.data && /^[\s.,;:!?)»]$/.test(e.data)) {
      const sel = window.getSelection();
      const n = sel.anchorNode;
      if (n && n.nodeType === 3 && sel.isCollapsed) {
        const before = n.nodeValue.slice(0, sel.anchorOffset - 1);
        const m = /([\p{L}\p{M}'’-]+)$/u.exec(before);
        const rep = m && autoRep.get(m[1].toLowerCase());
        if (rep) {
          const r = document.createRange();
          r.setStart(n, before.length - m[1].length);
          r.setEnd(n, before.length);
          sel.removeAllRanges();
          sel.addRange(r);
          document.execCommand('insertText', false, rep);
          sel.modify('move', 'forward', 'character');
        }
      }
    }
  });
  new MutationObserver(() => schedule()).observe(ed, { childList: true, characterData: true, subtree: true });
  document.addEventListener('selectionchange', () => {
    if (cur) { const it = itemAtCaret(); if (!it || it.node !== cur.item.node || it.start !== cur.item.start) { if (!document.querySelector('.menu')) hidePill(); } }
    if (Date.now() - lastInput < 2500) schedule(450);
  });
  document.addEventListener('mousedown', (e) => {
    if (!cur) return;
    if (e.target.closest && e.target.closest('#spellpill, .menu')) return;
    hidePill();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); toggleCard(); return; }
    if (e.key === 'Escape') { if (cur) { hidePill(); } else if (!card.hidden && !document.querySelector('.menu, .overlay')) { closeCard(); } }
  });
  window.addEventListener('resize', () => { hidePill(); paintSoon(); });
  $('#scroller') && $('#scroller').addEventListener('scroll', () => { if (cur) hidePill(); paintSoon(); }, { passive: true });

  /* ---------- API ---------- */
  P.spell = {
    isBad, suggest,
    add(word) { personal.add(String(word).toLowerCase()); store.set('plume.dict', Array.from(personal)); schedule(0); },
    refresh() { scan(0); },
    clear: clearAll,
    toggleCard, openCard, closeCard,
    get count() { return items.length; },
    get items() { return items; },
  };
  P.actions = P.actions || {};
  P.actions.spellcard = toggleCard;

  // Chargement différé : les dictionnaires (≈ 200 ms) se préparent quand l'interface est au repos.
  const boot = () => { try { langs().forEach(engine); } catch (_) { /* ignoré */ } schedule(0); };
  if (window.requestIdleCallback) requestIdleCallback(boot, { timeout: 1500 }); else setTimeout(boot, 600);
})();
