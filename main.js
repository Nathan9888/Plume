const { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage, net } = require('electron');
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
  return remember(args.find((a) => /\.(plume|html?|txt)$/i.test(a) && fs.existsSync(a)) || null);
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

// ---------- Fichiers connus (le moteur d'interface ne peut ouvrir que ceux-ci) ----------
const known = new Set();
const remember = (p) => { if (typeof p === 'string' && p) known.add(path.resolve(p)); return p; };
const isKnown = (p) => typeof p === 'string' && known.has(path.resolve(p));

// ---------- Documents récents ----------
const userFile = (name) => path.join(app.getPath('userData'), name);
const HEX = /^#[0-9a-f]{6}$/i;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function loadRecents() {
  const list = readJson(userFile('recents.json'), []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && typeof r.path === 'string' && /\.plume$/i.test(r.path))
    .map((r) => ({
      path: r.path,
      title: String(r.title || path.basename(r.path, '.plume')).slice(0, 200),
      openedAt: Number(r.openedAt) || 0,
      preview: String(r.preview || '').slice(0, 700),
      encrypted: !!r.encrypted,
    }))
    .slice(0, 30);
}

function saveRecents(list) {
  try { writeAtomic(userFile('recents.json'), JSON.stringify(list.slice(0, 30))); } catch (_) { /* disque en lecture seule : sans gravité */ }
}

// ---------- État de la fenêtre (couleurs de la barre de titre) ----------
const FRAME_H = 40;
const defaultTheme = { color: '#ececef', symbol: '#1d1d1f', bg: '#f5f5f7' };
function loadTheme() {
  const t = readJson(userFile('window.json'), {});
  return {
    color: HEX.test(t.color) ? t.color : defaultTheme.color,
    symbol: HEX.test(t.symbol) ? t.symbol : defaultTheme.symbol,
    bg: HEX.test(t.bg) ? t.bg : defaultTheme.bg,
  };
}

// ---------- Fenêtre ----------
function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const theme = loadTheme();
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: theme.bg,
    title: 'Plume',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    // Les boutons Réduire / Agrandir / Fermer sont dessinés par Windows dans la barre d'onglets de l'application.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: theme.color, symbolColor: theme.symbol, height: FRAME_H },
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

// ---------- IPC ----------
const guard = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { return { error: String(err && err.message ? err.message : err) }; }
};

ipcMain.handle('app:init', guard(() => {
  const f = pendingOpen;
  pendingOpen = null;
  return { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, file: f ? readDocFile(f) : null };
}));

