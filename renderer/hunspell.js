/* Plume — moteur de correction orthographique compatible Hunspell (fichiers .aff / .dic), sans dépendance.
   Utilisé tel quel par la version Windows et par la version navigateur : mêmes fautes soulignées, mêmes suggestions.
   Gère : drapeaux « long », préfixes et suffixes (avec produit croisé et affixes en chaîne), NEEDAFFIX, FORBIDDENWORD,
   KEEPCASE, NOSUGGEST, ICONV, BREAK, REP, MAP, TRY. Ne gère pas les mots composés (inutiles pour le français et l'anglais courants). */
(function (root) {
  'use strict';

  const NONE = [];

  function parseFlags(str, type) {
    if (!str) return NONE;
    if (type === 'long') { const out = []; for (let i = 0; i + 1 < str.length; i += 2) out.push(str.slice(i, i + 2)); return out; }
    if (type === 'num') return str.split(',').filter(Boolean);
    return Array.from(str);
  }

  function condRegex(cond, suffix) {
    if (!cond || cond === '.') return null;
    let src = '';
    for (let i = 0; i < cond.length; i++) {
      const c = cond[i];
      if (c === '[') {
        const j = cond.indexOf(']', i);
        if (j < 0) break;
        src += '[' + cond.slice(i + 1, j).replace(/\\/g, '\\\\').replace(/^\^/, '^') + ']';
        i = j;
      } else if (c === '.') src += '.';
      else src += c.replace(/[\\^$*+?()|{}[\]/-]/g, '\\$&');
    }
    try { return new RegExp(suffix ? '(?:' + src + ')$' : '^(?:' + src + ')', 'u'); } catch (_) { return null; }
  }

  function caseType(w) {
    const lower = w.toLowerCase();
    const upper = w.toUpperCase();
    if (w === lower) return 'lower';
    if (w === upper) return w.length > 1 && /\p{L}.*\p{L}/u.test(w) ? 'all' : 'init';
    const first = Array.from(w)[0];
    if (w === first.toUpperCase() + w.slice(first.length).toLowerCase()) return 'init';
    return 'mixed';
  }
  const capitalize = (w) => { const f = Array.from(w)[0] || ''; return f.toUpperCase() + w.slice(f.length); };

  class Hunspell {
    constructor(affText, dicText) {
      this.cfg = { flag: 'char', tryChars: '', rep: [], map: [], iconv: [], breaks: null, fullstrip: false, needaffix: null, forbidden: null, keepcase: null, nosuggest: null, onlyincompound: null };
      this.pfx = []; this.sfx = [];
      this.parseAff(affText);
      this.dic = new Map();
      this.parseDic(dicText);
      this.index();
      this.cache = new Map();
    }

    parseAff(text) {
      const c = this.cfg;
      const lines = text.split(/\r?\n/);
      const tail = (t) => t.slice(1).join(' ');
      let curr = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line[0] === '#') continue;
        const t = line.split(/\s+/);
        switch (t[0]) {
          case 'FLAG': c.flag = t[1] === 'long' ? 'long' : t[1] === 'num' ? 'num' : 'char'; break;
          case 'TRY': c.tryChars = t[1] || ''; break;
          case 'NEEDAFFIX': case 'PSEUDOROOT': c.needaffix = t[1]; break;
          case 'FORBIDDENWORD': c.forbidden = t[1]; break;
          case 'KEEPCASE': c.keepcase = t[1]; break;
          case 'NOSUGGEST': c.nosuggest = t[1]; break;
          case 'ONLYINCOMPOUND': c.onlyincompound = t[1]; break;
          case 'FULLSTRIP': c.fullstrip = true; break;
          case 'REP': if (t.length >= 3) c.rep.push([t[1], t[2].replace(/_/g, ' ')]); break;
          case 'MAP': if (t.length === 2 && !/^\d+$/.test(t[1])) c.map.push(Array.from(t[1])); break;
          case 'ICONV': if (t.length >= 3) c.iconv.push([t[1], t[2]]); break;
          case 'BREAK': if (t.length === 2 && !/^\d+$/.test(t[1])) (c.breaks = c.breaks || []).push(t[1]); else if (t[1] === '0') c.breaks = []; break;
          case 'PFX': case 'SFX': {
            const isPfx = t[0] === 'PFX';
            if (t.length === 4 && (t[2] === 'Y' || t[2] === 'N') && /^\d+$/.test(t[3])) { curr = { flag: t[1], cross: t[2] === 'Y' }; break; }
            if (t.length < 4 || !curr) break;
            let add = t[3];
            let cont = NONE;
            const slash = add.indexOf('/');
            if (slash >= 0) { cont = parseFlags(add.slice(slash + 1), c.flag); add = add.slice(0, slash); }
            if (add === '0') add = '';
            const rule = {
              flag: t[1], cross: curr.cross, strip: t[2] === '0' ? '' : t[2], add, cont: new Set(cont),
              cond: condRegex(t[4], !isPfx), pfx: isPfx,
            };
            (isPfx ? this.pfx : this.sfx).push(rule);
            break;
          }
          default: break;
        }
        void tail;
      }
    }

    parseDic(text) {
      const lines = text.split(/\r?\n/);
      const flagType = this.cfg.flag;
      for (let i = 1; i < lines.length; i++) {   // la première ligne est le nombre d'entrées
        const line = lines[i];
        if (!line || line[0] === '#' || line[0] === '\t') continue;
        const sp = line.search(/[ \t]/);
        let entry = sp < 0 ? line : line.slice(0, sp);
        let word = entry, flags = NONE;
        let s = -1;
        for (let k = 0; k < entry.length; k++) { if (entry[k] === '/' && entry[k - 1] !== '\\') { s = k; break; } }
        if (s >= 0) { word = entry.slice(0, s); flags = parseFlags(entry.slice(s + 1), flagType); }
        word = word.replace(/\\\//g, '/');
        if (!word) continue;
        const prev = this.dic.get(word);
        if (prev) prev.push(flags); else this.dic.set(word, [flags]);
      }
    }

    index() {
      // Règles rangées par partie ajoutée complète : on teste les longueurs possibles (1..max) plutôt que chaque règle.
      const byAddS = new Map(), byAddP = new Map();
      this.sfxEmpty = []; this.pfxEmpty = [];
      this.maxSfx = 0; this.maxPfx = 0;
      for (const r of this.sfx) {
        if (!r.add) { this.sfxEmpty.push(r); continue; }
        (byAddS.get(r.add) || byAddS.set(r.add, []).get(r.add)).push(r);
        if (r.add.length > this.maxSfx) this.maxSfx = r.add.length;
      }
      for (const r of this.pfx) {
        if (!r.add) { this.pfxEmpty.push(r); continue; }
        (byAddP.get(r.add) || byAddP.set(r.add, []).get(r.add)).push(r);
        if (r.add.length > this.maxPfx) this.maxPfx = r.add.length;
      }
      this.sfxByAdd = byAddS; this.pfxByAdd = byAddP;
    }

    // ----- Recherche d'une forme (sans gestion de la casse) -----
    /** Y a-t-il, pour ce radical, une entrée acceptable avec les affixes de ces chaînes ? */
    stemOk(stem, sChain, pChain, relaxed, forSuggest) {
      const entries = this.dic.get(stem);
      if (!entries) return false;
      const c = this.cfg;
      const affixed = sChain.length + pChain.length > 0;
      const s1 = sChain.length ? sChain[sChain.length - 1] : null;   // suffixe le plus proche du radical
      const p1 = pChain.length ? pChain[pChain.length - 1] : null;
      for (const flags of entries) {
        if (c.forbidden && flags.includes(c.forbidden)) return false;
        if (c.onlyincompound && flags.includes(c.onlyincompound)) continue;
        if (c.needaffix && !affixed && flags.includes(c.needaffix)) continue;
        if (relaxed && c.keepcase && flags.includes(c.keepcase)) continue;
        if (forSuggest && c.nosuggest && flags.includes(c.nosuggest)) continue;
        if (s1 && !(flags.includes(s1.flag) || (p1 && p1.cont.has(s1.flag)))) continue;
        if (p1 && !(flags.includes(p1.flag) || (s1 && s1.cont.has(p1.flag)))) continue;
        return true;
      }
      return false;
    }

    /** Défait les suffixes (jusqu'à 2) puis les préfixes (jusqu'à 2) ; sChain/pChain : du plus extérieur au plus intérieur. */
    search(w, sChain, pChain, relaxed, forSuggest) {
      if (this.stemOk(w, sChain, pChain, relaxed, forSuggest) && this.chainsOk(sChain, pChain)) return true;
      // préfixes (couche la plus extérieure : on les défait avant les suffixes)
      if (pChain.length < 2 && sChain.length === 0) {
        const outer = pChain.length ? pChain[pChain.length - 1] : null;
        const lists = [this.pfxEmpty];
        for (let k = Math.min(this.maxPfx, w.length); k >= 1; k--) { const l = this.pfxByAdd.get(w.slice(0, k)); if (l) lists.push(l); }
        for (const list of lists) {
          for (const r of list) {
            if (outer && !r.cont.has(outer.flag)) continue;
            const stem = r.strip + w.slice(r.add.length);
            if (!stem.length && !this.cfg.fullstrip) continue;
            if (r.cond && !r.cond.test(stem)) continue;
            if (this.search(stem, sChain, pChain.concat([r]), relaxed, forSuggest)) return true;
          }
        }
      }
      // suffixes
      if (sChain.length < 2) {
        const outer = sChain.length ? sChain[sChain.length - 1] : null;
        const lists = [this.sfxEmpty];
        for (let k = Math.min(this.maxSfx, w.length); k >= 1; k--) { const l = this.sfxByAdd.get(w.slice(w.length - k)); if (l) lists.push(l); }
        for (const list of lists) {
          for (const r of list) {
            if (outer && !r.cont.has(outer.flag)) continue;
            if (pChain.length && !r.cross) continue;
            const stem = w.slice(0, w.length - r.add.length) + r.strip;
            if (!stem.length && !this.cfg.fullstrip) continue;
            if (r.cond && !r.cond.test(stem)) continue;
            if (this.search(stem, sChain.concat([r]), pChain, relaxed, forSuggest)) return true;
          }
        }
      }
      return false;
    }

    /** Les couches extérieures doivent être permises par la « suite » de la couche intérieure. */
    chainsOk(sChain, pChain) {
      if (sChain.length === 2 && !sChain[1].cont.has(sChain[0].flag)) return false;
      if (pChain.length === 2 && !pChain[1].cont.has(pChain[0].flag)) return false;
      if (sChain.length && pChain.length && !(sChain.every((r) => r.cross) && pChain.every((r) => r.cross))) return false;
      return true;
    }

    form(w, relaxed, forSuggest) {
      const entries = this.dic.get(w);
      if (entries && this.cfg.forbidden && entries.some((f) => f.includes(this.cfg.forbidden))) return false;
      return this.search(w, NONE, NONE, relaxed, forSuggest);
    }

    /** Mot tout en majuscules qui correspond à une entrée du dictionnaire écrite autrement (ex. SAINT-EXUPÉRY). */
    upperHas(w) {
      if (!this.upper) { this.upper = new Set(); for (const k of this.dic.keys()) if (k !== k.toLowerCase()) this.upper.add(k.toUpperCase()); }
      return this.upper.has(w);
    }

    iconv(w) {
      w = w.normalize('NFC');
      for (const [from, to] of this.cfg.iconv) if (w.includes(from) && from !== to) w = w.split(from).join(to);
      return w;
    }

    /** Un mot (sans espace) est-il correct ? */
    spell(raw) {
      const key = raw;
      const hit = this.cache.get(key);
      if (hit !== undefined) return hit;
      const r = this.spellUncached(this.iconv(raw), 0);
      if (this.cache.size > 60000) this.cache.clear();
      this.cache.set(key, r);
      return r;
    }

    caseForms(w, forSuggest) {
      switch (caseType(w)) {
        case 'lower': return this.form(w, false, forSuggest);
        case 'init': return this.form(w, false, forSuggest) || this.form(w.toLowerCase(), true, forSuggest);
        case 'all': return this.form(w, false, forSuggest) || this.form(capitalize(w.toLowerCase()), true, forSuggest) || this.form(w.toLowerCase(), true, forSuggest) || this.upperHas(w);
        default: return this.form(w, false, forSuggest);
      }
    }

    spellUncached(w, depth, forSuggest) {
      if (!w || !/\p{L}/u.test(w) || /\d/.test(w)) return true;
      if (this.caseForms(w, forSuggest)) return true;
      if (depth > 1) return false;
      const brk = this.cfg.breaks || ['-', '^-', '-$'];
      // BREAK : on retire les apostrophes/guillemets de bord, puis on découpe aux tirets, points, etc.
      let trimmed = w;
      if (brk.includes('^\'') || brk.includes('^‘')) trimmed = trimmed.replace(/^['‘]+/, '');
      if (brk.includes('\'$') || brk.includes('’$')) trimmed = trimmed.replace(/['’]+$/, '');
      if (trimmed !== w) return trimmed ? this.spellUncached(trimmed, depth + 1, forSuggest) : true;
      const seps = brk.filter((b) => b.length === 1);
      if (seps.length) {
        const re = new RegExp('[' + seps.map((x) => x.replace(/[\]\\^-]/g, '\\$&')).join('') + ']+');
        if (re.test(w)) {
          const parts = w.split(re).filter(Boolean);
          return parts.length > 0 && parts.every((p) => this.spellUncached(p, depth + 1, forSuggest));
        }
      }
      return false;
    }

    // ----- Suggestions -----
    suggest(raw, max = 5) {
      const w0 = this.iconv(String(raw));
      if (!w0) return [];
      const type = caseType(w0);
      const lw = type === 'mixed' ? w0 : w0.toLowerCase();
      const scored = new Map();
      const add = (cand, score) => {
        if (!cand || cand === lw || cand === w0) return;
        const old = scored.get(cand);
        if (old === undefined || score < old) scored.set(cand, score);
      };
      const memo = new Map();
      const fix = (x) => (type === 'init' ? capitalize(x) : type === 'all' ? x.toUpperCase() : x);
      const ok = (cand) => {
        let v = memo.get(cand);
        if (v === undefined) { v = this.spellUncached(fix(cand), 0, true); memo.set(cand, v); }
        return v;
      };
      const c = this.cfg;
      const alphabet = Array.from(new Set(Array.from((c.tryChars || '') + "'-"))).filter((ch) => type === 'mixed' || ch === ch.toLowerCase());
      const accentGroups = new Map();
      for (const g of c.map) for (const ch of g) accentGroups.set(ch, g);

      // 1. Table de remplacements usuels (REP)
      for (const [from0, to] of c.rep) {
        let from = from0, atStart = false, atEnd = false;
        if (from[0] === '^') { atStart = true; from = from.slice(1); }
        if (from.endsWith('$')) { atEnd = true; from = from.slice(0, -1); }
        if (!from) continue;
        let i = -1;
        while ((i = lw.indexOf(from, i + 1)) >= 0) {
          if (atStart && i !== 0) break;
          if (atEnd && i + from.length !== lw.length) continue;
          const cand = lw.slice(0, i) + to + lw.slice(i + from.length);
          if (cand !== lw && ok(cand)) add(cand, 1);
        }
      }
      // 2. Accents : toutes les combinaisons (3 changements au plus)
      const chars = Array.from(lw);
      const variants = (ch) => (accentGroups.get(ch) || [ch]).filter((v) => v === v.toLowerCase());
      const accentPos = chars.map((ch, i) => (variants(ch).length > 1 ? i : -1)).filter((i) => i >= 0);
      let budget = 700;
      const accentSearch = (start, changes, cur) => {
        if (budget <= 0) return;
        if (changes > 0 && changes <= 3) { budget--; const cand = cur.join(''); if (ok(cand)) add(cand, 0.5 + changes * 0.1); }
        if (changes === 3) return;
        for (let k = start; k < accentPos.length; k++) {
          const p = accentPos[k];
          const orig = cur[p];
          for (const v of variants(orig)) {
            if (v === orig) continue;
            cur[p] = v;
            accentSearch(k + 1, changes + 1, cur);
            cur[p] = orig;
          }
        }
      };
      if (accentPos.length) accentSearch(0, 0, chars.slice());
      // 3. Une seule faute : lettre en trop, manquante, différente, deux lettres inversées, mot coupé en deux
      const n = chars.length;
      for (let i = 0; i < n; i++) {
        const del = chars.slice(0, i).concat(chars.slice(i + 1)).join('');
        if (del && ok(del)) add(del, 2);
      }
      for (let i = 0; i + 1 < n; i++) {
        const t = chars.slice(); [t[i], t[i + 1]] = [t[i + 1], t[i]];
        const cand = t.join('');
        if (ok(cand)) add(cand, 1.5);
      }
      for (let i = 0; i <= n; i++) {
        for (const a of alphabet) {
          const ins = chars.slice(0, i).join('') + a + chars.slice(i).join('');
          if (ok(ins)) add(ins, a === "'" ? 1.8 : a === '-' ? 3.4 : 2.5);
        }
      }
      for (let i = 0; i < n; i++) {
        const grp = accentGroups.get(chars[i]);
        for (const a of alphabet) {
          if (a === chars[i] || a === "'" || a === '-') continue;
          const rep = chars.slice(0, i).join('') + a + chars.slice(i + 1).join('');
          if (ok(rep)) add(rep, grp && grp.includes(a) ? 1 : 3);
        }
      }
      for (let i = 2; i < n - 1; i++) {
        const l = lw.slice(0, i), r = lw.slice(i);
        if (ok(l) && ok(r)) add(l + ' ' + r, 2.2);
      }
      // 4. Faute plus grosse : radicaux du dictionnaire à deux modifications au plus
      if (scored.size < 4 && lw.length >= 3) {
        const lens = lw.length;
        for (const [stem, entries] of this.dic) {
          if (stem.length < lens - 2 || stem.length > lens + 2) continue;
          if (type !== 'mixed' && stem !== stem.toLowerCase()) continue;
          const d = this.distance(lw, stem, 2);
          if (d > 2) continue;
          if (entries.every((f) => (c.nosuggest && f.includes(c.nosuggest)) || (c.forbidden && f.includes(c.forbidden)) || (c.needaffix && f.includes(c.needaffix)) || (c.onlyincompound && f.includes(c.onlyincompound)))) continue;
          add(stem, 4.5 + d * 0.5);
        }
      }
      // Classement : meilleure note d'abord, puis ressemblance du début et de la fin, puis ordre alphabétique
      const common = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; let j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++; return i + j; };
      const out = Array.from(scored.entries()).sort((x, y) => (x[1] - y[1]) || (common(lw, y[0]) - common(lw, x[0])) || (Math.abs(x[0].length - lw.length) - Math.abs(y[0].length - lw.length)) || (x[0] < y[0] ? -1 : 1)).map((e) => e[0]);
      return Array.from(new Set(out.map(fix))).slice(0, max);
    }

    /** Distance de Damerau-Levenshtein bornée (renvoie max+1 au-delà). */
    distance(a, b, max) {
      const la = a.length, lb = b.length;
      if (Math.abs(la - lb) > max) return max + 1;
      let prev2 = null, prev = Array.from({ length: lb + 1 }, (_, j) => j);
      for (let i = 1; i <= la; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= lb; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
          if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
          cur[j] = v;
          if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prev2 = prev; prev = cur;
      }
      return prev[lb];
    }
  }

  root.PlumeHunspell = { Hunspell, caseType };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PlumeHunspell;
})(typeof window !== 'undefined' ? window : globalThis);
