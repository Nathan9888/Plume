/* Plume — listes déroulantes (<select>) au style macOS.
   Le menu natif du navigateur (fond plat, surbrillance bleu pâle) est remplacé par un menu translucide, arrondi, avec coche
   devant la valeur choisie et surbrillance de la couleur d'accent. Le <select> reste l'élément de référence : sa valeur change et il
   émet « input » puis « change », donc tout le code existant (et les lecteurs d'écran) fonctionne sans modification.
   Dans la barre d'outils le menu s'ouvre sous le bouton ; ailleurs il se superpose au bouton, la valeur choisie en face de lui,
   comme les menus locaux de macOS. Attribut data-native pour garder le menu du navigateur. */
(function () {
  'use strict';
  const { h } = P;
  let cur = null;

  // Aperçu des entrées : chaque police dans sa propre police, chaque style de titre à sa taille.
  const PREVIEW = {
    font: (o) => ({ fontFamily: '"' + String(o.value || o.textContent).replace(/["\\]/g, '') + '", system-ui, sans-serif', fontSize: '14px' }),
    block: (o) => ({ h1: { fontWeight: '700', fontSize: '16px' }, h2: { fontWeight: '600', fontSize: '14.5px' }, h3: { fontWeight: '600', fontSize: '13.5px' }, blockquote: { fontStyle: 'italic' } }[o.value] || null),
  };

  const handles = (sel) => !!sel && sel.tagName === 'SELECT' && !sel.multiple && !(sel.size > 1) && !sel.disabled && !sel.hasAttribute('data-native');

  function close(refocus) {
    if (!cur) return;
    const c = cur;
    cur = null;
    c.menu.remove();
    window.removeEventListener('mousedown', c.onDown, true);
    window.removeEventListener('keydown', c.onKey, true);
    window.removeEventListener('blur', c.onAway);
    window.removeEventListener('resize', c.onAway);
    document.removeEventListener('scroll', c.onScroll, true);
    c.sel.setAttribute('aria-expanded', 'false');
    if (refocus && c.focusBack && c.sel.isConnected) c.sel.focus({ preventScroll: true });
  }

  function openFor(sel, viaKeyboard) {
    close();
    const options = Array.from(sel.options);
    if (!options.length) return;
    const layer = P.$('#pop');
    if (!layer) return;
    const kind = sel.dataset.menu || '';
    const inBar = !!sel.closest('#toolbar, #chrome, #tabbar');
    const menu = h('div', { class: 'menu select-menu', role: 'listbox', 'aria-label': sel.getAttribute('aria-label') || sel.title || '' });
    const rows = [];
    let hl = -1;

    options.forEach((o, i) => {
      const chosen = i === sel.selectedIndex;
      const label = h('span', { class: 'mi-label', text: o.textContent });
      const st = PREVIEW[kind] ? PREVIEW[kind](o) : null;
      if (st) Object.assign(label.style, st);
      const b = h('button', { type: 'button', class: 'menu-item' + (chosen ? ' checked' : ''), role: 'option', 'aria-selected': String(chosen), disabled: !!o.disabled },
        h('span', { class: 'mi-lead' }, chosen ? P.svgIcon('i-check', 'sm') : null), label);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('mouseenter', () => { if (!o.disabled) setHl(i); });
      b.addEventListener('click', () => choose(i));
      rows.push({ b, label, o });
      menu.append(b);
    });

    function setHl(i, scroll) {
      hl = i;
      rows.forEach((r, k) => r.b.classList.toggle('hl', k === i));
      if (scroll && rows[i]) rows[i].b.scrollIntoView({ block: 'nearest' });
    }

    function choose(i) {
      const o = options[i];
      if (!o || o.disabled) return;
      const changed = sel.selectedIndex !== i;
      close(true);
      if (changed) {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // --- position ---
    const r = sel.getBoundingClientRect();
    menu.style.visibility = 'hidden';
    menu.style.left = '0px'; menu.style.top = '0px';
    menu.style.minWidth = Math.max(Math.round(r.width) + 18, 96) + 'px';
    layer.append(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const pick = rows[Math.max(0, sel.selectedIndex)];
    let x, y;
    if (inBar || !pick) {
      x = r.left; y = r.bottom + 4;
    } else {
      // le texte de la valeur choisie se place exactement sur le texte du bouton
      const mr = menu.getBoundingClientRect(), lr = pick.label.getBoundingClientRect(), br = pick.b.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(sel).paddingLeft) || 8;
      x = r.left + padL - (lr.left - mr.left);
      y = r.top + r.height / 2 - (br.top + br.height / 2 - mr.top);
    }
    x = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - mh - 8));
    menu.style.left = Math.round(x) + 'px';
    menu.style.top = Math.round(y) + 'px';
    menu.style.visibility = '';
    setHl(sel.selectedIndex, true);
    if (pick) pick.b.scrollIntoView({ block: 'nearest' });
    sel.setAttribute('aria-expanded', 'true');

    // --- clavier ---
    let typed = '', typedAt = 0;
    const step = (dir) => {
      let i = hl < 0 ? (dir > 0 ? -1 : rows.length) : hl;
      for (let k = 0; k < rows.length; k++) {
        i += dir;
        if (i < 0 || i >= rows.length) break;
        if (!rows[i].o.disabled) { setHl(i, true); return; }
      }
    };
    const edge = (end) => {
      const idx = rows.map((_, k) => k).filter((k) => !rows[k].o.disabled);
      if (idx.length) setHl(end ? idx[idx.length - 1] : idx[0], true);
    };
    const onKey = (e) => {
      const k = e.key;
      const eat = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (k === 'Escape') { eat(); close(true); }
      else if (k === 'ArrowDown') { eat(); step(1); }
      else if (k === 'ArrowUp') { eat(); step(-1); }
      else if (k === 'Home') { eat(); edge(false); }
      else if (k === 'End') { eat(); edge(true); }
      else if (k === 'PageDown') { eat(); for (let n = 0; n < 6; n++) step(1); }
      else if (k === 'PageUp') { eat(); for (let n = 0; n < 6; n++) step(-1); }
      else if (k === 'Enter' || (k === ' ' && !typed)) { eat(); if (hl >= 0) choose(hl); }
      else if (k === 'Tab') { close(false); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        eat();
        const now = Date.now();
        typed = now - typedAt > 800 ? k.toLowerCase() : typed + k.toLowerCase();
        typedAt = now;
        const from = typed.length > 1 ? Math.max(hl, 0) : hl + 1;
        for (let n = 0; n < rows.length; n++) {
          const i = (from + n) % rows.length;
          if (!rows[i].o.disabled && rows[i].o.textContent.trim().toLowerCase().startsWith(typed)) { setHl(i, true); break; }
        }
      }
    };
    const onDown = (e) => {
      if (menu.contains(e.target)) return;
      const s = e.target.closest && e.target.closest('select');
      if (s === sel) return; // le gestionnaire d'ouverture s'en charge : il referme le menu
      close(false);
    };
    const onAway = () => close(false);
    const onScroll = (e) => { if (!menu.contains(e.target)) close(false); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onAway);
    window.addEventListener('resize', onAway);
    document.addEventListener('scroll', onScroll, true);
    cur = { sel, menu, onDown, onKey, onAway, onScroll, focusBack: viaKeyboard || document.activeElement === sel };
  }

  // Clic sur un <select> : ouvre notre menu au lieu de celui du navigateur (et le referme au second clic).
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const sel = e.target.closest && e.target.closest('select');
    if (!handles(sel)) return;
    e.preventDefault(); // pas de menu natif, et le document garde son focus et sa sélection
    if (cur && cur.sel === sel) { close(false); return; }
    openFor(sel, false);
  }, true);

  // Clavier sur un <select> ayant le focus : Espace, F4 ou Alt+Haut/Bas ouvrent le menu.
  window.addEventListener('keydown', (e) => {
    if (cur) return;
    const sel = e.target;
    if (!sel || sel.tagName !== 'SELECT' || !handles(sel)) return;
    if (e.key === 'F4' || e.key === ' ' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
      e.preventDefault(); e.stopPropagation();
      openFor(sel, true);
    }
  }, true);

  P.selects = { open: openFor, close, isOpen: () => !!cur };
})();
