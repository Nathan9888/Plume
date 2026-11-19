/* Plume — modèles de documents de la galerie de l'accueil. */
(function () {
  'use strict';

  const today = () => new Date().toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const status = (s, label) => `<span class="chip chip-status" contenteditable="false" data-type="status" data-status="${s}">${label}</span>&nbsp;`;
  const rows = (n, cols) => ('<tr>' + '<td><br></td>'.repeat(cols) + '</tr>').repeat(n);
  /** Champ du document (variable) : se remplit via « Remplir les champs » et se met à jour partout. */
  const v = (name) => `<span class="chip chip-var" contenteditable="false" data-type="var" data-var="${name.replace(/"/g, '&quot;')}">«${name}»</span>&nbsp;`;
  const toc = '<div class="toc" contenteditable="false" data-block="toc" title="Sommaire automatique"><div class="toc-title">Sommaire</div><div class="toc-body"><p class="toc-empty">…</p></div></div>';
  const head = (cells) => '<tr>' + cells.map((c) => `<th>${c}</th>`).join('') + '</tr>';

  P.templates = [
    {
      id: 'blank', name: 'Document vierge', sub: '', docTitle: 'Sans titre',
      html: () => '<p><br></p>',
    },
    {
      id: 'letter', name: 'Lettre', sub: 'Avec champs', docTitle: 'Lettre',
      vars: ['Votre nom', 'Votre adresse', 'Votre courriel', 'Nom du destinataire', 'Organisation du destinataire', 'Objet de la lettre'],
      html: () => `
        <p>${v('Votre nom')}<br>${v('Votre adresse')}<br>[Ville (Québec) Code postal]<br>[Téléphone] · ${v('Votre courriel')}</p>
        <p>${today()}</p>
        <p>${v('Nom du destinataire')}<br>[Titre]<br>${v('Organisation du destinataire')}<br>[Adresse]</p>
        <p><b>Objet : ${v('Objet de la lettre')}</b></p>
        <p>Madame, Monsieur,</p>
        <p>[Introduction : expliquez en une ou deux phrases la raison de votre lettre.]</p>
        <p>[Développement : donnez les détails, les faits ou les arguments utiles.]</p>
        <p>[Conclusion : indiquez ce que vous attendez du destinataire et remerciez-le.]</p>
        <p>Veuillez agréer, Madame, Monsieur, mes salutations distinguées.</p>
        <p><br></p>
        <p>${v('Votre nom')}</p>`,
    },
    {
      id: 'cv', name: 'Curriculum vitæ', sub: 'Chronologique', docTitle: 'Curriculum vitæ',
      vars: ['Prénom Nom', 'Ville', 'Téléphone', 'Courriel'],
      html: () => `
        <h1>${v('Prénom Nom')}</h1>
        <p>${v('Ville')}· ${v('Téléphone')}· ${v('Courriel')}· [Profil en ligne]</p>
        <h2>Profil</h2>
        <p>[Deux ou trois phrases qui résument votre expérience et ce que vous recherchez.]</p>
        <h2>Expérience professionnelle</h2>
        <h3>[Titre du poste] — [Employeur]</h3>
        <p><i>[Mois année] – [Mois année] · [Ville]</i></p>
        <ul><li>[Réalisation ou responsabilité principale]</li><li>[Résultat mesurable obtenu]</li></ul>
        <h3>[Titre du poste] — [Employeur]</h3>
        <p><i>[Mois année] – [Mois année] · [Ville]</i></p>
        <ul><li>[Réalisation ou responsabilité principale]</li></ul>
        <h2>Formation</h2>
        <p><b>[Diplôme]</b> — [Établissement], [année]</p>
        <h2>Compétences</h2>
        <ul><li>[Compétence]</li><li>[Compétence]</li><li>[Langues : français, anglais…]</li></ul>`,
    },
    {
      id: 'meeting', name: 'Notes de réunion', sub: 'Avec actions', docTitle: 'Notes de réunion',
      html: () => `
        <h1>Notes de réunion</h1>
        <table><tbody>
          <tr><th>Date</th><td>${today()}</td></tr>
          <tr><th>Participants</th><td><br></td></tr>
          <tr><th>Animation / secrétariat</th><td><br></td></tr>
        </tbody></table>
        <h2>Ordre du jour</h2>
        <ol><li><br></li></ol>
        <h2>Discussions et décisions</h2>
        <p><br></p>
        <h2>Actions à mener</h2>
        <table><tbody>${head(['Action', 'Responsable', 'Échéance', 'Statut'])}
          <tr><td><br></td><td><br></td><td><br></td><td>${status('todo', 'À faire')}</td></tr>
          <tr><td><br></td><td><br></td><td><br></td><td>${status('todo', 'À faire')}</td></tr>
        </tbody></table>
        <p>Prochaine rencontre : [date et lieu]</p>`,
    },
    {
      id: 'report', name: 'Rapport', sub: 'Avec sommaire', docTitle: 'Rapport',
      vars: ['Titre du rapport', 'Auteur'],
      html: () => `
        <h1>${v('Titre du rapport')}</h1>
        <p><i>${v('Auteur')}· ${today()}</i></p>
        ${toc}
        <h2>Résumé</h2>
        <p>[Résumé en quelques lignes : contexte, constats principaux, recommandations.]</p>
        <h2>1. Introduction</h2>
        <p>[Contexte, objectif et portée du rapport.]</p>
        <h2>2. Analyse</h2>
        <h3>2.1 [Sujet]</h3>
        <p>[Données, observations, comparaisons.]</p>
        <h3>2.2 [Sujet]</h3>
        <p><br></p>
        <h2>3. Conclusion</h2>
        <p><br></p>
        <h2>4. Recommandations</h2>
        <ol><li><br></li></ol>`,
    },
    {
      id: 'proposal', name: 'Proposition de projet', sub: 'Budget et échéancier', docTitle: 'Proposition de projet',
      vars: ['Nom du projet', 'Nom du client', 'Date de livraison'],
      html: () => `
        <h1>Proposition de projet</h1>
        <p><i>${v('Nom du projet')}· Préparé pour ${v('Nom du client')}· ${today()}</i></p>
        <h2>Contexte</h2>
        <p>[Situation actuelle et problème à résoudre.]</p>
        <h2>Objectifs</h2>
        <ul><li>[Objectif mesurable]</li><li>[Objectif mesurable]</li></ul>
        <h2>Livrables</h2>
        <table><tbody>${head(['Livrable', 'Description', 'Date'])}${rows(3, 3)}</tbody></table>
        <h2>Échéancier</h2>
        <p>Livraison prévue : ${v('Date de livraison')}</p>
        <p>[Grandes étapes et jalons.]</p>
        <h2>Budget</h2>
        <table><tbody>${head(['Poste', 'Quantité', 'Prix unitaire', 'Total'])}${rows(3, 4)}</tbody></table>
        <h2>Prochaines étapes</h2>
        <p><br></p>`,
    },
    {
      id: 'plan', name: 'Suivi de projet', sub: 'Avec statuts', docTitle: 'Suivi de projet',
      vars: ['Nom du projet'],
      html: () => `
        <h1>Suivi de projet</h1>
        <p><i>${v('Nom du projet')}· mis à jour le ${today()}</i></p>
        <table><tbody>${head(['Tâche', 'Responsable', 'Échéance', 'Statut'])}
          <tr><td>[Tâche]</td><td><br></td><td><br></td><td>${status('doing', 'En cours')}</td></tr>
          <tr><td>[Tâche]</td><td><br></td><td><br></td><td>${status('todo', 'À faire')}</td></tr>
          <tr><td>[Tâche]</td><td><br></td><td><br></td><td>${status('done', 'Terminé')}</td></tr>
        </tbody></table>
        <h2>Risques et blocages</h2>
        <ul><li><br></li></ul>`,
    },
    {
      id: 'todo', name: 'Liste de tâches', sub: 'Cases à cocher', docTitle: 'Liste de tâches',
      html: () => `
        <h1>Liste de tâches</h1>
        <p><i>${today()}</i></p>
        <h2>Aujourd’hui</h2>
        <ul class="checklist"><li>[Tâche]</li><li>[Tâche]</li><li>[Tâche]</li></ul>
        <h2>Cette semaine</h2>
        <ul class="checklist"><li>[Tâche]</li><li>[Tâche]</li></ul>
        <h2>Plus tard</h2>
        <ul class="checklist"><li>[Tâche]</li></ul>`,
    },
    {
      id: 'invoice', name: 'Facture', sub: 'TPS et TVQ', docTitle: 'Facture',
      vars: ['Votre entreprise', 'Numéro de facture', 'Nom du client', 'Numéro TPS', 'Numéro TVQ', 'Échéance de paiement'],
      html: () => `
        <h1>Facture</h1>
        <p>${v('Votre entreprise')}<br>[Adresse] · [Téléphone] · [Courriel]<br>N° TPS : ${v('Numéro TPS')}· N° TVQ : ${v('Numéro TVQ')}</p>
        <table><tbody>
          <tr><th>Facture n°</th><td>${v('Numéro de facture')}</td><th>Date</th><td>${today()}</td></tr>
          <tr><th>Client</th><td>${v('Nom du client')}</td><th>Échéance</th><td>${v('Échéance de paiement')}</td></tr>
        </tbody></table>
        <table><tbody>${head(['Description', 'Quantité', 'Prix unitaire', 'Montant'])}${rows(4, 4)}
          <tr><td colspan="3"><b>Sous-total</b></td><td><br></td></tr>
          <tr><td colspan="3">TPS (5 %)</td><td><br></td></tr>
          <tr><td colspan="3">TVQ (9,975 %)</td><td><br></td></tr>
          <tr><td colspan="3"><b>Total à payer</b></td><td><br></td></tr>
        </tbody></table>
        <p>Modalités de paiement : [virement, chèque…]</p>`,
    },
  ];
})();
