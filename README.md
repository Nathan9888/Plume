# Plume — éditeur de documents pour Windows

Plume est un traitement de texte installable, inspiré de Google Docs, qui fonctionne **entièrement hors ligne** :
vos documents restent sur votre ordinateur (fichiers `.plume`).

## Obtenir l'application (.exe)

Il existe deux façons. Dans les deux cas, vous obtenez un installateur `Plume Setup 1.0.0.exe`.

### Option A — Sur votre PC (si vous pouvez installer des logiciels)

1. Installez **Node.js** (version LTS) : <https://nodejs.org>
2. Ouvrez une invite de commandes dans ce dossier (`plume`) et lancez :

```bat
npm install
npm start          :: pour essayer l'application tout de suite
npm run dist       :: pour fabriquer l'installateur
```

3. L'installateur se trouve dans `dist\Plume Setup 1.0.0.exe`. Double-cliquez pour l'installer.

### Option B — Sans rien installer (GitHub Actions)

1. Créez un dépôt GitHub privé et envoyez-y le contenu de ce dossier.
2. Onglet **Actions** → **Construire l'installateur Windows** → **Run workflow**.
3. Quand c'est terminé (environ 3 minutes), téléchargez l'élément **Plume-installateur** en bas de la page.

> Windows peut afficher « Windows a protégé votre ordinateur » (SmartScreen) : l'installateur n'est pas signé
> numériquement. Cliquez sur **Informations complémentaires** puis **Exécuter quand même**.

## Ce que Plume fait

**Édition** — styles de titres, polices, tailles, couleurs, surlignage, listes, listes de tâches, tableaux
(ajout/suppression de lignes et colonnes), images, liens, sauts de page, recherche et remplacement,
plan du document, correcteur orthographique (français et anglais ; ses dictionnaires peuvent se télécharger
à la première utilisation, ce qui demande alors une connexion Internet).
Deux affichages : **Pages** (format Lettre, repères de saut de page) et **Sans pages** (surface continue).

**Smart Canvas** — tapez `@` pour insérer :
- des *puces* : Personne (carte de contact), Date, Fichier local, Lieu (ouvre une carte), Lien web ;
- des *variables* : une valeur (ex. « Nom du client ») modifiée une fois, mise à jour partout ;
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
- **Récupération automatique** après une fermeture imprévue (sauf pour un document chiffré, volontairement).
- Un document ouvert ne peut exécuter aucun code ni charger d'image externe, et ses liens sont limités à
  `http(s)`, `mailto` et « afficher dans le dossier ».

**Exportation** — Word (`.docx`, avec **modifications suivies** et **commentaires**), PDF, HTML, impression.
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
suggestion acceptée) — utilisez l'historique des versions.

## Raccourcis

`Ctrl+N` Nouveau · `Ctrl+O` Ouvrir · `Ctrl+S` Enregistrer · `Ctrl+Maj+S` Enregistrer sous · `Ctrl+P` Imprimer ·
`Ctrl+F` / `Ctrl+H` Rechercher / remplacer · `Ctrl+K` Lien · `Ctrl+Alt+M` Commenter · `@` Insérer

## Organisation du code

```
main.js        processus principal Electron : fenêtre, fichiers, chiffrement, PDF, récupération
preload.js     passerelle sécurisée entre l'interface et le processus principal
renderer/      l'interface (HTML/CSS/JavaScript sans dépendance)
  editor.js    mise en forme, tableaux, images, menu @, puces, blocs, recherche
  review.js    commentaires et mode Suggestion
  store.js     format de fichier .plume, images dédupliquées, versions
  panels.js    plan, historique des versions, variables
  dlp.js       détection de données sensibles
  docx.js      générateur Word (.docx), sans dépendance
  app.js       fichiers, modes, exports, mot de passe, récupération
```

Le format `.plume` est du JSON lisible (HTML du document, commentaires, variables, versions, images).
