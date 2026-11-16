/* Plume — panneaux latéraux : plan du document, historique des versions, variables. */
(function () {
  'use strict';
  const { h } = P;
  const ed = P.editor;
  const state = P.state;
  P.panels = P.panels || {};

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const readOnly = () => state.mode === 'view';

  /* ---------- Plan ---------- */
  P.panels.outline = function (body) {
    body.append(h('div', { class: 'panel-bar' }, h('b', { text: 'Plan du document' })));
    const heads = Array.from(ed.querySelectorAll('h1, h2, h3')).filter((n) => n.textContent.trim());
    if (!heads.length) {
      body.append(h('p', { class: 'empty', text: 'Aucun titre pour l’instant. Utilisez « Titre 1 », « Titre 2 » ou « Titre 3 » dans le style de paragraphe : ils apparaîtront ici.' }));
      return;
    }
    for (const n of heads) {
      body.append(h('button', { type: 'button', class: 'outline-item lvl' + n.tagName[1], text: n.textContent.trim(),
        onclick: () => n.scrollIntoView({ block: 'start', behavior: 'smooth' }) }));
    }
  };

  /* ---------- Versions ---------- */
  function preview(v) {
    const body = h('div', { class: 'preview-body' });
    body.innerHTML = P.sanitize(P.unpack(v.html));
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
      h('div', { class: 'modal wide' },
        h('h3', { text: (v.name || 'Version automatique') + ' — ' + fmtDate(v.date) }),
        body,
        h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'primary', text: 'Fermer', onclick: () => overlay.remove() }))));
    document.body.append(overlay);
  }

  P.panels.versions = function (body) {
    const bar = h('div', { class: 'panel-bar' }, h('b', { text: 'Historique des versions' }));
    if (!readOnly()) {
      bar.append(h('button', { class: 'sm primary', type: 'button', text: 'Nommer la version actuelle', onclick: async () => {
        const r = await P.modal({ title: 'Enregistrer une version', message: 'Une version nommée sert de point de repère que vous pourrez restaurer plus tard.',
          fields: [{ id: 'name', label: 'Nom', value: 'Version du ' + new Date().toLocaleDateString('fr-CA') }] });
        if (!r) return;
        P.snapshot(r.values.name.trim() || 'Version nommée', false);
        P.markDirty();
        P.renderPanel();
      } }));
    }
    body.append(bar);
    if (!state.versions.length) {
      body.append(h('p', { class: 'empty', text: 'Aucune version pour l’instant. Plume en crée une à chaque enregistrement et toutes les 10 minutes si le document a changé (les 40 plus récentes sont conservées).' }));
      return;
    }
    for (const v of state.versions.slice().reverse()) {
      const card = h('div', { class: 'card ver' + (v.auto ? '' : ' named') },
        h('div', { class: 'head' }, h('span', { class: 'who', text: v.name || 'Version automatique' }), h('span', { class: 'when', text: fmtDate(v.date) })),
        h('div', { class: 'meta', text: `${v.author || '—'} · ${v.words || 0} mot${v.words > 1 ? 's' : ''}` }));
      const acts = h('div', { class: 'actions' }, h('button', { class: 'sm', type: 'button', text: 'Aperçu', onclick: () => preview(v) }));
      if (!readOnly()) {
        acts.append(h('button', { class: 'sm', type: 'button', text: 'Restaurer', onclick: async () => {
          if (!(await P.confirm('Restaurer cette version ?', 'Le contenu actuel est d’abord sauvegardé comme version « Avant restauration » : rien n’est perdu.', 'Restaurer'))) return;
          P.restoreVersion(v);
          P.renderPanel();
          P.toast('Version restaurée.');
        } }));
        acts.append(h('button', { class: 'sm', type: 'button', text: 'Renommer', onclick: async () => {
          const r = await P.modal({ title: 'Renommer la version', fields: [{ id: 'name', label: 'Nom', value: v.name }] });
          if (!r) return;
          v.name = r.values.name.trim();
          if (v.name) v.auto = false;
          P.markDirty();
          P.renderPanel();
        } }));
        acts.append(h('button', { class: 'sm danger', type: 'button', text: 'Supprimer', onclick: () => {
          state.versions = state.versions.filter((x) => x.id !== v.id);
          P.markDirty();
          P.renderPanel();
        } }));
      }
      card.append(acts);
      body.append(card);
    }
  };

  /* ---------- Variables ---------- */
  const uses = (name) => ed.querySelectorAll(`.chip-var[data-var="${CSS.escape(name)}"]`).length;

  P.panels.variables = function (body) {
    const bar = h('div', { class: 'panel-bar' }, h('b', { text: 'Variables' }));
    if (!readOnly()) {
      bar.append(h('button', { class: 'sm primary', type: 'button', text: 'Nouvelle variable', onclick: async () => {
        const r = await P.modal({ title: 'Nouvelle variable', fields: [{ id: 'name', label: 'Nom (ex. Nom du client)' }, { id: 'value', label: 'Valeur' }] });
        if (!r || !r.values.name.trim()) return;
        state.variables[r.values.name.trim()] = r.values.value.trim();
        P.markDirty();
        P.renderPanel();
      } }));
    }
    body.append(bar);
    const names = Object.keys(state.variables);
    if (!names.length) {
      body.append(h('p', { class: 'empty', text: 'Une variable est un texte réutilisable (nom d’un client, date de livraison…). Modifiez sa valeur ici : elle change partout où elle est insérée. Insérez-la avec @ → Variable.' }));
      return;
    }
    for (const name of names) {
      const input = h('input', { type: 'text', value: state.variables[name], disabled: readOnly(),
        oninput: (e) => { state.variables[name] = e.target.value; P.refreshVars(); P.markDirty(); } });
      const n = uses(name);
      const card = h('div', { class: 'card var' },
        h('div', { class: 'head' }, h('span', { class: 'who', text: name }), h('span', { class: 'when', text: n + ' utilisation' + (n > 1 ? 's' : '') })),
        input);
      if (!readOnly()) {
        card.append(h('div', { class: 'actions' },
          h('button', { class: 'sm', type: 'button', text: 'Insérer', onclick: () => P.insertHTML(P.varChipHTML(name)) }),
          h('button', { class: 'sm danger', type: 'button', text: 'Supprimer', onclick: async () => {
            if (!(await P.confirm('Supprimer la variable « ' + name + ' » ?', 'Là où elle est insérée, sa valeur actuelle est conservée comme texte ordinaire.', 'Supprimer'))) return;
            ed.querySelectorAll(`.chip-var[data-var="${CSS.escape(name)}"]`).forEach((c) => c.replaceWith(document.createTextNode(state.variables[name] || '')));
            delete state.variables[name];
            P.markDirty();
            P.renderPanel();
          } })));
      }
      body.append(card);
    }
  };
})();
