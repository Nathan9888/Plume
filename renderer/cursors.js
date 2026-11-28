/* Plume — curseurs dessinés (flèche, main, texte, attente, déplacement, redimensionnement) dans le style macOS.
   Taille et couleur se règlent dans Paramètres → Apparence → Curseur ; le dessin est recalculé à la volée (SVG) et appliqué
   par variables CSS (--cur-*), si bien que la version Windows et la version navigateur ont exactement les mêmes curseurs. */
(function () {
  'use strict';
  const S = P.settings;
  const root = document.documentElement;

  const COLORS = { black: '#111111', white: '#ffffff', blue: '#0a6cff', red: '#e5342b', orange: '#f07d00', green: '#1f9d4b', purple: '#9a4cd0', pink: '#e8447e', graphite: '#6e6e73' };

  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  function resolveColor(key) {
    if (key === 'accent') {
      const v = (getComputedStyle(root).getPropertyValue('--accent') || '').trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) return v;
      if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('');
      return COLORS.blue;
    }
    return COLORS[key] || COLORS.black;
  }

  /** Les neuf dessins sur une grille de 32 × 32 ; « hot » est le point actif du curseur sur cette grille. */
  function art(fill) {
    const line = luminance(fill) > 0.42 ? '#0b0b0c' : '#ffffff';
    const shape = (d, w) => `<path d="${d}" fill="${line}" stroke="${line}" stroke-width="${w || 3.4}" stroke-linejoin="round"/><path d="${d}" fill="${fill}" stroke="${fill}" stroke-width="1" stroke-linejoin="round"/>`;
    const stroke = (d, w) => `<path d="${d}" fill="none" stroke="${line}" stroke-width="${(w || 2) + 2.6}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${fill}" stroke-width="${w || 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const tri = (pts) => shape('M' + pts.map((p) => p.join(' ')).join(' L') + ' Z', 3.2);

    const arrow = shape('M8 4.5 L8 24.8 L12.7 20.6 L15.9 27.8 L19.4 26.3 L16.3 19.3 L22.6 19.3 Z', 3.2);

    // Main : fond contrasté, contour de la couleur choisie (comme sur macOS)
    const hd = 'M12.3 14.2 V5.4 a2.2 2.2 0 0 1 4.4 0 V12.4 a1.7 1.7 0 0 1 3.4 .4 a1.7 1.7 0 0 1 3.4 .6 a1.65 1.65 0 0 1 3.3 1.2 V21.6 c0 3.4 -2.2 6.2 -4.8 7 H14.6 c-2 -2.2 -4.2 -4.6 -6 -7.2 c-1.4 -2 -2.6 -4 -2.6 -5.3 a1.9 1.9 0 0 1 3.2 -1.2 l2.5 2.6 Z';
    const hand = `<path d="${hd}" fill="${line}" stroke="${line}" stroke-width="3.6" stroke-linejoin="round"/>` +
      `<path d="${hd}" fill="${line}" stroke="${fill}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M16.7 13 V19 M20.1 13.6 V19 M23.5 14.6 V19" fill="none" stroke="${fill}" stroke-width="1.2" stroke-linecap="round"/>`;

    const ibeam = stroke('M16 7.4 V24.6', 2) + stroke('M11.6 5 C14 5 16 5.9 16 7.8 M20.4 5 C18 5 16 5.9 16 7.8 M11.6 27 C14 27 16 26.1 16 24.2 M20.4 27 C18 27 16 26.1 16 24.2', 1.7);

    const nesw = tri([[23, 9], [13, 9], [23, 19]]) + tri([[9, 23], [19, 23], [9, 13]]);
    const nwse = tri([[9, 9], [19, 9], [9, 19]]) + tri([[23, 23], [13, 23], [23, 13]]);
    const ew = tri([[4.6, 16], [12, 9.6], [12, 22.4]]) + tri([[27.4, 16], [20, 9.6], [20, 22.4]]) + shape('M14.8 6.5 h2.4 a.5 .5 0 0 1 .5 .5 V25 a.5 .5 0 0 1 -.5 .5 h-2.4 a.5 .5 0 0 1 -.5 -.5 V7 a.5 .5 0 0 1 .5 -.5 Z', 2.8);
    const ns = tri([[16, 4.6], [9.6, 12], [22.4, 12]]) + tri([[16, 27.4], [9.6, 20], [22.4, 20]]) + shape('M6.5 14.8 V17.2 a.5 .5 0 0 0 .5 .5 H25 a.5 .5 0 0 0 .5 -.5 V14.8 a.5 .5 0 0 0 -.5 -.5 H7 a.5 .5 0 0 0 -.5 .5 Z', 2.8);
    const move = stroke('M16 7 V25 M7 16 H25', 2.2) + tri([[16, 3.2], [12.2, 8.6], [19.8, 8.6]]) + tri([[16, 28.8], [12.2, 23.4], [19.8, 23.4]]) + tri([[3.2, 16], [8.6, 12.2], [8.6, 19.8]]) + tri([[28.8, 16], [23.4, 12.2], [23.4, 19.8]]);

    // Mains ouverte et fermée (déplacer une image) : silhouette de la couleur choisie, intérieur contrasté
    const hands = (pieces, creases) => {
      const outline = pieces.map((p) => p.replace('/>', ` fill="${fill}" stroke="${fill}" stroke-width="3.2" stroke-linejoin="round"/>`)).join('');
      const body = pieces.map((p) => p.replace('/>', ` fill="${line}"/>`)).join('');
      return outline + body + `<path d="${creases}" fill="none" stroke="${fill}" stroke-width="1.1" stroke-linecap="round"/>`;
    };
    const grab = hands([
      '<rect x="9.4" y="9.6" width="3.6" height="13" rx="1.8"/>', '<rect x="13" y="6.4" width="3.6" height="15" rx="1.8"/>',
      '<rect x="16.6" y="6" width="3.6" height="15" rx="1.8"/>', '<rect x="20.2" y="8.4" width="3.6" height="13.5" rx="1.8"/>',
      '<rect x="9.4" y="15" width="14.4" height="11.6" rx="5.2"/>', '<rect x="4.6" y="14.6" width="3.7" height="9" rx="1.85" transform="rotate(-32 6.4 19)"/>',
    ], 'M13 16.5 V13 M16.6 16.5 V12.4 M20.2 16.5 V13.2');
    const grabbing = hands([
      '<rect x="8.6" y="12" width="3.8" height="7" rx="1.9"/>', '<rect x="12.2" y="10.6" width="3.8" height="8" rx="1.9"/>',
      '<rect x="15.8" y="10.6" width="3.8" height="8" rx="1.9"/>', '<rect x="19.4" y="12" width="3.8" height="7" rx="1.9"/>',
      '<rect x="8.6" y="15.2" width="14.6" height="11.2" rx="5.2"/>', '<rect x="6.4" y="17.4" width="8.6" height="3.7" rx="1.85" transform="rotate(14 10.7 19.2)"/>',
    ], 'M12.2 16 V13.4 M15.8 16 V12.8 M19.4 16 V13.4');

    // Roue multicolore (attente) : six pétales en spirale
    const C = 16, R = 11.2, cols = ['#ffd60a', '#ff9f0a', '#ff453a', '#e05bd6', '#0a9cff', '#30d158'];
    const pt = (a, r) => [C + r * Math.cos(a), C + r * Math.sin(a)].map((v) => v.toFixed(2));
    let wheel = `<circle cx="16" cy="17" r="${R + 0.4}" fill="rgba(0,0,0,.22)"/>`;
    cols.forEach((c, i) => {
      const a0 = (i * Math.PI) / 3 - Math.PI / 2, a1 = ((i + 1) * Math.PI) / 3 - Math.PI / 2;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [k0x, k0y] = pt(a0 - 0.55, R * 0.62), [k1x, k1y] = pt(a1 - 0.55, R * 0.62);
      wheel += `<path d="M${C} ${C} Q${k0x} ${k0y} ${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Q${k1x} ${k1y} ${C} ${C} Z" fill="${c}"/>`;
    });
    wheel += `<circle cx="16" cy="16" r="${R}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1"/>`;

    return {
      default: { svg: arrow, hot: [8, 4.5], label: 'Flèche' },
      pointer: { svg: hand, hot: [14.5, 3.4], label: 'Main' },
      text: { svg: ibeam, hot: [16, 16], label: 'Texte' },
      wait: { svg: wheel, hot: [16, 16], label: 'Attente' },
      move: { svg: move, hot: [16, 16], label: 'Déplacer' },
      grab: { svg: grab, hot: [16, 16], label: 'Main ouverte' },
      grabbing: { svg: grabbing, hot: [16, 16], label: 'Main fermée' },
      ew: { svg: ew, hot: [16, 16], label: 'Redimensionner ↔' },
      ns: { svg: ns, hot: [16, 16], label: 'Redimensionner ↕' },
      nwse: { svg: nwse, hot: [16, 16], label: 'Redimensionner ⤡' },
      nesw: { svg: nesw, hot: [16, 16], label: 'Redimensionner ⤢' },
    };
  }

  const FALLBACK = { default: 'auto', pointer: 'pointer', text: 'text', wait: 'wait', move: 'move', grab: 'grab', grabbing: 'grabbing', ew: 'ew-resize', ns: 'ns-resize', nwse: 'nwse-resize', nesw: 'nesw-resize' };

  function svgUrl(svg, size) {
    const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">${svg}</svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(doc).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  let current = null;
  function build() {
    const size = S.get('cursorSize');
    const set = art(resolveColor(S.get('cursorColor')));
    const out = {};
    for (const k of Object.keys(set)) {
      const hx = Math.round((set[k].hot[0] / 32) * size), hy = Math.round((set[k].hot[1] / 32) * size);
      out[k] = { url: svgUrl(set[k].svg, size), hot: [hx, hy], label: set[k].label };
    }
    return out;
  }

  function apply() {
    if (!S.get('cursorOn')) {
      for (const k of Object.keys(FALLBACK)) root.style.removeProperty('--cur-' + k);
      root.classList.remove('cur-on');
      current = null;
      return;
    }
    current = build();
    for (const k of Object.keys(current)) {
      const c = current[k];
      root.style.setProperty('--cur-' + k, `url("${c.url}") ${c.hot[0]} ${c.hot[1]}, ${FALLBACK[k]}`);
    }
    root.classList.add('cur-on');
  }

  let timer = 0;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(apply, 30); };

  /** Aperçu dans les paramètres : une vignette par curseur, à la taille réelle choisie. */
  function preview(wrap) {
    wrap.replaceChildren();
    const set = build();
    const size = S.get('cursorSize');
    for (const k of Object.keys(set)) {
      const tile = document.createElement('span');
      tile.className = 'cp-tile';
      tile.title = set[k].label;
      const img = document.createElement('img');
      img.alt = set[k].label;
      img.width = size; img.height = size;
      img.src = set[k].url;
      tile.append(img);
      wrap.append(tile);
    }
  }

  P.cursors = { apply, refresh, preview, build, COLORS, get current() { return current; } };
  apply();
})();
