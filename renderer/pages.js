/* Plume — pagination : de vraies feuilles séparées par un espace, comme dans Google Docs.
 *
 * Principe : le document reste UN SEUL élément éditable (le natif — frappe, sélection, annulation — n'est jamais touché).
 *  - Les feuilles et l'espace gris qui les sépare sont dessinés par le CSS (styles.css, « #page.sheet::after »).
 *  - Pour qu'aucune ligne ne tombe dans l'espace entre deux feuilles (ni dans les marges), le bloc de texte qui
 *    chevauche une limite de page reçoit un flottant invisible (« [data-pg]::before ») dont la forme (shape-outside)
 *    est la zone interdite : le navigateur repousse lui-même chaque ligne concernée sur la page suivante.
 *    → découpe ligne par ligne, sans toucher au texte ni aux nœuds : l'annulation native reste intacte.
 *  - Un tableau se coupe entre deux lignes : la ligne qui chevauche la limite reçoit une cale (« tr[data-pg] > td::before »).
 *  - Un saut de page manuel (.pagebreak) remplit le reste de la page.
 * Les marques (attribut data-pg + variables --pgy/--pgh/--pgm) sont purement visuelles : elles sont retirées
 * à l'enregistrement, à l'export et au collage (P.pages.strip).
 */
(function () {
  'use strict';
  const ed = P.editor;
  const state = P.state;
  const ATTR = 'data-pg';
  const VARS = ['--pgy', '--pgh', '--pgm'];
  const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'DIV', 'PRE', 'TABLE', 'HR', 'DL', 'DD', 'DT', 'FIGURE', 'SECTION', 'ARTICLE']);

  let G = null;          // géométrie (px, repère de la feuille)
  let S = 1;             // facteur de zoom de la page
  let running = false;
  let pages = 1;
  let queued = 0;

  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const enabled = () => !state.pageless;

  function geometry() {
    const rs = getComputedStyle(document.documentElement);
    const cs = getComputedStyle(ed);
    const pageH = num(rs.getPropertyValue('--page-h'), 1056);
    const gap = num(rs.getPropertyValue('--pg-gap'), 24);
    const mt = num(cs.paddingTop, 96);
    const mb = num(cs.paddingBottom, 96);
    const contentH = Math.max(120, pageH - mt - mb);
    const band = mb + gap + mt;            // zone interdite : marge basse + espace + marge haute
    return { pageH, gap, mt, mb, contentH, band, step: contentH + band };
  }

  // Mesures relatives à la feuille : le navigateur peut décaler le défilement (ancrage) pendant qu'on repousse du contenu,
  // si bien qu'une origine lue une seule fois deviendrait fausse.
  const top = (el) => (el.getBoundingClientRect().top - ed.getBoundingClientRect().top) / S - G.mt;
  const bottom = (el) => (el.getBoundingClientRect().bottom - ed.getBoundingClientRect().top) / S - G.mt;
  const mod = (x, m) => ((x % m) + m) % m;

  function unmark(el) {
    el.removeAttribute(ATTR);
    for (const v of VARS) el.style.removeProperty(v);
    if (el.getAttribute('style') === '') el.removeAttribute('style');
  }
  const setVar = (el, name, px) => {
    const cur = num(el.style.getPropertyValue(name), NaN);
    if (!Number.isFinite(cur) || Math.abs(cur - px) > 0.4) el.style.setProperty(name, (Math.round(px * 100) / 100) + 'px');
  };

  /** Retire toutes les marques de pagination d'un arbre (copie du document, HTML à exporter…). */
  function strip(root) {
    if (!root || !root.querySelectorAll) return root;
    root.querySelectorAll('[' + ATTR + ']').forEach(unmark);
    return root;
  }
  /** Idem, sur du texte HTML. */
  function stripHTML(html) {
    if (!/data-pg/.test(html || '')) return html;
    const t = document.createElement('template');
    t.innerHTML = html;
    strip(t.content);
    return t.innerHTML;
  }

  const blockKids = (el) => { const out = []; for (const c of el.children) if (BLOCK.has(c.tagName)) out.push(c); return out; };
  const hasBeforeContent = (el) => getComputedStyle(el, '::before').content !== 'none';

  /** Élément (ou ligne de tableau) qui chevauche la limite b : { el, kind } ou null. */
  function locate(b) {
    let el = ed;
    for (let depth = 0; depth < 14; depth++) {
      const kids = blockKids(el);
      if (!kids.length) return el === ed ? null : { el, kind: 'text' };
      let lo = 0, hi = kids.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (bottom(kids[mid]) > b) hi = mid; else lo = mid + 1; }
      const kid = kids[lo];
      if (!kid || top(kid) >= b + G.band) {
        // aucun bloc enfant ne chevauche : le texte propre de el (ex. une puce avant sa sous-liste) peut chevaucher
        if (el !== ed && top(el) < b + G.band && bottom(el) > b) return { el, kind: 'text' };
        return null;
      }
      if (kid.classList.contains('pagebreak')) return null;
      if (kid.tagName === 'TABLE') return { el: kid, kind: 'table' };
      if (kid.tagName === 'HR') return { el: kid, kind: 'block' };
      if (blockKids(kid).length) { el = kid; continue; }
      if (!kid.hasAttribute(ATTR) && hasBeforeContent(kid)) return { el: kid, kind: 'block' };
      return { el: kid, kind: 'text' };
    }
    return null;
  }

  function markText(el, b, seen) {
    const cs = getComputedStyle(el);
    const t = top(el) + num(cs.paddingTop, 0) + num(cs.borderTopWidth, 0);
    const Y = b - t;
    const first = !seen.has(el);
    seen.add(el);
    const prevY = num(el.style.getPropertyValue('--pgy'), NaN);
    const phase = Number.isFinite(prevY) ? mod(Y - prevY, G.step) : NaN;
    const same = el.getAttribute(ATTR) === 't' && (phase < 0.6 || G.step - phase < 0.6);
    if (!same) {
      el.setAttribute(ATTR, 't');
      setVar(el, '--pgy', Y);
      setVar(el, '--pgh', Y + G.band);
      return;
    }
    const prevH = num(el.style.getPropertyValue('--pgh'), 0);
    const want = first ? Y + G.band : Math.max(prevH, Y + G.band);
    setVar(el, '--pgh', want);
  }

  function markRow(table, b, seen) {
    const rows = table.rows;
    if (!rows.length) return;
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bottom(rows[mid]) > b) hi = mid; else lo = mid + 1; }
    const row = rows[lo];
    if (!row) return;
    const t = top(row);
    if (t >= b + G.band) return;
    const cell = row.cells[0];
    const pad = cell ? num(getComputedStyle(cell).paddingTop, 0) : 0;
    const push = Math.max(1, b + G.band - t - pad);
    seen.add(row);
    if (row.getAttribute(ATTR) !== 'r') row.setAttribute(ATTR, 'r');
    setVar(row, '--pgy', push);
  }

  /** Bloc sans lignes de texte (trait, bloc décoré) : on le descend sous la zone interdite par sa marge haute. */
  function pushBlock(el, b, seen) {
    const target = b + G.band;
    seen.add(el);
    for (let k = 0; k < 3; k++) {
      const cur = top(el);
      const d = target - cur;
      if (cur >= target - 0.5 && k === 0) return;
      if (Math.abs(d) < 0.5) return;
      const prev = el.previousElementSibling;
      const base = prev ? bottom(prev) : top(el.parentElement) + num(getComputedStyle(el.parentElement).paddingTop, 0);
      const m = Math.max(0, cur - base + d);
      el.setAttribute(ATTR, 'm');
      el.style.setProperty('--pgm', (Math.round(m * 100) / 100) + 'px');
    }
  }

  /** Saut de page manuel : remplit le reste de la page courante. */
  function setBreak(el, seen) {
    const t = top(el);
    const k = Math.max(0, Math.floor(t / G.step));
    const h = Math.max(1, (k + 1) * G.step - t);
    seen.add(el);
    if (el.getAttribute(ATTR) !== 'b') el.setAttribute(ATTR, 'b');
    setVar(el, '--pgm', h);
  }

  /** Une marque est « périmée » si l'élément ne touche plus aucune zone interdite. */
  function stale(el) {
    const t = top(el), bt = bottom(el);
    const k = Math.max(0, Math.floor(t / G.step));
    return !(bt > k * G.step + G.contentH);
  }

  function run() {
    if (running) return;
    if (!enabled()) { clear(); return; }
    if (!ed.isConnected || !ed.offsetWidth || !ed.offsetHeight) return;
    running = true;
    try {
      G = geometry();
      const pr = ed.getBoundingClientRect();
      S = pr.width / ed.offsetWidth || 1;

      // 1. les poussées de blocs sont toujours recalculées ; les autres marques périmées sont retirées
      ed.querySelectorAll('[' + ATTR + '="m"]').forEach(unmark);
      for (let pass = 0; pass < 3; pass++) {
        let removed = 0;
        ed.querySelectorAll('[' + ATTR + '="t"],[' + ATTR + '="r"]').forEach((el) => { if (stale(el)) { unmark(el); removed++; } });
        if (!removed) break;
      }

      // 2. on parcourt les limites de page l'une après l'autre
      const seen = new Set();
      const breaks = Array.from(ed.querySelectorAll('.pagebreak'));
      let j = 0, i = 0;
      for (; i < 4000; i++) {
        const b = i * G.step + G.contentH;
        while (j < breaks.length && top(breaks[j]) < b) setBreak(breaks[j++], seen);
        const last = ed.lastElementChild;
        if (!last || bottom(last) <= b) break;
        const hit = locate(b);
        if (hit) {
          if (hit.kind === 'text') markText(hit.el, b, seen);
          else if (hit.kind === 'table') markRow(hit.el, b, seen);
          else pushBlock(hit.el, b, seen);
        }
        while (j < breaks.length && top(breaks[j]) < b + G.band) setBreak(breaks[j++], seen);
      }
      while (j < breaks.length) setBreak(breaks[j++], seen);
      pages = i + 1;

      // 3. nettoyage + hauteur de la dernière feuille
      ed.querySelectorAll('[' + ATTR + ']').forEach((el) => { if (!seen.has(el)) unmark(el); });
      const minH = G.pageH + i * G.step;
      const root = document.documentElement;
      if (root.style.getPropertyValue('--pg-minh') !== minH + 'px') root.style.setProperty('--pg-minh', minH + 'px');
      document.body.dataset.pages = String(pages);
    } finally {
      running = false;
      obs.takeRecords();
    }
    if (P.pages && P.pages.onChange) P.pages.onChange(pages);
  }

  function clear() {
    if (running) return;
    running = true;
    try {
      ed.querySelectorAll('[' + ATTR + ']').forEach(unmark);
      document.documentElement.style.removeProperty('--pg-minh');
    } finally { running = false; obs.takeRecords(); }
  }

  function schedule() {
    if (queued) return;
    queued = requestAnimationFrame(() => { queued = 0; run(); });
  }

  // Tout changement du document (frappe, collage, annulation…) : on recalcule dans la même tâche, avant l'affichage.
  const obs = new MutationObserver(() => { if (!running) run(); });
  obs.observe(ed, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'width', 'height', 'colspan', 'rowspan', 'src', 'contenteditable'] });
  if (window.ResizeObserver) new ResizeObserver(() => { if (!running) schedule(); }).observe(ed);
  ed.addEventListener('load', schedule, true);               // une image qui finit de charger change la hauteur
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', schedule);
  window.addEventListener('beforeprint', clear);
  window.addEventListener('afterprint', () => schedule());

  P.pages = {
    refresh: run,
    schedule,
    clear,
    strip,
    stripHTML,
    enabled,
    count() { return enabled() ? pages : 0; },
    geometry() { return G || geometry(); },
    onChange: null,
  };
  P.pageCount = () => (enabled() ? Math.max(1, pages) : 0);
  P.pageLabel = () => { const n = P.pageCount(); return n + ' page' + (n > 1 ? 's' : ''); };
  P.pages.onChange = () => { const el = document.getElementById('st-pages'); if (el) el.textContent = enabled() ? P.pageLabel() : ''; };

  schedule();
})();
