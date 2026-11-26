/* Plume — styles de paragraphe (Texte normal, Titre, Sous-titre, Titre 1 à 6, Citation), comme dans Google Docs :
   chaque document a ses propres définitions ; « Mettre à jour pour qu'il corresponde » reprend la mise en forme du paragraphe
   où se trouve le curseur ; les définitions peuvent être enregistrées comme styles par défaut de cet appareil (utilisés pour
   les nouveaux documents). Les définitions sont validées (liste fermée de propriétés) puis traduites en CSS — jamais copiées telles quelles. */
(function () {
  'use strict';
  const { $, h } = P;
  const ed = P.editor;
  const state = P.state;
  const KEY = 'plume.styles';

  const KEYS = [
    ['p', 'Texte normal'], ['title', 'Titre'], ['subtitle', 'Sous-titre'],
    ['h1', 'Titre 1'], ['h2', 'Titre 2'], ['h3', 'Titre 3'], ['h4', 'Titre 4'], ['h5', 'Titre 5'], ['h6', 'Titre 6'], ['blockquote', 'Citation'],
  ];
  const NAME = Object.fromEntries(KEYS);
  const SEL = {
    p: '#page', title: '#page p.doc-title', subtitle: '#page p.doc-subtitle',
    h1: '#page h1', h2: '#page h2', h3: '#page h3', h4: '#page h4', h5: '#page h5', h6: '#page h6', blockquote: '#page blockquote',
  };
  const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, blockquote';
  // Valeurs intégrées (aperçu dans le menu) : elles doivent rester identiques à celles de styles.css
  const BUILTIN = {
    p: { fontSize: 11 }, title: { fontSize: 26 }, subtitle: { fontSize: 15, color: '#666666' },
    h1: { fontSize: 20 }, h2: { fontSize: 16 }, h3: { fontSize: 14 }, h4: { fontSize: 12, color: '#434343' }, h5: { fontSize: 11, color: '#666666' },
    h6: { fontSize: 11, color: '#666666', italic: true }, blockquote: { fontSize: 11, color: '#444444', italic: true },
  };

  /* ---------- Validation ---------- */
  const num = (v, a, b) => { v = Number(v); return isFinite(v) && v >= a && v <= b ? Math.round(v * 100) / 100 : undefined; };
  function cleanOne(o) {
    const s = {};
    if (!o || typeof o !== 'object') return s;
    if (typeof o.fontFamily === 'string' && /^[^;{}"'<>\\\n]{1,100}$/.test(o.fontFamily.trim())) s.fontFamily = o.fontFamily.trim();
    const fs = num(o.fontSize, 6, 96); if (fs !== undefined) s.fontSize = fs;
    if (typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color)) s.color = o.color.toLowerCase();
    for (const k of ['bold', 'italic', 'underline']) if (typeof o[k] === 'boolean') s[k] = o[k];
    if (['left', 'center', 'right', 'justify'].includes(o.align)) s.align = o.align;
    const lh = num(o.lineHeight, 0.8, 4); if (lh !== undefined) s.lineHeight = lh;
    const b = num(o.before, 0, 72); if (b !== undefined) s.before = b;
    const a = num(o.after, 0, 72); if (a !== undefined) s.after = a;
    return s;
  }
  function clean(map) {
    const out = {};
    if (!map || typeof map !== 'object') return out;
    for (const [k] of KEYS) { const s = cleanOne(map[k]); if (Object.keys(s).length) out[k] = s; }
    return out;
  }

  /* ---------- Rendu : une feuille de style dans l'en-tête de la page ---------- */
  const sheet = h('style', { id: 'doc-styles' });
  document.head.append(sheet);
  const css = (key, s) => {
    const d = [];
    if (s.fontFamily) d.push('font-family:"' + s.fontFamily + '",Calibri,Carlito,"Segoe UI",Arial,sans-serif');
    if (s.fontSize) d.push('font-size:' + s.fontSize + 'pt');
    if (s.color) d.push('color:' + s.color);
    if (s.bold !== undefined) d.push('font-weight:' + (s.bold ? 700 : 400));
    if (s.italic !== undefined) d.push('font-style:' + (s.italic ? 'italic' : 'normal'));
    if (s.underline !== undefined) d.push('text-decoration:' + (s.underline ? 'underline' : 'none'));
    if (s.align) d.push('text-align:' + s.align);
    if (s.lineHeight) d.push('line-height:' + s.lineHeight);
    if (s.before !== undefined) d.push('margin-top:' + s.before + 'pt');
    if (s.after !== undefined) d.push('margin-bottom:' + s.after + 'pt');
    return d.length ? SEL[key] + '{' + d.join(';') + '}' : '';
  };
  function render() {
    const st = clean(state.styles);
    sheet.textContent = KEYS.map(([k]) => (st[k] ? css(k, st[k]) : '')).filter(Boolean).join('\n');
    // la police des documents en ligne (Google Fonts) est chargée si besoin
    if (P.fonts) Object.values(st).forEach((s) => { if (s.fontFamily) P.fonts.load(s.fontFamily); });
  }

  /* ---------- Styles par défaut de l'appareil ---------- */
  function userDefaults() {
    try { return clean(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { return {}; }
  }
  const fresh = () => userDefaults();

  /* ---------- Lecture du style du paragraphe sous le curseur ---------- */
  function selBlocks() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return [];
    const r = sel.getRangeAt(0);
    const out = [];
    const startEl = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
    const first = startEl && startEl.closest ? startEl.closest(BLOCKS) : null;
    if (first && ed.contains(first)) out.push(first);
    ed.querySelectorAll(BLOCKS).forEach((b) => { if (b !== first && !b.closest('table, .callout, .toc') && r.intersectsNode(b) && !r.collapsed) out.push(b); });
    return out.filter((b) => !b.closest('td, th') || true);
  }
  function keyOf(b) {
    if (!b) return 'p';
    const t = b.tagName.toLowerCase();
    if (t === 'p') return b.classList.contains('doc-title') ? 'title' : b.classList.contains('doc-subtitle') ? 'subtitle' : 'p';
    return KEYS.some(([k]) => k === t) ? t : 'p';
  }
  function current() {
    const b = selBlocks()[0];
    return keyOf(b);
  }
  const hex = (c) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || '');
    return m ? '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('') : undefined;
  };

  /* ---------- Appliquer / mettre à jour ---------- */
  function ro() { return state.mode === 'view'; }
  function apply(key) {
    if (ro() || !NAME[key]) return;
    P.restoreSel();
    const tag = key === 'title' || key === 'subtitle' ? 'p' : key;
    if (P.setBlock) P.setBlock(tag);
    // Titre et Sous-titre sont des paragraphes à classe ; les autres styles retirent cette classe
    const blocks = selBlocks();
    blocks.forEach((b) => {
      b.classList.remove('doc-title', 'doc-subtitle');
      if (key === 'title') b.classList.add('doc-title');
      if (key === 'subtitle') b.classList.add('doc-subtitle');
      if (!b.getAttribute('class')) b.removeAttribute('class');
      // la taille tapée à la main ne doit pas masquer celle du style
      b.querySelectorAll('[style*="font-size"]').forEach((el) => { el.style.removeProperty('font-size'); if (!el.getAttribute('style')) el.removeAttribute('style'); });
    });
    P.markDirty();
    if (P.updateToolbar) P.updateToolbar();
    reflect();
  }
  function update(key) {
    if (ro() || !NAME[key]) return;
    P.restoreSel();
    const b = selBlocks()[0];
    if (!b) { P.toast('Placez le curseur dans un paragraphe pour définir le style.'); return; }
    const sel = window.getSelection();
    const n = sel.anchorNode;
    const el = n && n.nodeType === 3 ? n.parentElement : (n && n.nodeType === 1 ? n : b);
    const cs = getComputedStyle(el && b.contains(el) ? el : b);
    const bs = getComputedStyle(b);
    const s = {
      fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      fontSize: Math.round(parseFloat(cs.fontSize) * 0.75 * 10) / 10,
      color: hex(cs.color),
      bold: (parseInt(cs.fontWeight, 10) || 400) >= 600,
      italic: cs.fontStyle === 'italic',
      underline: /underline/.test(cs.textDecorationLine || cs.textDecoration || ''),
      align: ({ start: 'left', left: 'left', center: 'center', right: 'right', end: 'right', justify: 'justify' })[bs.textAlign] || 'left',
    };
    const lh = parseFloat(bs.lineHeight);
    const fpx = parseFloat(bs.fontSize);
    if (isFinite(lh) && fpx) s.lineHeight = Math.round((lh / fpx) * 100) / 100;
    s.before = Math.round(parseFloat(bs.marginTop) * 0.75 * 10) / 10 || 0;
    s.after = Math.round(parseFloat(bs.marginBottom) * 0.75 * 10) / 10 || 0;
    const c = cleanOne(s);
    state.styles = Object.assign({}, clean(state.styles), { [key]: c });
    render();
    P.markDirty();
    P.toast('« ' + NAME[key] + ' » mis à jour.');
  }
  function reset() {
    if (ro()) return;
    state.styles = {};
    render();
    P.markDirty();
    P.toast('Styles d’origine rétablis.');
  }
  function saveDefaults() {
    try { localStorage.setItem(KEY, JSON.stringify(clean(state.styles))); P.toast('Enregistré : ces styles seront utilisés pour vos nouveaux documents.'); }
    catch (_) { P.toast('Impossible d’enregistrer sur cet appareil.'); }
  }
  function useDefaults() {
    if (ro()) return;
    state.styles = userDefaults();
    render();
    P.markDirty();
    P.toast('Vos styles par défaut sont appliqués à ce document.');
  }

  /* ---------- Menu ---------- */
  const eff = (key) => Object.assign({}, BUILTIN[key] || {}, clean(state.styles)[key] || {});
  function previewStyle(key) {
    const s = eff(key);
    const px = Math.max(12, Math.min(22, Math.round((s.fontSize || 11) * 1.05)));
    const bold = s.bold !== undefined ? s.bold : /^h[1-6]$/.test(key) && key !== 'h6' ? true : false;
    return 'font-size:' + px + 'px;font-weight:' + (bold ? 600 : 400) + ';font-style:' + (s.italic ? 'italic' : 'normal') + ';' + (s.color ? 'color:' + s.color + ';' : '')
      + (s.fontFamily ? 'font-family:"' + s.fontFamily + '",system-ui,sans-serif;' : '');
  }
  function menuItems() {
    const cur = current();
    const items = KEYS.map(([k, l]) => {
      const it = { label: l, style: previewStyle(k), checked: () => k === cur, disabled: ro(), action: () => apply(k) };
      if (k !== 'blockquote') {
        it.items = [
          { label: 'Appliquer « ' + l + ' »', action: () => apply(k) },
          { label: 'Mettre à jour « ' + l + ' » pour qu’il corresponde', action: () => update(k), disabled: ro() },
        ];
      }
      return it;
    });
    items.push('-', { label: 'Options', items: [
      { label: 'Enregistrer comme mes styles par défaut', action: saveDefaults },
      { label: 'Utiliser mes styles par défaut', action: useDefaults, disabled: ro() },
      { label: 'Réinitialiser les styles', action: reset, disabled: ro() },
    ] });
    return items;
  }
  const blockSel = $('#tb-block');
  function openMenu(anchor) { P.menu.open(menuItems(), { anchor: anchor || blockSel, align: 'left' }); }

  /** Met à jour l'affichage du sélecteur de la barre d'outils. */
  function reflect() {
    if (!blockSel) return;
    const k = current();
    if (blockSel.value !== k) blockSel.value = k;
  }

  if (blockSel) {
    blockSel.replaceChildren(...KEYS.map(([k, l]) => new Option(l, k)));
    blockSel.setAttribute('data-native', '1');
    blockSel.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (P.pop.isOpen() && P.pop.anchor() === blockSel) { P.pop.close(); return; }
      P.saveSel();
      openMenu(blockSel);
    }, true);
    blockSel.addEventListener('keydown', (e) => {
      if (e.key === 'F4' || e.key === ' ' || e.key === 'Enter' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) { e.preventDefault(); e.stopPropagation(); P.saveSel(); openMenu(blockSel); }
    }, true);
    blockSel.addEventListener('change', () => apply(blockSel.value));
  }

  /* ---------- Raccourcis : Ctrl+Alt+0 (normal), Ctrl+Alt+1 … 6 (titres) ---------- */
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey || !(P.app && P.app.inDoc && P.app.inDoc())) return;
    const m = /^(?:Digit|Numpad)([0-6])$/.exec(e.code || '');
    if (!m) return;
    e.preventDefault();
    apply(m[1] === '0' ? 'p' : 'h' + m[1]);
  });

  /* Après Entrée, le paragraphe suivant d'un Titre ou d'un Sous-titre est du texte normal */
  ed.addEventListener('input', (e) => {
    if (e.inputType !== 'insertParagraph') return;
    const b = selBlocks()[0];
    if (b && (b.classList.contains('doc-title') || b.classList.contains('doc-subtitle'))) {
      b.classList.remove('doc-title', 'doc-subtitle');
      if (!b.getAttribute('class')) b.removeAttribute('class');
    }
  });

  P.styles = {
    KEYS, NAME, apply, update, reset, render, fresh, clean, current, reflect, menuItems, openMenu, saveDefaults, useDefaults, userDefaults,
  };
})();
