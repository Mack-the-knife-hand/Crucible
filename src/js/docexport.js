// =============================================================================
// docexport.js — Word (.docx) and EPUB 3 export
// -----------------------------------------------------------------------------
// Both formats are ZIP files full of XML, written here from the same rendered
// HTML that the preview and PDF use (so epigraphs, scene breaks, alignment and
// chapter images all carry over). No libraries.
//
// Word: two styles
//   * Manuscript: the standard submission format agents and editors expect
//     (Times New Roman 12 pt, double-spaced, 1" margins, indented paragraphs,
//     "#" scene breaks, a title page with word count, a running header
//     "Surname / TITLE / page").
//   * Book: matches the PDF (your typeface, single-spaced, page numbers).
// EPUB: one file per chapter, a table of contents, optional cover image.
// =============================================================================

const DocExport = {
  xml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),

  // Gather the book's images: { rel → { bytes, mime, ext, w, h } }
  async images(root) {
    const out = {};
    for (const img of root.querySelectorAll('img[data-rel]')) {
      const rel = img.dataset.rel;
      if (out[rel]) continue;
      const url = await BookImages.url(rel);
      if (!url) continue;
      const [, mime, b64] = url.match(/^data:([^;]+);base64,(.*)$/) || [];
      if (!b64) continue;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dim = await new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([800, 600]); im.src = url; });
      out[rel] = { bytes, mime, ext: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[mime] || 'png', w: dim[0], h: dim[1] };
    }
    return out;
  },

  ALLOWED: new Set('P H1 H2 H3 H4 H5 H6 EM STRONG B I U S DEL INS SUB SUP SMALL MARK BLOCKQUOTE HR BR IMG UL OL LI PRE CODE DIV SPAN A NAV TABLE THEAD TBODY TR TH TD'.split(' ')),

  body(md, o) {
    const html = Export.applyToc(Export.bodyHtml(md, o), md, o);
    const body = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html').body;
    // Unknown tags (e.g. "<like this>" typed in the text) would make an
    // invalid e-book: keep their contents, drop the tag.
    for (const n of [...body.querySelectorAll('*')].reverse()) {
      if (!this.ALLOWED.has(n.tagName)) n.replaceWith(...n.childNodes);
      else for (const a of [...n.attributes]) if (!['class', 'src', 'alt', 'href', 'title', 'data-rel', 'id'].includes(a.name)) n.removeAttribute(a.name);
    }
    return body;
  },

  // ================================================================ DOCX ====
  // Language codes go into the files' XML, so only real codes are accepted
  // ("en", "en-US", "pt-BR"…); anything else becomes plain English.
  lang: (v, dflt) => (/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/.test(String(v || '')) ? String(v) : dflt),

  async docx(md, o) {
    o = { ...o, language: this.lang(o.language, 'en-US') };
    const body = this.body(md, o);
    const imgs = await this.images(body);
    const ms = o.docxStyle !== 'book';
    const chapterTag = `H${o.breakLevel === '1' ? 1 : 2}`;
    const X = this.xml;
    const rels = [];
    let imgN = 0;
    const media = [];

    const run = (text, f = {}) => {
      if (!text) return '';
      const props = [f.b ? '<w:b/>' : '', f.i ? '<w:i/>' : '', f.u ? '<w:u w:val="single"/>' : '', f.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : ''].join('');
      return text.split('\n').map((t, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${X(t)}</w:t></w:r>`).join('');
    };
    const inline = (node, f = {}) => {
      let s = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) s += run(n.nodeValue.replace(/\s+/g, ' '), f);
        else if (n.nodeType === 1) {
          const t = n.tagName;
          if (t === 'BR') s += '<w:r><w:br/></w:r>';
          else if (t === 'IMG') s += drawing(n);
          else s += inline(n, { ...f, b: f.b || t === 'STRONG' || t === 'B', i: f.i || t === 'EM' || t === 'I', u: f.u || t === 'U', code: f.code || t === 'CODE' });
        }
      }
      return s;
    };
    const drawing = (img) => {
      const im = imgs[img.dataset.rel];
      if (!im) return '';
      imgN++;
      const id = `rIdImg${imgN}`;
      const file = `image${imgN}.${im.ext}`;
      media.push({ name: `word/media/${file}`, data: im.bytes });
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`);
      const maxW = 4.5 * 914400, maxH = 4 * 914400;
      let cx = maxW, cy = Math.round(maxW * (im.h / im.w));
      if (cy > maxH) { cy = maxH; cx = Math.round(maxH * (im.w / im.h)); }
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imgN}" name="Picture ${imgN}"/>`
        + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imgN}" name="${file}"/><pic:cNvPicPr/></pic:nvPicPr>`
        + `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
        + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
        + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    };
    const para = (style, content, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${content}</w:p>`;

    // The book's own "# Title" line duplicates the title page: drop it.
    const h1 = body.querySelector('h1');
    if (h1 && h1.textContent.trim() === (o.title || '').trim() && !h1.previousElementSibling) h1.remove();
    const out = [];
    let tocInDoc = false;
    let first = true; // first paragraph after a heading/break isn't indented
    const walk = (nodes, align = null) => {
      for (const n of nodes) {
        if (n.nodeType !== 1) continue;
        const t = n.tagName;
        const jc = align ? `<w:jc w:val="${align}"/><w:ind w:firstLine="0"/>` : '';
        if (t === 'NAV' && n.classList.contains('toc')) {
          // A real Word table of contents: a TOC field that Word fills in
          // (with page numbers) when the file is opened. The entries inside
          // are what shows until then.
          const scenes = !!n.querySelector('li.toc-sc');
          const rows = [...n.querySelectorAll('li')].map((li) => para(li.classList.contains('toc-sc') ? 'TOC2' : 'TOC1', run(li.querySelector('.toc-t').textContent)));
          const fld = (x) => `<w:r><w:fldChar w:fldCharType="${x}"/></w:r>`;
          out.push(para('TOCHeading', run('Contents'), out.length ? '<w:pageBreakBefore/>' : ''));
          rows[0] = rows[0].replace('</w:pPr>', `</w:pPr>${fld('begin')}<w:r><w:instrText xml:space="preserve"> TOC \\o "1-${scenes ? 3 : 1}" \\h \\z \\u </w:instrText></w:r>${fld('separate')}`);
          rows[rows.length - 1] = rows[rows.length - 1].replace(/<\/w:p>$/, `${fld('end')}</w:p>`);
          out.push(...rows, '<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
          tocInDoc = true;
          first = true;
          continue;
        }
        if (/^H[1-6]$/.test(t)) {
          const isChapter = t === chapterTag || (chapterTag === 'H2' && t === 'H1');
          const lvl = isChapter ? 1 : Math.min(3, +t[1]);
          out.push(para(`Heading${lvl}`, inline(n), isChapter && o.breakLevel !== '0' && out.length && !/w:type="page"/.test(out[out.length - 1]) ? '<w:pageBreakBefore/>' : ''));
          first = true;
        } else if (t === 'P') {
          if (n.classList.contains('img-p')) { out.push(para('Picture', inline(n))); first = true; continue; }
          if (n.classList.contains('attr')) { out.push(para('Attribution', inline(n))); continue; }
          out.push(para(first ? 'FirstParagraph' : '', inline(n), jc));
          first = false;
        } else if (t === 'HR') {
          out.push(para('SceneBreak', run(ms ? '#' : '*   *   *')));
          first = true;
        } else if (t === 'BLOCKQUOTE') {
          for (const p of n.children) {
            if (p.tagName !== 'P') { walk([p]); continue; }
            out.push(para(p.classList.contains('attr') ? 'Attribution' : 'Quote', inline(p)));
          }
          first = true;
        } else if (t === 'DIV' && /align-(center|right|justify)/.test(n.className)) {
          const a = n.className.match(/align-(center|right|justify)/)[1];
          walk(n.childNodes, a === 'justify' ? 'both' : a);
        } else if (t === 'UL' || t === 'OL') {
          [...n.children].forEach((li, i) => out.push(para('ListPara', run(t === 'UL' ? '•\t' : `${i + 1}.\t`) + inline(li))));
        } else if (t === 'PRE') {
          out.push(para('Code', run(n.textContent, { code: true })));
        } else if (t === 'TABLE') {
          for (const tr of n.querySelectorAll('tr')) out.push(para('', run([...tr.children].map((c) => c.textContent.trim()).join('\t'))));
        } else walk(n.childNodes, align);
      }
    };
    walk(body.childNodes);

    // Title page.
    const words = countWords(md);
    const rounded = words < 1000 ? words : Math.round(words / 1000) * 1000;
    const title = [];
    if (ms) {
      title.push(para('Contact', run(o.author || '')), para('Contact', run(o.contact || '')));
      title.push(para('WordCount', run(`about ${rounded.toLocaleString()} words`)));
      for (let i = 0; i < 8; i++) title.push(para('', ''));
    } else for (let i = 0; i < 6; i++) title.push(para('', ''));
    title.push(para('Title', run(o.title || 'Untitled')));
    if (o.author) title.push(para('Byline', run(`${ms ? 'by ' : ''}${o.author}`)));
    title.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');

    // Page size (twips) and margins.
    const sizes = { letter: [12240, 15840], a4: [11906, 16838], a5: [8391, 11906], trade6x9: [8640, 12960], digest55x85: [7920, 12240] };
    const [pw, ph] = ms ? (o.pageSize === 'a4' ? sizes.a4 : sizes.letter) : (sizes[o.pageSize] || sizes.letter);
    const mar = ms ? 1440 : Math.round((Number(o.marginIn) || 0.75) * 1440);
    const surname = (o.author || '').trim().split(/\s+/).pop() || '';
    if (tocInDoc) rels.push('<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>');
    rels.push('<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    rels.push(`<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${ms ? 'header' : 'footer'}" Target="${ms ? 'header1' : 'footer1'}.xml"/>`);
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
    const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const hf = ms
      ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${run(`${surname ? surname + ' / ' : ''}${(o.title || '').toUpperCase()} / `)}${pageField}</w:p></w:hdr>`
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${o.pageNumbers === false ? '' : pageField}</w:p></w:ftr>`;
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${title.join('')}${out.join('')}<w:sectPr><w:${ms ? 'headerReference' : 'footerReference'} w:type="default" r:id="rIdHdr"/><w:pgSz w:w="${pw}" w:h="${ph}"/><w:pgMar w:top="${mar}" w:right="${mar}" w:bottom="${mar}" w:left="${mar}" w:header="720" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr></w:body></w:document>`;

    const font = ms ? 'Times New Roman' : ({ garamond: 'Garamond', palatino: 'Palatino Linotype', georgia: 'Georgia', times: 'Times New Roman', baskerville: 'Baskerville Old Face' }[o.font] || 'Garamond');
    const sz = ms ? 24 : Math.round((o.fontSize || 11.5) * 2);
    const line = ms ? 480 : 276;
    const ind = ms ? 720 : 360;
    const st = (id, name, ppr = '', rpr = '', basedOn = 'Normal') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="${o.language || 'en-US'}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="${ind}"/>${ms ? '' : '<w:jc w:val="both"/>'}<w:widowControl/></w:pPr></w:style>
${st('FirstParagraph', 'First Paragraph', ms ? `<w:ind w:firstLine="${ind}"/>` : '<w:ind w:firstLine="0"/>')}
${st('Heading1', 'heading 1', `<w:keepNext/><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="${ms ? 2880 : 1440}" w:after="${ms ? 480 : 600}"/><w:outlineLvl w:val="0"/>`, `<w:sz w:val="${ms ? 24 : sz + 12}"/>${ms ? '<w:caps/>' : ''}`)}
${st('Heading2', 'heading 2', '<w:keepNext/><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="480" w:after="240"/><w:outlineLvl w:val="1"/>', `<w:sz w:val="${ms ? 24 : sz + 6}"/>`)}
${st('Heading3', 'heading 3', '<w:keepNext/><w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="2"/>', '<w:i/>')}
${st('Title', 'Title', '<w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:after="240"/>', `<w:sz w:val="${ms ? 24 : 48}"/>${ms ? '<w:caps/>' : ''}`)}
${st('Byline', 'Byline', '<w:jc w:val="center"/><w:ind w:firstLine="0"/>', ms ? '' : '<w:i/>')}
${st('Contact', 'Contact', '<w:ind w:firstLine="0"/><w:spacing w:line="240" w:lineRule="auto"/>')}
${st('WordCount', 'Word Count', '<w:jc w:val="right"/><w:ind w:firstLine="0"/>')}
${st('Quote', 'Quote', '<w:ind w:left="720" w:right="720" w:firstLine="0"/>', '<w:i/>')}
${st('Attribution', 'Attribution', '<w:jc w:val="right"/><w:ind w:left="720" w:right="720" w:firstLine="0"/>')}
${st('SceneBreak', 'Scene Break', '<w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="240" w:after="240"/>')}
${st('Picture', 'Picture', '<w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="120" w:after="360"/>')}
${st('ListPara', 'List Paragraph', '<w:ind w:left="720" w:hanging="360"/>')}
${st('TOCHeading', 'TOC Heading', '<w:jc w:val="center"/><w:ind w:firstLine="0"/><w:spacing w:before="1440" w:after="600"/>', `<w:sz w:val="${ms ? 24 : sz + 12}"/>${ms ? '<w:caps/>' : ''}`)}
${st('TOC1', 'toc 1', '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs><w:ind w:firstLine="0"/><w:spacing w:after="80"/>')}
${st('TOC2', 'toc 2', '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs><w:ind w:left="440" w:firstLine="0"/><w:spacing w:after="60"/>')}
${st('Code', 'Code', '<w:ind w:firstLine="0"/>', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/>')}
</w:styles>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="webp" ContentType="image/webp"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/${ms ? 'header1' : 'footer1'}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${ms ? 'header' : 'footer'}+xml"/>
${tocInDoc ? '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
    const files = [
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
      { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: styles },
      { name: `word/${ms ? 'header1' : 'footer1'}.xml`, data: hf },
      { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` },
      { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${X(o.title || '')}</dc:title><dc:creator>${X(o.author || '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
      { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Crucible</Application><Words>${words}</Words></Properties>` },
      ...(tocInDoc ? [{ name: 'word/settings.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>' }] : []),
      ...media,
    ];
    return this.zipBytes(files);
  },

  // ================================================================ EPUB ====
  async epub(md, o) {
    o = { ...o, language: this.lang(o.language, 'en') };
    const body = this.body(md, o);
    const imgs = await this.images(body);
    const X = this.xml;
    const chapterTag = `H${o.breakLevel === '1' ? 1 : 2}`;
    const ser = new XMLSerializer();
    const xhtml = (node) => ser.serializeToString(node).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    const lang = o.language || 'en';

    // Images → OEBPS/images
    const imgFiles = {};
    let n = 0;
    for (const [rel, im] of Object.entries(imgs)) imgFiles[rel] = { file: `images/img${++n}.${im.ext}`, ...im };
    body.querySelectorAll('img').forEach((img) => {
      const f = imgFiles[img.dataset.rel];
      if (!f) { img.remove(); return; }
      img.setAttribute('src', `../${f.file}`);
      img.removeAttribute('data-rel');
      if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
    });

    // The table of contents becomes its own page (see below).
    const tocNav = body.querySelector('nav.toc');
    if (tocNav) tocNav.dataset.mark = '1';
    // Split into sections at chapter headings.
    const sections = [];
    let cur = { title: null, nodes: [] };
    for (const node of [...body.childNodes]) {
      if (node.nodeType === 1 && node.tagName === chapterTag) {
        if (cur.title || cur.nodes.some((x) => x.nodeType === 1 || x.textContent.trim())) sections.push(cur);
        cur = { title: node.textContent.trim(), nodes: [node] };
      } else cur.nodes.push(node);
    }
    if (cur.title || cur.nodes.some((x) => x.nodeType === 1 || x.textContent.trim())) sections.push(cur);
    // An H1 book title at the very top belongs to the title page, not the text.
    if (sections[0] && !sections[0].title) {
      sections[0].nodes = sections[0].nodes.filter((x) => !(x.nodeType === 1 && x.tagName === 'H1' && x.textContent.trim() === (o.title || '').trim()));
      if (!sections[0].nodes.some((x) => x.nodeType === 1)) sections.shift();
      else sections[0].title = 'Opening';
    }

    const page = (title, inner, cls = '') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${X(title)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body${cls ? ` class="${cls}"` : ''}>
${inner}
</body></html>`;
    // Where the contents page goes: after the section that held the [TOC]
    // spot (or before the first chapter, which is the same thing).
    let tocAt = -1;
    const tocItems = [];
    if (tocNav) {
      const si = sections.findIndex((s) => s.nodes.includes(tocNav));
      if (si >= 0) {
        const s = sections[si];
        const pos = s.nodes.indexOf(tocNav);
        s.nodes.splice(pos, 1);
        const empty = !s.nodes.some((x) => x.nodeType === 1);
        if (empty) { sections.splice(si, 1); tocAt = si; } else tocAt = pos === 0 && s.title ? si : si + 1;
      }
      for (const li of tocNav.querySelectorAll('li')) {
        const a = li.querySelector('a');
        tocItems.push({ id: a.getAttribute('href').slice(1), text: li.querySelector('.toc-t').textContent, sc: li.classList.contains('toc-sc') });
      }
    }
    const docs = [];
    docs.push({ id: 'titlepage', file: 'text/title.xhtml', title: 'Title page', xml: page(o.title || 'Untitled', `<section epub:type="titlepage" class="titlepage"><h1 class="book-title">${X(o.title || 'Untitled')}</h1>${o.author ? `<p class="book-author">${X(o.author)}</p>` : ''}</section>`) });
    const fileOf = {};
    sections.forEach((s, i) => {
      const id = `s${String(i + 1).padStart(3, '0')}`;
      for (const x of s.nodes) if (x.nodeType === 1) { if (x.id) fileOf[x.id] = `${id}.xhtml`; x.querySelectorAll?.('[id]').forEach((e) => { fileOf[e.id] = `${id}.xhtml`; }); }
      docs.push({ id, file: `text/${id}.xhtml`, title: s.title || `Section ${i + 1}`, xml: page(s.title || o.title || '', `<section>${s.nodes.map((x) => (x.nodeType === 1 ? xhtml(x) : X(x.textContent))).join('\n')}</section>`) });
    });
    if (tocNav && tocItems.length) {
      const items = tocItems.filter((t) => fileOf[t.id]);
      // Nest scenes under their chapter.
      let lis = '', open = false;
      for (const t of items) {
        const a = `<a href="${fileOf[t.id]}#${t.id}">${X(t.text)}</a>`;
        if (t.sc) { lis += `${open ? '' : '<ol>'}<li>${a}</li>`; open = true; }
        else { lis += `${open ? '</ol>' : ''}${lis ? '</li>' : ''}<li>${a}`; open = false; }
      }
      if (lis) lis += `${open ? '</ol>' : ''}</li>`;
      const contents = { id: 'contents', file: 'text/contents.xhtml', title: 'Contents', xml: page('Contents', `<nav epub:type="toc" class="contents"><h2 class="contents-title">Contents</h2><ol>${lis}</ol></nav>`) };
      docs.splice(1 + Math.max(0, tocAt), 0, contents);
    }
    const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${docs.filter((d) => d.id !== 'titlepage').map((d) => `<li><a href="${d.file}">${X(d.title)}</a></li>`).join('\n')}
</ol></nav></body></html>`;
    const fonts = { garamond: '"EB Garamond", Garamond, serif', palatino: '"Palatino Linotype", Palatino, serif', georgia: 'Georgia, serif', times: '"Times New Roman", serif', baskerville: 'Baskerville, serif' };
    const css = `body { font-family: ${fonts[o.font] || 'serif'}; line-height: 1.5; margin: 0 5%; }
h1, h2, h3 { text-align: center; font-weight: normal; page-break-after: avoid; }
h1 { margin: 2em 0 1.2em; } h2 { margin: 2em 0 1em; } h3 { font-style: italic; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
h1 + p, h2 + p, h3 + p, hr + p, p.img-p + p, blockquote + p, div + p { text-indent: 0; }
hr { border: 0; text-align: center; margin: 1em 0; }
hr::after { content: "*  *  *"; }
blockquote { margin: 1.5em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
p.attr { text-align: right; font-style: normal; }
p.img-p { text-align: center; text-indent: 0; margin: .5em 0 1.5em; }
img { max-width: 100%; }
img.chapter-image { max-height: 45vh; }
.align-center p, .align-center { text-align: center; text-indent: 0; }
.align-right p, .align-right { text-align: right; text-indent: 0; }
.titlepage { text-align: center; margin-top: 30%; }
.book-title { font-size: 2em; } .book-author { text-indent: 0; text-align: center; font-style: italic; margin-top: 1em; }
nav ol { list-style: none; padding: 0; } nav li { margin: .4em 0; }
nav.contents { margin-top: 15%; } .contents-title { margin-bottom: 1.5em; }
nav.contents a { text-decoration: none; color: inherit; } nav.contents ol ol { margin-left: 1.5em; font-size: .95em; }`;

    const uuid = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const cover = o.coverRel && imgFiles[o.coverRel] ? imgFiles[o.coverRel] : null;
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
<dc:title>${X(o.title || 'Untitled')}</dc:title>
${o.author ? `<dc:creator>${X(o.author)}</dc:creator>` : ''}
<dc:language>${X(lang)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
${cover ? '<meta name="cover" content="cover-image"/>' : ''}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
${docs.map((d) => `<item id="${d.id}" href="${d.file}" media-type="application/xhtml+xml"/>`).join('\n')}
${Object.values(imgFiles).map((f, i) => `<item id="${cover && f === cover ? 'cover-image' : `img${i + 1}`}" href="${f.file}" media-type="${f.mime}"${cover && f === cover ? ' properties="cover-image"' : ''}/>`).join('\n')}
</manifest>
<spine>
${docs.map((d) => `<itemref idref="${d.id}"/>`).join('\n')}
</spine>
</package>`;
    const files = [
      { name: 'mimetype', data: 'application/epub+zip', store: true },
      { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { name: 'OEBPS/content.opf', data: opf },
      { name: 'OEBPS/nav.xhtml', data: nav },
      { name: 'OEBPS/style.css', data: css },
      ...docs.map((d) => ({ name: `OEBPS/${d.file}`, data: d.xml })),
      ...Object.values(imgFiles).map((f) => ({ name: `OEBPS/${f.file}`, data: f.bytes, store: true })),
    ];
    return this.zipBytes(files);
  },

  async zipBytes(files) {
    const parts = [];
    await Zip.writeZip(files.map((f) => ({ ...f, size: 0, mtime: new Date() })), { write: async (u) => { parts.push(u); }, close: async () => {} });
    return new Blob(parts, { type: 'application/zip' });
  },
};
