/* Construit dist-web/Plume.html : toute l'application dans un seul fichier, qui s'ouvre dans un navigateur.
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

const csp = "default-src 'none'; script-src " + hashes.join(' ') + "; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src https://api.anthropic.com; form-action 'none'; base-uri 'none'";
html = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, () => '<meta http-equiv="Content-Security-Policy" content="' + csp + '">');
if (!html.includes("script-src 'sha256-")) throw new Error('La politique de sécurité n’a pas été remplacée.');
if (/<script src=|<link rel="stylesheet"/.test(html)) throw new Error('Une ressource externe est restée dans la page.');

const out = path.join(root, 'dist-web');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'Plume.html'), html);
console.log('dist-web/Plume.html : ' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' Ko, ' + hashes.length + ' scripts');
