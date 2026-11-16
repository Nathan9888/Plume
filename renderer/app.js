/* Plume — application : fichiers, modes, panneaux, exports, protection par mot de passe, récupération. */
(function () {
  'use strict';
  const { $, $$, h, esc } = P;
  const ed = P.editor;
  const state = P.state;

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const fileTitle = (p) => String(p || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const safeName = () => (state.title || 'Sans titre').replace(/[\\/:*?"<>|]/g, '_');

  /* ---------- Auteur ---------- */
  const loadAuthor = () => { try { return localStorage.getItem('plume.author') || ''; } catch (_) { return ''; } };
  function setAuthor(name) {
    state.author = name;
    try { localStorage.setItem('plume.author', name); } catch (_) { /* ignoré */ }
    $('#author-name').textContent = name || '—';
  }
  async function askAuthor(first) {
    const r = await P.modal({
      title: first ? 'Bienvenue dans Plume' : 'Votre nom',
      message: 'Ce nom accompagne vos commentaires, vos suggestions et les versions du document.',
      fields: [{ id: 'name', label: 'Nom', value: state.author || '' }],
      ok: 'Enregistrer',
    });
    if (r && r.values.name.trim()) setAuthor(r.values.name.trim().slice(0, 60));
    else if (first && !state.author) setAuthor('Moi');
  }
  $('#btn-author').addEventListener('click', () => askAuthor(false));

  /* ---------- Barre de titre, état ---------- */
  let rev = 0;
  function refreshChrome() {
    const t = state.title || 'Sans titre';
    document.title = (state.dirty ? '• ' : '') + t + ' — Plume';
    $('#savestate').textContent = state.dirty ? 'Modifications non enregistrées' : state.path ? 'Enregistré' : 'Nouveau document';
    $('#st-lock').textContent = state.password ? '🔒 Chiffré' : '';
    $('#st-lock').title = state.password ? 'Document chiffré (AES-256). Pas de récupération automatique pour un document chiffré.' : '';
  }

  let panelTimer = null;
  P.onDirty = () => {
    rev++;
    refreshChrome();
    clearTimeout(panelTimer);
    panelTimer = setTimeout(() => {
      const ae = document.activeElement;
      if (ae && ae.closest && ae.closest('#sidebody')) return;   // ne pas voler le focus d'un champ du panneau
      P.renderPanel();
    }, 400);
  };

  $('#title').addEventListener('input', (e) => { state.title = e.target.value; P.markDirty(); });
  $('#title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });

  /* ---------- Modes ---------- */
  const MODE_LABEL = {
    edit: 'Édition',
    suggest: 'Suggestion : vos modifications sont proposées, pas appliquées',
    view: 'Lecture seule',
  };
  function setMode(m) {
    state.mode = m;
    $('#mode').value = m;
    ed.contentEditable = m === 'view' ? 'false' : 'true';
    document.body.dataset.mode = m;
    $('#st-mode').textContent = MODE_LABEL[m];
    P.renderPanel();
  }
  $('#mode').addEventListener('change', (e) => setMode(e.target.value));

  function setPageless(on) {
    state.pageless = !!on;
    document.body.classList.toggle('pageless', !!on);
    $('#btn-pageless').textContent = on ? '▯ Pages' : '▭ Sans pages';
    P.updateCounts();
  }
  $('#btn-pageless').addEventListener('click', () => { setPageless(!state.pageless); P.markDirty(); });

  /* ---------- Panneau latéral ---------- */
  let tab = 'outline';
  const side = $('#side');
  P.showPanel = (name) => { if (name) tab = name; side.hidden = false; P.renderPanel(); };
  P.renderPanel = () => {
    if (side.hidden) return;
    $$('#sidetabs button').forEach((b) => {
      b.classList.toggle('on', b.dataset.tab === tab);
      if (!b.dataset.label) b.dataset.label = b.textContent;
      let n = 0;
      if (b.dataset.tab === 'comments') n = P.openCommentCount();
      else if (b.dataset.tab === 'suggestions') n = P.suggestionCount();
      b.textContent = b.dataset.label + (n ? ` (${n})` : '');
    });
    const body = $('#sidebody');
    body.replaceChildren();
    const fn = P.panels[tab];
    if (fn) fn(body);
  };
  $('#btn-side').addEventListener('click', () => { if (side.hidden) P.showPanel(); else side.hidden = true; });
  $('#sidetabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) P.showPanel(b.dataset.tab); });

  /* ---------- Chargement ---------- */
  function afterLoad(opts) {
    state.path = opts.path || null;
    state.password = opts.password || null;
    state.dirty = !!opts.dirty;
    $('#title').value = state.title;
    setPageless(state.pageless);
    setMode('edit');
    refreshChrome();
    P.renderPanel();
    $('#scroller').scrollTop = 0;
    if (!opts.dirty) { try { native.recovery.clear(); } catch (_) { /* ignoré */ } }
  }

  function blankState() {
    state.title = 'Sans titre';
    state.variables = {};
    state.comments = [];
    state.versions = [];
    state.assets = {};
    state.pageless = false;
  }

  async function loadFile(f) {
    if (!f) return false;
    if (f.error) { P.toast(f.error, 5000); return false; }
    try {
      if (f.kind === 'plume') {
        let text = f.text;
        let password = null;
        if (f.encrypted) {
          for (;;) {
            const r = await P.modal({
              title: 'Document protégé',
              message: 'Entrez le mot de passe pour ouvrir « ' + fileTitle(f.path) + ' ».',
              fields: [{ id: 'pw', label: 'Mot de passe', type: 'password' }],
              ok: 'Ouvrir',
            });
            if (!r) return false;
            const d = await native.decrypt(f.b64, r.values.pw);
            if (d.error) { P.toast(d.error); continue; }
            text = d.text;
            password = r.values.pw;
            break;
          }
        }
        P.loadData(JSON.parse(text));
        if (state.title === 'Sans titre' && f.path) state.title = fileTitle(f.path);
        afterLoad({ path: f.path, password });
      } else if (f.kind === 'html') {
        const doc = new DOMParser().parseFromString(f.text, 'text/html');
        blankState();
        state.title = (doc.title || '').trim() || fileTitle(f.path) || 'Sans titre';
        ed.innerHTML = P.sanitize(doc.body ? doc.body.innerHTML : '', { pasted: true }) || '<p><br></p>';
        P.refreshVars();
        P.updateCounts();
        afterLoad({ path: null, dirty: true });
      } else {
        blankState();
        state.title = fileTitle(f.path) || 'Sans titre';
        ed.innerHTML = String(f.text).replace(/\r\n?/g, '\n').split('\n').map((l) => '<p>' + (l ? esc(l) : '<br>') + '</p>').join('');
        P.updateCounts();
        afterLoad({ path: null, dirty: true });
      }
      return true;
    } catch (err) {
      P.toast('Impossible d’ouvrir ce fichier : ' + (err && err.message ? err.message : err), 6000);
      return false;
    }
  }

  /* ---------- Enregistrement ---------- */
  async function save(saveAs) {
    P.snapshot(null, true);
    const res = await native.save({
      path: state.path, content: JSON.stringify(P.serialize()), password: state.password || '',
      saveAs: !!saveAs, name: state.title,
    });
    if (!res) return false;
    if (res.error) { P.toast('Échec de l’enregistrement : ' + res.error, 6000); return false; }
    state.path = res.path;
    state.dirty = false;
    try { await native.recovery.clear(); } catch (_) { /* ignoré */ }
    refreshChrome();
    P.renderPanel();
    P.toast('Enregistré');
    return true;
  }

  async function confirmDiscard() {
    if (!state.dirty) return true;
    const r = await P.modal({
      title: 'Modifications non enregistrées',
      message: 'Enregistrer les modifications de « ' + (state.title || 'Sans titre') + ' » ?',
      buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'no', label: 'Ne pas enregistrer' }, { id: 'yes', label: 'Enregistrer', primary: true }],
    });
    if (!r) return false;
    if (r.button === 'yes') return save(false);
    return true;
  }

  async function newDoc() {
    if (!(await confirmDiscard())) return;
    blankState();
    ed.innerHTML = '<p><br></p>';
    P.refreshVars();
    P.updateCounts();
    afterLoad({ path: null });
  }

  async function openDoc() {
    if (!(await confirmDiscard())) return;
    const f = await native.open();
    if (f) await loadFile(f);
  }

  /* ---------- Exports ---------- */
  function report(res, label) {
    if (!res) return;
    if (res.error) P.toast('Échec de l’exportation : ' + res.error, 6000);
    else P.toast(label + ' : ' + fileTitle(res.path) + ' enregistré.');
  }

  async function exportDocx() {
    if (!(await P.runDlp(true))) return;
    try {
      const bytes = PlumeDocx.build(ed, { author: state.author || 'Moi', title: state.title, comments: state.comments });
      report(await native.exportDocx(bytes, safeName()), 'Word');
    } catch (err) { P.toast('Échec de la conversion en Word : ' + (err && err.message ? err.message : err), 6000); }
  }

  async function exportPdf() {
    if (!(await P.runDlp(true))) return;
    report(await native.exportPdf(safeName()), 'PDF');
  }

  const EXPORT_CSS = 'body{font:11pt Calibri,Arial,sans-serif;color:#202124;line-height:1.5;margin:0}main{max-width:780px;margin:32px auto;padding:0 24px}' +
    'h1{font-size:20pt}h2{font-size:16pt}h3{font-size:14pt}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}img{max-width:100%}' +
    'blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:14px;color:#555}ul.checklist{list-style:none;padding-left:4px}' +
    '.chip{background:#e8eef9;border-radius:10px;padding:0 6px}ins.sg-ins{color:#188038;text-decoration:underline}del.sg-del{color:#c5221f}' +
    '.pagebreak{border-top:1px dashed #bbb;margin:24px 0}';

  async function exportHtml() {
    if (!(await P.runDlp(true))) return;
    const c = ed.cloneNode(true);
    c.querySelectorAll('.noexport').forEach((n) => n.remove());
    c.querySelectorAll('.cmt').forEach((n) => P.unwrap(n));
    c.querySelectorAll('input[type="checkbox"]').forEach((i) => i.setAttribute('disabled', ''));
    const html = `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>${esc(state.title || 'Document')}</title><style>${EXPORT_CSS}</style></head><body><main>${c.innerHTML}</main></body></html>`;
    report(await native.exportHtml(html, safeName()), 'HTML');
  }

  async function printDoc() {
    if (!(await P.runDlp(true))) return;
    await native.print();
  }

  /* ---------- Mot de passe ---------- */
  async function setPassword() {
    const r = await P.modal({
      title: 'Protéger par mot de passe',
      message: state.password
        ? 'Ce document est chiffré. Laissez les deux champs vides pour retirer la protection.'
        : 'Le document sera chiffré (AES-256) à l’enregistrement. Sans le mot de passe il est impossible de le rouvrir : Plume ne peut pas le récupérer.',
      fields: [{ id: 'p1', label: 'Mot de passe', type: 'password' }, { id: 'p2', label: 'Confirmer', type: 'password' }],
      ok: 'Appliquer',
    });
    if (!r) return;
    if (r.values.p1 !== r.values.p2) { P.toast('Les deux mots de passe ne correspondent pas.'); return; }
    if (r.values.p1 && r.values.p1.length < 6) { P.toast('Choisissez au moins 6 caractères.'); return; }
    state.password = r.values.p1 || null;
    if (state.password) { try { await native.recovery.clear(); } catch (_) { /* ignoré */ } }   // pas de copie en clair
    P.markDirty();
    await save(false);
  }

  /* ---------- Menu natif ---------- */
  const MENU = {
    new: newDoc, open: openDoc, save: () => save(false), saveAs: () => save(true),
    exportDocx, exportPdf, exportHtml, print: printDoc, password: setPassword,
    find: () => P.openFind(), pageless: () => { setPageless(!state.pageless); P.markDirty(); },
  };
  native.onMenu((id) => { const fn = MENU[id]; if (fn) fn(); });
  native.onExternalOpen(async (f) => { if (await confirmDiscard()) await loadFile(f); });

  // Utilisé par le processus principal (fermeture de la fenêtre)
  window.plume = {
    isDirty: () => state.dirty,
    save: () => save(false),
    discardRecovery: () => native.recovery.clear(),
  };

  /* ---------- Récupération automatique et versions automatiques ---------- */
  let writtenRev = 0;
  setInterval(async () => {
    if (!state.dirty || state.password || rev === writtenRev) return;
    const mine = rev;
    try { await native.recovery.write(JSON.stringify(P.serialize())); writtenRev = mine; } catch (_) { /* ignoré */ }
  }, 5000);

  setInterval(() => {
    if (state.dirty && P.snapshot(null, true) && tab === 'versions') P.renderPanel();
  }, 10 * 60 * 1000);

  /* ---------- Démarrage ---------- */
  async function start() {
    setAuthor(loadAuthor());
    setMode('edit');
    refreshChrome();
    P.updateCounts();
    let init = {};
    try { init = (await native.init()) || {}; } catch (_) { /* ignoré */ }
    if (!state.author) await askAuthor(true);

    try {
      const rec = await native.recovery.read();
      if (rec && typeof rec === 'string') {
        const data = JSON.parse(rec);
        const ok = await P.confirm(
          'Restaurer un document non enregistré ?',
          'Plume s’est fermé avant d’enregistrer « ' + (data.title || 'Sans titre') + ' » (' + fmtDate(data.savedAt) + '). Voulez-vous le récupérer ?',
          'Restaurer');
        if (ok) { P.loadData(data); afterLoad({ path: null, dirty: true }); rev++; }
        else await native.recovery.clear();
      }
    } catch (_) { try { await native.recovery.clear(); } catch (__) { /* ignoré */ } }

    if (init.file && (await confirmDiscard())) await loadFile(init.file);
    ed.focus();
  }
  start();
})();
