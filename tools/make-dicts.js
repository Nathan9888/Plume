/* Génère renderer/dict-fr.js et renderer/dict-en.js à partir des fichiers Hunspell du dossier dictionaries/.
   Usage : node tools/make-dicts.js
   Français : dictionnaire « Classique » de Dicollecte (MPL 2.0, https://grammalecte.net/). Anglais : SCOWL (voir dictionaries/en/license). */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const lang of ['fr', 'en']) {
  const dir = path.join(root, 'dictionaries', lang);
  const aff = fs.readFileSync(path.join(dir, 'index.aff'), 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n');
  const dic = fs.readFileSync(path.join(dir, 'index.dic'), 'utf8').replace(/\r/g, '');
  const js = '/* Dictionnaire ' + lang + ' pour le correcteur Plume — généré par tools/make-dicts.js ; licence : dictionaries/' + lang + '/license */\n' +
    '(window.PlumeDicts = window.PlumeDicts || {}).' + lang + ' = ' + JSON.stringify({ aff, dic }) + ';\n';
  fs.writeFileSync(path.join(root, 'renderer', 'dict-' + lang + '.js'), js);
  console.log('dict-' + lang + '.js : ' + (Buffer.byteLength(js) / 1024).toFixed(0) + ' Ko');
}
