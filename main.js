const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MAGIC = Buffer.from('PLUMEENC1');
let win = null;
let pendingOpen = null;
let forceClose = false;

// ---------- Instance unique + ouverture par double-clic ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      const f = fileFromArgv(argv);
      if (f) {
        try { win.webContents.send('doc:external', readDocFile(f)); } catch (_) { /* ignoré */ }
      }
    }
  });
}

function fileFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.find((a) => /\.(plume|html?|txt)$/i.test(a) && fs.existsSync(a)) || null;
}

// ---------- Fichiers ----------
function readDocFile(p) {
  const buf = fs.readFileSync(p);
  if (buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    return { path: p, kind: 'plume', encrypted: true, b64: buf.toString('base64') };
  }
  const ext = path.extname(p).toLowerCase();
  const kind = ext === '.plume' ? 'plume' : ext === '.txt' ? 'text' : 'html';
  return { path: p, kind, encrypted: false, text: buf.toString('utf8') };
}

function writeAtomic(target, data) {
  const tmp = target + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

// ---------- Chiffrement (AES-256-GCM, clé dérivée par scrypt) ----------
function encrypt(text, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}

function decrypt(buf, password) {
  let o = MAGIC.length;
  const salt = buf.subarray(o, (o += 16));
  const iv = buf.subarray(o, (o += 12));
  const tag = buf.subarray(o, (o += 16));
  const key = crypto.scryptSync(password, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(o)), d.final()]).toString('utf8');
}

