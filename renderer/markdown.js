/* Plume — export Markdown (GitHub Flavored Markdown).
   Entrée : l'élément de l'éditeur. Sortie : { md, images } ; les images (données intégrées) sont extraites dans des
   fichiers « image-N.ext » et référencées par le jeton {{IMAGES}}, remplacé par le processus principal au moment
   d'écrire le dossier à côté du fichier .md. */
(function (root) {
  'use strict';

  const ALERT = { info: 'NOTE', tip: 'TIP', warn: 'WARNING', danger: 'IMPORTANT' };
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'BLOCKQUOTE', 'PRE']);
  const EXT = { png: 'png', jpeg: 'jpg', jpg: 'jpg', gif: 'gif', webp: 'webp' };

  const escText = (s) => s.replace(/([\\`*_[\]<>|~])/g, '\\$1');
  const trimBreaks = (s) => s.replace(/(\\\n)+$/, '').replace(/^(\\\n)+/, '').trim();
  const urlOf = (u) => String(u).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  const isNoExport = (el) => el.classList && el.classList.contains('noexport');

  /** Même algorithme que GitHub pour les ancres de titres (minuscules, ponctuation retirée, doublons suffixés). */
  function slugs(rootEl) {
    const seen = {};
    const map = new Map();
    for (const h of rootEl.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (h.closest('.toc')) continue;
      const base = h.textContent.replace(/\u00a0/g, ' ').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
      const n = seen[base] || 0;
      seen[base] = n + 1;
      map.set(h, n ? base + '-' + n : base);
    }
    return map;
  }

  function build(rootEl) {
    const images = [];
    const slugOf = slugs(rootEl);
    const tocHeads = Array.from(rootEl.querySelectorAll('h1, h2, h3')).filter((n) => !n.closest('.toc') && n.textContent.trim());

    function wrap(marker, inner) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
      return m[2] ? m[1] + marker + m[2] + marker + m[3] : inner;
    }

    function image(el) {
      const src = el.getAttribute('src') || '';
      const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(src);
      if (!m) return '';
      const name = 'image-' + (images.length + 1) + '.' + EXT[m[1].toLowerCase()];
      images.push({ name, b64: m[2] });
      return `![${escText(el.getAttribute('alt') || 'Image')}]({{IMAGES}}/${name})`;
    }

    function chip(el) {
      const d = el.dataset;
      const text = el.textContent.replace(/\u00a0/g, ' ');
      switch (d.type) {
        case 'person': return d.email ? `[${escText(text)}](mailto:${urlOf(d.email)})` : escText(text);
        case 'link': case 'place': return d.href ? `[${escText(text)}](${urlOf(d.href)})` : escText(text);
        case 'status': return '`' + text + '`';
        default: return escText(text);
      }
    }

    function inlineEl(el) {
      if (isNoExport(el)) return '';
      const tag = el.tagName;
      if (tag === 'BR') return '\\\n';
      if (tag === 'IMG') return image(el);
      if (tag === 'INPUT' || tag === 'BUTTON') return '';
      if (el.classList.contains('chip')) return chip(el);
      if (tag === 'DEL' || el.classList.contains('sg-del')) return wrap('~~', inline(el.childNodes));   // suggestion de suppression en attente : texte barré
      const inner = () => inline(el.childNodes);
      if (tag === 'B' || tag === 'STRONG') return wrap('**', inner());
      if (tag === 'I' || tag === 'EM') return wrap('*', inner());
      if (tag === 'S' || tag === 'STRIKE') return wrap('~~', inner());
      if (tag === 'U') { const t = inner(); return t.trim() ? `<u>${t}</u>` : t; }
      if (tag === 'SUB' || tag === 'SUP') { const t = inner(); return t.trim() ? `<${tag.toLowerCase()}>${t}</${tag.toLowerCase()}>` : t; }
      if (tag === 'CODE') { const t = el.textContent; return t ? '`' + t.replace(/`/g, "'") + '`' : ''; }
      if (tag === 'A') {
        const href = el.getAttribute('href');
        const t = inner();
        return href && t.trim() ? `[${t}](${urlOf(href)})` : t;
      }
      let t = inner();
      if (tag === 'SPAN' || tag === 'FONT') {
        const st = el.style || {};
        if (/^(bold|[6-9]00)$/.test(st.fontWeight || '')) t = wrap('**', t);
        if ((st.fontStyle || '') === 'italic') t = wrap('*', t);
        if (/line-through/.test(st.textDecorationLine || st.textDecoration || '')) t = wrap('~~', t);
      }
      if (BLOCK.has(tag)) t = t.replace(/(\\\n)+$/, '') + ' '; // bloc glissé dans un contexte en ligne : on garde les mots séparés
      return t;
    }

    function inline(nodes) {
      let out = '';
      for (const n of Array.from(nodes)) {
        if (n.nodeType === 3) out += escText(n.nodeValue.replace(/\u00a0/g, ' ').replace(/\s*\n\s*/g, ' '));
        else if (n.nodeType === 1) out += inlineEl(n);
      }
      return out;
    }

    /** Évite qu'un paragraphe ordinaire soit pris pour un titre, une liste ou une citation. */
    const safeStart = (t) => t.replace(/^(#{1,6})(\s)/, '\\$1$2').replace(/^([-+])(\s)/, '\\$1$2').replace(/^(\d+)([.)])(\s)/, '$1\\$2$3').replace(/^(={2,}|-{3,})\s*$/, '\\$1');

    function list(el) {
      const ordered = el.tagName === 'OL';
      const check = el.classList.contains('checklist');
      let n = parseInt(el.getAttribute('start') || '1', 10) || 1;
      const lines = [];
      for (const li of Array.from(el.children)) {
        if (li.tagName !== 'LI') continue;
        const marker = ordered ? (n++) + '.' : '-';
        const pad = ' '.repeat(marker.length + 1);
        const buf = [], nested = [];
        for (const c of Array.from(li.childNodes)) {
          if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) nested.push(c); else buf.push(c);
        }
        let task = '';
        if (check) {
          const cb = li.querySelector(':scope > input[type="checkbox"]');
          task = cb && (cb.checked || cb.hasAttribute('checked')) ? '[x] ' : '[ ] ';
        }
        const text = trimBreaks(inline(buf)).replace(/\n/g, '\n' + pad);
        lines.push(marker + ' ' + task + text);
        for (const nl of nested) lines.push(list(nl).split('\n').map((l) => pad + l).join('\n'));
      }
      return lines.join('\n');
    }

    function table(el) {
      const rows = Array.from(el.rows || []).map((r) => Array.from(r.cells).flatMap((c) => {
        const t = trimBreaks(inline(c.childNodes)).replace(/\\\n/g, '<br>').replace(/\n/g, '<br>');
        return [t].concat(Array(Math.max(1, c.colSpan || 1) - 1).fill(''));
      }));
      if (!rows.length) return '';
      const cols = Math.max(...rows.map((r) => r.length), 1);
      rows.forEach((r) => { while (r.length < cols) r.push(''); });
      const line = (r) => '| ' + r.join(' | ') + ' |';
      return [line(rows[0]), '| ' + Array(cols).fill('---').join(' | ') + ' |'].concat(rows.slice(1).map(line)).join('\n');
    }

    const quote = (text) => text.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n');

    function callout(el) {
      const kind = Object.keys(ALERT).find((k) => el.classList.contains('callout-' + k)) || 'info';
      return quote('[!' + ALERT[kind] + ']\n' + blocks(el).join('\n\n'));
    }

    function toc(el) {
      const lines = Array.from(el.querySelectorAll('.toc-item')).map((it) => {
        const lvl = +((/lvl([1-3])/.exec(it.className) || [0, 1])[1]);
        const h = tocHeads[+it.dataset.h];
        const slug = h ? slugOf.get(h) : '';
        const text = escText(it.textContent.trim());
        return '  '.repeat(lvl - 1) + '- ' + (slug ? `[${text}](#${urlOf(slug)})` : text);
      });
      return ('**' + ((el.querySelector('.toc-title') || {}).textContent || 'Sommaire').trim() + '**' + (lines.length ? '\n\n' + lines.join('\n') : ''));
    }

    function blocks(parent) {
      const out = [];
      let buf = [];
      const flush = () => {
        if (buf.length) {
          const t = safeStart(trimBreaks(inline(buf)));
          if (t) out.push(t);
        }
        buf = [];
      };
      for (const c of Array.from(parent.childNodes)) {
        if (c.nodeType !== 1) { buf.push(c); continue; }
        if (isNoExport(c)) continue;
        const tag = c.tagName;
        if (c.classList.contains('pagebreak')) { flush(); out.push('<!-- saut de page -->'); }
        else if (c.classList.contains('callout')) { flush(); out.push(callout(c)); }
        else if (c.classList.contains('toc')) { flush(); out.push(toc(c)); }
        else if (/^H[1-6]$/.test(tag)) {
          flush();
          const t = trimBreaks(inline(c.childNodes)).replace(/\\\n/g, ' ');
          if (t) out.push('#'.repeat(+tag[1]) + ' ' + t);
        } else if (tag === 'P') { buf.push(c); flush(); }
        else if (tag === 'UL' || tag === 'OL') { flush(); const t = list(c); if (t) out.push(t); }
        else if (tag === 'TABLE') { flush(); const t = table(c); if (t) out.push(t); }
        else if (tag === 'HR') { flush(); out.push('---'); }
        else if (tag === 'BLOCKQUOTE') { flush(); const t = blocks(c).join('\n\n'); if (t) out.push(quote(t)); }
        else if (tag === 'PRE') { flush(); out.push('```\n' + c.textContent.replace(/\n$/, '') + '\n```'); }
        else if (tag === 'DIV' && Array.from(c.children).some((k) => BLOCK.has(k.tagName) || k.classList.contains('callout'))) { flush(); out.push(...blocks(c)); }
        else if (tag === 'DIV') { buf.push(c); flush(); }
        else buf.push(c);
      }
      flush();
      return out;
    }

    const md = blocks(rootEl).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    return { md: md ? md + '\n' : '', images };
  }

  root.PlumeMd = { build };
})(typeof window !== 'undefined' ? window : globalThis);
