const { contextBridge, ipcRenderer, webFrame } = require('electron');

const call = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('native', {
  init: () => call('app:init'),
  open: () => call('doc:open'),
  save: (opts) => call('doc:save', opts),
  decrypt: (b64, password) => call('doc:decrypt', { b64, password }),
  exportDocx: (bytes, name) => call('export:docx', { bytes, name }),
  exportPdf: (name) => call('export:pdf', { name }),
  exportHtml: (html, name) => call('export:html', { html, name }),
  exportMd: (md, images, name) => call('export:md', { md, images, name }),
  print: () => call('print'),
  pickFile: () => call('dialog:pickFile'),
  pickImage: () => call('dialog:pickImage'),
  openExternal: (kind, value) => call('shell:open', { kind, value }),
  setTheme: (t) => call('win:theme', t),
  setUiZoom: (f) => call('win:uiZoom', f),
  toggleFullscreen: () => call('win:fullscreen'),
  setSpellLangs: (mode) => call('spell:langs', mode),
  editCmd: (cmd) => call('edit:cmd', cmd),
  // Orthographe : le menu contextuel du document est dessiné par Plume, qui interroge le correcteur de Chromium
  spell: {
    check: (word) => {
      try {
        const w = String(word || '');
        const bad = !!webFrame.isWordMisspelled(w);
        return { bad, suggestions: bad ? webFrame.getWordSuggestions(w).slice(0, 5) : [] };
      } catch (_) { return { bad: false, suggestions: [] }; }
    },
    add: (word) => call('spell:add', String(word || '')),
  },
  // IA : la clé reste dans le processus principal ; l'interface n'en reçoit jamais le contenu.
  ai: {
    status: () => call('ai:status'),
    setKey: (key) => call('ai:setKey', String(key || '')),
    clearKey: () => call('ai:clearKey'),
    cancel: (id) => call('ai:cancel', String(id || '')),
    complete: async (opts, onChunk) => {
      const id = String((opts && opts.id) || Math.random().toString(36).slice(2));
      const on = (_e, m) => { if (m && m.id === id && typeof onChunk === 'function') onChunk(String(m.text || '')); };
      ipcRenderer.on('ai:chunk', on);
      try { return await call('ai:complete', Object.assign({}, opts, { id })); } finally { ipcRenderer.removeListener('ai:chunk', on); }
    },
  },
  recents: {
    list: () => call('recents:list'),
    add: (entry) => call('recents:add', entry),
    remove: (p) => call('recents:remove', p),
    clear: () => call('recents:clear'),
    open: (p) => call('recents:open', p),
  },
  recovery: {
    write: (text) => call('recovery:write', text),
    read: () => call('recovery:read'),
    clear: () => call('recovery:clear'),
  },
  // Ces fonctions ne retournent rien : ipcRenderer.on() renverrait l'objet ipcRenderer lui-même,
  // qu'il ne faut jamais exposer à la page.
  onMenu: (cb) => { ipcRenderer.on('menu', (_e, id) => { cb(id); }); },
  onExternalOpen: (cb) => { ipcRenderer.on('doc:external', (_e, doc) => { cb(doc); }); },
});
