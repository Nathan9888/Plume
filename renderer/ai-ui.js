/* Plume — assistant IA : interface. Carte de résultat (sous le texte visé), panneau « Assistant » (conversation avec le document),
   relecture du document, menus (sélection, Outils, clic droit, menu /) et réglages. Le noyau est dans ai.js. */
(function () {
  'use strict';
  const { h } = P;
  const S = P.settings;
  const A = P.ai;
  const ed = P.editor;
  const ic = (id, size) => P.svgIcon(id, size);
  const cap = (t, n) => (t.length > n ? t.slice(0, n) + '\n[…texte tronqué]' : t);
  const noFocus = (el) => { el.addEventListener('mousedown', (e) => { if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault(); }); return el; };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(A.stripMd(text)); P.toast('Copié.'); }
    catch (_) { P.toast('Copie impossible.'); }
  };
  const render = (el, text) => { el.innerHTML = P.sanitize(A.mdToHtml(text || '')); };

  /* ====================================================================================================================
     Carte de résultat
     ==================================================================================================================== */
  const card = h('div', { id: 'aicard', role: 'dialog', 'aria-label': 'Assistant IA', hidden: true });
  document.body.append(card);
  noFocus(card);
  let cur = null;   // tâche en cours d'affichage

  function closeCard() {
    if (cur && cur.ctl) cur.ctl.cancel();
    cur = null;
    card.hidden = true;
    card.replaceChildren();
    P.pending.clear();
  }

  function place() {
    if (card.hidden) return;
    const w = card.offsetWidth, hg = card.offsetHeight;
    let a = null;
    if (cur && cur.range) { try { a = P.rangeAnchor(cur.range); } catch (_) { a = null; } }
    const top0 = (document.getElementById('chrome') || { getBoundingClientRect: () => ({ bottom: 0 }) }).getBoundingClientRect().bottom;
    let x, y;
    if (a && (a.bottom || a.top) && a.bottom >= top0 && a.top <= innerHeight) {
      x = Math.max(12, Math.min(a.left - 8, innerWidth - w - 12));
      y = a.bottom + 12;
      if (y + hg > innerHeight - 10) y = Math.max(top0 + 8, a.top - hg - 12);
    } else {
      x = Math.max(12, (innerWidth - w) / 2);
      y = top0 + 70;
    }
    y = Math.max(top0 + 6, Math.min(y, innerHeight - hg - 10));
    card.style.left = Math.round(x) + 'px';
    card.style.top = Math.round(y) + 'px';
  }

  function btn(label, fn, cls, icon) {
    const b = h('button', { type: 'button', class: 'ai-btn ' + (cls || ''), onclick: fn }, icon ? ic(icon, 'sm') : null, label);
    return b;
  }

  function drawCard() {
    if (!cur) return;
    const t = cur;
    const scroll = t.out ? t.out.scrollTop : 0;
    card.replaceChildren();
    const label = (A.TASKS[t.task] || {}).label || 'Assistant IA';
    card.append(h('div', { class: 'ai-head' },
      h('span', { class: 'ai-star' }, ic('i-sparkle', 'sm')),
      h('b', { text: t.task === 'custom' && !t.sent ? 'Demander à l’IA' : label }),
      t.running ? h('span', { class: 'ai-spin', role: 'status', 'aria-label': 'Génération en cours' }) : null,
      h('span', { class: 'ai-fill' }),
      h('button', { type: 'button', class: 'sc-ic', title: 'Fermer (Échap)', 'aria-label': 'Fermer', onclick: closeCard }, ic('i-close'))));

    if (!t.sent) {
      const input = h('input', { type: 'text', class: 'ai-input', placeholder: t.hasSel ? 'Que faire de ce texte ? (ex. : en puces, plus formel…)' : 'Que faut-il écrire ? (ex. : un courriel pour reporter la réunion)', 'aria-label': 'Votre demande', spellcheck: 'false' });
      const go = () => { const v = input.value.trim(); if (v) { t.instruction = v; sendGated(t); } };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      card.append(h('div', { class: 'ai-ask' }, input, h('button', { type: 'button', class: 'ai-send', title: 'Envoyer', 'aria-label': 'Envoyer', onclick: go }, ic('i-send', 'sm'))));
      if (t.hasSel) {
        const chips = ['improve', 'fix', 'concise', 'formal', 'expand', 'tr:en'].map((k) => h('button', { type: 'button', class: 'ai-chip', text: A.TASKS[k].label, onclick: () => { t.task = k; t.instruction = ''; t.messages = null; sendGated(t); } }));
        card.append(h('div', { class: 'ai-chips' }, chips));
      }
      card.append(h('div', { class: 'ai-note', text: 'Seuls ce texte et votre demande sont envoyés au service d’IA.' }));
      setTimeout(() => input.focus(), 0);
      place();
      return;
    }

    t.out = h('div', { class: 'ai-out', tabindex: '0', 'aria-live': 'polite' });
    if (t.result) render(t.out, t.result);
    card.append(t.out);
    if (t.error) card.append(h('div', { class: 'ai-err', role: 'alert', text: t.error }));
    if (!t.running && !t.error && !t.result) card.append(h('div', { class: 'ai-err', text: 'Le service n’a rien renvoyé.' }));

    if (!t.running && t.result && !t.error) {
      const input = h('input', { type: 'text', class: 'ai-input', placeholder: 'Précisez ou modifiez… (ex. : plus court, ton plus doux)', 'aria-label': 'Préciser la demande', spellcheck: 'false' });
      const go = () => { const v = input.value.trim(); if (v) refine(v); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      card.append(h('div', { class: 'ai-ask refine' }, input, h('button', { type: 'button', class: 'ai-send', title: 'Envoyer', 'aria-label': 'Envoyer', onclick: go }, ic('i-send', 'sm'))));
    }

    const acts = h('div', { class: 'ai-acts' });
    if (t.running) acts.append(btn('Arrêter', () => { if (t.ctl) t.ctl.cancel(); }, '', 'i-stop'));
    else if (t.error) acts.append(btn('Réessayer', () => send(), 'primary', 'i-refresh'));
    else if (t.result) {
      const mode = (A.TASKS[t.task] || {}).mode;
      const hasRange = !!t.range;
      const suggestMode = P.state.mode === 'suggest';
      if (mode === 'edit' && t.hasSel) {
        acts.append(btn(suggestMode ? 'Proposer' : 'Remplacer', () => apply(suggestMode ? 'suggest' : 'replace'), 'primary'));
        acts.append(btn('Insérer dessous', () => apply('below')));
        if (!suggestMode) acts.append(btn('En suggestion', () => apply('suggest')));
      } else if (mode === 'show') {
        acts.append(btn('Insérer dans le document', () => apply(hasRange ? 'below' : 'end'), 'primary'));
      } else {
        acts.append(btn('Insérer', () => apply(suggestMode ? 'suggest' : 'at'), 'primary'));
      }
      acts.append(btn('Copier', () => copy(t.result)));
      acts.append(btn('Réessayer', () => send(), '', 'i-refresh'));
    }
    card.append(acts);
    card.append(h('div', { class: 'ai-note', text: 'Contenu généré par IA : relisez-le avant de l’utiliser.' }));
    if (scroll) t.out.scrollTop = scroll;
    place();
  }

  /** Première demande depuis la carte « Demander à l'IA » : on vérifie d'abord ce qui va partir (données sensibles). */
  async function sendGated(t) {
    if (!(await A.gate([t.text, t.context, t.instruction]))) return;
    if (t === cur) send();
  }

  function send() {
    const t = cur;
    if (!t) return;
    t.sent = true;
    t.running = true;
    t.error = '';
    t.result = '';
    const messages = t.messages || (t.messages = A.buildMessages(t.task, { text: t.text, instruction: t.instruction, context: t.context }));
    t.ctl = A.complete({ messages, onChunk: (txt) => { t.result = txt; if (t.out && t === cur) { t.dirtyOut = true; if (!t.raf) t.raf = requestAnimationFrame(() => { t.raf = 0; render(t.out, t.result); t.out.scrollTop = t.out.scrollHeight; place(); }); } } });
    drawCard();
    t.ctl.promise.then((r) => {
      if (t !== cur) return;
      t.running = false;
      t.ctl = null;
      if (r.error) { t.error = r.error; t.result = ''; }
      else t.result = A.cleanOutput(r.text);
      drawCard();
    });
  }

  async function refine(instr) {
    const t = cur;
    if (!t || t.running || !t.result) return;
    if (!(await A.gate([instr]))) return;
    t.messages = (t.messages || []).concat([{ role: 'assistant', content: t.result }, { role: 'user', content: 'Modifie le texte ci-dessus selon cette consigne : ' + instr + '. Renvoie uniquement le nouveau texte complet.' }]);
    send();
  }

  function apply(how) {
    const t = cur;
    if (!t || !t.result) return;
    const text = t.result;
    let range = t.range && t.range.startContainer.isConnected ? t.range : null;
    closeCard();
    const end = () => { const r = document.createRange(); const last = ed.lastElementChild; if (last) { r.selectNodeContents(last); r.collapse(false); } else { r.selectNodeContents(ed); r.collapse(false); } return r; };
    if (!range) range = end();
    if (how === 'replace') A.applyReplace(range, text);
    else if (how === 'below') A.applyBelow(range, text);
    else if (how === 'suggest') A.applySuggest(range, text);
    else if (how === 'end') A.applyBelow(end(), text);
    else A.applyReplace(range, text);   // 'at' : à la position du curseur
    P.toast(how === 'suggest' ? 'Proposé en suggestion (Assistant IA).' : 'Texte inséré · Ctrl+Z pour annuler.');
  }

  /** Lance une tâche d'IA. opts : { range, instruction, scope: 'sel' | 'doc' }. */
  async function start(task, opts) {
    opts = opts || {};
    const def = A.TASKS[task];
    if (!def) return;
    if (P.state.mode === 'view' && def.mode === 'edit') { P.toast('Le document est en lecture seule.'); return; }
    const sel = A.selection(opts.range || null);
    const hasSel = !!(sel.range && !sel.range.collapsed && sel.text);
    let text = sel.text;
    let context = '';
    let range = sel.range;
    const docLevel = ['summarize', 'ideas', 'titles', 'outline'].includes(task);
    if (!hasSel && def.mode === 'edit' && task !== 'custom') { P.toast('Sélectionnez d’abord le texte à traiter.'); return; }
    if (!hasSel && docLevel) { text = cap(A.docText(), 30000); range = range || null; if (!text) { P.toast('Le document est vide.'); return; } }
    if (task === 'continue') {
      text = cap(A.contextBefore(range, 4000) || A.docText(), 6000);
      if (!text) { P.toast('Écrivez d’abord quelques lignes à poursuivre.'); return; }
    }
    if (task === 'custom' && !hasSel) context = A.contextBefore(range, 2500);
    text = cap(text, 30000);
    if (!(await A.gate([text, context, opts.instruction || '']))) return;
    if (cur && cur.ctl) cur.ctl.cancel();
    cur = { task, range: range ? range.cloneRange() : null, text, context, instruction: opts.instruction || '', hasSel, sent: task !== 'custom' || !!opts.instruction, running: false, result: '', error: '' };
    if (cur.range && hasSel) P.pending.set(cur.range);
    card.hidden = false;
    if (cur.sent) send(); else drawCard();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) { e.preventDefault(); e.stopPropagation(); closeCard(); }
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (card.hidden || card.contains(e.target)) return;
    if (cur && cur.running) return;
    if (e.target.closest && e.target.closest('.menu, .overlay')) return;
    closeCard();
  }, true);
  window.addEventListener('resize', place);

  /* ====================================================================================================================
     Menus
     ==================================================================================================================== */
  const T = (task, range, extra) => ({ label: A.TASKS[task].label, action: () => start(task, Object.assign({ range }, extra || {})) });

  /** Actions sur le texte sélectionné. */
  function selectionItems(range, hasSel) {
    const off = !hasSel;
    const t = (task) => Object.assign(T(task, range), { disabled: off });
    return [
      Object.assign(t('improve'), { icon: 'i-sparkle' }),
      t('fix'),
      { label: 'Reformuler', disabled: off, items: ['formal', 'friendly', 'concise', 'simplify'].map(t) },
      t('shorten'),
      t('expand'),
      { label: 'Traduire', disabled: off, items: Object.keys(A.LANGS).map((c) => t('tr:' + c)) },
      '-',
      t('summarize'),
      t('explain'),
      t('ideas'),
      t('titles'),
      '-',
      { label: 'Demander à l’IA…', hint: 'Ctrl+Alt+J', icon: 'i-sparkle', action: () => askSafe(range) },
    ];
  }

  /** Actions sur le document entier (menu Outils). */
  function docItems() {
    const hasSel = () => { const s = window.getSelection(); return !!(s.rangeCount && !s.isCollapsed && ed.contains(s.anchorNode)); };
    return [
      { label: 'Assistant (panneau)', icon: 'i-sparkle', action: () => P.app.togglePanel('assistant') },
      { label: 'Demander à l’IA…', hint: 'Ctrl+Alt+J', action: () => askSafe() },
      '-',
      { label: 'Relire le document', action: () => review() },
      T('summarize', null),
      T('outline', null),
      T('titles', null),
      T('ideas', null),
      T('continue', null),
      '-',
      { label: 'Sur le texte sélectionné', disabled: !hasSel(), items: selectionItems(null, true) },
      '-',
      { label: 'Paramètres de l’IA…', icon: 'i-settings', action: () => S.openDialog('ai') },
    ];
  }

  function ask(range) {
    const sel = A.selection(range || null);
    const hasSel = !!(sel.range && !sel.range.collapsed && sel.text);
    if (cur && cur.ctl) cur.ctl.cancel();
    cur = { task: 'custom', range: sel.range ? sel.range.cloneRange() : null, text: sel.text, context: hasSel ? '' : A.contextBefore(sel.range, 2500), instruction: '', hasSel, sent: false, running: false, result: '', error: '' };
    if (P.state.mode === 'view') { cur = null; P.toast('Le document est en lecture seule.'); return; }
    if (cur.range && hasSel) P.pending.set(cur.range);
    card.hidden = false;
    drawCard();
  }

  /** Version avec vérification d'activation pour « Demander à l'IA… » (la carte s'ouvre seulement si l'IA est prête). */
  async function askSafe(range) {
    if (!(await A.gate([]))) return;
    ask(range);
  }

  /* ====================================================================================================================
     Panneau « Assistant »
     ==================================================================================================================== */
  const chat = { root: null, msgs: [], running: null, history: [] };

  function buildChat() {
    const list = h('div', { class: 'as-msgs', 'aria-live': 'polite' });
    const input = h('textarea', { class: 'as-input', rows: '1', placeholder: 'Posez une question sur le document ou demandez une idée…', 'aria-label': 'Message pour l’assistant', spellcheck: 'false' });
    const sendBtn = h('button', { type: 'button', class: 'ai-send big', title: 'Envoyer (Entrée)', 'aria-label': 'Envoyer' }, ic('i-send', 'sm'));
    const root = h('div', { class: 'as-root' },
      h('div', { class: 'as-top' }, h('b', { text: 'Assistant IA' }), h('span', { class: 'ai-fill' }),
        h('button', { type: 'button', class: 'chipbtn', text: 'Nouvelle conversation', onclick: () => { stop(); chat.history = []; chat.msgs = []; fillEmpty(); } })),
      list,
      h('div', { class: 'as-compose' }, input, sendBtn),
      h('div', { class: 'ai-note', text: 'Le texte du document est envoyé au service d’IA pour répondre. Les réponses peuvent contenir des erreurs.' }));
    chat.list = list; chat.input = input; chat.sendBtn = sendBtn; chat.root = root;

    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); say(input.value); } });
    sendBtn.addEventListener('click', () => { if (chat.running) stop(); else say(input.value); });
    fillEmpty();
    return root;
  }

  function fillEmpty() {
    chat.list.replaceChildren();
    const quick = [
      ['Résumer le document', () => say('Résume le document en quelques phrases.')],
      ['Idées pour continuer', () => say('Propose 5 idées concrètes pour continuer ou enrichir ce document.')],
      ['Proposer un plan', () => say('Propose un plan détaillé pour ce document, avec des titres et des sous-points.')],
      ['Trouver un titre', () => say('Propose 6 titres possibles pour ce document.')],
      ['Relire le document', () => review()],
      ['Simplifier la sélection', () => say('Réécris la sélection en langage clair et simple.')],
    ];
    chat.list.append(h('div', { class: 'as-empty' },
      h('div', { class: 'as-hello' }, h('span', { class: 'ai-star lg' }, ic('i-sparkle')), h('b', { text: 'Comment puis-je vous aider ?' }),
        h('p', { text: 'Je connais le contenu de votre document. Posez une question, demandez des idées ou une relecture.' })),
      h('div', { class: 'ai-chips col' }, quick.map(([label, fn]) => h('button', { type: 'button', class: 'ai-chip', text: label, onclick: fn })))));
  }

  function bubble(role) {
    if (chat.list.querySelector('.as-empty')) chat.list.replaceChildren();
    const b = h('div', { class: 'as-msg ' + role });
    chat.list.append(b);
    return b;
  }
  const toEnd = () => { chat.list.scrollTop = chat.list.scrollHeight; };

  function stop() { if (chat.running) { chat.running.cancel(); chat.running = null; } setBusy(false); }
  function setBusy(on) {
    chat.sendBtn.replaceChildren(ic(on ? 'i-stop' : 'i-send', 'sm'));
    chat.sendBtn.title = on ? 'Arrêter' : 'Envoyer (Entrée)';
    chat.sendBtn.classList.toggle('busy', on);
  }

  function systemWithDoc() {
    const sel = A.selection(null);
    let s = A.SYSTEM + '\n\nContenu du document :\n<document>\n' + cap(A.docText(), 40000) + '\n</document>';
    if (sel.text) s += '\n\nTexte actuellement sélectionné par l’utilisateur :\n<selection>\n' + cap(sel.text, 8000) + '\n</selection>';
    return { system: s, sel };
  }

  async function say(raw) {
    const text = String(raw || '').trim();
    if (!text || chat.running) return;
    const ctx = systemWithDoc();
    if (!(await A.gate([ctx.system, text]))) return;
    chat.input.value = ''; chat.input.style.height = 'auto';
    bubble('user').textContent = text;
    const out = bubble('ai');
    out.append(h('span', { class: 'ai-spin' }));
    chat.history.push({ role: 'user', content: text });
    toEnd();
    setBusy(true);
    const ctl = A.complete({ system: ctx.system, messages: chat.history.slice(-16), onChunk: (t) => { render(out, t); toEnd(); } });
    chat.running = ctl;
    const r = await ctl.promise;
    if (chat.running !== ctl) { /* arrêtée entre-temps */ }
    chat.running = null;
    setBusy(false);
    if (r.error) {
      out.replaceChildren(h('div', { class: 'ai-err', role: 'alert', text: r.error }));
      chat.history.pop();
      return;
    }
    const answer = A.cleanOutput(r.text);
    if (!answer) { out.remove(); chat.history.pop(); return; }
    chat.history.push({ role: 'assistant', content: answer });
    render(out, answer);
    const range = ctx.sel.range && !ctx.sel.range.collapsed ? ctx.sel.range.cloneRange() : null;
    out.append(h('div', { class: 'as-acts' },
      noFocus(h('button', { type: 'button', class: 'ai-btn', text: 'Insérer', onclick: () => { A.applyBelow(range || endRange(), answer); P.toast('Texte inséré · Ctrl+Z pour annuler.'); } })),
      range ? noFocus(h('button', { type: 'button', class: 'ai-btn', text: 'Remplacer la sélection', onclick: () => { A.applyReplace(range, answer); P.toast('Sélection remplacée · Ctrl+Z pour annuler.'); } })) : null,
      noFocus(h('button', { type: 'button', class: 'ai-btn', text: 'Copier', onclick: () => copy(answer) }))));
    toEnd();
  }

  function endRange() {
    const r = document.createRange();
    const last = ed.lastElementChild;
    r.selectNodeContents(last || ed);
    r.collapse(false);
    return r;
  }

  P.panels = P.panels || {};
  P.panels.assistant = function (body) {
    if (!chat.root) buildChat();
    body.append(chat.root);
    setTimeout(() => { toEnd(); }, 0);
  };

  /* ====================================================================================================================
     Relecture du document (fautes et tournures, corrections applicables une à une)
     ==================================================================================================================== */
  const REVIEW_ASK = 'Relis le texte et repère les fautes d’orthographe, de grammaire, d’accord, de conjugaison et de ponctuation, ainsi que les tournures vraiment maladroites. ' +
    'Réponds UNIQUEMENT par un tableau JSON, sans aucun autre texte : [{"original":"extrait exact tel qu’il est écrit (3 à 12 mots, dans un seul paragraphe)","correction":"le même extrait corrigé","raison":"explication brève"}]. ' +
    'Si tout est correct, réponds []. N’inclus jamais un élément où original et correction sont identiques.';

  function chunks(text, size, max) {
    const out = [];
    let cur2 = '';
    for (const p of text.split(/\n\n+/)) {
      if (cur2 && cur2.length + p.length > size) { out.push(cur2); cur2 = ''; }
      cur2 += (cur2 ? '\n\n' : '') + p;
    }
    if (cur2) out.push(cur2);
    return { list: out.slice(0, max), cut: out.length > max };
  }

  function parseFindings(raw) {
    const s = String(raw || '');
    const a = s.indexOf('['), z = s.lastIndexOf(']');
    if (a < 0 || z <= a) return null;
    try {
      const arr = JSON.parse(s.slice(a, z + 1));
      if (!Array.isArray(arr)) return null;
      return arr.filter((x) => x && typeof x.original === 'string' && typeof x.correction === 'string' && x.original.trim() && x.original !== x.correction)
        .map((x) => ({ original: x.original, correction: x.correction, reason: typeof x.raison === 'string' ? x.raison : (typeof x.reason === 'string' ? x.reason : '') }));
    } catch (_) { return null; }
  }

  async function review() {
    const text = A.docText();
    if (!text.trim()) { P.toast('Le document est vide.'); return; }
    if (!(await A.gate([text]))) return;
    P.showPanel('assistant');
    if (!chat.root) buildChat();
    if (chat.running) { P.toast('Une réponse est déjà en cours.'); return; }
    const out = bubble('ai');
    const status = h('div', { class: 'as-status' }, h('span', { class: 'ai-spin' }), h('span', { text: 'Relecture en cours…' }));
    out.append(status);
    toEnd();
    setBusy(true);
    const { list, cut } = chunks(text, 6000, 6);
    const found = [];
    let failed = '';
    let stopped = false;
    chat.running = { cancel: () => { stopped = true; if (chat.running && chat.running.cur) chat.running.cur.cancel(); } };
    const holder = chat.running;
    for (let i = 0; i < list.length && !stopped; i++) {
      status.lastChild.textContent = 'Relecture en cours… (' + (i + 1) + ' sur ' + list.length + ')';
      const ctl = A.complete({ system: A.SYSTEM, maxTokens: 4096, messages: [{ role: 'user', content: REVIEW_ASK + '\n\n<texte>\n' + list[i] + '\n</texte>' }] });
      holder.cur = ctl;
      const r = await ctl.promise;
      if (r.cancelled) { stopped = true; break; }
      if (r.error) { failed = r.error; break; }
      const f = parseFindings(r.text);
      if (!f) { failed = 'La réponse de l’IA n’a pas pu être lue. Réessayez.'; break; }
      f.forEach((x) => { if (!found.some((y) => y.original === x.original)) found.push(x); });
    }
    chat.running = null;
    setBusy(false);
    status.remove();
    if (failed && !found.length) { out.append(h('div', { class: 'ai-err', role: 'alert', text: failed })); return; }
    renderFindings(out, found, { cut, failed, stopped });
    toEnd();
  }

  function renderFindings(out, found, info) {
    // on ne garde que ce qui se retrouve réellement dans le document
    const items = found.filter((x) => A.findRange(x.original));
    if (!items.length) {
      out.append(h('div', { class: 'as-ok' }, ic('i-check', 'sm'), info.stopped ? 'Relecture arrêtée : aucune correction à proposer pour l’instant.' : 'Aucune faute repérée. Le texte me semble correct.'));
      return;
    }
    const left = { n: items.length };
    const head = h('div', { class: 'as-rv-head' });
    const upd = () => {
      head.replaceChildren(h('b', { text: left.n ? left.n + (left.n > 1 ? ' corrections proposées' : ' correction proposée') : 'Relecture terminée' }));
      if (left.n > 1) head.append(noFocus(h('button', { type: 'button', class: 'ai-btn primary', text: 'Tout appliquer', onclick: applyAll })));
    };
    const rows = items.map((it) => {
      const row = h('div', { class: 'as-rv' },
        h('div', { class: 'as-rv-txt' }, h('s', { text: it.original }), h('span', { class: 'as-arrow', text: ' → ' }), h('b', { text: it.correction })),
        it.reason ? h('div', { class: 'as-rv-why', text: it.reason }) : null);
      const act = h('div', { class: 'as-rv-acts' },
        noFocus(h('button', { type: 'button', class: 'ai-btn', text: 'Appliquer', onclick: () => doApply(it, row) })),
        noFocus(h('button', { type: 'button', class: 'ai-btn', text: 'Ignorer', onclick: () => done(row, 'Ignorée') })));
      row.append(act);
      row.querySelector('.as-rv-txt').addEventListener('click', () => show(it));
      it.row = row;
      return row;
    });
    function show(it) {
      const r = A.findRange(it.original);
      if (!r) return;
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      const el = r.startContainer.parentElement;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    function done(row, label) {
      if (row.classList.contains('done')) return;
      row.classList.add('done');
      row.querySelector('.as-rv-acts').replaceChildren(h('span', { class: 'as-rv-state', text: label }));
      left.n--; upd();
    }
    function doApply(it, row) {
      const r = A.findRange(it.original);
      if (!r) { done(row, 'Texte modifié depuis'); return; }
      if (P.state.mode === 'suggest') A.applySuggest(r, it.correction); else A.applyReplace(r, it.correction);
      done(row, P.state.mode === 'suggest' ? 'Proposée' : 'Appliquée');
    }
    function applyAll() { items.forEach((it) => { if (!it.row.classList.contains('done')) doApply(it, it.row); }); P.toast('Corrections appliquées · Ctrl+Z pour annuler une à une.'); }
    upd();
    out.append(head, ...rows);
    if (info.cut) out.append(h('div', { class: 'ai-note', text: 'La relecture couvre les premiers 36 000 caractères du document.' }));
    if (info.failed) out.append(h('div', { class: 'ai-note', text: 'Relecture interrompue : ' + info.failed }));
  }

  /* ====================================================================================================================
     Points d'entrée
     ==================================================================================================================== */
  P.ai.ui = { start, ask: askSafe, review, selectionItems, docItems, openAssistant: () => P.app.togglePanel('assistant'), closeCard, say };

  // Raccourci : Ctrl+Alt+J
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (e.key === 'j' || e.key === 'J' || e.code === 'KeyJ')) {
      if (!P.app.inDoc()) return;
      e.preventDefault();
      askSafe();
    }
  });

  const aiBtn = document.getElementById('btn-ai');
  if (aiBtn) aiBtn.addEventListener('click', () => P.app.togglePanel('assistant'));
})();
