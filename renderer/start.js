/* Plume — démarrage : applique les paramètres, construit les menus et l'accueil, puis lance l'application. */
(function () {
  'use strict';
  // La feuille défile sous l'en-tête : on mesure sa hauteur (elle change en mode compact, barre d'outils déployée…)
  const chrome = document.getElementById('chrome');
  const syncChrome = () => document.documentElement.style.setProperty('--chrome-h', chrome.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(syncChrome).observe(chrome);
  syncChrome();
  P.settings.applyAll();
  P.menu.initBar();
  P.home.init();
  P.app.start();
})();
