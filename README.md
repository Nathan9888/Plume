# Plume — éditeur de documents pour Windows

Plume est un traitement de texte installable, à l'esthétique macOS, qui fonctionne **entièrement hors ligne** :
vos documents restent sur votre ordinateur (fichiers `.plume`).

## Obtenir l'application (.exe)

Il existe deux façons. Dans les deux cas, vous obtenez un installateur `Plume Setup 1.4.1.exe`.

### Option A — Sur votre PC (si vous pouvez installer des logiciels)

1. Installez **Node.js** (version LTS) : <https://nodejs.org>
2. Ouvrez une invite de commandes dans ce dossier (`plume`) et lancez :

```bat
npm install
npm start          :: pour essayer l'application tout de suite
npm run dist       :: pour fabriquer l'installateur
```

3. L'installateur se trouve dans `dist\Plume Setup 1.4.1.exe`. Double-cliquez pour l'installer.

### Option B — Sans rien installer (GitHub Actions)

1. Créez un dépôt GitHub et envoyez-y le contenu de ce dossier.
2. Onglet **Actions** → **Construire l'installateur Windows** → **Run workflow**.
3. Quand c'est terminé (environ 3 minutes), l'installateur est publié dans la section **Releases** du dépôt
   (version « Plume 1.4.1 ») et aussi disponible comme élément **Plume-installateur** au bas de la page de l'exécution.

> Windows peut afficher « Windows a protégé votre ordinateur » (SmartScreen) : l'installateur n'est pas signé
> numériquement. Cliquez sur **Informations complémentaires** puis **Exécuter quand même**.

### Version navigateur (un seul fichier `Plume.html`)

