/* Plume — sélecteur d'émojis (recherche, catégories, récents) utilisé pour les réactions sur du texte.
   Les émojis sont ceux d'Unicode 12 et antérieurs : ils s'affichent avec la police d'émojis de Windows 10 et 11.
   Les drapeaux sont volontairement absents : Windows les affiche sous forme de lettres (« CA », « FR »…). */
(function () {
  'use strict';
  const { h } = P;

  // « émoji nom|mots-clés » ; une ligne par émoji
  const CATS = [
    { id: 'smileys', icon: '😀', label: 'Émoticônes et émotions', data: `
😀 visage rieur|sourire content joie
😃 visage rieur aux grands yeux|sourire heureux
😄 visage rieur aux yeux rieurs|sourire joyeux
😁 visage radieux|sourire dents
😆 visage hilare|rire
😅 sourire avec goutte de sueur|soulagement
🤣 mort de rire|rire lol mdr
😂 larmes de joie|rire lol mdr
🙂 visage légèrement souriant|sourire
🙃 visage à l’envers|ironie
😉 clin d’œil|clin oeil
😊 visage souriant aux joues roses|timide heureux
😇 visage avec auréole|ange innocent
🥰 visage amoureux|coeurs adorer
😍 yeux en forme de cœur|amoureux adorer
🤩 yeux étoilés|wow impressionné
😘 visage envoyant un bisou|baiser
😗 visage qui embrasse|bisou
😚 bisou les yeux fermés|baiser
😋 visage savoureux|miam délicieux
😛 visage tirant la langue|langue
😜 clin d’œil avec la langue|blague
🤪 visage fou|dingue
😝 langue et yeux fermés|beurk
🤑 visage avec des billets|argent riche
🤗 visage qui fait un câlin|merci calin
🤭 main sur la bouche|oups gloussement
🤫 chut|silence secret
🤔 visage qui réfléchit|penser hum
🤐 bouche fermée|secret
🤨 sourcil levé|doute sceptique
😐 visage neutre|indifférent
😑 visage sans expression|bof
😶 visage sans bouche|silence
😏 sourire en coin|malin
😒 visage mécontent|agacé
🙄 yeux au ciel|exaspéré
😬 grimace|gêné
🤥 menteur|pinocchio mensonge
😌 visage soulagé|apaisé zen
😔 visage pensif|triste
😪 visage endormi|fatigue
🤤 visage qui bave|envie
😴 visage qui dort|sommeil zzz
😷 visage avec masque|malade
🤒 thermomètre dans la bouche|fièvre malade
🤕 tête bandée|blessé
🤢 visage nauséeux|malade
🤮 visage qui vomit|vomissement
🤧 éternuement|rhume
🥵 visage brûlant|chaud
🥶 visage glacé|froid
🥴 visage étourdi|ivre
😵 visage sonné|vertige
🤯 tête qui explose|choc
🤠 chapeau de cowboy|cowboy
🥳 visage de fête|anniversaire
😎 lunettes de soleil|cool
🤓 visage de binoclard|geek
🧐 visage avec monocle|examiner
😕 visage perplexe|confus
😟 visage inquiet|souci
🙁 légère grimace|triste
😮 bouche ouverte|surpris
😲 visage stupéfait|étonné
😳 visage rougissant|gêne
🥺 yeux suppliants|svp
😨 visage effrayé|peur
😰 visage anxieux|sueur
😢 visage qui pleure|larme
😭 visage qui sanglote|pleurer
😱 visage qui hurle de peur|effroi
😖 visage déconfit|confus
😞 visage déçu|déception
😓 visage abattu|sueur
😩 visage las|fatigué
😫 visage épuisé|fatigue
🥱 visage qui bâille|ennui
😤 visage qui souffle|colère
😡 visage furieux|rage rouge
😠 visage en colère|fâché
🤬 visage jurant|insultes
😈 diable souriant|démon
👿 diablotin en colère|démon
💀 crâne|mort
💩 caca|crotte
🤡 clown|cirque
👻 fantôme|halloween
👽 extraterrestre|alien
🤖 robot|machine
💋 trace de baiser|bisou
💌 lettre d’amour|courrier
💘 cœur transpercé|amour cupidon
💝 cœur avec ruban|cadeau amour
💖 cœur étincelant|amour
💗 cœur grandissant|amour
💓 cœur battant|amour
💞 cœurs tournants|amour
💕 deux cœurs|amour
❤ cœur rouge|amour coeur
🧡 cœur orange|coeur
💛 cœur jaune|coeur amitié
💚 cœur vert|coeur nature
💙 cœur bleu|coeur
💜 cœur violet|coeur
🖤 cœur noir|coeur
💔 cœur brisé|chagrin
💯 cent points|parfait score
💢 symbole de colère|fâché
💥 collision|explosion boum
💫 étourdissement|étoiles
💦 gouttes de sueur|eau
💨 nuage de poussière|vite vent
💬 bulle de dialogue|message parler
💭 bulle de pensée|penser
💤 sommeil|zzz dormir` },
    { id: 'people', icon: '🧑', label: 'Gestes et personnes', data: `
👋 main qui salue|bonjour salut au revoir
🤚 dos de la main levée|stop
🖐 main aux doigts écartés|cinq
✋ main levée|stop arrêt
🖖 salut vulcain|spock
👌 geste OK|parfait ok
🤏 geste de pincement|petit
✌ signe de victoire|paix
🤞 doigts croisés|chance espoir
🤟 geste je t’aime|amour
🤘 signe des cornes|rock
🤙 appelle-moi|téléphone
👈 index pointant à gauche|gauche
👉 index pointant à droite|droite
👆 index pointant vers le haut|haut
👇 index pointant vers le bas|bas
☝ index levé|attention
👍 pouce levé|oui bien d’accord ok
👎 pouce baissé|non mal
✊ poing levé|solidarité
👊 poing|coup
🤛 poing vers la gauche|poing
🤜 poing vers la droite|poing
👏 applaudissements|bravo
🙌 mains levées|hourra célébration
👐 mains ouvertes|câlin
🤲 paumes ensemble|offrir
🤝 poignée de main|accord entente
🙏 mains jointes|merci prière svp
✍ main qui écrit|écrire
💅 vernis à ongles|beauté
🤳 selfie|photo
💪 biceps|force muscle
🧠 cerveau|intelligence
👀 yeux|regarder voir
👁 œil|voir
👂 oreille|écouter
👃 nez|odeur
👄 bouche|lèvres
👅 langue|goût
🦷 dent|dentiste
🦴 os|squelette
👶 bébé|nourrisson
🧒 enfant|jeune
👦 garçon|enfant
👧 fille|enfant
🧑 personne|adulte
👨 homme|adulte
👩 femme|adulte
🧓 personne âgée|aîné
👴 vieil homme|grand-père
👵 vieille femme|grand-mère
👮 policier|police
🕵 détective|enquêteur
💂 garde|garde royal
👷 ouvrier du bâtiment|chantier
🤴 prince|roi
👸 princesse|reine
🧙 mage|magicien sorcier
🧚 fée|magie
🧛 vampire|dracula
🧜 sirène|mer
🧝 elfe|fantastique
🧞 génie|lampe
🧟 zombie|mort-vivant
🙋 personne qui lève la main|question
🤦 main sur le front|facepalm désespoir
🤷 haussement d’épaules|je ne sais pas
🙇 personne qui s’incline|révérence respect
💁 personne au guichet|information
💃 danseuse|danser fête
🕺 danseur|danser fête
🚶 personne qui marche|marche
🏃 personne qui court|course
👫 couple|amour
👪 famille|parents enfants` },
    { id: 'nature', icon: '🌿', label: 'Animaux et nature', data: `
🐶 chien|animal compagnon
🐱 chat|animal compagnon
🐭 souris|rongeur
🐹 hamster|rongeur
🐰 lapin|animal
🦊 renard|animal
🐻 ours|animal
🐼 panda|animal
🐨 koala|animal
🐯 tigre|félin
🦁 lion|félin roi
🐮 vache|ferme
🐷 cochon|ferme
🐸 grenouille|crapaud
🐵 singe|primate
🙈 singe qui ne voit rien|gêne
🙉 singe qui n’entend rien|sourd
🙊 singe qui ne dit rien|silence
🐔 poule|ferme
🐧 manchot|pingouin
🐦 oiseau|ciel
🐤 poussin|bébé
🦆 canard|mare
🦅 aigle|oiseau
🦉 hibou|sagesse nuit
🦇 chauve-souris|nuit
🐺 loup|sauvage
🐗 sanglier|forêt
🐴 cheval|équitation
🦄 licorne|magie
🐝 abeille|miel insecte
🐛 chenille|insecte
🦋 papillon|insecte
🐌 escargot|lent
🐞 coccinelle|insecte
🐜 fourmi|insecte
🕷 araignée|insecte
🐢 tortue|lent
🐍 serpent|reptile
🦎 lézard|reptile
🐙 pieuvre|mer
🦑 calmar|mer
🦀 crabe|mer
🐠 poisson tropical|mer
🐟 poisson|mer
🐬 dauphin|mer
🐳 baleine|mer
🦈 requin|mer
🐊 crocodile|reptile
🐘 éléphant|animal
🦒 girafe|animal
🦓 zèbre|animal
🐪 dromadaire|désert
🐿 écureuil|forêt
🦔 hérisson|piquants
🌵 cactus|désert
🎄 sapin de Noël|fêtes
🌲 conifère|forêt sapin
🌳 arbre|forêt
🌴 palmier|plage vacances
🌱 jeune pousse|plante
🌿 herbe|plante
🍀 trèfle|chance
🍁 feuille d’érable|automne canada
🍂 feuilles mortes|automne
🍃 feuilles au vent|vent
🍄 champignon|forêt
💐 bouquet|fleurs
🌷 tulipe|fleur
🌹 rose|fleur amour
🌺 hibiscus|fleur
🌸 fleur de cerisier|printemps
🌼 marguerite|fleur
🌻 tournesol|fleur été
☀ soleil|beau temps
🌙 croissant de lune|nuit
⭐ étoile|favori
🌟 étoile brillante|brillant
✨ étincelles|magie nouveau
⚡ éclair|électricité rapide
☁ nuage|ciel
⛅ soleil derrière un nuage|météo
☔ parapluie avec gouttes|pluie
❄ flocon de neige|hiver
⛄ bonhomme de neige|hiver
🔥 feu|flamme chaud
💧 goutte|eau
🌊 vague|mer océan
🌈 arc-en-ciel|couleurs
🌍 globe Europe et Afrique|monde terre` },
    { id: 'food', icon: '🍵', label: 'Nourriture et boissons', data: `
🍏 pomme verte|fruit
🍎 pomme rouge|fruit
🍐 poire|fruit
🍊 orange|fruit
🍋 citron|fruit
🍌 banane|fruit
🍉 pastèque|fruit été
🍇 raisin|fruit
🍓 fraise|fruit
🍈 melon|fruit
🍒 cerises|fruit
🍑 pêche|fruit
🍍 ananas|fruit
🥥 noix de coco|fruit
🥝 kiwi|fruit
🍅 tomate|légume
🍆 aubergine|légume
🥑 avocat|légume
🥦 brocoli|légume
🥕 carotte|légume
🌽 maïs|légume
🌶 piment|épicé
🥔 pomme de terre|patate
🍠 patate douce|légume
🥐 croissant|viennoiserie
🍞 pain|boulangerie
🥖 baguette|pain
🥨 bretzel|pain
🧀 fromage|laitier
🥚 œuf|oeuf
🍳 œuf au plat|cuisine déjeuner
🥞 crêpes|déjeuner érable
🥓 bacon|déjeuner
🥩 steak|viande
🍗 cuisse de poulet|viande
🍖 viande sur l’os|viande
🌭 hot-dog|saucisse
🍔 hamburger|burger
🍟 frites|poutine patates
🍕 pizza|italien
🌮 taco|mexicain
🌯 burrito|mexicain
🥗 salade|légumes
🍝 spaghetti|pâtes
🍜 bol de nouilles|soupe ramen
🍲 marmite|ragoût soupe
🍣 sushi|japonais
🍤 crevette frite|tempura
🍦 cornet de glace|dessert
🍩 beignet|dessert
🍪 biscuit|dessert
🎂 gâteau d’anniversaire|fête
🍰 part de gâteau|dessert
🧁 petit gâteau|cupcake
🍫 chocolat|dessert
🍬 bonbon|sucre
🍭 sucette|bonbon
🍯 pot de miel|sucre
🥛 verre de lait|boisson
☕ boisson chaude|café thé
🍵 tasse de thé|thé
🍶 saké|boisson
🍾 bouteille qui saute|champagne fête
🍷 verre de vin|boisson
🍸 cocktail|boisson
🍹 boisson tropicale|cocktail
🍺 chope de bière|boisson
🍻 chopes qui trinquent|santé
🥂 coupes qui trinquent|fête
🥃 verre|whisky
🥤 gobelet avec paille|boisson
🥢 baguettes|asiatique
🍴 fourchette et couteau|repas
🥄 cuillère|repas
🍽 assiette et couverts|repas` },
    { id: 'travel', icon: '🏙', label: 'Voyages et lieux', data: `
🚗 voiture|auto
🚕 taxi|auto
🚌 autobus|transport
🚑 ambulance|urgence
🚒 camion de pompiers|urgence
🚓 voiture de police|police
🚚 camion|livraison
🚜 tracteur|ferme
🛴 trottinette|transport
🚲 vélo|bicyclette
🛵 scooter|transport
🏍 moto|transport
🚂 locomotive|train
🚆 train|transport
🚇 métro|transport
🚊 tramway|transport
✈ avion|voyage
🛫 décollage|avion
🛬 atterrissage|avion
🚀 fusée|lancement espace
🛸 soucoupe volante|ovni
🚁 hélicoptère|transport
⛵ voilier|bateau
🚢 paquebot|bateau
⚓ ancre|bateau
⛽ pompe à essence|carburant
🚦 feu tricolore|circulation
🚧 travaux|chantier
🗺 carte du monde|voyage
🗽 statue de la Liberté|new york
🗼 tour de Tokyo|japon
🏰 château|moyen âge
🏯 château japonais|japon
🏟 stade|sport
🎡 grande roue|parc
🎢 montagnes russes|parc
⛲ fontaine|ville
⛺ tente|camping
🏖 plage avec parasol|vacances
🏝 île déserte|vacances
🏜 désert|sable
⛰ montagne|nature
🏔 montagne enneigée|nature
🌋 volcan|éruption
🏕 camping|nature
🏠 maison|domicile
🏡 maison avec jardin|domicile
🏢 immeuble de bureaux|travail
🏥 hôpital|santé
🏦 banque|argent
🏨 hôtel|voyage
🏪 dépanneur|magasin
🏫 école|étude
🏭 usine|industrie
⛪ église|religion
🕌 mosquée|religion
🌆 ville au crépuscule|soir
🌃 nuit étoilée|ville
🌉 pont de nuit|ville` },
    { id: 'activities', icon: '🏆', label: 'Activités', data: `
⚽ ballon de football|soccer sport
🏀 basket-ball|sport
🏈 football américain|sport
⚾ baseball|sport
🎾 tennis|sport
🏐 volley-ball|sport
🏉 rugby|sport
🎱 billard|jeu
🏓 tennis de table|ping-pong
🏸 badminton|sport
🏒 hockey sur glace|sport canadien
🥅 filet de but|sport
🎿 ski|hiver
⛷ skieur|hiver
🏂 planche à neige|hiver
⛸ patin à glace|hiver
🥌 pierre de curling|curling hiver
🏋 haltérophilie|musculation
🤺 escrime|sport
⛳ drapeau de golf|golf
🎣 canne à pêche|pêche
🥊 gant de boxe|sport
🥋 tenue d’arts martiaux|judo karaté
🎯 cible|fléchettes objectif
🏆 trophée|victoire coupe
🥇 médaille d’or|premier
🥈 médaille d’argent|deuxième
🥉 médaille de bronze|troisième
🏅 médaille sportive|récompense
🎖 médaille militaire|décoration
🎗 ruban de sensibilisation|cause
🎫 billet|entrée
🎪 chapiteau|cirque
🎭 masques de théâtre|spectacle
🎨 palette de peinture|art
🎬 clap de cinéma|film
🎤 microphone|chanter karaoké
🎧 casque audio|musique
🎼 partition|musique
🎹 clavier de piano|musique
🥁 tambour|batterie musique
🎷 saxophone|musique jazz
🎸 guitare|musique
🎻 violon|musique
🎲 dé|jeu hasard
🧩 pièce de puzzle|jeu
🎮 manette de jeu|jeux vidéo
🎰 machine à sous|casino
🎳 quilles|bowling
🎉 cotillon|fête célébration
🎊 boule de confettis|fête
🎈 ballon de baudruche|fête
🎁 cadeau|fête
🎀 ruban|cadeau
🎃 citrouille|halloween
🎅 père Noël|fêtes` },
    { id: 'objects', icon: '💡', label: 'Objets', data: `
⌚ montre|heure
📱 téléphone portable|mobile
💻 ordinateur portable|travail
🖥 ordinateur de bureau|écran
⌨ clavier|saisie
🖱 souris d’ordinateur|clic
💾 disquette|sauvegarde
💿 disque optique|cd
📷 appareil photo|photo
📹 caméra vidéo|film
📞 combiné téléphonique|appel
📺 télévision|écran
📻 radio|musique
⏰ réveil|heure alarme
⏳ sablier|attente temps
🔋 pile|énergie
🔌 prise électrique|énergie
💡 ampoule|idée
🔦 lampe de poche|lumière
🕯 bougie|lumière
💸 billet avec ailes|argent dépense
💵 billet de banque|argent dollar
💰 sac d’argent|argent
💳 carte de crédit|paiement
💎 pierre précieuse|diamant valeur
⚖ balance|justice
🔧 clé à molette|outil réparer
🔨 marteau|outil
⛏ pioche|outil
⚙ engrenage|réglages
🛡 bouclier|protection
🔮 boule de cristal|magie
🔭 télescope|astronomie
🔬 microscope|science
💊 pilule|médicament
💉 seringue|vaccin
🌡 thermomètre|température
🧹 balai|ménage
🧺 panier|linge
🧼 savon|propreté
🔑 clé|accès
🗝 vieille clé|accès
🚪 porte|entrée
🛋 canapé|salon
🛏 lit|dormir
🚿 douche|salle de bain
🛒 chariot|magasinage achats
✉ enveloppe|courrier
📧 courriel|email
📦 colis|livraison
📝 note|mémo écrire
📁 dossier|classement
📅 calendrier|date
📈 graphique en hausse|croissance
📉 graphique en baisse|baisse
📊 diagramme à barres|statistiques
📌 punaise|épingler
📍 repère|lieu
📎 trombone|pièce jointe
📏 règle|mesure
✂ ciseaux|couper
🗑 corbeille|supprimer
🔒 cadenas fermé|sécurité
🔓 cadenas ouvert|déverrouillé
📖 livre ouvert|lecture
📚 livres|bibliothèque
📓 carnet|notes
🔖 signet|marque-page
🏷 étiquette|prix
🖊 stylo|écrire
✏ crayon|écrire
🖍 crayon de cire|dessin
🔍 loupe vers la gauche|rechercher
🔎 loupe vers la droite|rechercher
📣 mégaphone|annonce
📢 haut-parleur|annonce
🔔 cloche|notification
🔕 cloche barrée|silence` },
    { id: 'symbols', icon: '✔', label: 'Symboles', data: `
✔ coche|oui ok
✅ case cochée|fait terminé validé
☑ case cochée dans une boîte|fait
❌ croix|non erreur supprimer
❎ bouton croix|non
❓ point d’interrogation|question
❗ point d’exclamation|important attention
‼ double point d’exclamation|important
⚠ avertissement|attention danger
🚫 interdit|défendu
⛔ sens interdit|stop
➕ plus|ajouter
➖ moins|retirer
➗ division|calcul
✖ multiplication|calcul
♻ recyclage|écologie
⚜ fleur de lys|québec
➡ flèche vers la droite|droite
⬅ flèche vers la gauche|gauche
⬆ flèche vers le haut|haut
⬇ flèche vers le bas|bas
↗ flèche en haut à droite|diagonale
↘ flèche en bas à droite|diagonale
↔ flèche gauche-droite|échange
↕ flèche haut-bas|échange
↩ flèche courbe vers la gauche|retour
↪ flèche courbe vers la droite|suivant
🔄 flèches dans le sens antihoraire|actualiser
🔁 flèches de répétition|boucle
🔙 flèche retour|précédent
🔝 flèche haut|sommet
▶ lecture|play
⏸ pause|pause
⏹ arrêt|stop
⏺ enregistrement|rec
⏩ avance rapide|suivant
⏪ retour rapide|précédent
🔊 haut-parleur fort|son
🔇 haut-parleur muet|silence
ℹ information|info
⭕ cercle rouge|cible
🔴 disque rouge|rouge
🔵 disque bleu|bleu
🔶 grand losange orange|orange
🔷 grand losange bleu|bleu
🔺 triangle rouge vers le haut|rouge
🔻 triangle rouge vers le bas|rouge
💠 losange avec point|forme
🔘 bouton radio|choix
⬛ grand carré noir|noir
⬜ grand carré blanc|blanc
♠ pique|cartes
♣ trèfle|cartes
♥ cœur|cartes
♦ carreau|cartes
🃏 joker|cartes
™ marque de commerce|tm
© droit d’auteur|copyright
® marque déposée|registered
💲 symbole du dollar|argent
☮ symbole de la paix|paix
☯ yin et yang|équilibre
✝ croix latine|religion` },
  ];

  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
  let ALL = null;

  function parse() {
    if (ALL) return ALL;
    ALL = CATS.map((c) => ({
      id: c.id, icon: c.icon, label: c.label,
      items: c.data.trim().split('\n').map((line) => {
        const sp = line.indexOf(' ');
        const char = line.slice(0, sp);
        const [name, kw] = line.slice(sp + 1).split('|');
        return { char, name, slug: ':' + name.replace(/[’']/g, '').trim().replace(/\s+/g, '-') + ':', hay: norm(name + ' ' + (kw || '')) };
      }),
    }));
    return ALL;
  }

  const RKEY = 'plume.emoji.recent';
  const recent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || '[]').filter((x) => typeof x === 'string').slice(0, 16); } catch (_) { return []; } };
  const remember = (c) => { try { localStorage.setItem(RKEY, JSON.stringify([c, ...recent().filter((x) => x !== c)].slice(0, 16))); } catch (_) { /* ignoré */ } };

  /**
   * P.emoji.open({ x, y, onPick, onClose }) : ouvre le sélecteur près du point donné.
   * La recherche accepte la forme « :nom: » ; survoler un émoji affiche son nom dans le champ.
   */
  function open(o) {
    const cats = parse();
    const byChar = new Map();
    cats.forEach((c) => c.items.forEach((it) => byChar.set(it.char, it)));
    const search = h('input', { type: 'search', class: 'em-search', placeholder: 'Rechercher', 'aria-label': 'Rechercher un émoji', autocomplete: 'off', spellcheck: 'false' });
    const tabs = h('div', { class: 'em-tabs', role: 'tablist' });
    const list = h('div', { class: 'em-list', role: 'listbox', tabindex: '-1' });
    const box = h('div', { class: 'em-pop', role: 'dialog', 'aria-label': 'Choisir un émoji' },
      h('div', { class: 'em-searchrow' }, P.svgIcon('i-search', 'sm'), search), tabs, list);
    const sections = [];

    const pick = (it) => { remember(it.char); P.pop.close(); if (o.onPick) o.onPick(it.char); };
    const cell = (it) => h('button', {
      type: 'button', class: 'em-cell', role: 'option', 'aria-label': it.name, text: it.char,
      onmouseenter: () => { search.placeholder = it.slug; },
      onmouseleave: () => { search.placeholder = 'Rechercher'; },
      onclick: () => pick(it),
    });

    function renderAll() {
      list.replaceChildren();
      sections.length = 0;
      const rec = recent().map((c) => byChar.get(c)).filter(Boolean);
      if (rec.length) {
        const s = h('section', { class: 'em-sec', 'data-cat': 'recent' }, h('h4', { class: 'em-h', text: 'Récents' }), h('div', { class: 'em-grid' }, rec.map(cell)));
        list.append(s);
      }
      for (const c of cats) {
        const s = h('section', { class: 'em-sec', 'data-cat': c.id }, h('h4', { class: 'em-h', text: c.label }), h('div', { class: 'em-grid' }, c.items.map(cell)));
        sections.push({ id: c.id, el: s });
        list.append(s);
      }
    }

    function renderFound(q) {
      const words = norm(q.replace(/^:|:$/g, '').replace(/-/g, ' ')).split(/\s+/).filter(Boolean);
      const found = [];
      for (const c of cats) for (const it of c.items) if (words.every((w) => it.hay.includes(w))) found.push(it);
      list.replaceChildren();
      if (!found.length) { list.append(h('p', { class: 'em-empty', text: 'Aucun émoji trouvé.' })); return; }
      list.append(h('div', { class: 'em-grid' }, found.map(cell)));
    }

    cats.forEach((c) => {
      tabs.append(h('button', {
        type: 'button', class: 'em-tab', role: 'tab', title: c.label, 'aria-label': c.label, 'data-cat': c.id, text: c.icon,
        onclick: () => {
          search.value = '';
          if (!sections.length) renderAll();
          const s = sections.find((x) => x.id === c.id);
          if (s) list.scrollTop = s.el.offsetTop - 1;
        },
      }));
    });

    function syncTab() {
      if (!sections.length) return;
      const top = list.scrollTop + 4;
      let cur = sections[0].id;
      for (const s of sections) if (s.el.offsetTop <= top) cur = s.id;
      tabs.querySelectorAll('.em-tab').forEach((t) => t.classList.toggle('on', t.dataset.cat === cur));
    }
    list.addEventListener('scroll', syncTab);
    search.addEventListener('input', () => {
      const q = search.value.trim();
      if (!q || q === ':') { renderAll(); syncTab(); } else renderFound(q);
      tabs.classList.toggle('off', !!q && q !== ':');
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const first = list.querySelector('.em-cell'); if (first) first.click(); }
    });

    renderAll();
    P.pop.open(box, { x: o.x, y: o.y, onClose: o.onClose });
    syncTab();
    search.focus();
    return box;
  }

  P.emoji = { open };
})();
