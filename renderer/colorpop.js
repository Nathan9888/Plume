/* Plume — palette de couleurs façon macOS pour « Couleur du texte » et « Surlignage ».
   Un clic sur le bouton ouvre une fenêtre translucide (pastilles rondes) au lieu du sélecteur de couleur du système ;
   « Autre couleur… » ouvre quand même celui du système pour une teinte libre. Le champ <input type="color"> reste l'élément de
   référence : il reçoit la valeur et émet « input », ce qui applique la couleur comme avant. */
(function () {
  'use strict';
  const { h } = P;

  const GRAYS = ['#000000', '#3a3a3c', '#636366', '#8e8e93', '#aeaeb2', '#c7c7cc', '#d1d1d6', '#e5e5ea', '#f2f2f7', '#ffffff'];
  const HUES = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#32ade6', '#007aff', '#5856d6', '#af52de', '#ff2d55'];

  const toRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (hex, to, t) => { const a = toRgb(hex), b = to === 'w' ? [255, 255, 255] : [0, 0, 0]; return toHex(a.map((v, i) => v + (b[i] - v) * t)); };

  // 6 lignes × 10 colonnes : niveaux de gris, puis chaque teinte du plus clair au plus foncé
  const GRID = [GRAYS, HUES.map((c) => mix(c, 'w', 0.78)), HUES.map((c) => mix(c, 'w', 0.5)), HUES.map((c) => mix(c, 'w', 0.22)), HUES, HUES.map((c) => mix(c, 'b', 0.3))].flat();
  const COLS = 10;

  const normalize = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : '');

  let bypass = false;

  function openFor(input) {
    const label = input.closest('.colorbtn');
    const kind = input.id === 'tb-hilite' ? 'hilite' : 'color';
    const now = normalize(input.value);
    const sw = [];
    let hl = -1;

    const setHl = (i) => { hl = i; sw.forEach((b, k) => b.classList.toggle('hl', k === i)); };
    const pickColor = (hex) => {
      P.pop.close();
      input.value = hex;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const pickNone = () => {
      P.pop.close();
      P.exec('hiliteColor', 'transparent', true);
      const ico = P.$('#ico-hilite');
      if (ico) ico.style.background = '';
    };
    const other = () => {
      P.pop.close();
      bypass = true;
      try { if (input.showPicker) input.showPicker(); else input.click(); } catch (e) { input.click(); } finally { setTimeout(() => { bypass = false; }, 0); }
    };

    const grid = h('div', { class: 'cm-grid', role: 'grid' });
    GRID.forEach((c, i) => {
      const b = h('button', { type: 'button', class: 'cm-sw' + (c === now ? ' cur' : ''), title: c.toUpperCase(), 'aria-label': c.toUpperCase(), 'data-c': c });
      b.style.background = c;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('mouseenter', () => setHl(i));
      b.addEventListener('click', () => pickColor(c));
      sw.push(b);
      grid.append(b);
    });

    const row = (icon, text, fn) => {
      const b = h('button', { type: 'button', class: 'menu-item cm-act' }, h('span', { class: 'mi-lead' }, icon), h('span', { class: 'mi-label', text }));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      return b;
    };
    const wheel = h('i', { class: 'cm-wheel' });
    const none = h('i', { class: 'cm-none' });
    const menu = h('div', { class: 'menu color-menu', role: 'dialog', 'aria-label': kind === 'hilite' ? 'Surlignage' : 'Couleur du texte' },
      h('div', { class: 'cm-title', text: kind === 'hilite' ? 'Surlignage' : 'Couleur du texte' }),
      grid,
      h('div', { class: 'menu-sep' }),
      kind === 'hilite' ? row(none, 'Aucun surlignage', pickNone) : null,
      row(wheel, 'Autre couleur…', other));

    P.pop.open(menu, {
      anchor: label,
      onKey(e) {
        const k = e.key;
        const go = (d) => { e.preventDefault(); e.stopPropagation(); setHl(hl < 0 ? 0 : Math.max(0, Math.min(GRID.length - 1, hl + d))); };
        if (k === 'ArrowRight') go(1);
        else if (k === 'ArrowLeft') go(-1);
        else if (k === 'ArrowDown') go(COLS);
        else if (k === 'ArrowUp') go(-COLS);
        else if ((k === 'Enter' || k === ' ') && hl >= 0) { e.preventDefault(); e.stopPropagation(); pickColor(GRID[hl]); }
      },
    });
    const cur = sw.findIndex((b) => b.classList.contains('cur'));
    if (cur >= 0) setHl(cur);
  }

  // Le document garde son focus et sa sélection quand on clique sur le bouton.
  window.addEventListener('mousedown', (e) => {
    if (e.target.matches && e.target.matches('.colorbtn input[type="color"]') && e.button === 0) e.preventDefault();
  }, true);

  window.addEventListener('click', (e) => {
    const input = e.target.matches && e.target.matches('.colorbtn input[type="color"]') ? e.target : null;
    if (!input || bypass) return;
    e.preventDefault(); // pas de sélecteur du système
    const label = input.closest('.colorbtn');
    if (P.pop.isOpen() && P.pop.anchor() === label) { P.pop.close(); return; }
    openFor(input);
  }, true);

  /** Palette autonome : pick(ancre, { title, current, none (libellé « aucune couleur »), onPick(hex | null) }). */
  function pick(anchor, o) {
    o = o || {};
    const now = normalize(o.current) || normalize(rgbToHex(o.current));
    const sw = [];
    let hl = -1;
    const setHl = (i) => { hl = i; sw.forEach((b, k) => b.classList.toggle('hl', k === i)); };
    const done = (hex) => { P.pop.close(); if (o.onPick) o.onPick(hex); };
    const grid = h('div', { class: 'cm-grid', role: 'grid' });
    GRID.forEach((c, i) => {
      const b = h('button', { type: 'button', class: 'cm-sw' + (c === now ? ' cur' : ''), title: c.toUpperCase(), 'aria-label': c.toUpperCase(), 'data-c': c });
      b.style.background = c;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('mouseenter', () => setHl(i));
      b.addEventListener('click', () => done(c));
      sw.push(b); grid.append(b);
    });
    const row = (icon, text, fn) => {
      const b = h('button', { type: 'button', class: 'menu-item cm-act' }, h('span', { class: 'mi-lead' }, icon), h('span', { class: 'mi-label', text }));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      return b;
    };
    const input = h('input', { type: 'color', value: now || '#000000', tabindex: '-1', style: 'position:fixed;left:-99px;opacity:0' });
    input.addEventListener('input', () => { if (o.onPick) o.onPick(input.value.toLowerCase()); });
    document.body.append(input);
    const other = () => { P.pop.close(); bypass = true; try { if (input.showPicker) input.showPicker(); else input.click(); } catch (e) { input.click(); } finally { setTimeout(() => { bypass = false; setTimeout(() => input.remove(), 60000); }, 0); } };
    const menu = h('div', { class: 'menu color-menu', role: 'dialog', 'aria-label': o.title || 'Couleur' },
      h('div', { class: 'cm-title', text: o.title || 'Couleur' }), grid, h('div', { class: 'menu-sep' }),
      o.none ? row(h('i', { class: 'cm-none' }), o.none, () => done(null)) : null,
      row(h('i', { class: 'cm-wheel' }), 'Autre couleur…', other));
    P.pop.open(menu, {
      anchor,
      onKey(e) {
        const k = e.key;
        const go = (d) => { e.preventDefault(); e.stopPropagation(); setHl(hl < 0 ? 0 : Math.max(0, Math.min(GRID.length - 1, hl + d))); };
        if (k === 'ArrowRight') go(1); else if (k === 'ArrowLeft') go(-1); else if (k === 'ArrowDown') go(COLS); else if (k === 'ArrowUp') go(-COLS);
        else if ((k === 'Enter' || k === ' ') && hl >= 0) { e.preventDefault(); e.stopPropagation(); done(GRID[hl]); }
      },
    });
    const cur = sw.findIndex((b) => b.classList.contains('cur'));
    if (cur >= 0) setHl(cur);
  }
  const rgbToHex = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? toHex([+m[1], +m[2], +m[3]]) : ''; };

  P.colorpop = { open: openFor, pick };
})();