ipcMain.handle('doc:open', guard(async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Documents (Plume, HTML, texte)', extensions: ['plume', 'html', 'htm', 'txt'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDocFile(remember(r.filePaths[0]));
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
  remember(target);
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
  const data = await getData(r.filePath);
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

// Markdown : le texte et, s'il y a des images, un dossier « nom_images » à côté du fichier
ipcMain.handle('export:md', guard((_e, { md, images, name }) => {
  const imgs = Array.isArray(images) ? images : [];
  if (typeof md !== 'string' || md.length > 60 * 1024 * 1024) return { error: 'Le document est trop volumineux.' };
  if (imgs.length > 300 || imgs.some((i) => !i || !/^image-\d{1,4}\.(png|jpg|gif|webp)$/.test(i.name) || typeof i.b64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(i.b64))) return { error: 'Images invalides.' };
  return saveDialogAndWrite(name, 'md', 'Markdown', (filePath) => {
    let text = md;
    if (imgs.length) {
      const dirName = path.basename(filePath, path.extname(filePath)) + '_images';
      const dir = path.join(path.dirname(filePath), dirName);
      fs.mkdirSync(dir, { recursive: true });
      for (const i of imgs) fs.writeFileSync(path.join(dir, i.name), Buffer.from(i.b64, 'base64'));
      text = text.split('{{IMAGES}}').join(encodeURIComponent(dirName));
    }
    return Buffer.from(text, 'utf8');
  });
}));

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

// ---------- Fenêtre, correcteur, presse-papiers ----------
ipcMain.handle('win:theme', guard((_e, t) => {
  if (!t || !HEX.test(t.color) || !HEX.test(t.symbol) || !HEX.test(t.bg)) return false;
  if (win) {
    try { win.setTitleBarOverlay({ color: t.color, symbolColor: t.symbol, height: FRAME_H }); } catch (_) { /* plateforme sans superposition */ }
    win.setBackgroundColor(t.bg);
  }
  try { writeAtomic(userFile('window.json'), JSON.stringify({ color: t.color, symbol: t.symbol, bg: t.bg })); } catch (_) { /* ignoré */ }
  return true;
}));

ipcMain.handle('win:uiZoom', guard((_e, f) => {
  const n = Number(f);
  if (!win || !isFinite(n)) return false;
  win.webContents.setZoomFactor(Math.min(1.6, Math.max(0.8, n)));
  return true;
}));

ipcMain.handle('win:fullscreen', guard(() => {
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
}));

ipcMain.handle('spell:langs', guard((_e, mode) => {
  const langs = mode === 'fr' ? ['fr'] : mode === 'en' ? ['en-US'] : ['fr', 'en-US'];
  try { win.webContents.session.setSpellCheckerLanguages(langs); } catch (_) { return false; }
  return true;
}));

ipcMain.handle('spell:add', guard((_e, word) => {
  if (!win || typeof word !== 'string' || !word.trim() || word.length > 80) return false;
  return win.webContents.session.addWordToSpellCheckerDictionary(word.trim());
}));

ipcMain.handle('edit:cmd', guard((_e, cmd) => {
  if (!win || !['cut', 'copy', 'paste', 'selectAll'].includes(cmd)) return false;
  win.webContents[cmd]();
  return true;
}));

// ---------- Intelligence artificielle (API Claude ou API Google Gemini, avec la clé personnelle de l'utilisateur) ----------
// Les clés sont chiffrées par le coffre de Windows (safeStorage) et ne reviennent jamais à l'interface. Les requêtes partent d'ici :
// la page n'a pas le droit de se connecter à Internet (CSP). Seuls le texte et la consigne envoyés par l'interface sont transmis,
// au fournisseur choisi : ni le nom de l'utilisateur, ni aucune autre donnée.
const AI_MODELS = {
  claude: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  gemini: ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-pro'],
};
const AI_KEY_RE = { claude: /^sk-ant-[A-Za-z0-9_-]{20,}$/, gemini: /^[A-Za-z0-9_.-]{20,256}$/ };
const AI_FIELD = { claude: 'key', gemini: 'gemini' };           // champ de ai.json (« key » : Claude, comme avant la 1.5)
const AI_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_URL = (model) => 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':streamGenerateContent?alt=sse';
const aiProv = (p) => (p === 'gemini' ? 'gemini' : 'claude');
const aiFile = () => path.join(app.getPath('userData'), 'ai.json');
const aiRuns = new Map();

function aiStore() {
  try { const o = JSON.parse(fs.readFileSync(aiFile(), 'utf8')); return o && typeof o === 'object' ? o : {}; } catch (_) { return {}; }
}
function aiKey(provider) {
  try {
    const v = aiStore()[AI_FIELD[aiProv(provider)]];
    return v ? safeStorage.decryptString(Buffer.from(v, 'base64')) : null;
  } catch (_) { return null; }
}

function aiErrorText(status, body) {
  let msg = '';
  try { const j = JSON.parse(body); msg = j && j.error && j.error.message ? j.error.message : ''; } catch (_) { /* pas du JSON */ }
  if (status === 401) return 'La clé API a été refusée (401). Vérifiez-la dans Paramètres → Intelligence artificielle.';
  if (status === 403) return 'Accès refusé par le service (403). ' + msg;
  if (status === 429) return 'Trop de requêtes ou limite atteinte (429). Réessayez dans un instant.';
  if (status === 529 || status === 503) return 'Le service est momentanément surchargé. Réessayez dans un instant.';
  if (/credit balance/i.test(msg)) return 'Le solde de crédits de votre compte API est insuffisant.';
  return 'Erreur du service (' + status + ')' + (msg ? ' : ' + msg : '.');
}

function geminiErrorText(status, body) {
  let msg = '', st = '';
  try {
    const j = JSON.parse(body);
    const e = (j && j.error) || (Array.isArray(j) && j[0] && j[0].error) || {};
    msg = e.message || ''; st = e.status || '';
  } catch (_) { /* pas du JSON */ }
  const all = msg + ' ' + st;
  if (/API key not valid|API_KEY_INVALID|API key expired|API key.*(not found|invalid)/i.test(all) || status === 401) return 'La clé Google a été refusée. Vérifiez-la dans Paramètres → Intelligence artificielle (elle se crée dans Google AI Studio).';
  if (/location is not supported|not available in your country/i.test(all)) return 'Le service Gemini n’est pas offert depuis votre région (' + (msg || status) + ').';
  if (status === 403 || st === 'PERMISSION_DENIED') return 'Accès refusé par Google (403). ' + msg;
  if (status === 404 || st === 'NOT_FOUND') return 'Ce modèle n’est pas (ou plus) disponible chez Google. Choisissez-en un autre dans Paramètres → Intelligence artificielle.';
  if (status === 429 || st === 'RESOURCE_EXHAUSTED') return 'Limite gratuite de Google atteinte (429) : trop de demandes ou quota du jour épuisé. Patientez un moment ou choisissez un autre modèle.';
  if (status === 500 || status === 503 || st === 'UNAVAILABLE' || st === 'INTERNAL') return 'Le service de Google est momentanément surchargé. Réessayez dans un instant.';
  return 'Erreur du service Google (' + status + ')' + (msg ? ' : ' + msg : '.');
}

// Réflexion de Gemini : coupée (ou minimale) pour les modèles qui l'acceptent, afin de répondre vite et de ne pas gaspiller de quota.
// Si un modèle refuse ce réglage (erreur 400 qui parle de « thinking »), la requête est refaite sans lui.
const geminiThinking = (model) => (/^gemini-2\.5-flash(-lite)?$/.test(model) ? { thinkingBudget: 0 } : /^gemini-3/.test(model) ? { thinkingLevel: 'minimal' } : null);

function geminiBody(system, messages, maxTokens, think) {
  const contents = [];
  for (const m of messages) {                                      // Gemini veut des tours qui alternent : on fusionne les messages de même rôle
    const role = m.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n\n' + m.content;
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  const body = { contents, generationConfig: { maxOutputTokens: Math.min(65536, maxTokens + (think ? 4096 : 16384)) } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (think) body.generationConfig.thinkingConfig = think;
  return body;
}

/** Lit un flux « server-sent events » ; onData reçoit chaque objet JSON et peut renvoyer une valeur pour tout arrêter. */
async function aiReadSse(res, onData) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const feed = (line) => {
    line = line.trim();
    if (!line.startsWith('data:')) return null;
    let ev;
    try { ev = JSON.parse(line.slice(5)); } catch (_) { return null; }
    return onData(ev);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const r = feed(line);
      if (r) return r;
    }
  }
  return buf ? feed(buf) : null;
}

ipcMain.handle('ai:status', guard((_e, p) => ({ hasKey: !!aiKey(p), secure: safeStorage.isEncryptionAvailable(), where: 'app' })));

ipcMain.handle('ai:setKey', guard((_e, a) => {
  const obj = a && typeof a === 'object';
  const provider = aiProv(obj ? a.provider : 'claude');
  const key = String(obj ? a.key : a || '').trim();
  if (!AI_KEY_RE[provider].test(key)) {
    return { error: provider === 'gemini'
      ? 'Cette clé ne ressemble pas à une clé API Google (elle se crée dans Google AI Studio et commence en général par « AIza »).'
      : 'Cette clé ne ressemble pas à une clé API Claude (elle commence par « sk-ant- »).' };
  }
  if (!safeStorage.isEncryptionAvailable()) return { error: 'Le coffre sécurisé de Windows n’est pas disponible : la clé ne peut pas être enregistrée de façon sûre.' };
  const o = aiStore();
  o[AI_FIELD[provider]] = safeStorage.encryptString(key).toString('base64');
  writeAtomic(aiFile(), JSON.stringify({ key: o.key, gemini: o.gemini }));
  return { ok: true };
}));

ipcMain.handle('ai:clearKey', guard((_e, p) => {
  const o = aiStore();
  delete o[AI_FIELD[aiProv(p)]];
  if (!o.key && !o.gemini) { try { fs.unlinkSync(aiFile()); } catch (_) { /* absente */ } }
  else writeAtomic(aiFile(), JSON.stringify({ key: o.key, gemini: o.gemini }));
  return { ok: true };
}));

ipcMain.handle('ai:cancel', guard((_e, id) => { const c = aiRuns.get(String(id)); if (c) c.abort(); return true; }));

ipcMain.handle('ai:complete', guard(async (e, o) => {
  if (!win || e.sender !== win.webContents) return { error: 'Appel refusé.' };
  const provider = aiProv(o && o.provider);
  const key = aiKey(provider);
  if (!key) return { error: (provider === 'gemini' ? 'Aucune clé Google enregistrée.' : 'Aucune clé API enregistrée.') + ' Ajoutez-la dans Paramètres → Intelligence artificielle.' };
  const id = String(o && o.id || '');
  const model = AI_MODELS[provider].includes(o && o.model) ? o.model : AI_MODELS[provider][0];
  const messages = (Array.isArray(o && o.messages) ? o.messages : []).slice(-24)
    .map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String(m && m.content || '').slice(0, 240000) })).filter((m) => m.content);
  while (messages.length && messages[0].role === 'assistant') messages.shift();    // la conversation doit commencer par l'utilisateur
  if (!messages.length) return { error: 'Requête vide.' };
  const system = String(o.system || '').slice(0, 60000);
  const maxTokens = Math.max(16, Math.min(8192, o.maxTokens | 0 || 4096));
  const ctl = new AbortController();
  aiRuns.set(id, ctl);
  const timer = setTimeout(() => ctl.abort(), 180000);
  let full = '';
  const send = (text) => { full += text; if (!e.sender.isDestroyed()) e.sender.send('ai:chunk', { id, text }); };
  try {
    if (provider === 'gemini') {
      const post = (think) => net.fetch(GEMINI_URL(model), {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(geminiBody(system, messages, maxTokens, think)),
      });
      const think = geminiThinking(model);
      let res = await post(think);
      if (!res.ok) {
        const t = await res.text();
        if (res.status === 400 && think && /think/i.test(t)) { res = await post(null); }   // ce modèle refuse le réglage de réflexion
        else return { error: geminiErrorText(res.status, t) };
        if (!res.ok) return { error: geminiErrorText(res.status, await res.text()) };
      }
      let blocked = '', finish = '';
      const err = await aiReadSse(res, (ev) => {
        if (ev.error) return { error: geminiErrorText(ev.error.code | 0 || 500, JSON.stringify(ev)) };
        if (ev.promptFeedback && ev.promptFeedback.blockReason) blocked = ev.promptFeedback.blockReason;
        const c = ev.candidates && ev.candidates[0];
        if (!c) return null;
        for (const part of (c.content && c.content.parts) || []) if (part && typeof part.text === 'string' && part.text && !part.thought) send(part.text);
        if (c.finishReason && c.finishReason !== 'STOP' && c.finishReason !== 'MAX_TOKENS') finish = c.finishReason;
        return null;
      });
      if (err) return err;
      if (!full) {
        return { error: blocked ? 'Google a refusé de traiter ce texte (' + blocked + ').'
          : finish ? 'Google n’a pas pu produire de réponse (' + finish + ').' : 'Google n’a renvoyé aucune réponse. Réessayez.' };
      }
      return { ok: true, text: full };
    }
    const res = await net.fetch(AI_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true }),
    });
    if (!res.ok) return { error: aiErrorText(res.status, await res.text()) };
    const err = await aiReadSse(res, (ev) => {
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta' && ev.delta.text) send(ev.delta.text);
      else if (ev.type === 'error') return { error: aiErrorText(ev.error && ev.error.type === 'overloaded_error' ? 529 : 500, JSON.stringify(ev)) };
      return null;
    });
    if (err) return err;
    return { ok: true, text: full };
  } catch (err) {
    if (ctl.signal.aborted) return { cancelled: true, text: full };
    return { error: 'Impossible de joindre le service (' + (err && err.message ? err.message : err) + '). Vérifiez votre connexion Internet.' };
  } finally {
    clearTimeout(timer);
    aiRuns.delete(id);
  }
}));

