/* Plume — polices : un menu comme celui de Google Docs (récentes, mes polices, graisses, « Autres polices »),
   les polices installées sur l'ordinateur et le catalogue complet de Google Fonts (près de 1 900 familles, téléchargées
   seulement quand on les utilise). Les polices en ligne ne sont chargées que si le réglage « Polices en ligne » est actif. */
(function () {
  'use strict';
  const { $, h } = P;
  const ed = P.editor;
  const KEY = 'plume.fonts';
  const MAX_RECENT = 5;
  const WEIGHTS = [[100, 'Fin'], [200, 'Très clair'], [300, 'Clair'], [400, 'Normal'], [500, 'Moyen'], [600, 'Semi-gras'], [700, 'Gras'], [800, 'Très gras'], [900, 'Noir']];
  const CATS = ['Sans-serif', 'Serif', 'Affichage', 'Écriture manuscrite', 'Monospace', 'Cet ordinateur'];
  const BASE = ['Arial', 'Arial Narrow', 'Arial Black', 'Book Antiqua', 'Calibri', 'Cambria', 'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
    'Courier New', 'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Gill Sans MT', 'Helvetica', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype',
    'Rockwell', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

  /* ---------- Réglages mémorisés (appareil) ---------- */
  const store = { mine: [], recent: [], local: [], online: true };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    for (const k of ['mine', 'recent', 'local']) if (Array.isArray(s[k])) store[k] = s[k].filter((x) => typeof x === 'string' && x && x.length <= 100).slice(0, k === 'local' ? 3000 : 300);
    if (typeof s.online === 'boolean') store.online = s.online;
  } catch (_) { /* valeurs par défaut */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_) { /* stockage indisponible */ } if (P.fonts && P.fonts.onChange) P.fonts.onChange(); };

  /* ---------- Catalogue Google ---------- */
  let cat = null;
  const byName = new Map();
  function catalogue() {
    if (cat) return cat;
    cat = String(P.gfontsRaw || '').split(';').filter(Boolean).map((s) => {
      const [n, c, m, i] = s.split('|');
      const mask = parseInt(m, 16) || 8;
      const weights = [];
      for (let k = 0; k < 9; k++) if (mask & (1 << k)) weights.push((k + 1) * 100);
      return { name: n, cat: +c, weights, italic: i === '1' };
    });
    cat.forEach((f) => byName.set(f.name.toLowerCase(), f));
    return cat;
  }
  const gfont = (name) => { catalogue(); return byName.get(String(name || '').toLowerCase()) || null; };

  const loaded = new Set();
  const previewed = new Set();

  /* ---------- Détection des polices installées ---------- */
  let canvas = null;
  const instCache = new Map();
  const localSet = () => new Set(store.local.map((x) => x.toLowerCase()));
  function installed(name) {
    const k = name.toLowerCase();
    if (instCache.has(k)) return instCache.get(k);
    let res = localSet().has(k);
    const g = byName.get(k);
    if (!res && !(g && (loaded.has(g.name) || previewed.has(g.name)))) {   // une police déjà téléchargée ne prouve pas qu'elle est installée
      try {
        canvas = canvas || document.createElement('canvas').getContext('2d');
        const txt = 'mmmmmmmmmmlli1WwQ@#àéÔ';
        for (const base of ['monospace', 'serif', 'sans-serif']) {
          canvas.font = '72px ' + base;
          const w0 = canvas.measureText(txt).width;
          canvas.font = '72px "' + name.replace(/"/g, '') + '", ' + base;
          if (canvas.measureText(txt).width !== w0) { res = true; break; }
        }
      } catch (_) { res = false; }
    }
    instCache.set(k, res);
    return res;
  }

  /* ---------- Chargement des polices en ligne ---------- */
  const linkCss = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); };
  const gUrl = (f, extra) => 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f.name).replace(/%20/g, '+') + (extra || '') + '&display=swap';
  function load(name) {
    const f = gfont(name);
    if (!f || !store.online || loaded.has(f.name) || installed(f.name)) return;
    loaded.add(f.name);
    const w = f.weights.length ? f.weights : [400];
    const q = f.italic ? ':ital,wght@' + [0, 1].flatMap((i) => w.map((x) => i + ',' + x)).join(';') : ':wght@' + w.join(';');
    linkCss(gUrl(f, q));
  }
  function preview(name) {
    const f = gfont(name);
    if (!f || !store.online || loaded.has(f.name) || previewed.has(f.name) || installed(f.name)) return;
    previewed.add(f.name);
    linkCss(gUrl(f, '') + '&text=' + encodeURIComponent(f.name));
  }
  const familiesIn = (root) => {
    const out = new Set();
    root.querySelectorAll('[style*="font-family"]').forEach((el) => {
      for (const part of String(el.style.fontFamily || '').split(',')) { const n = part.replace(/["']/g, '').trim(); if (n) out.add(n); }
    });
    return out;
  };
  /** Charge les polices en ligne utilisées par le document ouvert. */
  function scan() { familiesIn(ed).forEach(load); }
  let scanTimer = 0;
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 500); }).observe(ed, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }

  /* ---------- Polices de l'ordinateur (Local Font Access, si le navigateur le permet) ---------- */
  async function loadLocal() {
    if (typeof window.queryLocalFonts !== 'function') throw new Error('Votre navigateur ne permet pas de lister les polices de l’ordinateur.');
    const list = await window.queryLocalFonts();
    const fams = Array.from(new Set(list.map((f) => f.family))).filter((x) => x && x.length <= 100).sort((a, b) => a.localeCompare(b));
    store.local = fams.slice(0, 3000);
    instCache.clear();
    save();
    return store.local.length;
  }

  /* ---------- Listes ---------- */
  const uniq = (a) => Array.from(new Set(a));
  const baseInstalled = () => BASE.filter(installed);
  const mine = () => uniq([...baseInstalled(), ...store.mine]).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  function weightsOf(name) {
    const f = gfont(name);
    if (f) return WEIGHTS.filter(([w]) => f.weights.includes(w));
    return [];
  }

  function remember(name) {
    store.recent = [name, ...store.recent.filter((x) => x !== name)].slice(0, MAX_RECENT);
    save();
  }

  /* ---------- Application à la sélection ---------- */
  const famOf = (sp) => (sp.style.fontFamily || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  function apply(name, weight) {
    if (P.state.mode === 'view') return;
    load(name);
    remember(name);
    P.restoreSel();
    const sel = window.getSelection();
    const collapsed = !sel.rangeCount || sel.getRangeAt(0).collapsed;
    P.exec('fontName', name, true);
    if (weight) {
      const r = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (collapsed) {
        let bold = false;
        try { bold = document.queryCommandState('bold'); } catch (_) { /* ignoré */ }
        if ((weight >= 600) !== bold) document.execCommand('bold');
      } else if (r) {
        ed.querySelectorAll('span').forEach((sp) => { if (famOf(sp) === name.toLowerCase() && r.intersectsNode(sp)) sp.style.fontWeight = String(weight); });
        P.markDirty();
      }
    }
    reflect(name);
    if (P.updateToolbar) P.updateToolbar();
  }

  /** Affiche la police courante dans la barre d'outils (ajoute l'entrée si besoin). */
  function reflect(fam) {
    const sel = $('#tb-font');
    if (!sel || !fam) return;
    if (!Array.from(sel.options).some((o) => o.value === fam)) sel.append(new Option(fam, fam));
    sel.value = fam;
  }

  /* ---------- Menu déroulant ---------- */
  const currentFont = () => ($('#tb-font') || {}).value || '';
  function menuItems() {
    const cur = currentFont().toLowerCase();
    const mk = (n) => {
      const ws = weightsOf(n);
      const it = { label: n, font: n, checked: () => n.toLowerCase() === cur, action: () => apply(n) };
      if (ws.length > 1) it.items = ws.map(([w, l]) => ({ label: l, style: 'font-family:"' + n.replace(/"/g, '') + '";font-weight:' + w, action: () => apply(n, w) }));
      return it;
    };
    const items = [{ label: 'Autres polices', icon: 'i-title', action: () => openDialog() }];
    const rec = store.recent.filter((n) => n !== '');
    if (rec.length) items.push('-', { caption: 'Récentes' }, ...rec.map(mk));
    items.push('-', { caption: 'Mes polices' }, ...mine().map(mk));
    return items;
  }
  function openMenu(anchor) {
    const items = menuItems();
    items.forEach((it) => { if (it && it.font) preview(it.font); });   // aperçu léger (le nom seulement) : la police entière n'est téléchargée qu'à l'emploi
    P.menu.open(items, { anchor, align: 'left' });
  }
  P.fontMenu = openMenu;

  /* ---------- Fenêtre « Autres polices » ---------- */
  function openDialog() {
    P.saveSel();
    catalogue();
    const chosen = new Set(mine().filter((n) => !baseInstalled().includes(n)));
    const all = () => [...cat.map((f) => ({ name: f.name, cat: f.cat })), ...store.local.filter((n) => !byName.has(n.toLowerCase())).map((n) => ({ name: n, cat: 5 }))];
    let filter = '', catSel = -1, shown = 0, rows = [];
    const STEP = 70;

    const q = h('input', { type: 'search', placeholder: 'Rechercher des polices', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Rechercher des polices' });
    const catBox = h('select', { 'aria-label': 'Catégorie' }, h('option', { value: '-1', text: 'Toutes les catégories' }), CATS.map((c, i) => h('option', { value: String(i), text: c })));
    const list = h('div', { class: 'fd-list', role: 'listbox', 'aria-label': 'Polices disponibles', 'aria-multiselectable': 'true' });
    const sel = h('div', { class: 'fd-sel', 'aria-label': 'Polices sélectionnées' });
    const note = h('p', { class: 'fd-note' });
    const count = h('span', { class: 'fd-count' });
    const online = h('input', { type: 'checkbox', checked: store.online });
    online.addEventListener('change', () => { store.online = online.checked; save(); if (store.online) renderList(true); updateNote(); });

    function updateNote() {
      note.textContent = store.online
        ? (navigator.onLine === false ? 'Vous êtes hors ligne : les polices de Google Fonts ne s’affichent pas pour le moment.' : 'Les polices de Google Fonts sont téléchargées depuis les serveurs de Google quand vous les utilisez.')
        : 'Polices en ligne désactivées : seules les polices installées sur cet ordinateur sont utilisées.';
    }
    updateNote();

    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { preview(e.target.dataset.n); io.unobserve(e.target); } }), { root: list, rootMargin: '120px' }) : null;

    function rowEl(f) {
      const on = chosen.has(f.name);
      const b = h('button', { type: 'button', class: 'fd-row' + (on ? ' on' : ''), role: 'option', 'aria-selected': String(on), 'data-n': f.name },
        h('span', { class: 'fd-name', style: 'font-family:"' + f.name.replace(/"/g, '') + '",system-ui,sans-serif', text: f.name }),
        h('span', { class: 'fd-cat', text: CATS[f.cat] }),
        h('span', { class: 'fd-tick' }, on ? P.svgIcon('i-check', 'sm') : null));
      b.addEventListener('click', () => { if (chosen.has(f.name)) chosen.delete(f.name); else chosen.add(f.name); b.classList.toggle('on'); b.setAttribute('aria-selected', String(chosen.has(f.name))); b.querySelector('.fd-tick').replaceChildren(...(chosen.has(f.name) ? [P.svgIcon('i-check', 'sm')] : [])); renderSel(); });
      if (io) io.observe(b); else preview(f.name);
      return b;
    }
    function renderList(reset) {
      if (reset) {
        const t = filter.trim().toLowerCase();
        rows = all().filter((f) => (catSel < 0 || f.cat === catSel) && (!t || f.name.toLowerCase().includes(t)));
        list.replaceChildren(); shown = 0; list.scrollTop = 0;
        count.textContent = rows.length + ' police' + (rows.length > 1 ? 's' : '');
        if (!rows.length) list.append(h('p', { class: 'fd-empty', text: 'Aucune police ne correspond.' }));
      }
      const next = rows.slice(shown, shown + STEP);
      shown += next.length;
      list.append(...next.map(rowEl));
    }
    function renderSel() {
      const names = Array.from(chosen).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
      sel.replaceChildren(...(names.length ? names.map((n) => h('div', { class: 'fd-pick' },
        h('span', { style: 'font-family:"' + n.replace(/"/g, '') + '",system-ui,sans-serif', text: n }),
        h('button', { type: 'button', class: 'fd-x', title: 'Retirer ' + n, 'aria-label': 'Retirer ' + n, onclick: () => { chosen.delete(n); renderSel(); const r = list.querySelector('[data-n="' + n.replace(/["\\]/g, '') + '"]'); if (r) { r.classList.remove('on'); r.setAttribute('aria-selected', 'false'); r.querySelector('.fd-tick').replaceChildren(); } } }, P.svgIcon('i-close', 'sm'))))
        : [h('p', { class: 'fd-empty', text: 'Cochez des polices à gauche pour les ajouter à votre menu.' })]));
    }
    list.addEventListener('scroll', () => { if (shown < rows.length && list.scrollTop + list.clientHeight > list.scrollHeight - 160) renderList(false); });
    q.addEventListener('input', () => { filter = q.value; renderList(true); });
    catBox.addEventListener('change', () => { catSel = parseInt(catBox.value, 10); renderList(true); });

    const localBtn = h('button', { type: 'button', class: 'fd-link', text: 'Polices de cet ordinateur…', title: 'Ajouter à la liste les polices installées sur cet ordinateur' });
    localBtn.addEventListener('click', async () => {
      try {
        const n = await loadLocal();
        P.toast(n + ' polices de cet ordinateur ajoutées à la liste.');
        catBox.value = '5'; catSel = 5; renderList(true);
      } catch (e) { P.toast(String((e && e.message) || e), 5000); }
    });
    if (typeof window.queryLocalFonts !== 'function') localBtn.hidden = true;

    const finish = (ok) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (io) io.disconnect();
      if (!ok) return;
      const base = new Set(baseInstalled());
      store.mine = Array.from(chosen).filter((n) => !base.has(n));
      save();
      P.toast('Votre liste de polices est à jour.');
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
    document.addEventListener('keydown', onKey, true);
    const form = h('form', { class: 'modal fonts-dlg', novalidate: '', onsubmit: (e) => { e.preventDefault(); finish(true); } },
      h('h3', { text: 'Autres polices' }),
      h('div', { class: 'fd-bar' }, h('label', { class: 'fd-search' }, P.svgIcon('i-search', 'sm'), q), catBox),
      h('div', { class: 'fd-cols' },
        h('div', { class: 'fd-col' }, list, h('div', { class: 'fd-foot' }, count)),
        h('div', { class: 'fd-col fd-col-r' }, h('div', { class: 'fd-cap', text: 'Polices sélectionnées' }), sel)),
      h('label', { class: 'fd-online' }, online, h('span', { text: 'Utiliser les polices en ligne (Google Fonts)' })),
      note,
      h('div', { class: 'btnrow' }, localBtn, h('span', { class: 'spacer' }),
        h('button', { type: 'button', text: 'Annuler', onclick: () => finish(false) }),
        h('button', { type: 'submit', class: 'primary', text: 'OK' })));
    const overlay = h('div', { class: 'overlay' }, form);
    document.body.append(overlay);
    renderList(true); renderSel();
    q.focus();
  }

  /* ---------- Branchement sur la barre d'outils ---------- */
  const fontSel = $('#tb-font');
  if (fontSel) {
    fontSel.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (P.pop.isOpen() && P.pop.anchor() === fontSel) { P.pop.close(); return; }
      openMenu(fontSel);
    }, true);
    fontSel.addEventListener('keydown', (e) => {
      if (e.key === 'F4' || e.key === ' ' || e.key === 'Enter' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) { e.preventDefault(); e.stopPropagation(); openMenu(fontSel); }
    }, true);
  }

  P.fonts = {
    apply, reflect, scan, load, installed, openDialog, openMenu, gfont, mine, WEIGHTS,
    catalogue: () => catalogue().slice(),
    isOnline: () => store.online,
    setOnline: (v) => { store.online = !!v; save(); if (v) scan(); },
    onChange: null,
  };
})();
