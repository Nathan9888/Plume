/* Plume — pastille flottante sous le texte sélectionné : mise en forme rapide, commentaire et réaction par émoji. */
(function () {
  'use strict';
  const { $ } = P;
  const ed = P.editor;
  const state = P.state;
  const bar = $('#selbar');
  if (!bar) return;

  const BTNS = [
    { cmd: 'bold', icon: 'i-bold', title: 'Gras (Ctrl+B)', fmt: true },
    { cmd: 'italic', icon: 'i-italic', title: 'Italique (Ctrl+I)', fmt: true },
    { cmd: 'underline', icon: 'i-underline', title: 'Souligné (Ctrl+U)', fmt: true },
    { act: 'link', icon: 'i-link', title: 'Lien (Ctrl+K)', fmt: true },
    '|',
    { act: 'comment', icon: 'i-comment', title: 'Ajouter un commentaire (Ctrl+Alt+M)' },
    { act: 'emoji', icon: 'i-emoji', title: 'Ajouter un émoji' },
  ];

  const els = [];
  BTNS.forEach((b) => {
    if (b === '|') { const s = document.createElement('span'); s.className = 'sb-sep'; s.setAttribute('role', 'separator'); bar.append(s); els.push({ sep: true, el: s }); return; }
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sb-btn';
    el.title = b.title;
    el.setAttribute('aria-label', b.title);
    el.append(P.svgIcon(b.icon));
    el.addEventListener('mousedown', (e) => e.preventDefault());   // la sélection du document reste en place
    el.addEventListener('click', () => run(b));
    bar.append(el);
    els.push({ b, el });
  });

  let pointerDown = false;
  let frame = 0;
  let live = null;     // plage pour laquelle la pastille est affichée

  function wanted() {
    if (!P.settings.get('selBar') || !P.app.inDoc() || state.mode === 'view') return null;
    if (document.querySelector('.overlay') || P.pop.isOpen()) return null;
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const r = sel.getRangeAt(0);
    if (!ed.contains(r.commonAncestorContainer) || !sel.toString().trim()) return null;
    const el = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentElement : r.commonAncestorContainer;
    if (el && el.closest && el.closest('.toc, .noexport, input, button')) return null;
    return r;
  }

  function hide() { bar.hidden = true; live = null; }

  function update() {
    frame = 0;
    const r = !pointerDown ? wanted() : null;
    if (!r) { hide(); return; }
    const a = P.rangeAnchor(r);
    const top = (document.getElementById('chrome') || { getBoundingClientRect: () => ({ bottom: 0 }) }).getBoundingClientRect().bottom;
    if (a.bottom < top || a.top > innerHeight) { hide(); return; }
    const suggest = state.mode === 'suggest';
    els.forEach(({ b, el }) => { if (b && b.fmt) el.hidden = suggest; if (!b) el.hidden = suggest; });
    bar.hidden = false;
    live = r.cloneRange();
    syncState();
    const w = bar.offsetWidth, hg = bar.offsetHeight;
    // sous la dernière ligne sélectionnée, à hauteur de la fin de la sélection ; au-dessus s'il n'y a pas la place
    let y = a.bottom + 10;
    if (y + hg > innerHeight - 8) y = Math.max(top + 4, a.top - hg - 10);
    const x = Math.max(8, Math.min(a.right - w / 2, innerWidth - w - 8));
    bar.style.left = x + 'px';
    bar.style.top = y + 'px';
  }

  function schedule() { if (!frame) frame = requestAnimationFrame(update); }

  function syncState() {
    els.forEach(({ b, el }) => {
      if (!b || !b.cmd) return;
      let on = false;
      try { on = document.queryCommandState(b.cmd); } catch (_) { /* ignoré */ }
      el.classList.toggle('on', !!on);
    });
  }

  function run(b) {
    const range = live ? live.cloneRange() : null;
    if (b.cmd) { P.exec(b.cmd, null, false); syncState(); return; }
    if (b.act === 'link') { hide(); P.actions.link(); return; }
    if (b.act === 'comment') { hide(); P.addComment(); return; }
    if (b.act === 'emoji' && range) {
      const a = P.rangeAnchor(range);
      hide();
      P.pending.set(range);
      P.emoji.open({
        x: a.right - 20, y: a.bottom + 10,
        onPick: (em) => { P.pending.clear(); P.addReaction(range, em); },
        onClose: () => P.pending.clear(),
      });
    }
  }

  document.addEventListener('selectionchange', schedule);
  document.addEventListener('pointerdown', (e) => { if (ed.contains(e.target)) { pointerDown = true; hide(); } }, true);
  document.addEventListener('pointerup', () => { if (pointerDown) { pointerDown = false; schedule(); } }, true);
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift' || e.key.startsWith('Arrow')) schedule(); });
  document.addEventListener('scroll', () => { if (!bar.hidden) schedule(); }, true);
  window.addEventListener('resize', schedule);
  P.settings.onChange((k) => { if (k === 'selBar' || k === '*') schedule(); });
  P.selbar = { hide, refresh: schedule };
})();
