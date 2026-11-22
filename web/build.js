/* Construit dist-web/Plume.html (toute l'application dans un seul fichier, qui s'ouvre dans un navigateur)
   et dist-site/ (le même éditeur sous forme de site installable : manifeste, service worker, icônes).
   Usage : node web/build.js */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const R = path.join(root, 'renderer');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const read = (p) => fs.readFileSync(p, 'utf8');

let html = read(path.join(R, 'index.html'));
const hashes = [];
const sha = (s) => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'";
const inlineScript = (code) => {
  if (/<\/script/i.test(code)) throw new Error('Un script contient « </script » et ne peut pas être intégré.');
  hashes.push(sha(code));
  return '<script>' + code + '</script>';
};

html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_m, f) => {
  const css = read(path.join(R, f));
  if (/<\/style/i.test(css)) throw new Error('Une feuille de style contient « </style ».');
  return '<style>\n' + css + '\n</style>';
});

const shim = read(path.join(__dirname, 'native-web.js')).replace('__VERSION__', pkg.version + ' (navigateur)');
// Le pont navigateur est le premier script exécuté, avant boot.js
html = html.replace('<script src="boot.js"></script>', () => inlineScript(shim) + '\n  <script src="boot.js"></script>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_m, f) => inlineScript(read(path.join(R, f))));

const icon = fs.readFileSync(path.join(__dirname, 'favicon.png')).toString('base64');
html = html.replace('<title>Plume</title>', () => '<title>Plume</title>\n  <link rel="icon" type="image/png" href="data:image/png;base64,' + icon + '">');

// Deux sorties : dist-web/Plume.html (fichier autonome) et dist-site/ (le même éditeur, installable comme application : PWA).
const CONNECT = 'https://api.anthropic.com https://generativelanguage.googleapis.com';
const makeCsp = (site) => "default-src 'none'; script-src " + hashes.join(' ') + "; style-src 'unsafe-inline'; img-src data: blob:" + (site ? " 'self'" : '')
  + "; font-src 'none'; connect-src " + CONNECT + (site ? "; manifest-src 'self'; worker-src 'self'" : '') + "; form-action 'none'; base-uri 'none'";
const CSP_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
const withCsp = (h, site) => h.replace(CSP_RE, () => '<meta http-equiv="Content-Security-Policy" content="' + makeCsp(site) + '">');
const SITE_HEAD = '\n  <meta name="theme-color" content="#ececef">\n  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">';
const siteHtml = withCsp(html.replace(/(<link rel="icon"[^>]*>)/, (m) => m + SITE_HEAD), true);
html = withCsp(html, false);
for (const h of [html, siteHtml]) {
  if (!h.includes("script-src 'sha256-")) throw new Error('La politique de sécurité n’a pas été remplacée.');
  if (/<script src=|<link rel="stylesheet"/.test(h)) throw new Error('Une ressource externe est restée dans la page.');
}
if (!siteHtml.includes('<link rel="manifest"') || html.includes('<link rel="manifest"')) throw new Error('Le manifeste doit figurer dans la version site, et seulement là.');

const out = path.join(root, 'dist-web');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'Plume.html'), html);
console.log('dist-web/Plume.html : ' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' Ko, ' + hashes.length + ' scripts');

const site = path.join(root, 'dist-site');
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'icons'), { recursive: true });
const pwa = path.join(__dirname, 'pwa');
fs.writeFileSync(path.join(site, 'index.html'), siteHtml);
fs.copyFileSync(path.join(pwa, 'manifest.webmanifest'), path.join(site, 'manifest.webmanifest'));
fs.writeFileSync(path.join(site, 'sw.js'), read(path.join(pwa, 'sw.js')).replace('__VERSION__', pkg.version));
for (const f of fs.readdirSync(path.join(pwa, 'icons'))) fs.copyFileSync(path.join(pwa, 'icons', f), path.join(site, 'icons', f));
JSON.parse(read(path.join(site, 'manifest.webmanifest')));
console.log('dist-site/ : index.html + manifeste + service worker + icônes (version ' + pkg.version + ')');
