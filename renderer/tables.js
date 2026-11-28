/* Plume — tableaux, aussi complets que ceux de Google Docs :
   • sélecteur de taille au survol (jusqu'à 10 × 10) à l'insertion ;
   • sélection de cellules à la souris (glisser, Maj+clic) ou au clavier (Maj+flèches), avec cadre de sélection ;
   • lignes / colonnes (au-dessus, en dessous, à gauche, à droite) même dans un tableau aux cellules fusionnées ;
   • fusionner / séparer, trier, répartir, ligne d'en-tête répétée, lignes non coupées ;
   • bordures par cellule (toutes, extérieures, intérieures, un côté…) : couleur, épaisseur, trait continu / tirets / pointillé ;
   • couleur de fond, alignement vertical, marges intérieures, alignement du tableau, largeur ;
   • glisser les traits pour changer la largeur des colonnes et la hauteur des lignes ;
   • Tab / Maj+Tab pour passer de cellule en cellule (Tab dans la dernière cellule ajoute une ligne).
   Tout est stocké en HTML ordinaire (styles en ligne, <colgroup>) : le document s'ouvre tel quel ailleurs. */
(function () {
  'use strict';
  const { $, h } = P;
  const ed = P.editor;
  const state = P.state;
  const ro = () => state.mode === 'view';
  const scroller = $('#scroller');

  /* ---------- Grille : position réelle de chaque cellule (lignes/colonnes fusionnées comprises) ---------- */
  function grid(table) {
    const rows = Array.from(table.rows);
    const g = rows.map(() => []);
    const pos = new Map();
    rows.forEach((tr, r) => {
      let c = 0;
      Array.from(tr.cells).forEach((cell) => {
        while (g[r][c]) c++;
        const rs = Math.max(1, Math.min(cell.rowSpan || 1, rows.length - r));
        const cs = Math.max(1, Math.min(cell.colSpan || 1, 64));
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) g[r + i][c + j] = cell;
        pos.set(cell, { r, c, rs, cs });
        c += cs;
      });
    });
    const cols = Math.max(0, ...g.map((x) => x.length));
    for (const row of g) for (let c = 0; c < cols; c++) if (!row[c]) row[c] = null;
    return { g, pos, rows: rows.length, cols };
  }
  const closest = (n, sel) => { const el = n && n.nodeType === 3 ? n.parentElement : n; const c = el && el.closest ? el.closest(sel) : null; return c && ed.contains(c) ? c : null; };
  const cellAtCaret = () => { const s = window.getSelection(); return s.rangeCount ? closest(s.anchorNode, 'td, th') : null; };
  const newCell = (like, tag) => { const n = document.createElement(tag || (like && like.tagName === 'TH' ? 'th' : 'td')); n.innerHTML = '<br>'; return n; };

  /* ---------- Sélection de cellules ---------- */
  let sel = null;       // { table, r1, c1, r2, c2 } (inclus)
  let anchorCell = null;
  let dragging = false;
  const box = h('div', { id: 'cellsel', 'aria-hidden': 'true' });
  box.hidden = true;
  scroller.append(box);

  function rectOf(table, a, b) {
    const G = grid(table);
    const pa = G.pos.get(a), pb = G.pos.get(b);
    if (!pa || !pb) return null;
    let r1 = Math.min(pa.r, pb.r), c1 = Math.min(pa.c, pb.c);
    let r2 = Math.max(pa.r + pa.rs - 1, pb.r + pb.rs - 1), c2 = Math.max(pa.c + pa.cs - 1, pb.c + pb.cs - 1);
    // une cellule fusionnée coupée par le rectangle l'agrandit
    for (let again = true; again;) {
      again = false;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const p = G.g[r] && G.g[r][c] && G.pos.get(G.g[r][c]);
        if (!p) continue;
        if (p.r < r1) { r1 = p.r; again = true; }
        if (p.c < c1) { c1 = p.c; again = true; }
        if (p.r + p.rs - 1 > r2) { r2 = p.r + p.rs - 1; again = true; }
        if (p.c + p.cs - 1 > c2) { c2 = p.c + p.cs - 1; again = true; }
      }
    }
    return { table, r1, c1, r2, c2 };
  }
  function cellsIn(s) {
    if (!s || !s.table.isConnected) return [];
    const G = grid(s.table);
    const out = new Set();
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) if (G.g[r] && G.g[r][c]) out.add(G.g[r][c]);
    return Array.from(out);
  }
  function paintBox() {
    if (!sel || !sel.table.isConnected) { box.hidden = true; return; }
    const cells = cellsIn(sel);
    if (cells.length < 2 && !dragging) { box.hidden = true; return; }
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    cells.forEach((c) => { const q = c.getBoundingClientRect(); l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
    if (!isFinite(l)) { box.hidden = true; return; }
    const o = scroller.getBoundingClientRect();
    box.style.left = (l - o.left + scroller.scrollLeft) + 'px';
    box.style.top = (t - o.top + scroller.scrollTop) + 'px';
    box.style.width = (r - l) + 'px';
    box.style.height = (b - t) + 'px';
    box.hidden = false;
  }
  function setSel(s) { sel = s; ed.classList.add('cell-selecting'); paintBox(); refreshBar(); }
  function clearSel() { if (sel) { sel = null; ed.classList.remove('cell-selecting'); paintBox(); refreshBar(); } }
  /** Cellules visées : la sélection de cellules, sinon la cellule du curseur. */
  function targets() {
    if (sel && sel.table.isConnected) { const c = cellsIn(sel); if (c.length) return c; }
    const c = cellAtCaret();
    return c ? [c] : [];
  }
  const tableOfTargets = () => { const c = targets()[0]; return c ? c.closest('table') : null; };
  /** Rectangle visé (sélection ou cellule du curseur). */
  function curRect() {
    if (sel && sel.table.isConnected) return sel;
    const c = cellAtCaret();
    return c ? rectOf(c.closest('table'), c, c) : null;
  }

  ed.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || startResize(e)) return;
    const cell = closest(e.target, 'td, th');
    if (!cell) { clearSel(); anchorCell = null; return; }
    if (e.shiftKey && anchorCell && anchorCell.closest('table') === cell.closest('table') && anchorCell !== cell) {
      e.preventDefault();
      setSel(rectOf(cell.closest('table'), anchorCell, cell));
      return;
    }
    anchorCell = cell;
    clearSel();
    dragging = true;
  });
  ed.addEventListener('mousemove', (e) => {
    if (resize) return;
    if (!dragging) { hoverResize(e); return; }
    if (!(e.buttons & 1)) { dragging = false; return; }
    const cell = closest(e.target, 'td, th');
    if (!cell || !anchorCell || cell.closest('table') !== anchorCell.closest('table')) return;
    if (cell === anchorCell && !sel) return;
    const s = rectOf(cell.closest('table'), anchorCell, cell);
    if (s) {
      // plus de texte sélectionné à moitié : le curseur reste dans la première cellule
      const w = window.getSelection();
      try { w.collapse(anchorCell, 0); } catch (_) { /* ignoré */ }
      e.preventDefault();
      setSel(s);
    }
  });
  window.addEventListener('mouseup', () => { dragging = false; endResize(); });
  scroller.addEventListener('scroll', () => { if (sel) paintBox(); }, { passive: true });
  window.addEventListener('resize', () => { if (sel) paintBox(); });

  // Maj+flèches / sélection au clavier ou à la souris qui traverse plusieurs cellules du même tableau
  document.addEventListener('selectionchange', () => {
    if (dragging && sel) return;
    const s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) { if (!dragging) refreshBar(); return; }
    const a = closest(s.anchorNode, 'td, th'), f = closest(s.focusNode, 'td, th');
    if (a && f && a !== f && a.closest('table') === f.closest('table')) {
      const r = rectOf(a.closest('table'), a, f);
      if (r) { sel = r; ed.classList.add('cell-selecting'); paintBox(); refreshBar(); }
    } else if (sel && !dragging) {
      clearSel();
    }
  });
  new MutationObserver(() => { if (sel) { if (!sel.table.isConnected) clearSel(); else paintBox(); } }).observe(ed, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'colspan', 'rowspan', 'width', 'height'] });

  /* ---------- Structure ---------- */
  const spanSet = (cell, k, v) => { if (v > 1) cell.setAttribute(k, String(v)); else cell.removeAttribute(k); };

  function insertRows(table, rect, below) {
    const G = grid(table);
    const n = rect.r2 - rect.r1 + 1;
    const at = below ? rect.r2 + 1 : rect.r1;        // la nouvelle ligne prend la place de cette ligne
    const refRow = below ? rect.r2 : rect.r1;
    const ref = G.g[refRow];
    const src = table.rows[refRow];
    for (let k = 0; k < n; k++) {
      const tr = document.createElement('tr');
      const seen = new Set();
      for (let c = 0; c < G.cols; c++) {
        const cell = ref[c];
        if (!cell || seen.has(cell)) continue;
        seen.add(cell);
        const p = G.pos.get(cell);
        // une cellule fusionnée qui traverse la limite s'allonge au lieu de recevoir une cellule vide
        if (p.r < at && p.r + p.rs > at) { spanSet(cell, 'rowspan', (cell.rowSpan || 1) + 1); continue; }
        const nc = newCell(cell, 'td');
        copyLook(cell, nc);
        if (p.cs > 1) nc.setAttribute('colspan', String(p.cs));
        tr.append(nc);
      }
      if (src.style.height) tr.style.height = src.style.height;
      if (below) {
        // sous une ligne d'en-tête épinglée, la nouvelle ligne appartient au corps du tableau
        if (src.parentElement.tagName === 'THEAD') { const tb = table.tBodies[0] || table.appendChild(document.createElement('tbody')); tb.prepend(tr); } else src.after(tr);
      } else src.before(tr);
    }
  }
  /** Valeur d'un côté de bordure (Chromium range « none » dans les propriétés détaillées). */
  const borderOf = (st, side) => {
    const v = st.getPropertyValue('border-' + side);
    if (v) return v;
    return /^(none|hidden)$/.test(st.getPropertyValue('border-' + side + '-style')) ? 'none' : '';
  };
  /** Reprend l'allure (fond, bordures, alignement) de la cellule voisine. */
  function copyLook(from, to) {
    BORDER_SIDES.forEach((sd) => { const v = borderOf(from.style, sd); if (v) to.style.setProperty('border-' + sd, v); });
    ['vertical-align', 'padding', 'text-align', 'background-color'].forEach((p) => {
      const v = from.style.getPropertyValue(p);
      if (v) to.style.setProperty(p, v);
    });
    if (from.hasAttribute('width') && !from.getAttribute('colspan')) to.setAttribute('width', from.getAttribute('width'));
  }

  function insertCols(table, rect, right) {
    const G = grid(table);
    const n = rect.c2 - rect.c1 + 1;
    const at = right ? rect.c2 + 1 : rect.c1;
    const colgroup = table.querySelector('colgroup');
    for (let r = 0; r < G.rows; r++) {
      const refc = G.g[r][right ? rect.c2 : rect.c1];
      if (!refc) continue;
      const p = G.pos.get(refc);
      if (p.r !== r) continue;                                    // traité depuis la ligne où la cellule commence
      if (p.c < at && p.c + p.cs > at) { spanSet(refc, 'colspan', (refc.colSpan || 1) + n); continue; }
      let anchor = refc;
      for (let k = 0; k < n; k++) {
        const nc = newCell(refc, refc.tagName === 'TH' ? 'th' : 'td');
        copyLook(refc, nc);
        if (p.rs > 1) nc.setAttribute('rowspan', String(p.rs));
        nc.removeAttribute('width');
        if (right) { anchor.after(nc); anchor = nc; } else refc.before(nc);
      }
    }
    if (colgroup) {
      const cols = Array.from(colgroup.children);
      const w = cols[Math.min(right ? rect.c2 : rect.c1, cols.length - 1)];
      for (let k = 0; k < n; k++) { const col = document.createElement('col'); if (w && w.style.width) col.style.width = w.style.width; if (right) (cols[rect.c2] || colgroup.lastElementChild).after(col); else (cols[rect.c1] || colgroup.firstElementChild).before(col); }
      syncWidth(table);
    }
  }

  function deleteRow(table, r) {
    const G = grid(table);
    const next = table.rows[r + 1];
    const seen = new Set();
    for (let c = 0; c < G.cols; c++) {
      const cell = G.g[r][c];
      if (!cell || seen.has(cell)) continue;
      seen.add(cell);
      const p = G.pos.get(cell);
      if (p.r < r) spanSet(cell, 'rowspan', p.rs - 1);
      else if (p.rs > 1 && next) {
        // la cellule fusionnée qui commence ici descend d'une ligne
        const moved = cell.cloneNode(true);
        spanSet(moved, 'rowspan', p.rs - 1);
        let ref = null;
        for (let cc = p.c + p.cs; cc < G.cols && !ref; cc++) { const o = G.g[r + 1][cc]; if (o && G.pos.get(o).r === r + 1) ref = o; }
        if (ref) next.insertBefore(moved, ref); else next.append(moved);
      }
    }
    const tr = table.rows[r];
    const sect = tr.parentElement;
    tr.remove();
    if (sect.tagName !== 'TABLE' && !sect.rows.length) sect.remove();
  }
  function deleteRows(table, rect) {
    const G = grid(table);
    if (rect.r1 === 0 && rect.r2 >= G.rows - 1) { table.remove(); return; }
    for (let r = rect.r2; r >= rect.r1; r--) deleteRow(table, r);
  }
  function deleteCols(table, rect) {
    const G = grid(table);
    if (rect.c1 === 0 && rect.c2 >= G.cols - 1) { table.remove(); return; }
    const seen = new Set();
    for (let r = 0; r < G.rows; r++) for (let c = rect.c1; c <= rect.c2; c++) {
      const cell = G.g[r][c];
      if (!cell || seen.has(cell)) continue;
      seen.add(cell);
      const p = G.pos.get(cell);
      const inside = Math.min(p.c + p.cs - 1, rect.c2) - Math.max(p.c, rect.c1) + 1;
      if (inside >= p.cs) cell.remove(); else spanSet(cell, 'colspan', p.cs - inside);
    }
    const cg = table.querySelector('colgroup');
    if (cg) { Array.from(cg.children).slice(rect.c1, rect.c2 + 1).forEach((x) => x.remove()); syncWidth(table); }
    Array.from(table.rows).forEach((tr) => { if (!tr.cells.length) tr.remove(); });
  }
  /** Avec des colonnes en pixels, le tableau mesure la somme de ses colonnes. */
  function syncWidth(table) {
    const cg = table.querySelector(':scope > colgroup');
    if (!cg || !/px$/.test(table.style.width || '')) return;
    const sum = Array.from(cg.children).reduce((a, c) => a + (parseFloat(c.style.width) || 0), 0);
    if (sum > 0) table.style.width = Math.round(sum) + 'px';
  }

  function merge(table, rect) {
    const G = grid(table);
    const cells = cellsIn(rect);
    if (cells.length < 2) return false;
    const first = G.g[rect.r1][rect.c1];
    const parts = [];
    cells.forEach((c) => {
      if (c !== first) {
        const empty = !c.textContent.trim() && !c.querySelector('img, table');
        if (!empty) parts.push(c.innerHTML);
        c.remove();
      }
    });
    if (parts.length) {
      const own = !first.textContent.trim() && !first.querySelector('img, table');
      first.innerHTML = (own ? '' : first.innerHTML + '<br>') + parts.join('<br>');
    }
    spanSet(first, 'colspan', rect.c2 - rect.c1 + 1);
    spanSet(first, 'rowspan', rect.r2 - rect.r1 + 1);
    first.removeAttribute('width');
    return true;
  }
  function unmerge(table, cells) {
    let did = false;
    cells.forEach((cell) => {
      const G = grid(table);
      const p = G.pos.get(cell);
      if (!p || (p.rs < 2 && p.cs < 2)) return;
      did = true;
      cell.removeAttribute('colspan'); cell.removeAttribute('rowspan');
      for (let r = p.r; r < p.r + p.rs; r++) {
        const tr = table.rows[r];
        // les cellules vides se placent avant la première cellule de la ligne située à droite de l'origine
        let ref = null;
        for (const o of Array.from(tr.cells)) { const q = G.pos.get(o); if (o !== cell && q && q.r === r && q.c > p.c) { ref = o; break; } }
        for (let c = p.c; c < p.c + p.cs; c++) {
          if (r === p.r && c === p.c) continue;
          const nc = newCell(cell, 'td'); copyLook(cell, nc); nc.removeAttribute('width');
          if (ref) tr.insertBefore(nc, ref); else tr.append(nc);
        }
      }
    });
    return did;
  }

  function sortTable(table, col, dir) {
    const G = grid(table);
    if (Array.from(table.rows).some((r) => Array.from(r.cells).some((c) => c.colSpan > 1 || c.rowSpan > 1))) { P.toast('Le tri n’est pas possible dans un tableau qui contient des cellules fusionnées.'); return false; }
    const head = headerCount(table);
    const bodies = Array.from(table.rows).slice(head);
    const key = (r) => (r.cells[col] ? r.cells[col].textContent.trim() : '');
    const cmp = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
    const holder = bodies[0] && bodies[0].parentElement;
    if (!holder || bodies.some((r) => r.parentElement !== holder)) return false;
    bodies.slice().sort((a, b) => dir * cmp.compare(key(a), key(b))).forEach((r) => holder.append(r));
    void G;
    return true;
  }

  /* ---------- Ligne d'en-tête ---------- */
  const headerCount = (table) => {
    let n = 0;
    for (const r of Array.from(table.rows)) { if (r.parentElement.tagName === 'THEAD' || (r.cells.length && Array.from(r.cells).every((c) => c.tagName === 'TH'))) n++; else break; }
    return n;
  };
  function setHeader(table, on) {
    const first = table.rows[0];
    if (!first) return;
    const has = headerCount(table) > 0;
    if (on === has) return;
    Array.from(first.cells).forEach((c) => {
      const n = document.createElement(on ? 'th' : 'td');
      Array.from(c.attributes).forEach((a) => n.setAttribute(a.name, a.value));
      while (c.firstChild) n.append(c.firstChild);
      c.replaceWith(n);
    });
    if (!on && first.parentElement.tagName === 'THEAD') {
      const tb = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
      tb.prepend(first);
      if (!first.parentElement.previousElementSibling && table.tHead && !table.tHead.rows.length) table.tHead.remove();
    }
  }
  /** L'en-tête est répétée sur chaque page imprimée : la ligne passe dans <thead>. */
  function pinHeader(table, on) {
    const n = Math.max(1, headerCount(table));
    if (on) {
      let th = table.tHead;
      if (!th) { th = document.createElement('thead'); table.prepend(th); }
      for (let i = 0; i < n && table.tBodies[0] && table.tBodies[0].rows.length > 1; i++) { const r = table.tBodies[0].rows[0]; if (r) th.append(r); }
      if (!th.rows.length && table.rows[0]) th.append(table.rows[0]);
    } else if (table.tHead) {
      const tb = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
      Array.from(table.tHead.rows).reverse().forEach((r) => tb.prepend(r));
      table.tHead.remove();
    }
  }

  /* ---------- Mise en forme des cellules ---------- */
  const BORDER_SIDES = ['top', 'right', 'bottom', 'left'];
  const OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const fmt = { color: '#000000', width: 1, dash: 'solid' };   // réglages de bordure courants (barre d'outils)
  const spec = () => fmt.width === 0 ? 'none' : fmt.width + 'pt ' + fmt.dash + ' ' + fmt.color;

  function setEdge(table, G, cell, side, value) {
    cell.style.setProperty('border-' + side, value);
    // la cellule voisine partage ce trait : on lui donne la même valeur pour qu'aucun conflit n'en masque un
    const p = G.pos.get(cell);
    let nb = null;
    if (side === 'top' && p.r > 0) nb = G.g[p.r - 1][p.c];
    else if (side === 'bottom' && p.r + p.rs < G.rows) nb = G.g[p.r + p.rs][p.c];
    else if (side === 'left' && p.c > 0) nb = G.g[p.r][p.c - 1];
    else if (side === 'right' && p.c + p.cs < G.cols) nb = G.g[p.r][p.c + 1 - 1 + p.cs];
    if (nb && nb !== cell) nb.style.setProperty('border-' + OPP[side], value);
  }
  /** which : all | outer | inner | top | right | bottom | left | none | horizontal | vertical */
  function setBorders(which, value) {
    const rect = curRect();
    if (!rect) return;
    const table = rect.table;
    const G = grid(table);
    const v = value || spec();
    const cells = cellsIn(rect);
    for (const cell of cells) {
      const p = G.pos.get(cell);
      const edge = { top: p.r === rect.r1, bottom: p.r + p.rs - 1 === rect.r2, left: p.c === rect.c1, right: p.c + p.cs - 1 === rect.c2 };
      const sides = [];
      for (const s of BORDER_SIDES) {
        const outer = edge[s];
        if (which === 'all' || which === 'none') sides.push(s);
        else if (which === 'outer' && outer) sides.push(s);
        else if (which === 'inner' && !outer) sides.push(s);
        else if (which === 'horizontal' && (s === 'top' || s === 'bottom') && !outer) sides.push(s);
        else if (which === 'vertical' && (s === 'left' || s === 'right') && !outer) sides.push(s);
        else if (which === s && outer) sides.push(s);
      }
      sides.forEach((s) => setEdge(table, G, cell, s, which === 'none' ? 'none' : v));
    }
    P.markDirty();
  }
  function eachTarget(fn) { const t = targets(); if (!t.length) return; t.forEach(fn); P.markDirty(); }
  const setBg = (c) => eachTarget((cell) => { if (c) cell.style.backgroundColor = c; else cell.style.removeProperty('background-color'); if (!cell.getAttribute('style')) cell.removeAttribute('style'); });
  const setVAlign = (v) => eachTarget((cell) => { cell.style.verticalAlign = v; });
  const setPad = (px) => eachTarget((cell) => { if (px == null) cell.style.removeProperty('padding'); else cell.style.padding = px + 'px'; });
  const setHAlign = (v) => eachTarget((cell) => {
    cell.style.textAlign = v;
    cell.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div, li').forEach((b) => { b.style.removeProperty('text-align'); if (!b.getAttribute('style')) b.removeAttribute('style'); });
  });
  function clearCells() { eachTarget((cell) => { cell.innerHTML = '<br>'; }); }

  /* ---------- Largeur des colonnes, hauteur des lignes ---------- */
  function ensureColgroup(table) {
    const G = grid(table);
    let cg = table.querySelector(':scope > colgroup');
    if (cg && cg.children.length === G.cols) return cg;
    const widths = [];
    for (let c = 0; c < G.cols; c++) {
      let w = 0;
      for (let r = 0; r < G.rows && !w; r++) { const cell = G.g[r][c]; const p = cell && G.pos.get(cell); if (p && p.cs === 1) w = cell.getBoundingClientRect().width; }
      widths.push(w);
    }
    const known = widths.filter(Boolean);
    const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 100;
    cg = document.createElement('colgroup');
    widths.forEach((w) => { const col = document.createElement('col'); col.style.width = Math.round(w || avg) + 'px'; cg.append(col); });
    table.querySelector(':scope > colgroup') && table.querySelector(':scope > colgroup').remove();
    table.prepend(cg);
    table.style.tableLayout = 'fixed';
    table.style.width = widths.reduce((a, b) => a + (b || avg), 0) + 'px';
    table.removeAttribute('width');
    Array.from(table.querySelectorAll('td, th')).forEach((c) => c.removeAttribute('width'));
    return cg;
  }
  let resize = null;
  const guide = h('div', { id: 'tbl-guide' });
  guide.hidden = true;
  scroller.append(guide);
  const EDGE = 4;

  function edgeAt(e) {
    const cell = closest(e.target, 'td, th');
    if (!cell) return null;
    const q = cell.getBoundingClientRect();
    const table = cell.closest('table');
    const G = grid(table);
    const p = G.pos.get(cell);
    if (!p) return null;
    if (Math.abs(e.clientX - q.right) <= EDGE) return { kind: 'col', table, cell, col: p.c + p.cs - 1 };
    if (Math.abs(e.clientX - q.left) <= EDGE && p.c > 0) return { kind: 'col', table, cell, col: p.c - 1 };
    if (Math.abs(e.clientY - q.bottom) <= EDGE) return { kind: 'row', table, cell, row: p.r + p.rs - 1 };
    if (Math.abs(e.clientY - q.top) <= EDGE && p.r > 0) return { kind: 'row', table, cell, row: p.r - 1 };
    return null;
  }
  function hoverResize(e) {
    if (resize) return;                                      // pendant le glissement, le curseur de redimensionnement reste en place
    if (ro() || e.buttons) { ed.classList.remove('tbl-col-resize', 'tbl-row-resize'); return; }
    const g = edgeAt(e);
    ed.classList.toggle('tbl-col-resize', !!g && g.kind === 'col');
    ed.classList.toggle('tbl-row-resize', !!g && g.kind === 'row');
  }
  function startResize(e) {
    if (ro()) return false;
    const g = edgeAt(e);
    if (!g) return false;
    e.preventDefault();
    dragging = false;
    const table = g.table;
    const pr = scroller.getBoundingClientRect();
    if (g.kind === 'col') {
      const cg = ensureColgroup(table);
      const cols = Array.from(cg.children);
      const start = cols.map((c) => parseFloat(c.style.width) || 0);
      resize = { kind: 'col', table, cols, start, i: g.col, x0: e.clientX, total: start.reduce((a, b) => a + b, 0), max: Math.max(120, ed.clientWidth - 2) };
    } else {
      const tr = table.rows[g.row];
      resize = { kind: 'row', table, tr, y0: e.clientY, h0: tr.getBoundingClientRect().height };
    }
    guide.hidden = false;
    guide.className = 'tbl-guide-' + resize.kind;
    const q = table.getBoundingClientRect();
    if (resize.kind === 'col') { guide.style.top = (q.top - pr.top + scroller.scrollTop) + 'px'; guide.style.height = q.height + 'px'; guide.style.width = '2px'; guide.style.left = (e.clientX - pr.left + scroller.scrollLeft) + 'px'; }
    else { guide.style.left = (q.left - pr.left + scroller.scrollLeft) + 'px'; guide.style.width = q.width + 'px'; guide.style.height = '2px'; guide.style.top = (e.clientY - pr.top + scroller.scrollTop) + 'px'; }
    document.body.classList.add(resize.kind === 'col' ? 'tbl-dragging-col' : 'tbl-dragging-row');
    window.addEventListener('mousemove', onResize, true);
    return true;
  }
  function onResize(e) {
    if (!resize) return;
    e.preventDefault();
    const pr = scroller.getBoundingClientRect();
    if (resize.kind === 'col') {
      const MIN = 28;
      let dx = e.clientX - resize.x0;
      const a = resize.start[resize.i], b = resize.start[resize.i + 1];
      if (b !== undefined) dx = Math.max(MIN - a, Math.min(b - MIN, dx));
      else dx = Math.max(MIN - a, Math.min(resize.max - resize.total, dx));
      resize.cols[resize.i].style.width = Math.round(a + dx) + 'px';
      if (b !== undefined) resize.cols[resize.i + 1].style.width = Math.round(b - dx) + 'px';
      else resize.table.style.width = Math.round(resize.total + dx) + 'px';
      guide.style.left = (e.clientX - pr.left + scroller.scrollLeft) + 'px';
      resize.moved = true;
    } else {
      const hh = Math.max(18, Math.round(resize.h0 + e.clientY - resize.y0));
      resize.tr.style.height = hh + 'px';
      guide.style.top = (e.clientY - pr.top + scroller.scrollTop) + 'px';
      resize.moved = true;
    }
  }
  function endResize() {
    if (!resize) return;
    window.removeEventListener('mousemove', onResize, true);
    document.body.classList.remove('tbl-dragging-col', 'tbl-dragging-row');
    ed.classList.remove('tbl-col-resize', 'tbl-row-resize');
    guide.hidden = true;
    if (resize.moved) P.markDirty();
    resize = null;
    paintBox();
  }

  /* ---------- Opérations (menu, barre d'outils, menu contextuel) ---------- */
  function afterEdit() {
    if (!ed.firstElementChild) ed.innerHTML = '<p><br></p>';
    const last = ed.lastElementChild;
    if (last && last.matches('table')) { const p = document.createElement('p'); p.innerHTML = '<br>'; ed.append(p); }
    P.markDirty();
    if (P.updateCounts) P.updateCounts();
    if (P.updateToolbar) P.updateToolbar();
    paintBox();
    refreshBar();
  }
  function caretTo(cell) {
    if (!cell || !cell.isConnected) return;
    const r = document.createRange();
    r.selectNodeContents(cell);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    ed.focus({ preventScroll: true });
  }

  const firstOf = (table, r) => { const tr = table.rows[Math.max(0, Math.min(r, table.rows.length - 1))]; return tr ? tr.cells[0] : null; };
  function op(name, arg) {
    if (ro()) return;
    P.restoreSel();
    const rect = curRect();
    const cell = cellAtCaret() || (rect && cellsIn(rect)[0]);
    const table = rect ? rect.table : (cell && cell.closest('table'));
    if (!table) return;
    let focusCell = cell;
    const idx = Array.from(table.rows).indexOf(cell && cell.parentElement);
    const p0 = cell ? grid(table).pos.get(cell) : null;
    switch (name) {
      case 'addRowAbove': insertRows(table, rect, false); break;
      case 'addRow': insertRows(table, rect, true); break;
      case 'addColLeft': insertCols(table, rect, false); break;
      case 'addCol': insertCols(table, rect, true); break;
      case 'delRow': deleteRows(table, rect); focusCell = table.isConnected ? firstOf(table, rect.r1) : null; break;
      case 'delCol': { const col = rect.c1; deleteCols(table, rect); focusCell = table.isConnected && table.rows[0] ? table.rows[0].cells[Math.min(col, table.rows[0].cells.length - 1)] : null; break; }
      case 'delTable': table.remove(); focusCell = null; break;
      case 'merge': if (!merge(table, rect)) { P.toast('Sélectionnez plusieurs cellules (glissez la souris ou Maj+clic).'); return; } focusCell = grid(table).g[rect.r1][rect.c1]; break;
      case 'split': case 'unmerge': if (!unmerge(table, cellsIn(rect))) { P.toast('Cette cellule n’est pas fusionnée.'); return; } break;
      case 'sortAsc': case 'sortDesc': { const p = grid(table).pos.get(cell); if (!p || !sortTable(table, p.c, name === 'sortAsc' ? 1 : -1)) return; break; }
      case 'addHeader': { const G = grid(table); const tr = document.createElement('tr'); for (let c = 0; c < G.cols; c++) { const th = document.createElement('th'); th.innerHTML = '<br>'; tr.append(th); } (table.tBodies[0] || table).prepend(tr); break; }
      case 'header': setHeader(table, arg === undefined ? headerCount(table) === 0 : !!arg); break;
      case 'pinHeader': pinHeader(table, arg === undefined ? !table.tHead : !!arg); break;
      case 'noSplit': table.classList.toggle('tbl-nosplit', arg === undefined ? !table.classList.contains('tbl-nosplit') : !!arg); if (!table.getAttribute('class')) table.removeAttribute('class'); break;
      case 'distCols': distribute(table, 'col'); break;
      case 'distRows': distribute(table, 'row'); break;
      case 'options': properties(table); return;
      case 'clear': clearCells(); break;
      default: return;
    }
    if (table.isConnected && (!focusCell || !focusCell.isConnected)) {
      // les cellules ont pu être remplacées (en-tête…) : on retrouve la même position dans la grille
      const G = grid(table);
      if (p0 && G.rows) focusCell = G.g[Math.min(p0.r, G.rows - 1)][Math.min(p0.c, G.cols - 1)] || firstOf(table, idx);
      else if (idx >= 0) focusCell = firstOf(table, idx);
    }
    clearSel();
    afterEdit();
    if (focusCell && table.isConnected) caretTo(focusCell);
  }
  function distribute(table, kind) {
    if (kind === 'col') {
      const cg = ensureColgroup(table);
      const cols = Array.from(cg.children);
      const total = cols.reduce((a, c) => a + (parseFloat(c.style.width) || 0), 0);
      const w = Math.round(total / cols.length);
      cols.forEach((c) => { c.style.width = w + 'px'; });
    } else {
      const hs = Array.from(table.rows).map((r) => r.getBoundingClientRect().height);
      const m = Math.round(Math.max(...hs));
      Array.from(table.rows).forEach((r) => { r.style.height = m + 'px'; });
    }
  }

  /* ---------- Insertion : sélecteur de taille ---------- */
  const tableHTML = (rows, cols) => {
    const w = Math.max(40, Math.floor(Math.min(ed.clientWidth - 130, 624) / cols));
    return '<table style="table-layout:fixed;width:' + w * cols + 'px"><colgroup>' + ('<col style="width:' + w + 'px">').repeat(cols) + '</colgroup><tbody>' + ('<tr>' + '<td><br></td>'.repeat(cols) + '</tr>').repeat(rows) + '</tbody></table>';
  };
  function insert(rows, cols) {
    rows = Math.max(1, Math.min(100, rows | 0)); cols = Math.max(1, Math.min(20, cols | 0));
    const before = new Set(ed.querySelectorAll('table'));
    P.insertHTML(tableHTML(rows, cols) + '<p><br></p>');
    const t = Array.from(ed.querySelectorAll('table')).find((x) => !before.has(x));
    if (t && t.rows[0]) caretTo(t.rows[0].cells[0]);
  }
  function picker(anchor) {
    if (ro()) return;
    P.saveSel();
    const ROWS = 8, COLS = 10;
    const label = h('div', { class: 'tp-label', text: 'Tableau' });
    const cells = [];
    const grid_ = h('div', { class: 'tp-grid', style: `grid-template-columns:repeat(${COLS},20px)` });
    let cur = [0, 0];
    const paint = (r, c) => { cur = [r, c]; cells.forEach((b, i) => b.classList.toggle('on', Math.floor(i / COLS) < r && i % COLS < c)); label.textContent = r && c ? r + ' × ' + c : 'Tableau'; };
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const b = h('button', { type: 'button', class: 'tp-cell', tabindex: '-1', 'aria-label': (r + 1) + ' lignes × ' + (c + 1) + ' colonnes' });
      b.addEventListener('mouseenter', () => paint(r + 1, c + 1));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { P.pop.close(); insert(r + 1, c + 1); });
      cells.push(b); grid_.append(b);
    }
    const more = h('button', { type: 'button', class: 'menu-item', text: 'Autre taille…' });
    more.addEventListener('mousedown', (e) => e.preventDefault());
    more.addEventListener('click', async () => {
      P.pop.close();
      const r = await P.modal({ title: 'Insérer un tableau', fields: [{ id: 'rows', label: 'Lignes', type: 'number', value: 3, min: 1, max: 100 }, { id: 'cols', label: 'Colonnes', type: 'number', value: 3, min: 1, max: 20 }] });
      if (r) insert(parseInt(r.values.rows, 10) || 3, parseInt(r.values.cols, 10) || 3);
    });
    const menu = h('div', { class: 'menu table-picker', role: 'dialog', 'aria-label': 'Insérer un tableau' }, label, grid_, h('div', { class: 'menu-sep' }), more);
    grid_.addEventListener('mouseleave', () => paint(0, 0));
    const tbBtn = document.querySelector('#toolbar [data-act="table"]');
    const menuBtn_ = Array.from(document.querySelectorAll('#menubar button')).find((b) => /^Insertion$/.test(b.textContent.trim()));
    const a = anchor || (tbBtn && tbBtn.offsetParent ? tbBtn : menuBtn_) || $('#menubar');
    P.pop.open(menu, {
      anchor: a,
      onKey(e) {
        const mv = (dr, dc) => { e.preventDefault(); e.stopPropagation(); paint(Math.max(1, Math.min(ROWS, (cur[0] || 1) + dr)), Math.max(1, Math.min(COLS, (cur[1] || 1) + dc))); };
        if (e.key === 'ArrowDown') mv(cur[0] ? 1 : 0, 0); else if (e.key === 'ArrowUp') mv(-1, 0);
        else if (e.key === 'ArrowRight') mv(0, cur[1] ? 1 : 0); else if (e.key === 'ArrowLeft') mv(0, -1);
        else if (e.key === 'Enter' && cur[0]) { e.preventDefault(); e.stopPropagation(); P.pop.close(); insert(cur[0], cur[1]); }
      },
    });
    paint(0, 0);
    paint(1, 1);
  }

  /* ---------- Propriétés du tableau ---------- */
  function px(n) { return Math.round(parseFloat(n) || 0); }
  async function properties(table) {
    const cell = targets()[0] || table.rows[0].cells[0];
    const G = grid(table);
    const p = G.pos.get(cell) || { c: 0 };
    const cg = table.querySelector(':scope > colgroup');
    const colW = cg && cg.children[p.c] ? px(cg.children[p.c].style.width) : Math.round(cell.getBoundingClientRect().width);
    const align = table.style.marginLeft === 'auto' && table.style.marginRight === 'auto' ? 'center' : table.style.marginLeft === 'auto' ? 'right' : 'left';
    const bw = (() => { const v = borderOf(cell.style, 'top'); const m = /([\d.]+)pt/.exec(v); return m ? parseFloat(m[1]) : (v === 'none' ? 0 : 1); })();
    const r = await P.modal({
      title: 'Propriétés du tableau',
      fields: [
        { id: 'align', label: 'Alignement du tableau', type: 'select', value: align, options: [{ value: 'left', label: 'À gauche' }, { value: 'center', label: 'Au centre' }, { value: 'right', label: 'À droite' }] },
        { id: 'width', label: 'Largeur du tableau', type: 'select', value: table.style.width === '100%' ? 'full' : 'custom', options: [{ value: 'custom', label: 'Telle que définie par les colonnes' }, { value: 'full', label: 'Pleine largeur de la page' }] },
        { id: 'bw', label: 'Épaisseur des bordures (pt, 0 = aucune)', type: 'number', value: bw, min: 0, max: 6 },
        { id: 'bc', label: 'Couleur des bordures (#rrggbb)', type: 'text', value: (fmt.color || '#000000') },
        { id: 'colw', label: 'Largeur de la colonne courante (px)', type: 'number', value: colW, min: 28, max: 1200 },
        { id: 'rowh', label: 'Hauteur minimale des lignes (px, 0 = automatique)', type: 'number', value: px(table.rows[0] && table.rows[0].style.height), min: 0, max: 600 },
        { id: 'pad', label: 'Marge intérieure des cellules (px)', type: 'number', value: px(cell.style.padding) || 4, min: 0, max: 40 },
        { id: 'head', label: 'Première ligne', type: 'select', value: headerCount(table) ? (table.tHead ? 'pin' : 'yes') : 'no', options: [{ value: 'no', label: 'Ligne ordinaire' }, { value: 'yes', label: 'Ligne de titre (gras, fond gris)' }, { value: 'pin', label: 'Ligne de titre répétée à chaque page' }] },
        { id: 'split', label: 'Lignes à l’impression', type: 'select', value: table.classList.contains('tbl-nosplit') ? 'keep' : 'free', options: [{ value: 'free', label: 'Peuvent être coupées entre deux pages' }, { value: 'keep', label: 'Ne pas couper une ligne entre deux pages' }] },
      ],
      ok: 'Appliquer',
    });
    if (!r) return;
    const v = r.values;
    table.style.marginLeft = v.align === 'left' ? '' : 'auto';
    table.style.marginRight = v.align === 'right' ? '0' : v.align === 'center' ? 'auto' : '';
    if (v.width === 'full') { table.style.width = '100%'; table.style.tableLayout = 'fixed'; const c = table.querySelector(':scope > colgroup'); if (c) c.remove(); } else if (table.style.width === '100%') table.style.width = '';
    const w = Math.max(0, Math.min(6, parseFloat(v.bw) || 0));
    const col = /^#[0-9a-fA-F]{6}$/.test(String(v.bc).trim()) ? String(v.bc).trim().toLowerCase() : fmt.color;
    fmt.color = col;
    const saved = sel;
    sel = { table, r1: 0, c1: 0, r2: G.rows - 1, c2: G.cols - 1 };
    setBorders(w === 0 ? 'none' : 'all', w + 'pt ' + fmt.dash + ' ' + col);
    sel = saved;
    const cw = parseInt(v.colw, 10);
    if (cw >= 28) { const cg2 = ensureColgroup(table); if (cg2.children[p.c]) { const old = parseFloat(cg2.children[p.c].style.width) || cw; cg2.children[p.c].style.width = cw + 'px'; table.style.width = Math.round((parseFloat(table.style.width) || 0) + (cw - old)) + 'px'; } }
    const rh = parseInt(v.rowh, 10) || 0;
    Array.from(table.rows).forEach((tr) => { if (rh > 0) tr.style.height = rh + 'px'; else tr.style.removeProperty('height'); if (!tr.getAttribute('style')) tr.removeAttribute('style'); });
    const pad = Math.max(0, Math.min(40, parseInt(v.pad, 10) || 0));
    table.querySelectorAll('td, th').forEach((c) => { c.style.padding = pad + 'px ' + pad * 2 + 'px'; });
    setHeader(table, v.head !== 'no');
    pinHeader(table, v.head === 'pin');
    table.classList.toggle('tbl-nosplit', v.split === 'keep');
    if (!table.getAttribute('class')) table.removeAttribute('class');
    P.markDirty();
    afterEdit();
  }

  /* ---------- Barre d'outils du tableau ---------- */
  const bar = $('#tablebar');
  const colorBtn = (id, icon, title, onPick, cur) => {
    const b = h('button', { type: 'button', class: 'tb-icon', id, title, 'aria-label': title, 'aria-haspopup': 'dialog' }, P.svgIcon(icon), h('i', { class: 'tb-swatch', id: id + '-sw' }));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (P.pop.isOpen() && P.pop.anchor() === b) { P.pop.close(); return; }
      P.colorpop.pick(b, { title, current: cur(), none: id === 'tbl-bg' ? 'Aucune couleur' : null, onPick });
    });
    return b;
  };
  const menuBtn = (id, icon, title, items) => {
    const b = h('button', { type: 'button', class: 'tb-icon', id, title, 'aria-label': title, 'aria-haspopup': 'menu' }, P.svgIcon(icon), P.svgIcon('i-chev-down', 'sm'));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { if (P.pop.isOpen() && P.pop.anchor() === b) { P.pop.close(); return; } P.saveSel(); P.menu.open(items(), { anchor: b, align: 'left' }); });
    return b;
  };
  const BORDER_MENU = () => [
    { label: 'Toutes les bordures', icon: 'i-b-all', action: () => setBorders('all') },
    { label: 'Bordures extérieures', icon: 'i-b-outer', action: () => setBorders('outer') },
    { label: 'Bordures intérieures', icon: 'i-b-inner', action: () => setBorders('inner') },
    { label: 'Bordures horizontales', icon: 'i-b-h', action: () => setBorders('horizontal') },
    { label: 'Bordures verticales', icon: 'i-b-v', action: () => setBorders('vertical') },
    '-',
    { label: 'Bordure du haut', icon: 'i-b-top', action: () => setBorders('top') },
    { label: 'Bordure du bas', icon: 'i-b-bottom', action: () => setBorders('bottom') },
    { label: 'Bordure de gauche', icon: 'i-b-left', action: () => setBorders('left') },
    { label: 'Bordure de droite', icon: 'i-b-right', action: () => setBorders('right') },
    '-',
    { label: 'Aucune bordure', icon: 'i-b-none', action: () => setBorders('none') },
  ];
  const WIDTH_MENU = () => [0.5, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => ({ label: w + ' pt', checked: () => fmt.width === w, action: () => { fmt.width = w; refreshBar(); const r = curRect(); if (r && cellsIn(r).length > 0 && sel) setBorders('all'); } }));
  const DASH_MENU = () => [['solid', 'Trait continu'], ['dashed', 'Tirets'], ['dotted', 'Pointillés']].map(([k, l]) => ({ label: l, checked: () => fmt.dash === k, action: () => { fmt.dash = k; refreshBar(); } }));
  const VALIGN_MENU = () => [['top', 'En haut', 'i-va-top'], ['middle', 'Au milieu', 'i-va-mid'], ['bottom', 'En bas', 'i-va-bottom']].map(([k, l, i]) => ({ label: l, icon: i, action: () => setVAlign(k) }));
  const TABLE_MENU = () => {
    const t = tableOfTargets();
    const r = curRect();
    const multi = !!(r && cellsIn(r).length > 1);
    const merged = !!(r && cellsIn(r).some((c) => (c.rowSpan || 1) > 1 || (c.colSpan || 1) > 1));
    const rows = r ? r.r2 - r.r1 + 1 : 1, cols = r ? r.c2 - r.c1 + 1 : 1;
    const pl = (n, a, b) => (n > 1 ? n + ' ' + b : a);
    return [
      { label: 'Insérer ' + pl(rows, 'une ligne', 'lignes') + ' au-dessus', action: () => op('addRowAbove') },
      { label: 'Insérer ' + pl(rows, 'une ligne', 'lignes') + ' en dessous', action: () => op('addRow') },
      { label: 'Insérer ' + pl(cols, 'une colonne', 'colonnes') + ' à gauche', action: () => op('addColLeft') },
      { label: 'Insérer ' + pl(cols, 'une colonne', 'colonnes') + ' à droite', action: () => op('addCol') },
      '-',
      { label: 'Supprimer ' + pl(rows, 'la ligne', 'lignes'), action: () => op('delRow') },
      { label: 'Supprimer ' + pl(cols, 'la colonne', 'colonnes'), action: () => op('delCol') },
      { label: 'Supprimer le tableau', action: () => op('delTable') },
      '-',
      { label: 'Fusionner les cellules', icon: 'i-merge', disabled: !multi, action: () => op('merge') },
      { label: 'Séparer les cellules', disabled: !merged, action: () => op('split') },
      '-',
      { label: 'Trier selon cette colonne', items: [{ label: 'De A à Z', action: () => op('sortAsc') }, { label: 'De Z à A', action: () => op('sortDesc') }] },
      { label: 'Répartir les lignes', action: () => op('distRows') },
      { label: 'Répartir les colonnes', action: () => op('distCols') },
      '-',
      { label: 'Ligne de titre', checked: () => !!t && headerCount(t) > 0, action: () => op('header') },
      { label: 'Répéter la ligne de titre à chaque page', checked: () => !!t && !!t.tHead, action: () => op('pinHeader') },
      { label: 'Ne pas couper les lignes entre deux pages', checked: () => !!t && t.classList.contains('tbl-nosplit'), action: () => op('noSplit') },
      { label: 'Vider les cellules', action: () => op('clear') },
      '-',
      { label: 'Propriétés du tableau…', icon: 'i-table', action: () => op('options') },
    ];
  };
  const ALIGN_MENU = () => [['left', 'À gauche', 'i-al-left'], ['center', 'Au centre', 'i-al-center'], ['right', 'À droite', 'i-al-right'], ['justify', 'Justifié', 'i-al-justify']].map(([k, l, i]) => ({ label: l, icon: i, action: () => setHAlign(k) }));

  let barBuilt = false;
  function buildBar() {
    if (barBuilt || !bar) return;
    barBuilt = true;
    const merge_ = h('button', { type: 'button', class: 'tb-icon', id: 'tbl-merge', title: 'Fusionner les cellules sélectionnées', 'aria-label': 'Fusionner les cellules' }, P.svgIcon('i-merge'));
    merge_.addEventListener('mousedown', (e) => e.preventDefault());
    merge_.addEventListener('click', () => { const r = curRect(); if (r && cellsIn(r).some((c) => (c.rowSpan || 1) > 1 || (c.colSpan || 1) > 1) && cellsIn(r).length === 1) op('split'); else op('merge'); });
    const tblBtn = h('button', { type: 'button', class: 'txt', id: 'tbl-menu', title: 'Lignes, colonnes, fusion, tri, en-tête…', 'aria-haspopup': 'menu' }, h('span', { text: 'Tableau' }), P.svgIcon('i-chev-down', 'sm'));
    tblBtn.addEventListener('mousedown', (e) => e.preventDefault());
    tblBtn.addEventListener('click', () => { if (P.pop.isOpen() && P.pop.anchor() === tblBtn) { P.pop.close(); return; } P.saveSel(); P.menu.open(TABLE_MENU(), { anchor: tblBtn, align: 'left' }); });
    bar.replaceChildren(
      tblBtn,
      menuBtn('tbl-borders', 'i-b-all', 'Bordures', BORDER_MENU),
      colorBtn('tbl-bcolor', 'i-pen', 'Couleur de la bordure', (c) => { fmt.color = c || '#000000'; refreshBar(); if (sel) setBorders('all'); }, () => fmt.color),
      menuBtn('tbl-bwidth', 'i-b-width', 'Épaisseur de la bordure', WIDTH_MENU),
      menuBtn('tbl-bdash', 'i-b-dash', 'Style de trait', DASH_MENU),
      colorBtn('tbl-bg', 'i-fill', 'Couleur d’arrière-plan de la cellule', (c) => setBg(c), () => { const c = targets()[0]; return c ? c.style.backgroundColor : ''; }),
      menuBtn('tbl-halign', 'i-al-left', 'Alignement horizontal dans la cellule', ALIGN_MENU),
      menuBtn('tbl-valign', 'i-va-mid', 'Alignement vertical dans la cellule', VALIGN_MENU),
      merge_,
    );
  }
  function refreshBar() {
    if (!bar) return;
    buildBar();
    const sw = $('#tbl-bcolor-sw'); if (sw) sw.style.background = fmt.color;
    const bw = $('#tbl-bwidth'); if (bw) bw.title = 'Épaisseur de la bordure : ' + fmt.width + ' pt';
    const bg = $('#tbl-bg-sw'); const c = targets()[0];
    if (bg) bg.style.background = (c && c.style.backgroundColor) || 'transparent';
    const m = $('#tbl-merge');
    if (m) {
      const r = curRect();
      const cs = r ? cellsIn(r) : [];
      const merged = cs.length === 1 && ((cs[0].rowSpan || 1) > 1 || (cs[0].colSpan || 1) > 1);
      m.disabled = !(cs.length > 1 || merged);
      m.title = merged ? 'Séparer la cellule' : 'Fusionner les cellules sélectionnées';
      m.classList.toggle('on', merged);
    }
  }
  if (bar) buildBar();

  /* ---------- Clavier ---------- */
  ed.addEventListener('keydown', (e) => {
    if (ro()) return;
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const cell = cellAtCaret();
      if (!cell) return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      const table = cell.closest('table');
      const all = Array.from(table.querySelectorAll('td, th')).filter((c) => c.closest('table') === table);
      let i = all.indexOf(cell) + (e.shiftKey ? -1 : 1);
      if (i >= all.length) { sel = null; const G = grid(table); const last = G.rows - 1; insertRows(table, { r1: last, r2: last, c1: 0, c2: 0 }, true); afterEdit(); const fresh = Array.from(table.querySelectorAll('td, th')).filter((c) => c.closest('table') === table); i = all.length; caretTo(fresh[i] || fresh[fresh.length - 1]); return; }
      if (i < 0) return;
      clearSel();
      const t = all[i];
      const r = document.createRange();
      r.selectNodeContents(t);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && cellsIn(sel).length > 1) { e.preventDefault(); clearCells(); return; }
    if (e.key === 'Escape' && sel) { clearSel(); return; }
    if (sel && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(Shift|Control|Alt|Meta|CapsLock|F\d+)$/.test(e.key) && !(e.shiftKey && /^Arrow/.test(e.key))) clearSel();
  });

  P.tables = { grid, op, insert, picker, menuItems: TABLE_MENU, setBorders, setBg, setVAlign, setHAlign, setPad, merge: () => op('merge'), selection: () => sel, targets, properties, headerCount, fmt, rectOf, cellsIn, refresh: refreshBar };
  P.tableOp = op;
  P.inTable = () => !!cellAtCaret() || !!(sel && sel.table.isConnected);
  P.tableInfo = () => {
    const r = curRect();
    if (!r) return null;
    const cs = cellsIn(r);
    return { merged: cs.some((c) => (c.rowSpan || 1) > 1 || (c.colSpan || 1) > 1), multi: cs.length > 1, hasHeader: headerCount(r.table) > 0 };
  };
  if (P.actions) P.actions.table = picker;
})();