// ---------- Fenêtre ----------
function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f1f3f4',
    title: 'Plume',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  try { win.webContents.session.setSpellCheckerLanguages(['fr', 'en-US']); } catch (_) { /* langue indisponible */ }

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Menu contextuel : orthographe + presse-papiers
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: 'Aucune suggestion', enabled: false });
      items.push({ label: 'Ajouter au dictionnaire', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' });
    } else if (params.selectionText) {
      items.push({ role: 'copy', label: 'Copier' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Confirmation avant de quitter si modifications non enregistrées
  win.on('close', async (e) => {
    if (forceClose) return;
    e.preventDefault();
    let dirty = false;
    try { dirty = await win.webContents.executeJavaScript('window.plume.isDirty()'); } catch (_) { /* page absente */ }
    if (!dirty) { forceClose = true; win.close(); return; }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Enregistrer', 'Ne pas enregistrer', 'Annuler'],
      defaultId: 0,
      cancelId: 2,
      title: 'Plume',
      message: 'Enregistrer les modifications avant de quitter?',
    });
    if (response === 2) return;
    if (response === 1) {
      // L'utilisateur renonce volontairement : on ne lui proposera pas de « récupérer » ce brouillon.
      try { await win.webContents.executeJavaScript('window.plume.discardRecovery()'); } catch (_) { /* ignoré */ }
    }
    if (response === 0) {
      let ok = false;
      try { ok = await win.webContents.executeJavaScript('window.plume.save()'); } catch (_) { /* échec */ }
      if (!ok) return;
    }
    forceClose = true;
    win.close();
  });

  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const send = (id) => () => win && win.webContents.send('menu', id);
  const template = [
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouveau', accelerator: 'CmdOrCtrl+N', click: send('new') },
        { label: 'Ouvrir…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { type: 'separator' },
        { label: 'Enregistrer', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Enregistrer sous…', accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        { label: 'Exporter en Word (.docx)…', click: send('exportDocx') },
        { label: 'Exporter en PDF…', click: send('exportPdf') },
        { label: 'Exporter en HTML…', click: send('exportHtml') },
        { label: 'Imprimer…', accelerator: 'CmdOrCtrl+P', click: send('print') },
        { type: 'separator' },
        { label: 'Protéger par mot de passe…', click: send('password') },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
        { type: 'separator' },
        { label: 'Rechercher / remplacer…', accelerator: 'CmdOrCtrl+F', click: send('find') },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Mode sans pages', click: send('pageless') },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Zoom avant' },
        { role: 'zoomOut', label: 'Zoom arrière' },
        { role: 'resetZoom', label: 'Zoom normal' },
        { role: 'togglefullscreen', label: 'Plein écran' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        { label: 'À propos de Plume', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Plume', message: 'Plume ' + app.getVersion(), detail: 'Éditeur de documents local. Les documents restent sur votre ordinateur.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC ----------
const guard = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { return { error: String(err && err.message ? err.message : err) }; }
};

ipcMain.handle('app:init', guard(() => {
  const f = pendingOpen;
  pendingOpen = null;
  return { version: app.getVersion(), file: f ? readDocFile(f) : null };
}));

ipcMain.handle('doc:open', guard(async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Documents (Plume, HTML, texte)', extensions: ['plume', 'html', 'htm', 'txt'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDocFile(r.filePaths[0]);
}));

ipcMain.handle('doc:save', guard(async (_e, { path: p, content, password, saveAs, name }) => {
  let target = p;
  if (!target || saveAs) {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: (name || 'Sans titre').replace(/[\\/:*?"<>|]/g, '_') + '.plume',
      filters: [{ name: 'Document Plume', extensions: ['plume'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  const data = password ? encrypt(content, password) : Buffer.from(content, 'utf8');
  writeAtomic(target, data);
  return { path: target };
}));

ipcMain.handle('doc:decrypt', guard((_e, { b64, password }) => {
  try {
    return { text: decrypt(Buffer.from(b64, 'base64'), password) };
  } catch (_) {
    return { error: 'Mot de passe incorrect ou fichier endommagé.' };
  }
}));

async function saveDialogAndWrite(defaultName, ext, label, getData) {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: (defaultName || 'Sans titre').replace(/[\\/:*?"<>|]/g, '_') + '.' + ext,
    filters: [{ name: label, extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return null;
  const data = await getData();
  fs.writeFileSync(r.filePath, data);
  return { path: r.filePath };
}

ipcMain.handle('export:docx', guard((_e, { bytes, name }) =>
  saveDialogAndWrite(name, 'docx', 'Document Word', () => Buffer.from(bytes))));

ipcMain.handle('export:pdf', guard((_e, { name }) =>
  saveDialogAndWrite(name, 'pdf', 'Document PDF', () =>
    win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }))));

ipcMain.handle('export:html', guard((_e, { html, name }) =>
  saveDialogAndWrite(name, 'html', 'Page HTML', () => Buffer.from(html, 'utf8'))));

ipcMain.handle('print', guard(() => new Promise((resolve) => {
  win.webContents.print({ printBackground: true }, (ok) => resolve({ ok }));
})));

ipcMain.handle('dialog:pickFile', guard(async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], name: path.basename(r.filePaths[0]) };
}));

ipcMain.handle('dialog:pickImage', guard(async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  if (fs.statSync(p).size > 8 * 1024 * 1024) return { error: 'Image trop volumineuse (maximum 8 Mo).' };
  const ext = path.extname(p).toLowerCase().slice(1);
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;
  return { dataUrl: `data:${mime};base64,${fs.readFileSync(p).toString('base64')}` };
}));

// Un document reçu d'ailleurs ne doit jamais pouvoir lancer un programme :
// seuls http(s), mailto et « afficher dans le dossier » sont permis.
ipcMain.handle('shell:open', guard(async (_e, { kind, value }) => {
  if (typeof value !== 'string' || value.length > 4096) return false;
  if (kind === 'url' && /^https?:\/\//i.test(value)) { await shell.openExternal(value); return true; }
  if (kind === 'mail' && /^mailto:/i.test(value)) { await shell.openExternal(value); return true; }
  if (kind === 'reveal' && fs.existsSync(value)) { shell.showItemInFolder(value); return true; }
  return false;
}));

const recoveryFile = () => path.join(app.getPath('userData'), 'recovery.plume.json');
ipcMain.handle('recovery:write', guard((_e, text) => { fs.writeFileSync(recoveryFile(), String(text), 'utf8'); return true; }));
ipcMain.handle('recovery:read', guard(() => (fs.existsSync(recoveryFile()) ? fs.readFileSync(recoveryFile(), 'utf8') : null)));
ipcMain.handle('recovery:clear', guard(() => { if (fs.existsSync(recoveryFile())) fs.unlinkSync(recoveryFile()); return true; }));

// ---------- Démarrage ----------
if (gotLock) {
  pendingOpen = fileFromArgv(process.argv);
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
