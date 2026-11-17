/* Plume — démarrage : applique les paramètres, construit les menus et l'accueil, puis lance l'application. */
(function () {
  'use strict';
  P.settings.applyAll();
  P.menu.initBar();
  P.home.init();
  P.app.start();
})();
