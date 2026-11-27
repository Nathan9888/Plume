/* Plume — menu Outils à la manière de Google Docs : saisie vocale (Ctrl+Maj+S), nombre de mots (Ctrl+Maj+C),
   définir un mot (Ctrl+Maj+Y). La saisie vocale utilise la reconnaissance vocale du navigateur (Chrome, Edge, Safari) :
   elle exige une connexion Internet et l'autorisation du micro. Dans l'application Windows (Electron) ce service n'existe
   pas ; la carte l'explique et propose la dictée de Windows (Win + H). */
(function () {
  'use strict';
  const { $, h } = P;
  const ed = P.editor;
  const state = P.state;
  const ro = () => state.mode === 'view';

  /* ---------- Saisie vocale ---------- */
  const LANGS = [
    ['fr-FR', 'Français (France)'], ['fr-CA', 'Français (Canada)'], ['fr-BE', 'Français (Belgique)'], ['fr-CH', 'Français (Suisse)'],
    ['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['en-CA', 'English (Canada)'], ['en-AU', 'English (Australia)'], ['en-IN', 'English (India)'],
    ['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['es-AR', 'Español (Argentina)'], ['de-DE', 'Deutsch (Deutschland)'], ['de-CH', 'Deutsch (Schweiz)'],
    ['it-IT', 'Italiano'], ['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'], ['nl-NL', 'Nederlands'], ['sv-SE', 'Svenska'], ['da-DK', 'Dansk'], ['nb-NO', 'Norsk bokmål'],
    ['fi-FI', 'Suomi'], ['pl-PL', 'Polski'], ['cs-CZ', 'Čeština'], ['sk-SK', 'Slovenčina'], ['hu-HU', 'Magyar'], ['ro-RO', 'Română'], ['bg-BG', 'Български'], ['el-GR', 'Ελληνικά'],
    ['tr-TR', 'Türkçe'], ['ru-RU', 'Русский'], ['uk-UA', 'Українська'], ['he-IL', 'עברית'], ['ar-SA', 'العربية'], ['hi-IN', 'हिन्दी'], ['th-TH', 'ไทย'], ['vi-VN', 'Tiếng Việt'],
    ['id-ID', 'Bahasa Indonesia'], ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['zh-CN', '中文 (普通话)'], ['zh-TW', '中文 (國語)'], ['yue-Hant-HK', '粵語 (香港)'],
  ];
  const KEY = 'plume.voice';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isElectron = /Electron\//.test(navigator.userAgent);

  let lang = (() => {
    try { const s = localStorage.getItem(KEY); if (s && LANGS.some((l) => l[0] === s)) return s; } catch (_) { /* ignoré */ }
    const n = (navigator.language || 'fr-FR').replace('_', '-');
    return (LANGS.find((l) => l[0].toLowerCase() === n.toLowerCase()) || LANGS.find((l) => l[0].slice(0, 2) === n.slice(0, 2)) || LANGS[0])[0];
  })();

  // Mots de ponctuation et de mise en page prononcés (français et anglais)
  const COMMANDS = {
    fr: [[/\bpoint d['’ ]?interrogation\b/gi, '?'], [/\bpoint d['’ ]?exclamation\b/gi, '!'], [/\bpoint[- ]virgule\b/gi, ';'], [/\bdeux[- ]points\b/gi, ':'], [/\bpoints? de suspension\b/gi, '…'],
      [/\b(?:à|a) la ligne\b/gi, '\n'], [/\bnouvelle ligne\b/gi, '\n'], [/\bnouveau paragraphe\b/gi, '\n\n'], [/\bouvrir la parenthèse\b/gi, '('], [/\bfermer la parenthèse\b/gi, ')'],
      [/\bouvrez les guillemets\b/gi, '« '], [/\bfermez les guillemets\b/gi, ' »'], [/\bvirgule\b/gi, ','], [/\bpoint\b/gi, '.']],
    en: [[/\bquestion mark\b/gi, '?'], [/\bexclamation (?:mark|point)\b/gi, '!'], [/\bsemicolon\b/gi, ';'], [/\bcolon\b/gi, ':'], [/\bellipsis\b/gi, '…'],
      [/\bnew line\b/gi, '\n'], [/\bnew paragraph\b/gi, '\n\n'], [/\bopen parenthesis\b/gi, '('], [/\bclose parenthesis\b/gi, ')'], [/\bcomma\b/gi, ','], [/\b(?:period|full stop)\b/gi, '.']],
  };
  function applyCommands(text) {
    const set = COMMANDS[lang.slice(0, 2)];
    if (!set) return text;
    let t = ' ' + text.trim() + ' ';
    for (const [re, rep] of set) t = t.replace(re, '\u0001' + rep + '\u0001');
    // la ponctuation se colle au mot précédent ; l'espace est conservé après elle
    t = t.replace(/\s*\u0001([,.;:!?…)»\n]+)\u0001\s*/g, (m, p) => (/^\n/.test(p) ? p : p + ' ')).replace(/\s*\u0001([(«]\s?)\u0001\s*/g, ' $1');
    t = t.replace(/\u0001/g, '');
    if (lang.slice(0, 2) === 'fr') t = t.replace(/\s*([?!;:])\s?/g, (m, p) => ' ' + p + ' ');   // espace fine insécable avant ? ! ; :
    return t.trim() ? t.replace(/^ +/, '') : '';
  }

  let card = null, rec = null, listening = false, wantOn = false, fatal = false, interim = '';
  let statusEl = null, micBtn = null, liveEl = null;

  const say = (msg, kind) => { if (statusEl) { statusEl.textContent = msg; statusEl.dataset.kind = kind || ''; } };

  /** Insère le texte reconnu au curseur : espace et majuscule selon le contexte. */
  function insert(text) {
    if (ro()) return;
    let t = applyCommands(text);
    if (!t) return;
    P.restoreSel();
    const s = window.getSelection();
    if (!s.rangeCount || !ed.contains(s.anchorNode)) {
      const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); s.removeAllRanges(); s.addRange(r);
    }
    // caractère avant le curseur
    let before = '';
    try { const r = s.getRangeAt(0).cloneRange(); const blk = (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode).closest('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, div') || ed; r.setStart(blk, 0); before = r.toString(); } catch (_) { /* ignoré */ }
    const atStart = !before.trim();
    const afterSentence = /[.!?…]\s*$/.test(before) && !/^\s*[.,;:!?]/.test(t);
    if (!/^[\s,.;:!?…)» \n]/.test(t) && before && !/[\s(«\n]$/.test(before)) t = ' ' + t;
    if ((atStart || afterSentence) && !/^\n/.test(t.trim() ? t.trimStart() : t)) t = t.replace(/^(\s*)(\p{L})/u, (m, sp, c) => sp + c.toLocaleUpperCase(lang));
    const parts = t.split(/(\n+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\n+$/.test(part)) { for (let i = 0; i < part.length; i++) document.execCommand('insertParagraph'); } else document.execCommand('insertText', false, part);
    }
    P.markDirty();
  }

  function stopRec(final) {
    wantOn = false;
    listening = false;
    interim = '';
    if (liveEl) liveEl.textContent = '';
    if (rec) { try { rec.onend = null; rec.onresult = null; rec.onerror = null; final ? rec.abort() : rec.stop(); } catch (_) { /* ignoré */ } rec = null; }
    if (micBtn) { micBtn.classList.remove('on'); micBtn.setAttribute('aria-pressed', 'false'); micBtn.title = 'Cliquer pour parler'; }
    if (!fatal) say('Cliquer pour parler');
  }

  function startRec() {
    if (ro()) { P.toast('Passez en mode Édition pour dicter du texte.'); return; }
    if (!SR) { fatal = true; say(isElectron ? 'La saisie vocale n’est pas disponible dans l’application Windows. Utilisez Win + H (dictée de Windows) ou Plume dans Chrome ou Edge.' : 'Votre navigateur ne prend pas en charge la saisie vocale. Utilisez Chrome, Edge ou Safari.', 'err'); return; }
    fatal = false;
    wantOn = true;
    const r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => { listening = true; micBtn.classList.add('on'); micBtn.setAttribute('aria-pressed', 'true'); micBtn.title = 'Cliquer pour arrêter'; say('À l’écoute…', 'on'); };
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) { insert(res[0].transcript); live = ''; } else live += res[0].transcript;
      }
      interim = live;
      if (liveEl) liveEl.textContent = live;
    };
    r.onerror = (e) => {
      const code = e && e.error;
      if (code === 'no-speech' || code === 'aborted') return;
      fatal = true;
      wantOn = false;
      const msg = {
        'not-allowed': 'Le micro est bloqué. Autorisez-le pour ce site dans les réglages du navigateur, puis réessayez.',
        'service-not-allowed': 'Le service de reconnaissance vocale est refusé par le navigateur.',
        'audio-capture': 'Aucun micro n’a été trouvé.',
        'network': isElectron ? 'La saisie vocale n’est pas disponible dans l’application Windows. Utilisez Win + H (dictée de Windows) ou Plume dans Chrome ou Edge.' : 'La reconnaissance vocale a besoin d’une connexion Internet.',
        'language-not-supported': 'Cette langue n’est pas prise en charge par votre navigateur.',
      }[code] || 'La saisie vocale s’est arrêtée (' + code + ').';
      say(msg, 'err');
      stopRec(true);
      fatal = true;
      say(msg, 'err');
    };
    r.onend = () => {
      listening = false;
      if (wantOn && !fatal) { try { r.start(); } catch (_) { stopRec(false); } } else stopRec(false);   // le navigateur coupe après un silence : on reprend
    };
    rec = r;
    try { r.start(); } catch (_) { say('Impossible de démarrer la saisie vocale.', 'err'); }
  }
  const toggleMic = () => { if (wantOn || listening) stopRec(false); else startRec(); };

  function buildCard() {
    const sel = h('select', { 'aria-label': 'Langue de dictée' }, LANGS.map(([c, n]) => h('option', { value: c, text: n })));
    sel.value = lang;
    sel.addEventListener('change', () => {
      lang = sel.value;
      try { localStorage.setItem(KEY, lang); } catch (_) { /* ignoré */ }
      if (wantOn) { stopRec(true); fatal = false; startRec(); }
    });
    micBtn = h('button', { type: 'button', class: 'vc-mic', title: 'Cliquer pour parler', 'aria-pressed': 'false', 'aria-label': 'Micro' }, P.svgIcon('i-mic'));
    micBtn.addEventListener('mousedown', (e) => e.preventDefault());
    micBtn.addEventListener('click', toggleMic);
    statusEl = h('div', { class: 'vc-status', role: 'status', 'aria-live': 'polite', text: 'Cliquer pour parler' });
    liveEl = h('div', { class: 'vc-live', 'aria-hidden': 'true' });
    const close = h('button', { type: 'button', class: 'icon-btn vc-x', title: 'Fermer la saisie vocale', 'aria-label': 'Fermer la saisie vocale' }, P.svgIcon('i-close'));
    close.addEventListener('click', () => closeCard());
    const tip = h('div', { class: 'vc-tip', text: 'Dites « virgule », « point », « à la ligne » ou « nouveau paragraphe » pour la ponctuation et la mise en page.' });
    card = h('div', { id: 'voicecard', role: 'dialog', 'aria-label': 'Saisie vocale' }, h('div', { class: 'vc-head' }, h('b', { text: 'Saisie vocale' }), close), sel, micBtn, statusEl, liveEl, tip);
    card.addEventListener('mousedown', (e) => { if (!e.target.closest('select')) e.preventDefault(); });
    document.body.append(card);
  }
  function openCard() {
    if (!P.app.inDoc()) return;
    if (!card) buildCard();
    card.hidden = false;
    if (!SR) { fatal = true; say(isElectron ? 'La saisie vocale n’est pas disponible dans l’application Windows. Utilisez Win + H (dictée de Windows) ou Plume dans Chrome ou Edge.' : 'Votre navigateur ne prend pas en charge la saisie vocale. Utilisez Chrome, Edge ou Safari.', 'err'); }
  }
  function closeCard() { stopRec(true); fatal = false; if (card) card.hidden = true; ed.focus(); }
  function toggleVoice() {
    if (card && !card.hidden) { closeCard(); return; }
    P.saveSel();
    openCard();
    if (SR) startRec();
  }

  /* ---------- Nombre de mots ---------- */
  function counts(text) {
    return { words: (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length, chars: text.replace(/\n/g, '').length, noSpace: text.replace(/\s/g, '').length };
  }
  function wordCount() {
    const all = counts(ed.innerText || '');
    const s = window.getSelection();
    const selText = s.rangeCount && !s.isCollapsed && ed.contains(s.anchorNode) ? s.toString() : '';
    const part = selText ? counts(selText) : null;
    const paras = Array.from(ed.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th')).filter((n) => n.textContent.trim()).length;
    const pages = state.pageless ? '—' : String(P.pageCount());
    const nf = (n) => n.toLocaleString('fr-FR');
    const lines = [
      `Pages : ${pages}`,
      part ? `Mots : ${nf(part.words)} sur ${nf(all.words)}` : `Mots : ${nf(all.words)}`,
      part ? `Caractères : ${nf(part.chars)} sur ${nf(all.chars)}` : `Caractères : ${nf(all.chars)}`,
      part ? `Caractères sans espaces : ${nf(part.noSpace)} sur ${nf(all.noSpace)}` : `Caractères sans espaces : ${nf(all.noSpace)}`,
      `Paragraphes et éléments de liste : ${nf(paras)}`,
      `Temps de lecture : ≈ ${Math.max(1, Math.round(all.words / 230))} min`,
      `Commentaires ouverts : ${P.openCommentCount ? P.openCommentCount() : 0}`,
      `Suggestions en attente : ${P.suggestionCount ? P.suggestionCount() : 0}`,
    ];
    P.modal({ title: 'Nombre de mots', message: lines.join('\n'), buttons: [{ id: 'ok', label: 'Fermer', primary: true }] });
  }

  /* ---------- Définir ---------- */
  function define() {
    P.restoreSel();
    const s = window.getSelection();
    let w = s.rangeCount && !s.isCollapsed ? s.toString().trim() : '';
    if (!w && s.rangeCount && s.anchorNode && s.anchorNode.nodeType === 3) {
      const t = s.anchorNode.nodeValue, o = s.anchorOffset;
      const m = /[\p{L}'’-]*$/u.exec(t.slice(0, o)), n = /^[\p{L}'’-]*/u.exec(t.slice(o));
      w = ((m ? m[0] : '') + (n ? n[0] : '')).replace(/^['’-]+|['’-]+$/g, '');
    }
    w = w.split(/\s+/)[0] || '';
    if (!w) { P.toast('Placez le curseur dans un mot ou sélectionnez-le, puis choisissez « Définir ».'); return; }
    const en = lang.slice(0, 2) === 'en' || (P.settings.get('spellLang') === 'en');
    const url = 'https://' + (en ? 'en' : 'fr') + '.wiktionary.org/wiki/' + encodeURIComponent(w.toLowerCase());
    try { native.openExternal('url', url); } catch (_) { window.open(url, '_blank', 'noopener'); }
  }

  /* ---------- Raccourcis ---------- */
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.overlay')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || !e.shiftKey || e.altKey || !P.app.inDoc()) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); e.stopImmediatePropagation(); toggleVoice(); }
    else if (k === 'c') { e.preventDefault(); e.stopImmediatePropagation(); wordCount(); }
    else if (k === 'y') { e.preventDefault(); e.stopImmediatePropagation(); define(); }
  }, true);

  P.tools = { toggleVoice, wordCount, define, LANGS, applyCommands, isVoiceOpen: () => !!card && !card.hidden, setLang: (l) => { lang = l; }, voiceSupported: () => !!SR };
  P.actions = P.actions || {};
  P.actions.voice = toggleVoice;
  P.actions.wordcount = wordCount;
  P.actions.define = define;
})();
