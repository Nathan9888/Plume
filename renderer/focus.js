/* Plume — mode concentration : seule la page reste à l'écran, avec le temps de lecture et, si on le souhaite,
   les autres paragraphes estompés. Échap (ou Ctrl+Alt+C) pour revenir. */
(function () {
  'use strict';
  const { $ } = P;
  const ed = P.editor;
  const body = document.body;
  const pill = $('#focuspill');
  let on = false;
  let hideTimer = 0;
  let countTimer = 0;

  const words = () => P.wordCount();

  function refresh() {
    if (!on || !pill) return;
    const n = words();
    $('#fp-text').textContent = `${P.readingLabel(n).replace('lecture : ', 'Lecture : ').replace('lecture ≈', 'Lecture ≈')} · ${n} mot${n > 1 ? 's' : ''}`;
  }
  P.focusRefresh = () => { if (!on) return; clearTimeout(countTimer); countTimer = setTimeout(refresh, 120); };

  function poke() {
    if (!pill) return;
    pill.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => pill.classList.remove('show'), 2600);
  }

  /** Estompe tout sauf le paragraphe courant, sans toucher au contenu (API « CSS Custom Highlight »). */
  function dim() {
    if (!window.Highlight || !window.CSS || !CSS.highlights) return;
    if (!on || !P.settings.get('focusDim')) { CSS.highlights.delete('plume-dim'); return; }
    const sel = window.getSelection();
    if (!sel.rangeCount || !ed.contains(sel.anchorNode)) { CSS.highlights.delete('plume-dim'); return; }
    let n = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    let cur = n && n.closest ? n.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre') : null;
    if (!cur || !ed.contains(cur)) { while (n && n.parentNode !== ed) n = n.parentNode; cur = n && n !== ed ? n : null; }
    if (!cur) { CSS.highlights.delete('plume-dim'); return; }
    const before = document.createRange();
    before.setStart(ed, 0);
    before.setEndBefore(cur);
    const after = document.createRange();
    after.setStartAfter(cur);
    after.setEnd(ed, ed.childNodes.length);
    CSS.highlights.set('plume-dim', new Highlight(before, after));
  }

  function enter() {
    if (on || !P.app.inDoc()) return;
    on = true;
    body.classList.add('focus');
    if (pill) pill.hidden = false;
    refresh();
    poke();
    dim();
    if (P.selbar) P.selbar.hide();
    if (!ed.contains(document.activeElement)) ed.focus({ preventScroll: true });
  }

  function exit() {
    if (!on) return;
    on = false;
    body.classList.remove('focus');
    if (pill) { pill.hidden = true; pill.classList.remove('show'); }
    if (window.CSS && CSS.highlights) CSS.highlights.delete('plume-dim');
  }

  P.focus = { enter, exit, toggle: () => (on ? exit() : enter()), isOn: () => on };

  document.addEventListener('selectionchange', () => { if (on) dim(); });
  document.addEventListener('mousemove', () => { if (on) poke(); });
  P.settings.onChange((k) => { if (k === 'focusDim' || k === '*') dim(); });
  if (pill) $('#fp-exit').addEventListener('click', exit);

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.overlay')) return;
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); P.focus.toggle(); return; }
    if (e.key === 'Escape' && on && !e.defaultPrevented && !P.pop.isOpen() && $('#findbar').hidden && $('#atmenu').hidden) exit();
  }, true);

  // On quitte le mode en changeant d'onglet ou en revenant à l'accueil
  const poll = setInterval(() => { if (on && !P.app.inDoc()) exit(); }, 400);
  window.addEventListener('pagehide', () => clearInterval(poll));
})();
