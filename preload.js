const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('native', {
  init: () => call('app:init'),
  open: () => call('doc:open'),
  save: (opts) => call('doc:save', opts),
  decrypt: (b64, password) => call('doc:decrypt', { b64, password }),
  exportDocx: (bytes, name) => call('export:docx', { bytes, name }),
  exportPdf: (name) => call('export:pdf', { name }),
  exportHtml: (html, name) => call('export:html', { html, name }),
  print: () => call('print'),
  pickFile: () => call('dialog:pickFile'),
  pickImage: () => call('dialog:pickImage'),
  openExternal: (kind, value) => call('shell:open', { kind, value }),
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
