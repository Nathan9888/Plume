/* Plume — générateur .docx natif (aucune dépendance).
 * Convertit le DOM de l'éditeur en Office Open XML et l'emballe dans un zip « stocké ».
 * Prend en charge : titres, mise en forme, listes (numérotées, à puces, de tâches), tableaux,
 * images (PNG/JPEG/GIF), liens, commentaires Word, suggestions (révisions Word), sauts de page. */
(function (root) {
  'use strict';

  const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE']);
  const enc = new TextEncoder();

  // ---------- Utilitaires ----------
  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isoNoMs(d) {
    const x = d ? new Date(d) : new Date();
    return (isNaN(x) ? new Date() : x).toISOString().replace(/\.\d+Z$/, 'Z');
  }

  function parseColor(c) {
    if (!c) return null;
    c = String(c).trim().toLowerCase();
    let m = /^#([0-9a-f]{6})$/.exec(c);
    if (m) return m[1].toUpperCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
    if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(c);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
      return [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    return null;
  }

  function halfPoints(size) {
    const m = /^([\d.]+)(pt|px)$/.exec(String(size || '').trim());
    if (!m) return null;
    const v = parseFloat(m[1]);
    return Math.max(2, Math.round(m[2] === 'pt' ? v * 2 : v * 1.5));
  }

  function firstFont(f) {
    if (!f) return null;
    const first = String(f).split(',')[0].replace(/["']/g, '').trim();
    return first || null;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---------- Zip (méthode « stored ») ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const entries = files.map((f) => {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      return { name, data, crc: crc32(data), offset: 0 };
    });
    let size = 22;
    for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    let p = 0;
    for (const e of entries) {
      e.offset = p;
      dv.setUint32(p, 0x04034b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 0x0800, true);
      dv.setUint16(p + 8, 0, true); dv.setUint16(p + 10, dosTime, true); dv.setUint16(p + 12, dosDate, true);
      dv.setUint32(p + 14, e.crc, true); dv.setUint32(p + 18, e.data.length, true); dv.setUint32(p + 22, e.data.length, true);
      dv.setUint16(p + 26, e.name.length, true); dv.setUint16(p + 28, 0, true);
      out.set(e.name, p + 30); out.set(e.data, p + 30 + e.name.length);
      p += 30 + e.name.length + e.data.length;
    }
    const cdStart = p;
    for (const e of entries) {
      dv.setUint32(p, 0x02014b50, true); dv.setUint16(p + 4, 20, true); dv.setUint16(p + 6, 20, true);
      dv.setUint16(p + 8, 0x0800, true); dv.setUint16(p + 10, 0, true); dv.setUint16(p + 12, dosTime, true);
      dv.setUint16(p + 14, dosDate, true); dv.setUint32(p + 16, e.crc, true);
      dv.setUint32(p + 20, e.data.length, true); dv.setUint32(p + 24, e.data.length, true);
      dv.setUint16(p + 28, e.name.length, true); dv.setUint16(p + 30, 0, true); dv.setUint16(p + 32, 0, true);
      dv.setUint16(p + 34, 0, true); dv.setUint16(p + 36, 0, true); dv.setUint32(p + 38, 0, true);
      dv.setUint32(p + 42, e.offset, true);
      out.set(e.name, p + 46);
      p += 46 + e.name.length;
    }
    dv.setUint32(p, 0x06054b50, true); dv.setUint16(p + 4, 0, true); dv.setUint16(p + 6, 0, true);
    dv.setUint16(p + 8, entries.length, true); dv.setUint16(p + 10, entries.length, true);
    dv.setUint32(p + 12, p - cdStart, true); dv.setUint32(p + 16, cdStart, true); dv.setUint16(p + 20, 0, true);
    return out;
  }

  // ---------- Propriétés de texte ----------
  function mergeRpr(base, el) {
    const r = Object.assign({}, base);
    const t = el.tagName.toLowerCase();
    if (t === 'b' || t === 'strong') r.b = true;
    if (t === 'i' || t === 'em') r.i = true;
    if (t === 'u') r.u = true;
    if (t === 's' || t === 'strike') r.strike = true;
    if (t === 'sup') r.vert = 'superscript';
    if (t === 'sub') r.vert = 'subscript';
    if (t === 'code' || t === 'pre') r.font = 'Consolas';
    if (t === 'a') { r.color = '0563C1'; r.u = true; }
    if (t === 'font') {
      const c = parseColor(el.getAttribute('color')); if (c) r.color = c;
      const f = firstFont(el.getAttribute('face')); if (f) r.font = f;
      const sz = parseInt(el.getAttribute('size'), 10);
      if (sz >= 1 && sz <= 7) r.sz = [16, 20, 24, 28, 36, 48, 72][sz - 1];
    }
    const s = el.style;
    if (s) {
      if (s.fontWeight === 'bold' || parseInt(s.fontWeight, 10) >= 600) r.b = true;
      if (s.fontStyle === 'italic') r.i = true;
      const deco = (s.textDecorationLine || s.textDecoration || '');
      if (deco.includes('underline')) r.u = true;
      if (deco.includes('line-through')) r.strike = true;
      const c = parseColor(s.color); if (c) r.color = c;
      const bg = parseColor(s.backgroundColor); if (bg) r.shd = bg;
      const hs = halfPoints(s.fontSize); if (hs) r.sz = hs;
      const f = firstFont(s.fontFamily); if (f) r.font = f;
    }
    return r;
  }

  function rprXml(r) {
    let x = '';
    if (r.font) x += `<w:rFonts w:ascii="${esc(r.font)}" w:hAnsi="${esc(r.font)}" w:cs="${esc(r.font)}"/>`;
    if (r.b) x += '<w:b/><w:bCs/>';
    if (r.i) x += '<w:i/><w:iCs/>';
    if (r.strike) x += '<w:strike/>';
    if (r.color) x += `<w:color w:val="${r.color}"/>`;
    if (r.sz) x += `<w:sz w:val="${r.sz}"/><w:szCs w:val="${r.sz}"/>`;
    if (r.u) x += '<w:u w:val="single"/>';
    if (r.shd) x += `<w:shd w:val="clear" w:color="auto" w:fill="${r.shd}"/>`;
    if (r.vert) x += `<w:vertAlign w:val="${r.vert}"/>`;
    return x ? `<w:rPr>${x}</w:rPr>` : '';
  }

  // ---------- Conversion DOM -> XML ----------
  function makeCtx(opts) {
    const ctx = {
      author: opts.author || 'Auteur',
      date: isoNoMs(),
      rels: [],        // {id, type, target, external}
      media: [],       // {name, data}
      nums: [],        // identifiants de listes numérotées
      revId: 100,
      docPr: 1,
      del: false,
      hasRevisions: false,
      cmtNum: {},      // id éditeur -> id Word
      cmtTotal: {},
      cmtSeen: {},
    };
    ctx.addRel = (type, target, external) => {
      const id = 'rId' + (10 + ctx.rels.length);
      ctx.rels.push({ id, type, target, external });
      return id;
    };
    ctx.newNum = () => { const id = 2 + ctx.nums.length; ctx.nums.push(id); return id; };
    return ctx;
  }

  function hasContent(nodes) {
    return nodes.some((n) => n.nodeType === 1 || (n.nodeType === 3 && /\S/.test(n.nodeValue.replace(/​/g, ''))));
  }

  function textRun(text, r, ctx) {
    const tag = ctx.del ? 'w:delText' : 'w:t';
    const parts = text.split('\n');
    let out = '';
    parts.forEach((part, i) => {
      if (i > 0) out += `<w:r>${rprXml(r)}<w:br/></w:r>`;
      if (part) out += `<w:r>${rprXml(r)}<${tag} xml:space="preserve">${esc(part)}</${tag}></w:r>`;
    });
    return out;
  }

  function inline(nodes, r, ctx, pre) {
    let out = '';
    for (const n of Array.from(nodes)) {
      if (n.nodeType === 3) {
        let t = n.nodeValue.replace(/​/g, '');
        if (!pre) t = t.replace(/[\r\n]+/g, ' ');
        if (t) out += textRun(t, r, ctx);
      } else if (n.nodeType === 1) {
        out += inlineEl(n, r, ctx, pre);
      }
    }
    return out;
  }

  function imageRun(img, ctx) {
    const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(img.getAttribute('src') || '');
    if (!m) return textRun('[image non exportée]', {}, ctx);
    const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    const bytes = b64ToBytes(m[2]);
    const name = `image${ctx.media.length + 1}.${ext === 'jpeg' ? 'jpg' : ext}`;
    ctx.media.push({ name: 'word/media/' + name, data: bytes });
    const rid = ctx.addRel(NS_R + '/image', 'media/' + name);
    let w = parseFloat(img.style.width) || parseFloat(img.getAttribute('width')) || img.naturalWidth || 300;
    let h = parseFloat(img.style.height) || parseFloat(img.getAttribute('height')) || img.naturalHeight || w * 0.6;
    if (w > 624) { h = (h * 624) / w; w = 624; }
    const cx = Math.round(w * 9525), cy = Math.round(h * 9525);
    const id = ctx.docPr++;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  function hyperlink(href, inner, ctx) {
    if (!/^(https?:|mailto:)/i.test(href || '')) return inner;
    const rid = ctx.addRel(NS_R + '/hyperlink', href, true);
    return `<w:hyperlink r:id="${rid}" w:history="1">${inner}</w:hyperlink>`;
  }

  function inlineEl(n, r, ctx, pre) {
    const tag = n.tagName.toLowerCase();
    const cls = n.classList;
    if (cls.contains('noexport')) return '';
    if (tag === 'br') {
      // Le <br> final d'un bloc n'est qu'un marqueur de ligne vide dans l'éditeur
      const p = n.parentNode;
      const last = !n.nextSibling && p && (BLOCK_TAGS.has(p.tagName || '') || p.tagName === 'TD' || p.tagName === 'TH');
      return last ? '' : '<w:r><w:br/></w:r>';
    }
    if (tag === 'img') return imageRun(n, ctx);
    if (tag === 'input') return n.type === 'checkbox' ? textRun(n.checked || n.hasAttribute('checked') ? '☑ ' : '☐ ', r, ctx) : '';
    if (tag === 'script' || tag === 'style') return '';

    // Suggestions -> révisions Word
    if (tag === 'ins' && cls.contains('sg-ins')) {
      ctx.hasRevisions = true;
      const id = ctx.revId++;
      return `<w:ins w:id="${id}" w:author="${esc(n.dataset.author || ctx.author)}" w:date="${isoNoMs(n.dataset.date)}">${inline(n.childNodes, r, ctx, pre)}</w:ins>`;
    }
    if (tag === 'del' && cls.contains('sg-del')) {
      ctx.hasRevisions = true;
      const id = ctx.revId++;
      const prev = ctx.del; ctx.del = true;
      const inner = inline(n.childNodes, r, ctx, pre);
      ctx.del = prev;
      return `<w:del w:id="${id}" w:author="${esc(n.dataset.author || ctx.author)}" w:date="${isoNoMs(n.dataset.date)}">${inner}</w:del>`;
    }

    // Commentaires
    if (cls.contains('cmt') && n.dataset.cid) {
      const cid = n.dataset.cid;
      const inner = inline(n.childNodes, r, ctx, pre);
      const num = ctx.cmtNum[cid];
      if (num === undefined) return inner;
      ctx.cmtSeen[cid] = (ctx.cmtSeen[cid] || 0) + 1;
      const first = ctx.cmtSeen[cid] === 1;
      const lastOne = ctx.cmtSeen[cid] === ctx.cmtTotal[cid];
      return (first ? `<w:commentRangeStart w:id="${num}"/>` : '') + inner +
        (lastOne ? `<w:commentRangeEnd w:id="${num}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${num}"/></w:r>` : '');
    }

    // Puces intelligentes et variables
    if (cls.contains('chip')) {
      let text = (n.textContent || '').trim();
      if (n.dataset.type === 'person' && text && text[0] !== '@') text = '@' + text;
      const rr = Object.assign({}, r, { shd: 'E8EEF9' });
      const runs = textRun(text, rr, ctx);
      return n.dataset.href ? hyperlink(n.dataset.href, runs, ctx) : runs;
    }

    if (tag === 'a') {
      const inner = inline(n.childNodes, mergeRpr(r, n), ctx, pre);
      return hyperlink(n.getAttribute('href'), inner, ctx);
    }

    return inline(n.childNodes, mergeRpr(r, n), ctx, pre || tag === 'pre');
  }

  function para(inlineXml, o) {
    o = o || {};
    let p = '';
    if (o.style) p += `<w:pStyle w:val="${o.style}"/>`;
    if (o.numId !== undefined) p += `<w:numPr><w:ilvl w:val="${o.ilvl || 0}"/><w:numId w:val="${o.numId}"/></w:numPr>`;
    if (o.quote) p += '<w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="BDC1C6"/></w:pBdr>';
    if (o.ind) p += `<w:ind w:left="${o.ind}"/>`;
    if (o.align) p += `<w:jc w:val="${o.align}"/>`;
    return `<w:p>${p ? `<w:pPr>${p}</w:pPr>` : ''}${inlineXml}</w:p>`;
  }

  function alignOf(el) {
    const a = (el.style && el.style.textAlign) || el.getAttribute('align') || '';
    return { center: 'center', right: 'right', justify: 'both', left: 'left' }[a] || null;
  }

  function blockPara(el, ctx, o) {
    const tag = el.tagName.toLowerCase();
    const m = /^h([1-6])$/.exec(tag);
    const style = m ? 'Heading' + Math.min(3, +m[1]) : null;
    const base = Object.assign({}, o.rbase || {}, tag === 'pre' ? { font: 'Consolas' } : {});
    return para(inline(el.childNodes, mergeRpr(base, el), ctx, tag === 'pre'), {
      style, align: alignOf(el), ind: o.indent, quote: o.quote,
    });
  }

  function hasBlockChildren(el) {
    return Array.from(el.children).some((c) => BLOCK_TAGS.has(c.tagName) && !c.classList.contains('noexport'));
  }

  function list(el, ctx, o) {
    const ordered = el.tagName === 'OL';
    const check = el.classList.contains('checklist');
    const depth = o.depth || 0;
    const numId = check ? undefined : ordered ? ctx.newNum() : 1;
    let out = '';
    for (const li of Array.from(el.children)) {
      if (li.tagName !== 'LI') continue;
      let buf = [], first = true;
      const flush = () => {
        if (buf.length || first) {
          out += para(inline(buf, o.rbase || {}, ctx), {
            numId, ilvl: depth, ind: check ? 360 * (depth + 1) + (o.indent || 0) : o.indent, align: alignOf(li),
          });
        }
        first = false; buf = [];
      };
      for (const c of Array.from(li.childNodes)) {
        if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) {
          flush();
          out += list(c, ctx, Object.assign({}, o, { depth: depth + 1 }));
        } else buf.push(c);
      }
      if (buf.length && hasContent(buf)) flush();
      else if (first) flush();
    }
    return out;
  }

  function table(el, ctx, o) {
    const rows = Array.from(el.rows || []);
    if (!rows.length) return '';
    const spanOf = (c) => Math.max(1, c.colSpan || 1);
    const cols = Math.max(...rows.map((r) => Array.from(r.cells).reduce((s, c) => s + spanOf(c), 0)), 1);
    const total = 9360 - (o.indent || 0);
    const w = Math.floor(total / cols);
    const border = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`;
    let x = `<w:tbl><w:tblPr><w:tblW w:w="${w * cols}" w:type="dxa"/>${o.indent ? `<w:tblInd w:w="${o.indent}" w:type="dxa"/>` : ''}<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol w:w="' + w + '"/>'.repeat(cols)}</w:tblGrid>`;
    for (const row of rows) {
      x += '<w:tr>';
      for (const cell of Array.from(row.cells)) {
        const span = spanOf(cell);
        const th = cell.tagName === 'TH';
        const bg = parseColor(cell.style && cell.style.backgroundColor) || (th ? 'F1F3F4' : null);
        let inner = hasBlockChildren(cell)
          ? blocks(cell, ctx, { rbase: th ? { b: true } : {} })
          : para(inline(cell.childNodes, th ? { b: true } : {}, ctx), { align: alignOf(cell) });
        if (!inner || inner.endsWith('</w:tbl>')) inner += '<w:p/>';
        x += `<w:tc><w:tcPr><w:tcW w:w="${w * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
      }
      x += '</w:tr>';
    }
    return x + '</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
  }

  const CALLOUT_COLORS = { info: ['EAF3FF', '0A84FF'], tip: ['E9F8EE', '30A14E'], warn: ['FFF5E0', 'FF9F0A'], danger: ['FFECEA', 'FF453A'] };

  /** Encadré : tableau d'une cellule, fond teinté et filet coloré à gauche. */
  function callout(el, ctx, o) {
    const kind = Object.keys(CALLOUT_COLORS).find((k) => el.classList.contains('callout-' + k)) || 'info';
    const [fill, bar] = CALLOUT_COLORS[kind];
    const total = 9360 - (o.indent || 0);
    let inner = blocks(el, ctx, { rbase: o.rbase });
    if (!inner || inner.endsWith('</w:tbl>')) inner += '<w:p/>';
    const b = (n, c, sz) => `<w:${n} w:val="single" w:sz="${sz}" w:space="0" w:color="${c}"/>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${o.indent ? `<w:tblInd w:w="${o.indent}" w:type="dxa"/>` : ''}<w:tblBorders>${b('top', fill, 4)}${b('left', bar, 24)}${b('bottom', fill, 4)}${b('right', fill, 4)}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="180" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="180" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${total}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${total}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fill}"/></w:tcPr>${inner}</w:tc></w:tr></w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>`;
  }

  /** Sommaire : titre puis une ligne par titre du document, décalée selon le niveau (sans numéros de page). */
  function tocBlock(el, ctx, o) {
    const titleEl = el.querySelector('.toc-title');
    let out = para(inline([document.createTextNode((titleEl && titleEl.textContent.trim()) || 'Sommaire')], { b: true }, ctx), { ind: o.indent });
    for (const it of Array.from(el.querySelectorAll('.toc-item'))) {
      const lvl = +((/lvl([1-3])/.exec(it.className) || [0, 1])[1]);
      out += para(inline([document.createTextNode(it.textContent)], {}, ctx), { ind: (o.indent || 0) + (lvl - 1) * 360 });
    }
    return out;
  }

  function blocks(parent, ctx, o) {
    o = o || {};
    let out = '';
    let buf = [];
    const flush = () => {
      if (buf.length && hasContent(buf)) out += para(inline(buf, o.rbase || {}, ctx), { ind: o.indent, quote: o.quote });
      buf = [];
    };
    for (const c of Array.from(parent.childNodes)) {
      if (c.nodeType !== 1) { buf.push(c); continue; }
      const tag = c.tagName;
      if (c.classList.contains('noexport') || tag === 'SCRIPT' || tag === 'STYLE') continue;
      if (c.classList.contains('pagebreak')) { flush(); out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }
      else if (c.classList.contains('callout')) { flush(); out += callout(c, ctx, o); }
      else if (c.classList.contains('toc')) { flush(); out += tocBlock(c, ctx, o); }
      else if (tag === 'P' || /^H[1-6]$/.test(tag) || tag === 'PRE') { flush(); out += blockPara(c, ctx, o); }
      else if (tag === 'UL' || tag === 'OL') { flush(); out += list(c, ctx, o); }
      else if (tag === 'TABLE') { flush(); out += table(c, ctx, o); }
      else if (tag === 'HR') { flush(); out += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A0A0A0"/></w:pBdr></w:pPr></w:p>'; }
      else if (tag === 'BLOCKQUOTE') { flush(); out += blocks(c, ctx, Object.assign({}, o, { indent: (o.indent || 0) + 720, quote: true })); }
      else if (BLOCK_TAGS.has(tag)) {
        flush();
        out += hasBlockChildren(c) ? blocks(c, ctx, o) : blockPara(c, ctx, o);
      } else buf.push(c);
    }
    flush();
    return out;
  }

  // ---------- Parties du package ----------
  function stylesXml() {
    const head = (id, name, sz, before, after, outline) =>
      `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${outline}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="1F1F1F"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-CA" w:eastAsia="fr-CA" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      head('Heading1', 'heading 1', 40, 360, 120, 0) + head('Heading2', 'heading 2', 32, 280, 100, 1) + head('Heading3', 'heading 3', 26, 240, 80, 2) +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
      '</w:styles>';
  }

  function numberingXml(ctx) {
    const lvls = (kind) => {
      let x = '';
      for (let i = 0; i < 9; i++) {
        const left = 720 * (i + 1);
        if (kind === 'bullet') {
          const ch = ['•', '◦', '▪'][i % 3];
          x += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ch}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:hint="default"/></w:rPr></w:lvl>`;
        } else {
          const fmt = ['decimal', 'lowerLetter', 'lowerRoman'][i % 3];
          x += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
        }
      }
      return x;
    };
    let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${NS_W}">`;
    x += `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet')}</w:abstractNum>`;
    x += `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('decimal')}</w:abstractNum>`;
    x += '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    for (const id of ctx.nums) {
      x += `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
    }
    return x + '</w:numbering>';
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0] || '').join('').toUpperCase() || '?';
  }

  function commentsXml(comments, ctx) {
    let x = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${NS_W}">`;
    for (const c of comments) {
      const num = ctx.cmtNum[c.id];
      if (num === undefined) continue;
      const head = (c.resolved ? '[Résolu] ' : '') + (c.assignee ? `[Assigné à ${c.assignee}] ` : '');
      const p = (text, first) =>
        `<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${first ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
      let body = p(head + (c.text || ''), true);
      for (const rep of c.replies || []) body += p(`↳ ${rep.author || ''} : ${rep.text || ''}`, false);
      x += `<w:comment w:id="${num}" w:author="${esc(c.author || 'Auteur')}" w:date="${isoNoMs(c.date)}" w:initials="${esc(initials(c.author))}">${body}</w:comment>`;
    }
    return x + '</w:comments>';
  }

  // ---------- Point d'entrée ----------
  function build(rootEl, opts) {
    opts = opts || {};
    const ctx = makeCtx(opts);
    const comments = opts.comments || [];

    // Repérage des commentaires réellement ancrés dans le texte
    const known = new Set(comments.map((c) => String(c.id)));
    rootEl.querySelectorAll('[data-cid]').forEach((el) => {
      const id = el.dataset.cid;
      if (!known.has(id)) return;
      ctx.cmtTotal[id] = (ctx.cmtTotal[id] || 0) + 1;
    });
    let k = 0;
    comments.forEach((c) => { if (ctx.cmtTotal[c.id]) ctx.cmtNum[c.id] = k++; });
    const hasComments = k > 0;

    const body = blocks(rootEl, ctx, {}) || '<w:p/>';
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

    const relsFixed = [
      { id: 'rId1', type: NS_R + '/styles', target: 'styles.xml' },
      { id: 'rId2', type: NS_R + '/numbering', target: 'numbering.xml' },
      { id: 'rId3', type: NS_R + '/settings', target: 'settings.xml' },
    ];
    if (hasComments) relsFixed.push({ id: 'rId4', type: NS_R + '/comments', target: 'comments.xml' });
    const allRels = relsFixed.concat(ctx.rels);
    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${allRels
      .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${hasComments ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title || '')}</dc:title><dc:creator>${esc(ctx.author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${ctx.date}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${ctx.date}</dcterms:modified></cp:coreProperties>`;

    const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${NS_W}"><w:zoom w:percent="100"/>${ctx.hasRevisions ? '<w:trackRevisions/>' : ''}<w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

    const files = [
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: rootRels },
      { name: 'docProps/core.xml', data: core },
      { name: 'word/document.xml', data: document },
      { name: 'word/_rels/document.xml.rels', data: relsXml },
      { name: 'word/styles.xml', data: stylesXml() },
      { name: 'word/numbering.xml', data: numberingXml(ctx) },
      { name: 'word/settings.xml', data: settings },
    ];
    if (hasComments) files.push({ name: 'word/comments.xml', data: commentsXml(comments, ctx) });
    ctx.media.forEach((m) => files.push(m));
    return zip(files);
  }

  root.PlumeDocx = { build, zip, crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
