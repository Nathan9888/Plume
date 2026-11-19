/* Plume — version navigateur : remplace le pont Electron (preload.js) par des équivalents web.
   Fichiers : API « File System Access » quand elle existe (Chrome, Edge), sinon sélecteur de fichier + téléchargement.
   Chiffrement : même format que la version Windows (PLUMEENC1 + sel + IV + étiquette + texte, scrypt N=16384 r=8 p=1, AES-256-GCM),
   donc un fichier chiffré s'ouvre indifféremment dans les deux versions. */
(function () {
  'use strict';

  const VERSION = '__VERSION__';
  const MAGIC = new TextEncoder().encode('PLUMEENC1');
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');
  const FSA = typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
  const toast = (m, ms) => { try { window.P.toast(m, ms); } catch (_) { /* interface pas encore prête */ } };

  // ---------- Petits outils ----------
  const b64encode = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const b64decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const startsWithMagic = (u8) => u8.length >= MAGIC.length && MAGIC.every((b, i) => u8[i] === b);
  const safeName = (n, ext) => (String(n || 'Sans titre').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Sans titre') + '.' + ext;
  const extOf = (n) => (/\.([^.]+)$/.exec(String(n || '')) || [, ''])[1].toLowerCase();

  function download(data, filename, mime) {
    const url = URL.createObjectURL(new Blob([data], { type: mime || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function pickWithInput(accept) {
    return new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = accept || ''; i.style.display = 'none';
      i.addEventListener('change', () => { resolve(i.files && i.files[0] ? i.files[0] : null); i.remove(); });
      i.addEventListener('cancel', () => { resolve(null); i.remove(); });
      document.body.appendChild(i);
      i.click();
    });
  }

  // ---------- Stockage local (IndexedDB, avec repli en mémoire) ----------
  const mem = { kv: new Map(), handles: new Map() };
  const dbp = new Promise((resolve) => {
    try {
      const r = indexedDB.open('plume-web', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('handles'); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = r.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
  async function idb(store, mode, fn) {
    const db = await dbp;
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const t = db.transaction(store, mode);
        const rq = fn(t.objectStore(store));
        t.oncomplete = () => resolve(rq && rq.result);
        t.onerror = t.onabort = () => resolve(undefined);
      } catch (_) { resolve(undefined); }
    });
  }
  const kv = {
    async get(store, key) { const v = await idb(store, 'readonly', (s) => s.get(key)); return v !== undefined ? v : mem[store].get(key); },
    async set(store, key, value) { mem[store].set(key, value); await idb(store, 'readwrite', (s) => s.put(value, key)); },
    async del(store, key) { mem[store].delete(key); await idb(store, 'readwrite', (s) => s.delete(key)); },
    async clear(store) { mem[store].clear(); await idb(store, 'readwrite', (s) => s.clear()); },
  };

  // ---------- scrypt (RFC 7914) en JavaScript : WebCrypto n'en fournit pas ----------
  const rotl = (a, b) => (a << b) | (a >>> (32 - b));
  const SX = new Uint32Array(16);
  function salsa20_8(B) {
    const x = SX;
    x.set(B);
    for (let i = 0; i < 8; i += 2) {
      x[4] ^= rotl(x[0] + x[12], 7); x[8] ^= rotl(x[4] + x[0], 9); x[12] ^= rotl(x[8] + x[4], 13); x[0] ^= rotl(x[12] + x[8], 18);
      x[9] ^= rotl(x[5] + x[1], 7); x[13] ^= rotl(x[9] + x[5], 9); x[1] ^= rotl(x[13] + x[9], 13); x[5] ^= rotl(x[1] + x[13], 18);
      x[14] ^= rotl(x[10] + x[6], 7); x[2] ^= rotl(x[14] + x[10], 9); x[6] ^= rotl(x[2] + x[14], 13); x[10] ^= rotl(x[6] + x[2], 18);
      x[3] ^= rotl(x[15] + x[11], 7); x[7] ^= rotl(x[3] + x[15], 9); x[11] ^= rotl(x[7] + x[3], 13); x[15] ^= rotl(x[11] + x[7], 18);
      x[1] ^= rotl(x[0] + x[3], 7); x[2] ^= rotl(x[1] + x[0], 9); x[3] ^= rotl(x[2] + x[1], 13); x[0] ^= rotl(x[3] + x[2], 18);
      x[6] ^= rotl(x[5] + x[4], 7); x[7] ^= rotl(x[6] + x[5], 9); x[4] ^= rotl(x[7] + x[6], 13); x[5] ^= rotl(x[4] + x[7], 18);
      x[11] ^= rotl(x[10] + x[9], 7); x[8] ^= rotl(x[11] + x[10], 9); x[9] ^= rotl(x[8] + x[11], 13); x[10] ^= rotl(x[9] + x[8], 18);
      x[12] ^= rotl(x[15] + x[14], 7); x[13] ^= rotl(x[12] + x[15], 9); x[14] ^= rotl(x[13] + x[12], 13); x[15] ^= rotl(x[14] + x[13], 18);
    }
    for (let i = 0; i < 16; i++) B[i] += x[i];
  }
  function blockMix(B, Y, r) {
    const X = B.slice(16 * (2 * r - 1), 16 * 2 * r);
    for (let i = 0; i < 2 * r; i++) {
      for (let k = 0; k < 16; k++) X[k] ^= B[16 * i + k];
      salsa20_8(X);
      Y.set(X, 16 * (i % 2 === 0 ? i / 2 : r + (i - 1) / 2));
    }
    B.set(Y);
  }
  function roMix(B, N, r) {
    const V = new Uint32Array(32 * r * N);
    const Y = new Uint32Array(32 * r);
    for (let i = 0; i < N; i++) { V.set(B, i * 32 * r); blockMix(B, Y, r); }
    for (let i = 0; i < N; i++) {
      const j = B[16 * (2 * r - 1)] & (N - 1);
      const o = j * 32 * r;
      for (let k = 0; k < 32 * r; k++) B[k] ^= V[o + k];
      blockMix(B, Y, r);
    }
  }
  async function pbkdf2(password, salt, len) {
    const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, key, len * 8));
  }
  async function scrypt(password, salt, N, r, p, dkLen) {
    const pw = enc.encode(password);
    const B = await pbkdf2(pw, salt, p * 128 * r);
    const words = new Uint32Array(B.buffer, B.byteOffset, B.byteLength / 4);   // petit-boutiste, comme sur tout poste actuel
    for (let i = 0; i < p; i++) roMix(words.subarray(i * 32 * r, (i + 1) * 32 * r), N, r);
    return pbkdf2(pw, B, dkLen);
  }
  const deriveKey = async (password, salt) => crypto.subtle.importKey('raw', await scrypt(password, salt, 16384, 8, 1, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);

  async function encrypt(text, password) {
    if (!(window.crypto && crypto.subtle)) throw new Error('Le chiffrement n’est pas disponible dans ce navigateur.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, await deriveKey(password, salt), enc.encode(text)));
    const ct = sealed.subarray(0, sealed.length - 16);
    const tag = sealed.subarray(sealed.length - 16);
    const out = new Uint8Array(MAGIC.length + 16 + 12 + 16 + ct.length);
    let o = 0;
    for (const part of [MAGIC, salt, iv, tag, ct]) { out.set(part, o); o += part.length; }
    return out;
  }
  async function decrypt(buf, password) {
    let o = MAGIC.length;
    const salt = buf.subarray(o, (o += 16));
    const iv = buf.subarray(o, (o += 12));
    const tag = buf.subarray(o, (o += 16));
    const ct = buf.subarray(o);
    const sealed = new Uint8Array(ct.length + 16);
    sealed.set(ct); sealed.set(tag, ct.length);
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, await deriveKey(password, salt), sealed));
  }

  // ---------- Fichiers ----------
  const handles = new Map();   // chemin virtuel → FileSystemFileHandle
  async function register(handle) {
    let p = handle.name;
    const other = handles.get(p);
    if (other && !(await other.isSameEntry(handle))) {
      let n = 2;
      while (handles.has('dossier ' + n + '/' + handle.name) && !(await handles.get('dossier ' + n + '/' + handle.name).isSameEntry(handle))) n++;
      p = 'dossier ' + n + '/' + handle.name;
    }
    handles.set(p, handle);
    kv.set('handles', p, handle);   // pour rouvrir depuis « Récents » (le navigateur redemandera l'autorisation)
    return p;
  }
  async function docFromBytes(path, buf) {
    const u8 = new Uint8Array(buf);
    if (startsWithMagic(u8)) return { path, kind: 'plume', encrypted: true, b64: b64encode(u8) };
    const ext = extOf(path);
    return { path, kind: ext === 'plume' ? 'plume' : ext === 'txt' ? 'text' : 'html', encrypted: false, text: dec.decode(u8) };
  }

  async function openDocument() {
    if (FSA) {
      try {
        const [h] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Documents (Plume, HTML, texte)', accept: { 'application/json': ['.plume'], 'text/html': ['.html', '.htm'], 'text/plain': ['.txt'] } }],
        });
        const file = await h.getFile();
        return docFromBytes(await register(h), await file.arrayBuffer());
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        /* autre erreur : on essaie le sélecteur classique */
      }
    }
    const f = await pickWithInput('.plume,.html,.htm,.txt');
    return f ? docFromBytes(f.name, await f.arrayBuffer()) : null;
  }

  async function saveDocument({ path, content, password, saveAs, name }) {
    const data = password ? await encrypt(content, password) : enc.encode(content);
    let h = path && !saveAs ? handles.get(path) : null;
    if (!h && FSA) {
      try {
        h = await window.showSaveFilePicker({
          suggestedName: safeName(name, 'plume'),
          types: [{ description: 'Document Plume', accept: { 'application/json': ['.plume'] } }],
        });
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        h = null;
      }
    }
    if (h) {
      try {
        const w = await h.createWritable();
        await w.write(data);
        await w.close();
        return { path: await register(h) };
      } catch (e) {
        if (!(e && /NotAllowed|Security|InvalidState/i.test(e.name))) throw e;
        /* autorisation refusée : on bascule sur le téléchargement ci-dessous */
      }
    }
    const fileName = safeName(name, 'plume');
    download(data, fileName, 'application/octet-stream');
    if (!FSA) toast('Ce navigateur ne peut pas écrire directement : le document est téléchargé à chaque enregistrement. Chrome ou Edge enregistrent sur place.', 7000);
    return { path: fileName };
  }

  // ---------- Recents ----------
  const getRecents = async () => (await kv.get('kv', 'recents')) || [];

  // ---------- Édition (presse-papiers) ----------
  async function editCmd(cmd) {
    if (!['cut', 'copy', 'paste', 'selectAll'].includes(cmd)) return false;
    if (cmd !== 'paste') return document.execCommand(cmd);
    try {
      const t = await navigator.clipboard.readText();
      if (t) document.execCommand('insertText', false, t);
      return true;
    } catch (_) {
      toast('Le navigateur bloque le collage depuis le menu : utilisez Ctrl+V.', 5000);
      return false;
    }
  }

  const ready = (async () => ({ version: VERSION, electron: '', chrome: '', file: null }))();

  window.native = {
    web: true,
    init: () => ready,
    open: openDocument,
    save: saveDocument,
    decrypt: async (b64, password) => {
      try { return { text: await decrypt(b64decode(b64), password) }; } catch (_) { return { error: 'Mot de passe incorrect ou fichier endommagé.' }; }
    },
    exportDocx: async (bytes, name) => { const n = safeName(name, 'docx'); download(new Uint8Array(bytes), n, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); return { path: n }; },
    exportHtml: async (html, name) => { const n = safeName(name, 'html'); download(html, n, 'text/html;charset=utf-8'); return { path: n }; },
    exportMd: async (md, images, name) => {
      let text = String(md);
      // Un seul fichier : les images sont intégrées au texte (le navigateur ne peut pas créer de dossier à côté).
      for (const i of Array.isArray(images) ? images : []) {
        const ext = extOf(i.name);
        text = text.split('{{IMAGES}}/' + i.name).join('data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + i.b64);
      }
      const n = safeName(name, 'md');
      download(text, n, 'text/markdown;charset=utf-8');
      return { path: n };
    },
    exportPdf: async () => {
      toast('Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF » comme imprimante.', 7000);
      setTimeout(() => window.print(), 250);
      return null;
    },
    print: async () => { window.print(); return { ok: true }; },
    pickFile: async () => {
      if (FSA) {
        try { const [h] = await window.showOpenFilePicker({ multiple: false }); return { path: h.name, name: h.name }; } catch (e) { if (e && e.name === 'AbortError') return null; }
      }
      const f = await pickWithInput('');
      return f ? { path: f.name, name: f.name } : null;
    },
    pickImage: async () => {
      const f = await pickWithInput('image/png,image/jpeg,image/gif');
      if (!f) return null;
      if (f.size > 8 * 1024 * 1024) return { error: 'Image trop volumineuse (maximum 8 Mo).' };
      return new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve({ dataUrl: String(r.result) });
        r.onerror = () => resolve({ error: 'Lecture de l’image impossible.' });
        r.readAsDataURL(f);
      });
    },
    openExternal: async (kind, value) => {
      if (typeof value !== 'string' || value.length > 4096) return false;
      if (kind === 'url' && /^https?:\/\//i.test(value)) { window.open(value, '_blank', 'noopener,noreferrer'); return true; }
      if (kind === 'mail' && /^mailto:/i.test(value)) { window.location.href = value; return true; }
      return false;   // « afficher dans le dossier » n'existe pas dans un navigateur
    },
    setTheme: async () => true,
    setUiZoom: async (f) => {
      // Le zoom CSS agrandit aussi les unités vh : on compense pour que la fenêtre ne déborde pas.
      const z = f && f > 0 && f !== 1 ? f : 1;
      document.documentElement.style.zoom = z === 1 ? '' : String(z);
      let st = document.getElementById('web-zoom');
      if (!st) { st = document.createElement('style'); st.id = 'web-zoom'; document.head.appendChild(st); }
      st.textContent = z === 1 ? '' : '#app{height:calc(100vh / ' + z + ')}.modal,.pop-card,.settings{max-height:calc((100vh - 48px) / ' + z + ')}';
      return true;
    },
    toggleFullscreen: async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (_) { /* refusé */ }
      return true;
    },
    setSpellLangs: async () => true,
    editCmd,
    spell: { check: () => ({ bad: false, suggestions: [] }), add: async () => true },   // le correcteur du navigateur souligne les fautes
    recents: {
      list: async () => (await getRecents()).map((r) => Object.assign({ missing: false }, r)),
      add: async (e) => {
        if (!e || !e.path) return false;
        const list = (await getRecents()).filter((x) => x.path !== e.path);
        list.unshift({ path: e.path, title: String(e.title || e.path).slice(0, 200), openedAt: Date.now(), preview: e.encrypted ? '' : String(e.preview || '').slice(0, 700), encrypted: !!e.encrypted });
        await kv.set('kv', 'recents', list.slice(0, 30));
        return true;
      },
      remove: async (p) => { await kv.set('kv', 'recents', (await getRecents()).filter((x) => x.path !== p)); await kv.del('handles', p); handles.delete(p); return true; },
      clear: async () => { await kv.set('kv', 'recents', []); await kv.clear('handles'); handles.clear(); return true; },
      open: async (p) => {
        if (!(await getRecents()).some((x) => x.path === p)) return { error: 'Ce document n’est plus dans la liste.' };
        const h = handles.get(p) || (await kv.get('handles', p));
        if (!h || typeof h.getFile !== 'function') return { error: 'Ce navigateur ne peut pas rouvrir ce fichier tout seul : utilisez Fichier → Ouvrir.' };
        try {
          let perm = await h.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted') perm = await h.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') return { error: 'Accès au fichier refusé. Utilisez Fichier → Ouvrir pour le rouvrir.' };
          const file = await h.getFile();
          handles.set(p, h);
          return docFromBytes(p, await file.arrayBuffer());
        } catch (e) {
          if (e && e.name === 'NotFoundError') return { error: 'Ce fichier est introuvable : il a peut-être été déplacé ou supprimé.', missing: true };
          return { error: 'Impossible de rouvrir ce fichier : ' + (e && e.message ? e.message : e) };
        }
      },
    },
    recovery: {
      write: async (t) => { await kv.set('kv', 'recovery', String(t)); return true; },
      read: async () => { const v = await kv.get('kv', 'recovery'); return v === undefined ? null : v; },
      clear: async () => { await kv.del('kv', 'recovery'); return true; },
    },
    onMenu: () => {},
    onExternalOpen: () => {},
  };

  // Fermer l'onglet du navigateur avec des modifications non enregistrées : le navigateur demande confirmation.
  window.addEventListener('beforeunload', (e) => {
    try { if (window.plume && window.plume.isDirty && window.plume.isDirty()) { e.preventDefault(); e.returnValue = ''; } } catch (_) { /* ignoré */ }
  });
})();
