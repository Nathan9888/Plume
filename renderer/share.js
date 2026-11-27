/* Plume — Partager : dialogue (recherche d'une personne par son nom, rôle de chacun), section « Partagés avec moi » de l'accueil. */
(function () {
  'use strict';
  const { h } = P;
  const Y = P.sync;
  const ROLE = P.collab.ROLE;
  const ROLES = [
    ['edit', 'Édition', 'Peut modifier le document'],
    ['suggest', 'Suggestion', 'Peut proposer des modifications'],
    ['view', 'Lecture', 'Peut seulement lire'],
  ];

  const avatar = (name, color, extra) => h('span', { class: 'sh-av' + (extra ? ' ' + extra : ''), style: 'background:' + P.safeColor(color, name), text: P.initials(name) });

  /* ---------- Le bouton Partager n'existe que si le compte en ligne est configuré ---------- */
  const btn = P.$('#btn-share');
  const syncBtn = () => { if (btn) btn.hidden = !(Y && Y.account && Y.account.configured); };
  if (Y) Y.on(syncBtn);
  syncBtn();
  if (btn) {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => open());
  }

  const docTitle = () => P.state.title || 'Sans titre';

  async function open() {
    const A = P.app;
    if (!A.inDoc()) return;
    if (!Y.account.configured) { P.toast('Le partage nécessite le compte en ligne.', 5000); return; }
    if (!Y.can()) { P.toast('Connectez-vous à votre compte pour partager (Paramètres, Compte).', 6000); if (P.settings.openDialog) P.settings.openDialog('account'); return; }
    if (A.role() !== 'owner') { guestDialog(); return; }
    if (P.state.password) { P.toast('Un document protégé par mot de passe ne peut pas être partagé. Retirez d’abord le mot de passe.', 6000); return; }
    if (!A.isCloud()) {
      const ok = await P.confirm('Enregistrer en ligne pour partager ?',
        'Pour être partagé, « ' + docTitle() + ' » doit être enregistré dans votre compte en ligne' + (P.state.path ? ' ; il ne sera plus lié au fichier de cet ordinateur (vous pourrez en enregistrer une copie)' : '') + '.', 'Enregistrer et partager');
      if (!ok) return;
      if (!(await A.saveOnline())) return;
    } else if (P.state.dirty) {
      if (!(await A.saveOnline())) return;
    }
    const info = A.collabInfo();
    if (!info) { P.toast('Ce document n’est pas encore enregistré en ligne.', 5000); return; }
    ownerDialog(info.docId);
  }

  /* ---------- Fenêtre pour le propriétaire ---------- */
  function ownerDialog(docId) {
    let rows = [];                                    // [{id, name, color, role}]
    let results = null;                               // null : pas de recherche ; [] : rien trouvé ; false : erreur
    let query = '';
    let seq = 0, timer = null;
    const input = h('input', { type: 'search', class: 'sh-input', placeholder: 'Ajouter une personne par son nom', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Nom de la personne à ajouter' });
    const roleSel = h('select', { class: 'sh-role', 'aria-label': 'Rôle accordé' }, ROLES.map(([v, l]) => h('option', { value: v, text: l })));
    const resBox = h('div', { class: 'sh-results', role: 'listbox', hidden: true });
    const listBox = h('div', { class: 'sh-list' });
    const msg = h('div', { class: 'sh-msg', role: 'status', 'aria-live': 'polite' });
    const roleDesc = h('div', { class: 'sh-hint' });
    const form = h('form', { class: 'modal share', novalidate: true },
      h('h3', { text: 'Partager « ' + docTitle() + ' »' }),
      h('div', { class: 'sh-add' }, input, roleSel),
      resBox,
      roleDesc,
      msg,
      h('div', { class: 'sh-cap', text: 'Personnes ayant accès' }),
      listBox,
      h('p', { class: 'sh-note', text: 'Chaque personne doit avoir un compte Plume et s’être connectée au moins une fois. Le document apparaît dans « Partagés avec moi » sur son accueil.' }),
      h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'primary', text: 'Terminé', onclick: () => close() })));
    const overlay = h('div', { class: 'overlay' }, form);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (P.selects && P.selects.isOpen()) return;
        e.preventDefault(); e.stopPropagation(); close();
      }
    };
    function close() {
      document.removeEventListener('keydown', onKey, true);
      clearTimeout(timer);
      overlay.remove();
    }
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    form.addEventListener('submit', (e) => { e.preventDefault(); if (results && results.length) add(results[0]); });

    const say = (t, err) => { msg.textContent = t || ''; msg.className = 'sh-msg' + (err ? ' err' : ''); };
    const describe = () => { const r = ROLES.find((x) => x[0] === roleSel.value); roleDesc.textContent = r ? r[1] + ' : ' + r[2].toLowerCase() + '.' : ''; };
    roleSel.addEventListener('change', describe);
    describe();

    function paintResults() {
      resBox.replaceChildren();
      if (results === null) { resBox.hidden = true; return; }
      resBox.hidden = false;
      if (results === false) { resBox.append(h('div', { class: 'sh-none', text: 'Recherche impossible pour l’instant. Vérifiez votre connexion.' })); return; }
      if (!results.length) { resBox.append(h('div', { class: 'sh-none', text: 'Aucune personne trouvée pour « ' + query + ' ».' })); return; }
      for (const p of results) {
        const has = rows.some((x) => x.id === p.id);
        resBox.append(h('button', { type: 'button', class: 'sh-res', role: 'option', disabled: has, onclick: () => add(p) },
          avatar(p.name, p.color), h('span', { class: 'sh-name', text: p.name }), h('span', { class: 'sh-act', text: has ? 'A déjà accès' : 'Ajouter' })));
      }
    }

    function paintList() {
      listBox.replaceChildren();
      const me = P.state.author || 'Moi';
      listBox.append(h('div', { class: 'sh-row' }, avatar(me, P.avatarHue(me)), h('div', { class: 'sh-who' }, h('span', { class: 'sh-name', text: me + ' (vous)' })), h('span', { class: 'sh-owner', text: 'Propriétaire' })));
      if (!rows.length) listBox.append(h('div', { class: 'sh-none', text: 'Ce document n’est partagé avec personne.' }));
      for (const r of rows) {
        const sel = h('select', { class: 'sh-role', 'aria-label': 'Rôle de ' + r.name },
          ROLES.map(([v, l]) => h('option', { value: v, text: l })), h('option', { value: '__remove', text: 'Retirer l’accès' }));
        sel.value = r.role;
        sel.addEventListener('change', async () => {
          const v = sel.value;
          say('');
          const res = v === '__remove' ? await Y.unshare(docId, r.id) : await Y.setRole(docId, r.id, v);
          if (res.error) { say(res.error, true); sel.value = r.role; return; }
          if (v === '__remove') rows = rows.filter((x) => x.id !== r.id); else r.role = v;
          P.collab.noteShares(docId, rows.length);
          paintList(); paintResults();
          say(v === '__remove' ? r.name + ' n’a plus accès au document.' : 'Rôle de ' + r.name + ' : ' + ROLE[v] + '.');
        });
        listBox.append(h('div', { class: 'sh-row' }, avatar(r.name, r.color), h('div', { class: 'sh-who' }, h('span', { class: 'sh-name', text: r.name })), sel));
      }
    }

    async function add(p) {
      if (rows.some((x) => x.id === p.id)) return;
      say('');
      const role = roleSel.value;
      const res = await Y.addShare(docId, p.id, role);
      if (res.error) { say(res.error, true); return; }
      rows.push({ id: p.id, name: p.name, color: p.color, role });
      P.collab.noteShares(docId, rows.length);
      input.value = ''; query = ''; results = null;
      paintList(); paintResults();
      say('« ' + docTitle() + ' » est partagé avec ' + p.name + ' (' + ROLE[role] + ').');
      input.focus();
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      query = input.value.trim();
      const my = ++seq;
      if (query.length < 2) { results = null; paintResults(); return; }
      timer = setTimeout(async () => {
        const r = await Y.search(query);
        if (my !== seq) return;
        results = r === null ? false : r;
        paintResults();
      }, 250);
    });

    document.body.append(overlay);
    paintList();
    input.focus();
    Y.listShares(docId).then((l) => {
      if (!l) { say('Impossible de lire la liste des personnes ayant accès. Vérifiez votre connexion.', true); return; }
      rows = l;
      P.collab.noteShares(docId, rows.length);
      paintList(); paintResults();
    });
  }

  /* ---------- Fenêtre pour une personne avec qui le document est partagé ---------- */
  async function guestDialog() {
    const id = P.app.collabInfo() && P.app.collabInfo().docId;
    if (!id) return;
    const meta = Y.doc(id);
    const owner = meta && Y.person(meta.user_id);
    const role = P.app.role();
    const r = await P.modal({
      title: 'Document partagé avec vous',
      message: '« ' + docTitle() + ' » appartient à ' + (owner ? owner.name : 'une autre personne') + '.\nVotre rôle : ' + (ROLE[role] || '—') + (role === 'view' ? ' (lecture seule)' : role === 'suggest' ? ' (vos modifications sont proposées au propriétaire)' : '') + '.\nSeul le propriétaire peut changer les accès.',
      buttons: [{ id: 'leave', label: 'Quitter ce document' }, { id: 'ok', label: 'Fermer', primary: true }],
    });
    if (r && r.button === 'leave') P.app.leaveShared(id);
  }

  /* ---------- Menu de rôle (carte de profil) ---------- */
  /** Section « Mon rôle dans ce document » : Édition, Suggestion, Lecture. Les rôles au-dessus de celui qu'on m'a accordé sont grisés. */
  function roleSection(close) {
    const A = P.app;
    if (!A.inDoc()) return null;
    const cap = A.modeCap();
    const rank = { view: 0, suggest: 1, edit: 2 };
    const cur = P.state.mode;
    const owned = A.role() === 'owner';
    const box = h('div', { class: 'role-box', role: 'radiogroup', 'aria-label': 'Mon rôle dans ce document' });
    for (const k of Object.keys(A.MODES)) {
      const m = A.MODES[k];
      const locked = rank[k] > rank[cap];
      box.append(h('button', { type: 'button', class: 'role-opt' + (k === cur ? ' on' : ''), role: 'radio', 'aria-checked': String(k === cur), disabled: locked,
        title: locked ? 'Votre rôle sur ce document ne le permet pas' : '', onclick: () => { A.setMode(k); close(); } },
      h('span', { class: 'ro-ic' }, P.svgIcon(m.icon)),
      h('span', { class: 'ro-txt' }, h('b', { text: m.label }), h('span', { text: locked ? 'Non autorisé par le propriétaire' : m.desc })),
      h('span', { class: 'ro-ck' }, k === cur ? P.svgIcon('i-check', 'sm') : null)));
    }
    const kids = [h('h4', { text: 'Mon rôle dans ce document' }), box];
    if (!owned) {
      const info = A.collabInfo();
      const meta = info && Y.doc(info.docId);
      const owner = meta && Y.person(meta.user_id);
      kids.push(h('p', { class: 'role-note', text: 'Partagé par ' + (owner ? owner.name : 'son propriétaire') + ' · rôle accordé : ' + (ROLE[A.role()] || '—') + '.' }));
    }
    return h('div', { class: 'pc-sec pc-role' }, kids);
  }

  P.share = { open, roleSection };
})();