ipcMain.handle('recents:list', guard(() => {
  const list = loadRecents();
  list.forEach((r) => remember(r.path));
  return list.map((r) => Object.assign({}, r, { missing: !fs.existsSync(r.path) }));
}));

ipcMain.handle('recents:add', guard((_e, r) => {
  if (!r || !isKnown(r.path) || !/\.plume$/i.test(r.path)) return false;
  const entry = {
    path: r.path,
    title: String(r.title || path.basename(r.path, '.plume')).slice(0, 200),
    openedAt: Date.now(),
    // Aucun aperçu pour un document chiffré : son contenu ne doit pas se retrouver en clair dans la liste.
    preview: r.encrypted ? '' : String(r.preview || '').slice(0, 700),
    encrypted: !!r.encrypted,
  };
  const list = loadRecents().filter((x) => path.resolve(x.path) !== path.resolve(entry.path));
  list.unshift(entry);
  saveRecents(list);
  return true;
}));

ipcMain.handle('recents:remove', guard((_e, p) => {
  if (typeof p !== 'string') return false;
  saveRecents(loadRecents().filter((x) => path.resolve(x.path) !== path.resolve(p)));
  return true;
}));

ipcMain.handle('recents:clear', guard(() => { saveRecents([]); return true; }));

ipcMain.handle('recents:open', guard((_e, p) => {
  if (!loadRecents().some((x) => typeof p === 'string' && path.resolve(x.path) === path.resolve(p))) return { error: 'Ce document n’est plus dans la liste.' };
  if (!fs.existsSync(p)) return { error: 'Ce fichier est introuvable : il a peut-être été déplacé ou supprimé.', missing: true };
  return readDocFile(remember(p));
}));

const recoveryFile = () => path.join(app.getPath('userData'), 'recovery.plume.json');
ipcMain.handle('recovery:write', guard((_e, text) => { fs.writeFileSync(recoveryFile(), String(text), 'utf8'); return true; }));
ipcMain.handle('recovery:read', guard(() => (fs.existsSync(recoveryFile()) ? fs.readFileSync(recoveryFile(), 'utf8') : null)));
ipcMain.handle('recovery:clear', guard(() => { if (fs.existsSync(recoveryFile())) fs.unlinkSync(recoveryFile()); return true; }));

// ---------- Démarrage ----------
if (gotLock) {
  pendingOpen = fileFromArgv(process.argv);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);   // les menus sont dans l'interface (barre de menus HTML)
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
