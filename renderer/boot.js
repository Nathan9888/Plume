/* Plume — appliqué avant le premier affichage : thème et couleur d'accent (évite un éclair de thème clair). */
(function () {
  'use strict';
  try {
    var s = JSON.parse(localStorage.getItem('plume.settings') || '{}') || {};
    var theme = ['light', 'dark', 'system'].indexOf(s.theme) >= 0 ? s.theme : 'system';
    var dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var accent = ['blue', 'purple', 'pink', 'red', 'orange', 'green', 'graphite'].indexOf(s.accent) >= 0 ? s.accent : 'blue';
    var root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.accent = accent;
  } catch (e) { /* stockage indisponible : thème par défaut */ }
})();