Le même éditeur existe sous forme d'**un seul fichier HTML** : double-cliquez dessus, il s'ouvre dans Chrome, Edge ou Firefox, sans installation
ni connexion Internet (sauf pour l'assistant IA, facultatif). Il est joint à chaque *Release* du dépôt (`Plume.html`), ou se fabrique avec `npm run build:web` (fichier `dist-web\Plume.html`).

- **Chrome et Edge** : « Ouvrir » et « Enregistrer » travaillent directement sur vos fichiers `.plume` (le navigateur demande l'autorisation).
  Dans **Firefox et Safari**, l'enregistrement se fait par téléchargement.
- Les fichiers `.plume` sont **les mêmes** que ceux de la version Windows, **y compris chiffrés par mot de passe** (même format, mêmes algorithmes).
- Word, HTML et Markdown sont téléchargés ; pour le PDF, choisissez « Enregistrer au format PDF » dans la fenêtre d'impression.
- Différences : pas d'« Afficher dans le dossier » ; les images d'un export Markdown sont intégrées au fichier ; le correcteur orthographique est **le même** que dans la version Windows (dictionnaires intégrés au fichier) ; `Ctrl+N`, `Ctrl+T` et `Ctrl+W` sont réservés par le navigateur — utilisez les menus.
- Les réglages et la récupération automatique restent dans le navigateur, propres à ce fichier et à ce navigateur.

## L'interface (esthétique macOS)

Plume adopte le langage visuel de macOS : police système, coins arrondis, icônes en traits fins, barres de défilement discrètes,
menus translucides à surbrillance d'accent, boutons et interrupteurs « Apple ». La disposition reste celle d'un traitement de
texte moderne (menus, barre d'outils, plan, panneau latéral).

- **Onglets dans la barre de titre** : un onglet *Accueil* fixe, puis un onglet par document, en pastilles. Les boutons Réduire,
  Agrandir et Fermer de Windows sont intégrés à cette même barre. Plusieurs documents peuvent être ouverts en même temps
  (`Ctrl+T`, `Ctrl+W`, `Ctrl+Tab`).
- **Page d'accueil** : galerie de modèles (lettre, CV, notes de réunion, rapport, proposition, suivi de projet,
  liste de tâches, facture) et documents récents (grille ou liste, recherche, tri, « Afficher dans le dossier »).
  Un document chiffré n'affiche jamais d'aperçu de son contenu.
- **Barre de menus** : Fichier, Édition, Affichage, Insertion, Format, Outils, Extensions, Aide, avec sous-menus,
  raccourcis affichés et navigation au clavier. La barre d'outils, en capsules sur une seule ligne, déploie le reste
  derrière un bouton « … » quand la fenêtre est étroite. Le titre du document est centré dans l'en-tête.
- **Plan du document** à gauche, **commentaires / suggestions / versions / variables** à droite (contrôle segmenté).
- **Palette de commandes** (`Ctrl+Maj+P`) : recherche instantanée de toutes les actions, réglages et modèles.
- **Mode concentration** (`Ctrl+Maj+C`, `Échap` pour quitter) : tout disparaît sauf la page ; seul le paragraphe en cours reste
  bien visible, et une pastille discrète affiche le temps de lecture et le nombre de mots.
- **Barre flottante** : en sélectionnant du texte, une pastille apparaît sous la sélection (gras, italique, souligné, lien,
  surlignage, **commentaire**, **émoji**). Le commentaire s'écrit dans une bulle, avec le passage concerné surligné ;
  `@nom` assigne le commentaire, `Ctrl+Entrée` l'envoie. Le sélecteur d'émojis a une recherche et des catégories ;
  choisir un émoji sur une sélection ajoute une *réaction* à ce passage. (Les drapeaux ne sont pas inclus : Windows ne les affiche pas en émojis.)
- **Menu contextuel** (clic droit) : couper/copier/coller, coller sans mise en forme, suggestions d'orthographe et
  « Ajouter au dictionnaire », commentaire, lien. Dans un tableau : insérer/supprimer lignes et colonnes, ligne de titre,
  diviser la cellule, trier, répartir lignes/colonnes à égalité, et **Options du tableau** (bordures, largeur, ligne de titre).
- **Menu du profil** (l'avatar en haut à droite) : thème **clair / sombre / système** avec aperçus de fenêtre, page toujours blanche,
  **couleur d'accent** (bleu, violet, rose, rouge, orange, vert, graphite), taille de l'interface, mode compact (`Ctrl+Maj+F`), plan,
  correcteur orthographique et sa langue, récupération et versions automatiques.
  **« Tous les paramètres »** ouvre une fenêtre façon Réglages Système (barre latérale à icônes colorées, cartes groupées) :
  zoom des pages, repères de saut de page, compteur de mots, mode d'ouverture (édition ou lecture seule), nom affiché,
  liste des raccourcis et « À propos ». En thème sombre, la feuille du document devient sombre elle aussi (inversion des couleurs) ;
  l'impression et le PDF restent toujours blancs.

## Ce que Plume fait

**Édition** — styles de titres, polices, tailles, couleurs, surlignage, listes, listes de tâches, tableaux
(ajout/suppression de lignes et colonnes), images, liens, sauts de page, recherche et remplacement,
plan du document, **correcteur orthographique intégré** (français et anglais, hors connexion, identique dans les deux versions).
Deux affichages : **Pages** (format Lettre, repères de saut de page) et **Sans pages** (surface continue).

**Correction orthographique façon Google Docs** — les mots inconnus sont soulignés d'un trait ondulé rouge. Un clic sur un mot
ouvre une pastille : la **suggestion** (un clic la remplace), **Ignorer**, **commentaire**, et un menu `⋮` (autres suggestions,
« Toujours remplacer par … », « Ajouter au dictionnaire personnel », « Vérification de l'orthographe »).
`Ctrl+Alt+X` (ou Outils → *Vérification de l'orthographe…*) ouvre une petite carte qui parcourt les erreurs une à une
(« 1 sur 3 », suggestions, Ignorer, Ajouter au dictionnaire) ; sans erreur, elle affiche « Aucune suggestion à examiner. ».
Le moteur est un lecteur de dictionnaires Hunspell écrit en JavaScript (affixes, composés, suggestions par distance d'édition),
validé contre `libhunspell` (99,9 % d'accord). Dictionnaires : français (Grammalecte, MPL 2.0) et anglais (SCOWL),
dans `dictionaries/`, convertis en fichiers `renderer/dict-*.js` par `node tools/make-dicts.js`.

**Curseurs** — Plume dessine ses propres curseurs (style macOS : flèche, main, texte, roue d'attente multicolore, déplacement,
redimensionnements horizontal, vertical et diagonaux), identiques dans l'application Windows et dans le navigateur.
**Paramètres → Apparence → Curseur** : activer/désactiver, **taille** (20 à 64 px) et **couleur** (noir, blanc, couleur d'accent, bleu, rouge,
orange, vert, violet, rose, graphite), avec aperçu en direct des neuf curseurs.

**Assistant IA (facultatif)** — l'IA est présente un peu partout dans l'éditeur, avec **votre propre clé API Claude** (Anthropic). Plume n'a ni
abonnement ni serveur : l'IA est **désactivée par défaut**, et rien n'est envoyé tant que vous ne lancez pas une action.
- *Sur la sélection* (pastille ✦, clic droit → Assistant IA, ou Outils → Assistant IA) : améliorer l'écriture, corriger, reformuler (professionnel,
  chaleureux, concis, simple), raccourcir, développer, traduire (6 langues), résumer, expliquer, idées pour continuer, titres possibles.
  Le résultat s'affiche en direct dans une carte : **Remplacer**, **Insérer dessous**, **En suggestion** (au nom de « Assistant IA », à accepter ou refuser
  dans le panneau Suggestions), Copier, Réessayer, et un champ pour préciser (« plus court… »). Tout est annulable avec `Ctrl+Z`.
- *Demander à l'IA* (`Ctrl+Alt+J`, ou `/` → IA) : rédige un texte à partir d'une consigne, en tenant compte du début du document ; continuer l'écriture, générer un plan.
- *Panneau Assistant* (bouton ✦ en haut à droite) : écran d'accueil avec pastilles d'actions (résumer, idées, plan, relecture… et « Plus »), choix du modèle en haut, champ de saisie arrondi, menu « + » pour les outils. La conversation connaît le document ; une pastille affiche la sélection transmise (retirable avec ×). Chaque réponse peut être insérée ou remplacer la sélection.
- *Relecture* (Outils → Assistant IA, ou la carte d'orthographe) : fautes et tournures maladroites listées une à une, avec **Appliquer / Ignorer / Tout appliquer**.
- *Orthographe* : la pastille d'un mot fautif propose « Corriger la phrase avec l'IA ».
- **Confidentialité** : seul le texte concerné (sélection ; document entier pour le panneau et la relecture) et votre consigne partent vers `api.anthropic.com` ;
  jamais votre nom ni autre chose. Avant l'envoi, Plume **détecte les données sensibles** (carte, NAS, IBAN…) et demande confirmation, et **refuse** par défaut les
  documents chiffrés. Dans l'application Windows, la clé est chiffrée par le coffre du système (`safeStorage`) et reste dans le processus principal ; la page n'a toujours
  aucun accès réseau. Dans `Plume.html`, la clé est conservée dans le stockage local du navigateur (sans coffre) et la page n'a le droit de contacter que `api.anthropic.com`.
  Réglages : Paramètres → Intelligence artificielle (clé, modèle Sonnet / Haiku / Opus, vérifications).

**Menus déroulants façon macOS** — les listes (zoom, style de paragraphe, police, réglages, tri de l'accueil…) et la palette de couleurs
(couleur du texte, surlignage) n'utilisent plus les menus du navigateur : même verre dépoli, coins arrondis, coche devant la valeur
choisie et surbrillance de la couleur d'accent que les autres menus. Dans la barre d'outils la liste s'ouvre sous le bouton ; dans les
réglages elle se superpose au bouton, la valeur choisie en face (comme sur un Mac). Les polices s'y affichent dans leur propre police
et les titres à leur taille. Clavier : flèches, Début/Fin, Entrée, Échap, et frappe des premières lettres pour aller à une entrée.

**Menu `/`** — tapez `/` dans une ligne vide pour insérer rapidement : titres, listes, tableau, ligne de séparation, saut de page,
**encadrés** colorés (information, astuce, attention, danger), **sommaire automatique** (il se met à jour tout seul et
reste cliquable), etc. Continuez à taper pour filtrer, `Échap` pour fermer.

**Smart Canvas** — tapez `@` pour insérer :
- des *puces* : Personne (carte de contact), Date, Fichier local, Lieu (ouvre une carte), Lien web ;
- des *variables* : une valeur (ex. « Nom du client ») modifiée une fois, mise à jour partout. Les modèles (lettre, CV, rapport,
  proposition, plan, facture) arrivent avec leurs champs prêts à remplir : **Insertion → Remplir les champs** les propose tous d'un coup ;
- des *blocs* : notes de réunion, brouillon de courriel (s'ouvre dans votre messagerie), suivi de projet
  avec statuts, liste de tâches, tableau.

**Révision** — trois modes (liste en haut à droite) :
- **Édition** ;
- **Suggestion** : ce que vous tapez, collez ou supprimez est proposé (ajout en vert, suppression barrée en rouge)
  et peut être accepté ou refusé un par un ou en bloc ;
- **Lecture seule**.

Les **commentaires** sont attachés à un passage, avec réponses, résolution et **assignation** à une personne
(bouton « Notifier » : ouvre un courriel dans votre messagerie). Raccourci : `Ctrl+Alt+M`.

**Historique des versions** — une version à chaque enregistrement et toutes les 10 minutes si le document a changé
(les 40 dernières sont gardées dans le fichier) ; versions nommées, aperçu, restauration sans perte.

**Sécurité**
- **Mot de passe** : chiffrement AES-256-GCM (clé dérivée par scrypt). Sans le mot de passe, personne — Plume
  non plus — ne peut rouvrir le fichier.
- **Données sensibles** : avant toute exportation ou impression, Plume détecte les numéros de carte de paiement,
  NAS, assurance maladie (RAMQ), IBAN, mots de passe et clés d'accès écrits dans le document, et vous avertit.
- **Récupération automatique** après une fermeture imprévue, pour tous les onglets modifiés (sauf les documents chiffrés, volontairement).
- Un document ouvert ne peut exécuter aucun code ni charger d'image externe, et ses liens sont limités à
  `http(s)`, `mailto` et « afficher dans le dossier ». La page de l'application n'a aucun accès réseau (CSP `connect-src 'none'`) : l'IA, si vous l'activez, passe par le processus principal.

**Exportation** — Word (`.docx`, avec **modifications suivies**, **commentaires**, encadrés et sommaire), PDF, HTML (sommaire cliquable),
**Markdown** (`.md`, format GitHub : tableaux, listes de tâches, encadrés `> [!NOTE]`, images extraites dans un dossier à côté du fichier), impression.
Ouverture de fichiers `.plume`, `.html` et `.txt`.

## Ce que Plume ne fait pas (volontairement ou pas encore)

| Dans la liste Google Docs | Dans Plume |
|---|---|
| Édition simultanée à plusieurs, curseurs des autres, transformation opérationnelle | **Non.** Cela exige un serveur central ; Plume est un logiciel local. |
| Graphe de connaissances Google (profils, Drive, Agenda, Maps) | **Non.** Les puces utilisent des contacts et des fichiers locaux. |
| Apps Script, modules complémentaires, API REST | **Non** pour l'instant. |
| Droits Propriétaire/Éditeur/Commentateur/Lecteur par utilisateur | **Non.** Les modes Édition/Suggestion/Lecture sont des *modes de travail*, pas des permissions : n'importe qui ayant le fichier peut le modifier. Pour restreindre l'accès, utilisez le mot de passe. |
| Chiffrement côté client avec clés de l'entreprise, DLP par apprentissage automatique | **Non.** Plume a un chiffrement par mot de passe et une détection par motifs (des faux positifs et des oublis sont possibles). |
| Rendu sur `<canvas>` | **Non**, par choix : le rendu standard garde la saisie, l'orthographe et les accents natifs de Windows. |
| Ouvrir un fichier Word (`.docx`) | **Pas encore.** On peut exporter *vers* Word, pas l'ouvrir. Astuce : dans Word, enregistrez en `.html` puis ouvrez-le dans Plume. |

Limites connues : en mode Suggestion, seuls le texte tapé, collé et supprimé est suivi (pas la mise en forme, les
objets insérés ni les sauts de paragraphe) ; les repères de pages sont indicatifs (la vraie pagination se voit dans
l'aperçu PDF) ; annuler (`Ctrl+Z`) ne défait pas les actions faites dans les panneaux (commentaire résolu,
suggestion acceptée) — utilisez l'historique des versions. L'historique d'annulation d'un document est aussi remis à zéro
quand on change d'onglet (le contenu, lui, est conservé intact).

## Raccourcis

`Ctrl+N` / `Ctrl+T` Nouveau · `Ctrl+O` Ouvrir · `Ctrl+S` Enregistrer · `Ctrl+Maj+S` Enregistrer sous · `Ctrl+P` Imprimer ·
`Ctrl+W` Fermer l'onglet · `Ctrl+Tab` Onglet suivant · `Alt+Début` Accueil · `Ctrl+F` / `Ctrl+H` Rechercher / remplacer ·
`Ctrl+K` Lien · `Ctrl+\` Effacer la mise en forme · `Ctrl+Alt+M` Commenter · `@` Insérer · `/` Blocs ·
`Ctrl+Maj+P` Palette de commandes · `Ctrl+Maj+C` Mode concentration · `Ctrl+Alt+X` Vérification de l'orthographe ·
`Ctrl++` / `Ctrl+-` / `Ctrl+0` Zoom de la page · `Ctrl+Maj+F` Mode compact · `F11` Plein écran · `Ctrl+/` Liste des raccourcis

## Organisation du code

```
main.js        processus principal Electron : fenêtre (barre de titre intégrée), fichiers, récents, chiffrement, PDF, récupération
preload.js     passerelle sécurisée entre l'interface et le processus principal
renderer/      l'interface (HTML/CSS/JavaScript sans dépendance)
  index.html   structure : barre d'onglets, accueil, document, icônes SVG
  boot.js      applique le thème avant le premier affichage
  styles.css   variables de couleurs (clair/sombre/accents), éditeur, panneaux, impression
  chrome.css   habillage : onglets, accueil, menus, barre d'outils en capsules, profil, réglages
  ui.js        outils communs : DOM, fenêtres de dialogue, fenêtres contextuelles, assainissement du HTML
  settings.js  paramètres, carte de profil, fenêtre « Paramètres »
  templates.js modèles de documents
  editor.js    mise en forme, tableaux, images, menus @ et /, puces, encadrés, sommaire, champs, recherche
  markdown.js  export Markdown (GitHub)
  palette.js   palette de commandes
  emoji.js     sélecteur d'émojis (recherche, catégories)
  selbar.js    barre flottante de mise en forme
  ctxmenu.js   menu contextuel (orthographe, tableaux)
  hunspell.js  moteur de correction compatible Hunspell · dict-fr.js / dict-en.js : dictionnaires intégrés
  spell.js     soulignement ondulé, pastille de correction, carte « Vérification »
  cursors.js   curseurs dessinés (taille et couleur réglables)
  selects.js   listes déroulantes (<select>) au style macOS · colorpop.js : palette de couleurs
  ai.js        noyau de l'assistant IA (consignes, garde-fous, insertion) · ai-ui.js : carte, panneau Assistant, relecture
  focus.js     mode concentration
web/           version navigateur : native-web.js (remplace le pont Electron) et build.js (assemble Plume.html)
  review.js    commentaires et mode Suggestion
  store.js     format de fichier .plume, images dédupliquées, versions
  panels.js    plan, historique des versions, variables
  dlp.js       détection de données sensibles
  docx.js      générateur Word (.docx), sans dépendance
  app.js       onglets, fichiers, modes, exports, mot de passe, récupération
  menus.js     barre de menus et menus déroulants
  home.js      page d'accueil
  start.js     démarrage
```

Le format `.plume` est du JSON lisible (HTML du document, commentaires, variables, versions, images).
