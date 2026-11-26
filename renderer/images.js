/* Plume — images : un clic sélectionne l'image (poignées pour la redimensionner), et la barre d'outils propose les options
   de Google Docs : recadrer, remplacer l'image, bordure (couleur, épaisseur, trait), options d'image (taille, texte de
   remplacement), pivoter et rétablir la taille d'origine. Les changements passent par l'éditeur : Ctrl+Z les annule. */
(function () {
  'use strict';
  const { $, h } = P;
  const ed = P.editor;
  const state = P.state;
  const scroller = $('#scroller');
  const ro = () => state.mode === 'view';

  let img = null;          // image sélectionnée
  let busy = false;        // glisser en cours (redimensionnement, recadrage)
  let crop = null;         // { l, t, w, h } en pixels affichés, relatifs à l'image
  const fmt = { color: '#000000', width: 1, dash: 'solid' };

  /* ---------- Cadre de sélection et poignées ---------- */
  const DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const box = h('div', { id: 'imgsel', 'aria-hidden': 'true' }, DIRS.map((d) => h('i', { class: 'ih ih-' + d, 'data-d': d })));
  box.hidden = true;
  const cropBox = h('div', { id: 'imgcrop' },
    DIRS.map((d) => h('i', { class: 'ch ch-' + d, 'data-d': d })),
    h('div', { class: 'crop-bar' },
      h('button', { type: 'button', class: 'crop-ok', title: 'Appliquer le recadrage (Entrée)', 'aria-label': 'Appliquer le recadrage' }, P.svgIcon('i-check')),
      h('button', { type: 'button', class: 'crop-no', title: 'Annuler (Échap)', 'aria-label': 'Annuler le recadrage' }, P.svgIcon('i-close'))));
  cropBox.hidden = true;
  scroller.append(box, cropBox);

  const place = (el, r) => {
    const o = scroller.getBoundingClientRect();
    el.style.left = (r.left - o.left + scroller.scrollLeft) + 'px';
    el.style.top = (r.top - o.top + scroller.scrollTop) + 'px';
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
  };
  function paint() {
    if (!img || !img.isConnected) { box.hidden = true; cropBox.hidden = true; return; }
    const r = img.getBoundingClientRect();
    if (crop) {
      box.hidden = true;
      place(cropBox, { left: r.left + crop.l, top: r.top + crop.t, width: crop.w, height: crop.h });
      cropBox.style.setProperty('--ix', -crop.l + 'px'); cropBox.hidden = false;
      return;
    }
    cropBox.hidden = true;
    place(box, r);
    box.hidden = false;
  }
  function select(i) {
    if (img === i) { paint(); return; }
    img = i; crop = null;
    const b = i.style.border || '';
    const m = /([\d.]+)pt\s+(solid|dashed|dotted)\s+(.+)$/.exec(b) || null;
    if (m) { fmt.width = parseFloat(m[1]); fmt.dash = m[2]; const d = document.createElement('i'); d.style.color = m[3]; fmt.color = rgbHex(d.style.color) || fmt.color; }
    paint(); refresh();
  }
  function deselect() { if (!img && box.hidden) return; img = null; crop = null; box.hidden = true; cropBox.hidden = true; refresh(); }
  const rgbHex = (c) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c || ''); return m ? '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('') : ''; };

  ed.addEventListener('mousedown', (e) => {
    if (e.button === 2 || e.button === 0) {
      const t = e.target;
      if (t && t.tagName === 'IMG' && ed.contains(t)) {
        select(t);
        const r = document.createRange(); r.selectNode(t);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        return;
      }
    }
    if (!busy) deselect();
  });
  document.addEventListener('selectionchange', () => {
    if (!img || busy || crop) return;
    const s = window.getSelection();
    if (!s.rangeCount) return;
    const r = s.getRangeAt(0);
    if (!ed.contains(r.commonAncestorContainer)) return;
    if (!(r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1 && r.startContainer.childNodes[r.startOffset] === img)) deselect();
  });
  scroller.addEventListener('scroll', () => { if (img) paint(); }, { passive: true });
  window.addEventListener('resize', () => { if (img) paint(); });
  new MutationObserver(() => { if (img && !busy) { if (!img.isConnected) deselect(); else paint(); } }).observe(ed, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'width', 'height', 'src'] });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (img) paint(); }).observe(ed);

  /* ---------- Remplacement d'une image par une copie modifiée (annulable) ---------- */
  function replaceImg(old, mutate) {
    if (ro() || !old || !old.isConnected) return old;
    const c = old.cloneNode(true);
    mutate(c);
    for (const a of ['style']) if (!c.getAttribute(a)) c.removeAttribute(a);
    c.setAttribute('data-imgsel', '1');
    const r = document.createRange(); r.selectNode(old);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    ed.focus({ preventScroll: true });
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('insertHTML', false, c.outerHTML);
    const n = ed.querySelector('img[data-imgsel]');
    if (n) {
      n.removeAttribute('data-imgsel');
      img = null; select(n);
      const r2 = document.createRange(); r2.selectNode(n); s.removeAllRanges(); s.addRange(r2);
    }
    P.markDirty();
    return n;
  }
  const sizeOf = (i) => { const q = i.getBoundingClientRect(); return { w: Math.round(q.width), h: Math.round(q.height) }; };
  const maxW = () => Math.max(60, ed.clientWidth - 2);

  /* ---------- Redimensionner ---------- */
  box.addEventListener('mousedown', (e) => {
    const d = e.target.dataset && e.target.dataset.d;
    if (!d || !img || ro() || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const target = img;
    const s0 = sizeOf(target);
    const css0 = target.getAttribute('style');
    const ratio = s0.w / s0.h || 1;
    const x0 = e.clientX, y0 = e.clientY;
    const corner = d.length === 2;
    busy = true;
    let last = s0;
    const move = (ev) => {
      let dx = ev.clientX - x0, dy = ev.clientY - y0;
      let w = s0.w, hh = s0.h;
      if (d.includes('e')) w = s0.w + dx; else if (d.includes('w')) w = s0.w - dx;
      if (d.includes('s')) hh = s0.h + dy; else if (d.includes('n')) hh = s0.h - dy;
      if (corner && !ev.shiftKey) {                       // les coins gardent les proportions (Maj : étirement libre)
        const fw = w / s0.w, fh = hh / s0.h;
        const f = Math.abs(fw - 1) > Math.abs(fh - 1) ? fw : fh;
        w = s0.w * f; hh = s0.h * f;
      }
      w = Math.max(16, Math.min(maxW(), w)); hh = Math.max(16, hh);
      if (corner && !ev.shiftKey) hh = w / ratio;
      last = { w: Math.round(w), h: Math.round(hh) };
      target.style.width = last.w + 'px'; target.style.height = last.h + 'px';
      paint();
    };
    const up = () => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      busy = false;
      if (css0 === null) target.removeAttribute('style'); else target.setAttribute('style', css0);
      if (last.w !== s0.w || last.h !== s0.h) replaceImg(target, (c) => { c.style.width = last.w + 'px'; c.style.height = last.h + 'px'; c.removeAttribute('width'); c.removeAttribute('height'); });
      else paint();
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  });

  /* ---------- Recadrer ---------- */
  function startCrop() {
    if (!img || ro()) return;
    const s = sizeOf(img);
    crop = { l: 0, t: 0, w: s.w, h: s.h };
    paint();
    refresh();
  }
  function cancelCrop() { if (!crop) return; crop = null; paint(); refresh(); }
  cropBox.addEventListener('mousedown', (e) => {
    if (!crop || e.button !== 0) return;
    if (e.target.closest('.crop-bar')) return;
    e.preventDefault(); e.stopPropagation();
    const d = (e.target.dataset && e.target.dataset.d) || 'move';
    const s = sizeOf(img);
    const c0 = Object.assign({}, crop);
    const x0 = e.clientX, y0 = e.clientY;
    busy = true;
    const MIN = 20;
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      let { l, t, w, h: hh } = c0;
      if (d === 'move') { l = Math.max(0, Math.min(s.w - w, l + dx)); t = Math.max(0, Math.min(s.h - hh, t + dy)); }
      else {
        if (d.includes('e')) w = Math.max(MIN, Math.min(s.w - l, c0.w + dx));
        if (d.includes('s')) hh = Math.max(MIN, Math.min(s.h - t, c0.h + dy));
        if (d.includes('w')) { const nl = Math.max(0, Math.min(c0.l + c0.w - MIN, c0.l + dx)); w = c0.l + c0.w - nl; l = nl; }
        if (d.includes('n')) { const nt = Math.max(0, Math.min(c0.t + c0.h - MIN, c0.t + dy)); hh = c0.t + c0.h - nt; t = nt; }
      }
      crop = { l, t, w, h: hh };
      paint();
    };
    const up = () => { window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', up, true); busy = false; };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  });
  cropBox.querySelector('.crop-ok').addEventListener('click', () => applyCrop());
  cropBox.querySelector('.crop-no').addEventListener('click', cancelCrop);

  const mimeOf = (src) => { const m = /^data:image\/(png|jpe?g|gif|webp)/i.exec(src || ''); return m && /jpe?g/i.test(m[1]) ? 'image/jpeg' : 'image/png'; };
  function bake(src, fn, w, hh) {
    const i = new Image();
    return new Promise((res, rej) => {
      i.onload = () => { try { const c = document.createElement('canvas'); c.width = w(i); c.height = hh(i); fn(c.getContext('2d'), i, c); res(c.toDataURL(mimeOf(src), 0.92)); } catch (e) { rej(e); } };
      i.onerror = () => rej(new Error('Image illisible'));
      i.src = src;
    });
  }
  async function applyCrop() {
    if (!crop || !img) return;
    const s = sizeOf(img);
    const c = crop;
    const target = img;
    const src = target.getAttribute('src');
    const kx = (target.naturalWidth || s.w) / s.w, ky = (target.naturalHeight || s.h) / s.h;
    const sx = Math.round(c.l * kx), sy = Math.round(c.t * ky), sw = Math.max(1, Math.round(c.w * kx)), sh = Math.max(1, Math.round(c.h * ky));
    crop = null;
    try {
      const url = await bake(src, (ctx, i) => ctx.drawImage(i, sx, sy, sw, sh, 0, 0, sw, sh), () => sw, () => sh);
      replaceImg(target, (n) => { n.setAttribute('src', url); n.style.width = Math.round(c.w) + 'px'; n.style.height = Math.round(c.h) + 'px'; n.removeAttribute('width'); n.removeAttribute('height'); });
    } catch (e) { P.toast('Impossible de recadrer cette image.'); }
    paint(); refresh();
  }
  async function rotate(dir) {
    if (!img || ro()) return;
    const target = img, s = sizeOf(target), src = target.getAttribute('src');
    try {
      const url = await bake(src, (ctx, i, cv) => { ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(dir * Math.PI / 2); ctx.drawImage(i, -i.naturalWidth / 2, -i.naturalHeight / 2); }, (i) => i.naturalHeight, (i) => i.naturalWidth);
      replaceImg(target, (n) => { n.setAttribute('src', url); n.style.width = s.h + 'px'; n.style.height = s.w + 'px'; n.removeAttribute('width'); n.removeAttribute('height'); });
    } catch (e) { P.toast('Impossible de pivoter cette image.'); }
  }

  /* ---------- Remplacer, bordure, options ---------- */
  async function replaceFile() {
    if (!img || ro()) return;
    const target = img;
    P.saveSel();
    let r;
    try { r = await native.pickImage(); } catch (_) { r = null; }
    if (!r) return;
    if (r.error) { P.toast(r.error); return; }
    replaceImg(target, (n) => { n.setAttribute('src', r.dataUrl); n.style.removeProperty('height'); n.removeAttribute('height'); n.removeAttribute('width'); if (!n.style.width) n.style.width = Math.min(maxW(), sizeOf(target).w) + 'px'; });
  }
  const borderCss = () => (fmt.width === 0 ? '' : fmt.width + 'pt ' + fmt.dash + ' ' + fmt.color);
  function setBorder(partial) {
    Object.assign(fmt, partial);
    if (!img || ro()) { refresh(); return; }
    const css = borderCss();
    replaceImg(img, (n) => { if (css) n.style.border = css; else n.style.removeProperty('border'); });
  }
  function resetSize() {
    if (!img || ro()) return;
    const nw = img.naturalWidth || 0;
    replaceImg(img, (n) => { n.style.removeProperty('height'); n.removeAttribute('height'); n.removeAttribute('width'); if (nw) n.style.width = Math.min(nw, maxW()) + 'px'; else n.style.removeProperty('width'); });
  }
  async function options() {
    if (!img || ro()) return;
    const target = img, s = sizeOf(target);
    P.saveSel();
    const r = await P.modal({
      title: 'Options d’image',
      fields: [
        { id: 'w', label: 'Largeur (px)', type: 'number', value: s.w, min: 16, max: 4000 },
        { id: 'hh', label: 'Hauteur (px)', type: 'number', value: s.h, min: 16, max: 4000 },
        { id: 'lock', label: 'Proportions', type: 'select', value: 'yes', options: [{ value: 'yes', label: 'Conserver (la hauteur suit la largeur)' }, { value: 'no', label: 'Libres (largeur et hauteur indépendantes)' }] },
        { id: 'alt', label: 'Texte de remplacement (lu par les lecteurs d’écran)', type: 'text', value: target.getAttribute('alt') || '' },
        { id: 'title', label: 'Titre (infobulle)', type: 'text', value: target.getAttribute('title') || '' },
        { id: 'bw', label: 'Épaisseur de la bordure (pt, 0 = aucune)', type: 'number', value: fmt.width, min: 0, max: 12 },
        { id: 'bs', label: 'Style de la bordure', type: 'select', value: fmt.dash, options: [{ value: 'solid', label: 'Trait continu' }, { value: 'dashed', label: 'Tirets' }, { value: 'dotted', label: 'Pointillés' }] },
        { id: 'bc', label: 'Couleur de la bordure (#rrggbb)', type: 'text', value: fmt.color },
      ],
      ok: 'Appliquer',
    });
    if (!r) return;
    const v = r.values;
    let w = Math.max(16, Math.min(maxW(), parseInt(v.w, 10) || s.w));
    let hh = Math.max(16, parseInt(v.hh, 10) || s.h);
    if (v.lock === 'yes') hh = Math.round((w * s.h) / s.w);
    fmt.width = Math.max(0, Math.min(12, parseFloat(v.bw) || 0));
    fmt.dash = v.bs;
    if (/^#[0-9a-fA-F]{6}$/.test(String(v.bc).trim())) fmt.color = String(v.bc).trim().toLowerCase();
    const css = borderCss();
    replaceImg(target, (n) => {
      n.style.width = w + 'px'; n.style.height = hh + 'px'; n.removeAttribute('width'); n.removeAttribute('height');
      if (v.alt.trim()) n.setAttribute('alt', v.alt.trim()); else n.removeAttribute('alt');
      if (v.title.trim()) n.setAttribute('title', v.title.trim()); else n.removeAttribute('title');
      if (css) n.style.border = css; else n.style.removeProperty('border');
    });
  }
  async function altText() {
    if (!img || ro()) return;
    const target = img;
    P.saveSel();
    const r = await P.modal({ title: 'Texte de remplacement', message: 'Décrivez l’image pour les personnes qui ne la voient pas (lecteurs d’écran) et pour le cas où elle ne s’afficherait pas.', fields: [{ id: 'alt', label: 'Description', type: 'text', value: target.getAttribute('alt') || '' }], ok: 'Enregistrer' });
    if (!r) return;
    replaceImg(target, (n) => { if (r.values.alt.trim()) n.setAttribute('alt', r.values.alt.trim()); else n.removeAttribute('alt'); });
  }

  /* ---------- Barre d'outils ---------- */
  const bar = $('#imgbar');
  const btn = (id, icon, title, fn, withChev) => {
    const b = h('button', { type: 'button', class: 'tb-icon', id, title, 'aria-label': title }, P.svgIcon(icon), withChev ? P.svgIcon('i-chev-down', 'sm') : null);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => fn(b));
    return b;
  };
  const WIDTHS = [0, 0.5, 1, 1.5, 2.25, 3, 4.5, 6];
  function buildBar() {
    if (!bar) return;
    const col = btn('img-bcolor', 'i-pen', 'Couleur de la bordure', (b) => { if (P.pop.isOpen() && P.pop.anchor() === b) { P.pop.close(); return; } P.colorpop.pick(b, { title: 'Couleur de la bordure', current: fmt.color, onPick: (c) => setBorder({ color: c || '#000000', width: fmt.width || 1 }) }); });
    col.append(h('i', { class: 'tb-swatch', id: 'img-bcolor-sw' }));
    bar.replaceChildren(
      btn('img-crop', 'i-crop', 'Recadrer l’image', () => startCrop()),
      btn('img-replace', 'i-replace', 'Remplacer l’image…', () => replaceFile()),
      col,
      btn('img-bwidth', 'i-b-width', 'Épaisseur de la bordure', (b) => { if (P.pop.isOpen() && P.pop.anchor() === b) { P.pop.close(); return; } P.menu.open(WIDTHS.map((w) => ({ label: w === 0 ? 'Aucune bordure' : w + ' pt', checked: () => fmt.width === w, action: () => setBorder({ width: w }) })), { anchor: b, align: 'left' }); }, true),
      btn('img-bdash', 'i-b-dash', 'Style de trait de la bordure', (b) => { if (P.pop.isOpen() && P.pop.anchor() === b) { P.pop.close(); return; } P.menu.open([['solid', 'Trait continu'], ['dashed', 'Tirets'], ['dotted', 'Pointillés']].map(([k, l]) => ({ label: l, checked: () => fmt.dash === k, action: () => setBorder({ dash: k, width: fmt.width || 1 }) })), { anchor: b, align: 'left' }); }, true),
      btn('img-more', 'i-more', 'Options d’image', (b) => { if (P.pop.isOpen() && P.pop.anchor() === b) { P.pop.close(); return; } P.menu.open(menuItems(), { anchor: b, align: 'left' }); }, true),
    );
  }
  function menuItems() {
    const off = ro() || !img;
    return [
      { label: 'Recadrer l’image', icon: 'i-crop', disabled: off, action: startCrop },
      { label: 'Remplacer l’image…', icon: 'i-replace', disabled: off, action: replaceFile },
      '-',
      { label: 'Pivoter à droite', disabled: off, action: () => rotate(1) },
      { label: 'Pivoter à gauche', disabled: off, action: () => rotate(-1) },
      { label: 'Rétablir la taille d’origine', disabled: off, action: resetSize },
      '-',
      { label: 'Texte de remplacement…', disabled: off, action: altText },
      { label: 'Options d’image…', icon: 'i-settings', disabled: off, action: options },
    ];
  }
  function refresh() {
    if (!bar) return;
    if (!bar.firstChild) buildBar();
    bar.hidden = !img;
    const sw = $('#img-bcolor-sw'); if (sw) sw.style.background = fmt.color;
    bar.querySelectorAll('button').forEach((b) => { b.disabled = ro(); });
    const bw = $('#img-bwidth'); if (bw) bw.title = 'Épaisseur de la bordure : ' + (fmt.width ? fmt.width + ' pt' : 'aucune');
  }
  buildBar();

  /* ---------- Clavier ---------- */
  document.addEventListener('keydown', (e) => {
    if (crop) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelCrop(); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); applyCrop(); }
      return;
    }
    if (e.key === 'Escape' && img && !document.querySelector('.overlay') && !P.pop.isOpen()) { deselect(); }
  }, true);

  P.images = {
    selected: () => img, select, deselect, startCrop, applyCrop, cancelCrop, replaceFile, options, altText, rotate, resetSize, setBorder, menuItems, fmt,
    isCropping: () => !!crop, cropRect: () => crop && Object.assign({}, crop),
  };
})();
