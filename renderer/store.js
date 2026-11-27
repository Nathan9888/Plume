/* Plume — format de fichier .plume (JSON), images dédupliquées, versions.
 *
 * Les images (data:) ne sont stockées qu'une fois dans « assets » ; le HTML y renvoie par « asset:ID ».
 * Ainsi les 40 versions conservées ne multiplient pas le poids des images. */
(function () {
  'use strict';
  const ed = P.editor;
  const state = P.state;
  state.assets = {};   // id -> data:image/...

  // Empreinte rapide (cyrb53) pour nommer les images
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  const DATA_IMG = /src="(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)"/g;
  const IMG_OK = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;

  P.pack = (html, assets) => html.replace(DATA_IMG, (_m, data) => {
    const id = hash(data) + data.length.toString(36);
    (assets || state.assets)[id] = data;
    return `src="asset:${id}"`;
  });

  P.unpack = (html, assets) => {
    const a = assets || state.assets;
    return html.replace(/src="asset:([a-z0-9]+)"/g, (_m, id) => (a[id] ? `src="${a[id]}"` : 'src=""'));
  };

  /** HTML de l'éditeur sans les marques purement visuelles. */
  P.cleanHTML = () => {
    const c = ed.cloneNode(true);
    c.querySelectorAll('.active').forEach((n) => n.classList.remove('active'));
    if (P.pages) P.pages.strip(c);
    return c.innerHTML;
  };

  const words = () => (ed.textContent.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

  /** Sérialise un document : celui de l'éditeur, ou (onglet inactif) {st, html} tel que mémorisé. */
  P.serializeDoc = (st, rawHtml) => {
    const holder = document.createElement('div');
    holder.innerHTML = rawHtml;
    holder.querySelectorAll('.active').forEach((n) => n.classList.remove('active'));
    if (P.pages) P.pages.strip(holder);
    st.assets = st.assets || {};
    const html = P.pack(holder.innerHTML, st.assets);
    const used = new Set();
    const scan = (s) => { for (const m of s.matchAll(/asset:([a-z0-9]+)/g)) used.add(m[1]); };
    scan(html);
    st.versions.forEach((v) => scan(v.html));
    const assets = {};
    used.forEach((id) => { if (st.assets[id]) assets[id] = st.assets[id]; });
    return {
      format: 'plume', version: 1, title: st.title, savedAt: new Date().toISOString(),
      pageless: st.pageless, html, assets, styles: P.styles ? P.styles.clean(st.styles) : {},
      variables: st.variables, comments: st.comments, versions: st.versions,
    };
  };
  P.serialize = () => P.serializeDoc(state, ed.innerHTML);

  const str = (v, max) => String(v == null ? '' : v).slice(0, max || 5000);

  P.pruneCommentAnchors = () => {
    const ids = new Set(state.comments.map((c) => c.id));
    ed.querySelectorAll('.cmt').forEach((n) => { if (!ids.has(n.dataset.cid)) P.unwrap(n); });
  };

  /** Titre, images, styles, champs, commentaires et versions d'un document décodé (tout sauf le texte). `keepAssets` : on ajoute aux images déjà là. */
  P.applyMeta = (data, keepAssets) => {
    if (!keepAssets) state.assets = {};
    else state.assets = state.assets || {};
    if (data.assets && typeof data.assets === 'object') {
      for (const [k, v] of Object.entries(data.assets)) if (/^[a-z0-9]+$/.test(k) && typeof v === 'string' && IMG_OK.test(v)) state.assets[k] = v;
    }
    state.title = str(data.title || 'Sans titre', 200) || 'Sans titre';
    state.pageless = !!data.pageless;
    state.styles = P.styles ? P.styles.clean(data.styles) : {};
    if (P.styles) P.styles.render();
    state.variables = {};
    if (data.variables && typeof data.variables === 'object') for (const [k, v] of Object.entries(data.variables)) state.variables[str(k, 100)] = str(v, 500);
    state.comments = (Array.isArray(data.comments) ? data.comments : [])
      .filter((c) => c && typeof c.id === 'string' && /^[A-Za-z0-9_-]+$/.test(c.id))
      .map((c) => ({
        id: c.id, text: str(c.text), author: str(c.author, 100), date: str(c.date, 40), resolved: !!c.resolved, assignee: str(c.assignee, 100),
        replies: (Array.isArray(c.replies) ? c.replies : []).map((r) => ({ author: str(r && r.author, 100), text: str(r && r.text), date: str(r && r.date, 40) })),
      }));
    state.versions = (Array.isArray(data.versions) ? data.versions : [])
      .filter((v) => v && typeof v.html === 'string' && typeof v.id === 'string')
      .map((v) => ({
        id: str(v.id, 40), name: str(v.name, 200), date: str(v.date, 40), author: str(v.author, 100), auto: !!v.auto, html: v.html,
        words: Number(v.words) || 0,
        variables: v.variables && typeof v.variables === 'object' ? Object.fromEntries(Object.entries(v.variables).map(([k, x]) => [str(k, 100), str(x, 500)])) : {},
      }))
      .slice(-60);
  };

  /** Charge un document .plume déjà décodé (lève une erreur si le format est invalide). */
  P.loadData = (data) => {
    if (!data || data.format !== 'plume' || typeof data.html !== 'string') throw new Error('Ce fichier n’est pas un document Plume valide.');
    P.applyMeta(data, false);
    ed.innerHTML = P.sanitize(P.unpack(data.html, state.assets)) || '<p><br></p>';
    P.pruneCommentAnchors();
    if (P.fixChecklists) P.fixChecklists();
    P.refreshVars();
    P.updateCounts();
  };

  /** Crée une version. auto=true : ignorée si rien n'a changé depuis la dernière. */
  P.snapshot = (name, auto) => {
    const html = P.pack(P.cleanHTML());
    const last = state.versions[state.versions.length - 1];
    if (auto && last && last.html === html && JSON.stringify(last.variables) === JSON.stringify(state.variables)) return null;
    const v = {
      id: P.uid(), name: name || '', date: new Date().toISOString(), author: state.author || 'Moi',
      auto: !!auto, html, variables: Object.assign({}, state.variables), words: words(),
    };
    state.versions.push(v);
    while (state.versions.length > 40) {
      const i = state.versions.findIndex((x) => x.auto);
      state.versions.splice(i >= 0 ? i : 0, 1);
    }
    return v;
  };

  P.restoreVersion = (v) => {
    P.snapshot('Avant restauration', true);
    ed.innerHTML = P.sanitize(P.unpack(v.html, state.assets)) || '<p><br></p>';
    state.variables = Object.assign({}, v.variables || {});
    P.pruneCommentAnchors();
    if (P.fixChecklists) P.fixChecklists();
    P.refreshVars();
    P.markDirty();
    P.updateCounts();
  };
})();
