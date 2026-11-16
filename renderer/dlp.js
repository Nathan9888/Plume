/* Plume — détection de données sensibles (équivalent local de la « prévention des pertes de données »).
 *
 * Méthode : expressions régulières + validation (algorithme de Luhn, clé IBAN, plausibilité des dates).
 * Aucun apprentissage automatique : des faux positifs et des oublis restent possibles. */
(function () {
  'use strict';
  const ed = P.editor;

  const digitsOf = (s) => s.replace(/\D/g, '');

  function luhn(d) {
    let sum = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = d.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function ibanOk(raw) {
    const s = raw.replace(/\s/g, '');
    if (s.length < 15 || s.length > 34) return false;
    const r = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of r) {
      const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
      for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
    }
    return rem === 1;
  }

  const last4 = (s) => '•••• ' + digitsOf(s).slice(-4);

  const DETECTORS = [
    {
      id: 'card', label: 'Numéro de carte de paiement',
      re: /\b(?:\d[ -]?){12,18}\d\b/g,
      ok: (m) => { const d = digitsOf(m); return d.length >= 13 && d.length <= 19 && luhn(d); },
      mask: last4,
    },
    {
      id: 'nas', label: 'Numéro d’assurance sociale (NAS)',
      re: /\b\d{3}[ -]\d{3}[ -]\d{3}\b/g,
      ok: (m) => luhn(digitsOf(m)),
      mask: last4,
    },
    {
      id: 'nas2', label: 'Numéro d’assurance sociale (NAS)',
      re: /(?:\bNAS\b|\bSIN\b|assurance sociale|social insurance)[^0-9\n]{0,25}(\d{9})\b/gi,
      group: 1,
      ok: (m) => luhn(m),
      mask: last4,
    },
    {
      id: 'ramq', label: 'Numéro d’assurance maladie (RAMQ)',
      re: /\b[A-Z]{4} ?\d{4} ?\d{4}\b/g,
      ok: (m) => {
        const d = digitsOf(m);
        const mm = +d.slice(2, 4), dd = +d.slice(4, 6);
        return ((mm >= 1 && mm <= 12) || (mm >= 51 && mm <= 62)) && dd >= 1 && dd <= 31;
      },
      mask: (m) => m.slice(0, 4) + ' ••••',
    },
    {
      id: 'iban', label: 'Numéro de compte international (IBAN)',
      re: /\b[A-Z]{2}\d{2} ?(?:[A-Z0-9]{4} ?){2,7}[A-Z0-9]{1,4}\b/g,
      ok: ibanOk,
      mask: (m) => m.slice(0, 4) + ' ••••',
    },
    {
      id: 'secret', label: 'Mot de passe ou clé secrète',
      re: /(?:mot de passe|mdp|password|passwd|pwd|secret|cl[ée] api|api[_ -]?key|token)\s*(?:est|:|=)\s*(\S{4,})/gi,
      group: 1,
      ok: () => true,
      mask: () => '••••••••',
    },
    {
      id: 'key', label: 'Clé d’accès (API)',
      re: /\b(?:AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,})\b/g,
      ok: () => true,
      mask: (m) => m.slice(0, 4) + '••••',
    },
  ];

  /** Analyse le texte affiché du document. Retourne [{id, label, count, samples}]. */
  P.scanSensitive = function () {
    const text = ed.innerText || '';
    const found = new Map();
    for (const d of DETECTORS) {
      d.re.lastIndex = 0;
      let m;
      while ((m = d.re.exec(text))) {
        const value = d.group ? m[d.group] : m[0];
        if (!value || !d.ok(value)) continue;
        const key = d.id === 'nas2' ? 'nas' : d.id;
        const entry = found.get(key) || { id: key, label: d.label, count: 0, samples: [] };
        entry.count++;
        const masked = d.mask(value);
        if (entry.samples.length < 3 && !entry.samples.includes(masked)) entry.samples.push(masked);
        found.set(key, entry);
        if (m[0].length === 0) d.re.lastIndex++;
      }
    }
    return Array.from(found.values());
  };

  /**
   * Affiche le résultat de l'analyse.
   * beforeExport = true : n'interrompt que s'il y a quelque chose à signaler ; résout false si l'utilisateur annule.
   */
  P.runDlp = async function (beforeExport) {
    const found = P.scanSensitive();
    if (!found.length) {
      if (!beforeExport) P.toast('Aucune donnée sensible détectée (cartes, NAS, assurance maladie, IBAN, mots de passe).', 4500);
      return true;
    }
    const lines = found.map((f) => `• ${f.label} : ${f.count} (${f.samples.join(', ')})`).join('\n');
    const note = '\n\nLa détection repose sur des motifs et des contrôles de validité : elle peut se tromper et ne remplace pas votre relecture.';
    if (!beforeExport) {
      await P.modal({ title: 'Données sensibles détectées', message: lines + note, buttons: [{ id: 'ok', label: 'Fermer', primary: true }] });
      return true;
    }
    const r = await P.modal({
      title: 'Données sensibles détectées',
      message: 'Ce document semble contenir :\n' + lines + note,
      buttons: [{ id: 'cancel', label: 'Annuler' }, { id: 'ok', label: 'Continuer quand même', primary: true }],
    });
    return !!r;
  };
})();
