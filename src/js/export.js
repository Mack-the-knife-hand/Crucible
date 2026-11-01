// =============================================================================
// export.js — book → PDF, Word (.docx) and EPUB (see docexport.js)
// -----------------------------------------------------------------------------
// Builds a print-styled HTML version of the manuscript (book typography:
// justified text, first-line indents, chapters on new pages, scene breaks as
// centered asterisks) and hands it to Chromium's print-to-PDF in main.js.
// Linked songs/pictures and the change pool are never included.
// <!-- HTML comments --> in your Markdown can be left out, so you can keep
// private notes in the manuscript.
// =============================================================================

const Export = {
  FONTS: {
    garamond: '"EB Garamond", Garamond, "Adobe Garamond Pro", "Times New Roman", serif',
    palatino: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
    georgia: 'Georgia, serif',
    times: '"Times New Roman", Times, serif',
    baskerville: 'Baskerville, "Baskerville Old Face", "Libre Baskerville", Georgia, serif',
  },

  defaults() {
    const firstH1 = Editor.outline.find((h) => h.level === 1);
    return {
      title: S.path ? baseName(S.path).replace(/\.[^.]+$/, '') : (firstH1 ? firstH1.title : 'Untitled'),
      author: '',
      pageSize: 'trade6x9',
      marginIn: 0.75,
      fontSize: 11.5,
      font: 'garamond',
      // One "# Title" with "## Chapter" headings under it → chapters are ##.
      breakLevel: Editor.outline.filter((h) => h.level === 1).length > 1 ? '1' : '2',
      titlePage: true,
      pageNumbers: true,
      stripComments: true,
      indent: true,
      toc: 'chapters',
    };
  },

  FORMATS: {
    pdf: 'PDF (print-ready book)',
    docx: 'Word document (.docx)',
    epub: 'EPUB e-book (Kindle, Apple Books, Kobo…)',
  },

  open() {
    const o = Object.assign(this.defaults(), { format: 'pdf', docxStyle: 'manuscript', language: 'en', contact: '', coverRel: '' }, S.project.meta.export || {});
    const rows = [];
    // Each field lists the formats it applies to.
    const f = (label, input, hint, formats = 'pdf docx epub') => {
      const r = el('div', { class: 'field', 'data-for': formats }, el('label', {}, label), input, hint ? el('div', { class: 'hint' }, hint) : null);
      rows.push(r);
      return r;
    };
    const sel = (val, opts) => { const s = el('select'); opts.forEach(([v, t]) => s.append(el('option', { value: v }, t))); s.value = val; return s; };
    const chk = (v) => el('input', { type: 'checkbox', checked: v });
    const images = [...new Set([...Editor.text.matchAll(/!\[chapter-image\]\(([^)\s]+)\)/g)].map((m) => ChapterOps.decodeImg(m[1])))];

    const ui = {
      format: sel(o.format, Object.entries(this.FORMATS)),
      docxStyle: sel(o.docxStyle, [['manuscript', 'Manuscript format (for agents & editors)'], ['book', 'Book style (like the PDF)']]),
      title: el('input', { value: o.title }),
      author: el('input', { value: o.author, placeholder: 'Your name (or pen name)' }),
      contact: el('textarea', { rows: 2, placeholder: 'Address, email, phone (top-left of the title page)' }),
      language: el('input', { value: o.language, placeholder: 'en, en-GB, fr, de…', style: 'width:120px' }),
      cover: sel(o.coverRel, [['', 'No cover image'], ...images.map((r) => [r, `Chapter image: ${r.split('/').pop()}`]), ['__pick', 'Choose a picture…']]),
      pageSize: sel(o.pageSize, [['trade6x9', 'Trade paperback 6 × 9 in'], ['digest55x85', 'Digest 5.5 × 8.5 in'], ['letter', 'US Letter 8.5 × 11 in'], ['a5', 'A5'], ['a4', 'A4']]),
      marginIn: el('input', { type: 'number', step: '0.05', min: '0.3', max: '2', value: o.marginIn }),
      font: sel(o.font, [['garamond', 'Garamond'], ['palatino', 'Palatino'], ['baskerville', 'Baskerville'], ['georgia', 'Georgia'], ['times', 'Times New Roman']]),
      fontSize: el('input', { type: 'number', step: '0.5', min: '8', max: '18', value: o.fontSize }),
      breakLevel: sel(o.breakLevel, [['1', 'Each # heading (chapters are #)'], ['2', 'Each ## heading (chapters are ##)'], ['0', 'Never']]),
      toc: sel(o.toc || 'chapters', [['chapters', 'Chapters'], ['scenes', 'Chapters and scenes'], ['none', 'No table of contents']]),
      titlePage: chk(o.titlePage),
      pageNumbers: chk(o.pageNumbers),
      indent: chk(o.indent),
      stripComments: chk(o.stripComments),
    };
    ui.contact.value = o.contact || '';
    ui.cover.addEventListener('change', async () => {
      if (ui.cover.value !== '__pick') return;
      ui.cover.value = '';
      if (!S.path) return toast('Save the book first.', true);
      const r = await window.crucible.chooseChapterImage(S.path);
      if (!r) return;
      ui.cover.append(el('option', { value: r.rel }, `Cover: ${r.name}`));
      ui.cover.value = r.rel;
    });
    const note = el('p', { class: 'muted', style: 'font-size:12px;margin-top:14px' });
    const body = el('div', {},
      f('Format', ui.format),
      f('Word style', ui.docxStyle, 'Manuscript format: Times 12 pt, double-spaced, 1" margins, # scene breaks, word count on the title page, "Surname / TITLE / page" header.', 'docx'),
      f('Title', ui.title),
      f('Author', ui.author),
      f('Contact details', ui.contact, '', 'docx-ms'),
      f('Language', ui.language, 'Language code (helps e-readers choose hyphenation and fonts).', 'epub'),
      f('Cover image', ui.cover, 'Shown as the book\'s cover in e-reader libraries.', 'epub'),
      f('Page size', ui.pageSize, '', 'pdf docx-book'),
      f('Margins (inches)', ui.marginIn, '', 'pdf docx-book'),
      f('Typeface', ui.font, 'Uses fonts installed on this computer (e-readers may use their own).', 'pdf docx-book epub'),
      f('Font size (pt)', ui.fontSize, '', 'pdf docx-book'),
      f('New page for', ui.breakLevel, 'In an EPUB this also decides where each chapter file starts (and the table of contents).'),
      f('Table of contents', ui.toc, 'Goes where you put a [TOC] line (right-click → Insert table of contents here), otherwise just before the first chapter. PDF: page numbers and clickable entries. Word: fills in page numbers when opened. EPUB: a Contents page.'),
      f('Title page', ui.titlePage, '', 'pdf'),
      f('Page numbers', ui.pageNumbers, '', 'pdf docx-book'),
      f('Book-style indents', ui.indent, 'Indent paragraphs instead of spacing them (like a printed novel).', 'pdf'),
      f('Leave out comments', ui.stripComments, 'Skips <!-- notes --> you\'ve hidden in the manuscript.', 'pdf'),
      note);
    const show = () => {
      const fmt = ui.format.value;
      const keys = [fmt, fmt === 'docx' ? `docx-${ui.docxStyle.value === 'book' ? 'book' : 'ms'}` : ''];
      for (const r of rows) r.classList.toggle('hidden', !r.dataset.for.split(' ').some((k) => keys.includes(k)));
      note.textContent = fmt === 'pdf'
        ? (window.crucible.cssPaging ? 'Your browser\'s print window will open. Choose "Save as PDF" as the destination, leave Margins on Default, and turn off "Headers and footers" if it shows.' : '')
        : fmt === 'docx' ? 'Opens in Word, Google Docs, LibreOffice and Pages. Chapter headings use Word\'s Heading styles, so the Navigation pane lists your chapters.'
          : 'A standard EPUB 3 file. Apple Books, Kobo, Google Play Books and most e-readers open it directly; for Kindle, use Amazon\'s "Send to Kindle" (it accepts EPUB) or upload it to KDP.';
      $('.modal .export-go') && ($('.modal .export-go').textContent = fmt === 'pdf' ? 'Export…' : 'Save…');
    };
    ui.format.addEventListener('change', show);
    ui.docxStyle.addEventListener('change', show);

    openModal({
      title: 'Export book',
      body,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Export…', accent: true, cls: 'export-go',
          onClick: async () => {
            const opts = {
              format: ui.format.value, docxStyle: ui.docxStyle.value, contact: ui.contact.value, language: ui.language.value.trim() || 'en',
              coverRel: ui.cover.value === '__pick' ? '' : ui.cover.value,
              title: ui.title.value, author: ui.author.value, pageSize: ui.pageSize.value,
              marginIn: +ui.marginIn.value, font: ui.font.value, fontSize: +ui.fontSize.value,
              breakLevel: ui.breakLevel.value, toc: ui.toc.value, titlePage: ui.titlePage.checked, pageNumbers: ui.pageNumbers.checked,
              indent: ui.indent.checked, stripComments: ui.stripComments.checked,
            };
            S.project.meta.export = opts;
            markDirty(true);
            if (opts.format !== 'pdf') return this.saveDoc(opts);
            const web = !!window.crucible.cssPaging;
            toast(web ? 'Opening the print window…' : 'Building PDF…', false, 8000);
            const po = { ...opts, cssPaging: web };
            let html = await BookImages.embed(this.buildHtml(Editor.text, po));
            if (opts.toc !== 'none' && /class="toc"/.test(html)) {
              // Lay the book out once to find each chapter's page, then fill the contents in.
              const { pages } = await this.paginate(html, po);
              html = await BookImages.embed(this.buildHtml(Editor.text, po, pages));
            }
            const res = await window.crucible.exportPdf({
              html,
              options: opts,
              suggestedName: `${opts.title || 'book'}.pdf`,
            });
            if (res?.printed) {
              toast('In the print window, choose "Save as PDF" as the printer.', false, 7000);
            } else if (res?.ok) {
              toast('PDF saved');
              window.crucible.reveal(res.path);
            } else if (!res?.canceled) toast('Export failed', true);
          },
        },
      ],
    });
    show();
  },

  async saveDoc(opts) {
    const ext = opts.format;
    toast(`Building ${ext === 'docx' ? 'Word document' : 'EPUB'}…`, false, 8000);
    let blob;
    try {
      // Hidden comments (scene cards, notes) never go into Word or EPUB.
      const o = { ...opts, stripComments: true };
      blob = ext === 'docx' ? await DocExport.docx(Editor.text, o) : await DocExport.epub(Editor.text, o);
    } catch (e) {
      console.error(e);
      return toast(`Export failed: ${e.message}`, true, 8000);
    }
    const res = await window.crucible.saveBinary({
      suggestedName: `${(opts.title || 'book').replace(/[\\/:*?"<>|]+/g, '')}.${ext}`,
      blob,
      kind: ext === 'docx' ? { description: 'Word document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' } : { description: 'EPUB e-book', mime: 'application/epub+zip', ext: 'epub' },
    });
    if (res?.canceled) return;
    toast(`Saved ${res?.name || ''}`, false, 5000);
    if (res?.path) window.crucible.reveal(res.path);
  },

  // ------------------------------------------------- table of contents --
  // Where it goes: a line "[TOC]" in the manuscript, otherwise just before the
  // first chapter (after the title page and any epigraph/dedication).
  // o.toc: 'none' | 'chapters' | 'scenes'. pages: { id → page number } (PDF).
  chapterLevel(md, o) {
    return o.breakLevel === '1' ? 1 : o.breakLevel === '2' ? 2 : ChapterOps.detectLevel(md);
  },

  TOC_LINE: /^[ \t]*\[toc\][ \t]*$/im,

  isTocMarker: (n) => n.tagName === 'P' && /^\s*\[toc\]\s*$/i.test(n.textContent),

  applyToc(html, md, o, pages = null) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const root = tpl.content;
    const markers = [...root.querySelectorAll('p')].filter(this.isTocMarker);
    const mode = o.toc || 'none';
    if (mode === 'none') { markers.forEach((m) => m.remove()); return tpl.innerHTML; }
    const L = this.chapterLevel(md, o);
    const title = (o.title || '').trim();
    const heads = [...root.querySelectorAll(mode === 'scenes' ? `h${L}, h${Math.min(6, L + 1)}` : `h${L}`)]
      // The book's own title line at the very top isn't a chapter.
      .filter((h) => !(h.tagName === 'H1' && title && h.textContent.trim() === title && h === root.firstElementChild));
    if (!heads.some((h) => h.tagName === `H${L}`)) { markers.forEach((m) => m.remove()); return tpl.innerHTML; }
    heads.forEach((h, i) => { h.id = `toc-${i + 1}`; });
    const nav = document.createElement('nav');
    nav.className = 'toc';
    nav.innerHTML = `<p class="toc-title">Contents</p><ol>${heads.map((h) => `<li class="${h.tagName === `H${L}` ? 'toc-ch' : 'toc-sc'}"><a href="#${h.id}"><span class="toc-t">${escapeHtml(h.textContent.trim())}</span><span class="toc-dots"></span><span class="toc-pg">${pages ? (pages[h.id] ?? '') : (o.cssPaging !== undefined ? '000' : '')}</span></a></li>`).join('')}</ol>`;
    const first = heads.find((h) => h.tagName === `H${L}`);
    if (markers.length) { markers[0].replaceWith(nav); markers.slice(1).forEach((m) => m.remove()); }
    else first.before(nav);
    return tpl.innerHTML;
  },

  PRINT_CSP: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'",

  PAGE_IN: { letter: [8.5, 11], a4: [8.27, 11.69], a5: [5.83, 8.27], trade6x9: [6, 9], digest55x85: [5.5, 8.5] },

  // Work out which page each heading lands on. The print HTML is laid out in
  // an invisible frame as a row of page-sized columns: the browser splits
  // columns with the same engine it uses to split printed pages (same widths,
  // fonts, widows/orphans and page-break rules), so a heading's column is its
  // page. Returns { pages: { id → n }, total }.
  async paginate(html, o) {
    const [pw, ph] = this.PAGE_IN[o.pageSize] || this.PAGE_IN.letter;
    const m = Number(o.marginIn) || 0.75;
    const W = Math.round((pw - 2 * m) * 96), H = Math.round((ph - 2 * m) * 96);
    let doc = html
      .replace(/@page\s*:first\s*\{[^{}]*\{[^{}]*\}[^{}]*\}/g, '')
      .replace(/@page\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '')
      .replace(/break-(before|after)\s*:\s*page/g, 'break-$1: column');
    doc = doc.replace(/<body[^>]*>/, (b) => `${b}<div id="__flow" style="height:${H}px;width:${W}px;column-width:${W}px;column-gap:0;column-fill:auto;">`)
      .replace(/<\/body>/, '</div></body>');
    const fr = document.createElement('iframe');
    fr.style.cssText = `position:fixed;left:-30000px;top:0;width:${W}px;height:${H}px;border:0;visibility:hidden;`;
    // (The frame can report "loaded" for its blank starting page first, so
    // wait until the book itself is in it.)
    const loaded = new Promise((res, rej) => {
      const t0 = Date.now();
      const ready = () => fr.contentDocument?.getElementById('__flow') && fr.contentDocument.readyState === 'complete';
      fr.onload = () => { if (ready()) res(); };
      const poll = () => (ready() ? res() : Date.now() - t0 > 20000 ? rej(new Error('Page layout timed out')) : setTimeout(poll, 50));
      setTimeout(poll, 50);
    });
    // sandbox without allow-scripts: nothing in the book can ever run here.
    fr.setAttribute('sandbox', 'allow-same-origin');
    fr.srcdoc = doc;
    document.body.append(fr);
    try {
      await loaded;
      const d = fr.contentDocument;
      await d.fonts?.ready;
      await Promise.all([...d.images].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; }))));
      const flow = d.getElementById('__flow');
      const x0 = flow.getBoundingClientRect().left;
      const pages = {};
      // The title page sits before the flow's first column only if present; it
      // is inside the flow, so column 0 = page 1.
      for (const h of d.querySelectorAll('[id^="toc-"]')) {
        const r = h.getBoundingClientRect();
        pages[h.id] = Math.floor((r.left - x0 + 2) / W) + 1;
      }
      return { pages, total: Math.max(1, Math.round(flow.scrollWidth / W)) };
    } finally { fr.remove(); }
  },

  // The book as HTML (no <html> wrapper): Markdown → HTML with epigraph
  // attributions, alignment blocks and chapter-image placeholders.
  bodyHtml(md, o) {
    if (o.stripComments) md = md.replace(/<!--[\s\S]*?-->/g, '');
    md = Align.toHtmlMd(md);
    return BookImages.defer(sanitizeHtml(marked.parse(md))
      .replace(/(<blockquote>[\s\S]*?<\/blockquote>)/g, (bq) => bq.replace(/<p>(\s*(?:—|–|--|―)\s*)/g, '<p class="attr">$1')));
  },

  buildHtml(md, o, pages = null) {
    const body = this.applyToc(this.bodyHtml(md, o), md, o, pages);
    const breaks = o.breakLevel === '0' ? '' : o.breakLevel === '2' ? 'h1, h2' : 'h1';
    const titlePage = o.titlePage
      ? `<section class="title-page"><div class="t">${escapeHtml(o.title)}</div>${o.author ? `<div class="a">${escapeHtml(o.author)}</div>` : ''}</section>`
      : '';
    // Browser printing: page size, margins and page numbers come from CSS @page.
    const sizes = { letter: 'letter', a4: 'A4', a5: 'A5', trade6x9: '6in 9in', digest55x85: '5.5in 8.5in' };
    const paging = o.cssPaging ? `
  @page { size: ${sizes[o.pageSize] || 'letter'}; margin: ${Number(o.marginIn) || 0.75}in;
    ${o.pageNumbers ? '@bottom-center { content: counter(page); font-family: Georgia, serif; font-size: 9pt; color: #444; }' : ''} }
  ${o.titlePage && o.pageNumbers ? '@page :first { @bottom-center { content: none; } }' : ''}` : '';
    // The print page carries its own lock-down rules: no scripts, no network,
    // no frames; only the book's text, its styles and embedded pictures.
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${this.PRINT_CSP}"><title>${escapeHtml(o.title)}</title>
<style>${paging}
  html { -webkit-print-color-adjust: exact; }
  body { font-family: ${this.FONTS[o.font] || this.FONTS.garamond}; font-size: ${o.fontSize}pt; line-height: 1.45;
         color: #111; margin: 0; text-align: justify; hyphens: auto; -webkit-hyphens: auto; orphans: 2; widows: 2; }
  .title-page { height: ${o.cssPaging ? '90vh' : '85vh'}; display: flex; flex-direction: column; justify-content: center; text-align: center; break-after: page; }
  .title-page .t { font-size: 2.4em; letter-spacing: .04em; margin-bottom: .8em; }
  .title-page .a { font-size: 1.2em; font-style: italic; }
  h1, h2, h3 { text-align: center; font-weight: normal; break-after: avoid; hyphens: none; }
  h1 { font-size: 1.7em; margin: 2.5em 0 1.6em; letter-spacing: .03em; }
  h2 { font-size: 1.3em; margin: 2em 0 1em; }
  h3 { font-size: 1.1em; margin: 1.5em 0 .8em; font-style: italic; }
  ${breaks ? `${breaks} { break-before: page; } body > ${breaks.split(',')[0].trim()}:first-child { break-before: auto; }` : ''}
  .title-page + h1, .title-page + h2, h1 + h2 { break-before: auto; }
  p { margin: 0 0 ${o.indent ? '0' : '.8em'}; }
  ${o.indent ? 'p + p { text-indent: 1.5em; }' : ''}
  hr { border: 0; text-align: center; margin: 1.2em 0; break-after: avoid; }
  hr::after { content: "*  *  *"; letter-spacing: .4em; }
  blockquote { margin: 1em 2em; font-style: italic; }
  blockquote p { text-indent: 0 !important; }
  blockquote p.attr { text-align: right; font-style: normal; margin-top: .4em; }
  ${breaks ? `/* An epigraph right before a chapter gets its own page. */
  ${[...breaks.split(',').map((h) => `blockquote:has(+ ${h.trim()})`), 'blockquote:has(+ .toc)'].join(', ')} { break-before: page; break-after: page; margin-top: 30%; }` : ''}
  img { max-width: 100%; }
  .toc { break-before: page; break-after: page; }
  .toc-title { text-align: center; font-size: 1.5em; margin: 1.5em 0 1.2em; text-indent: 0 !important; letter-spacing: .03em; }
  .toc ol { list-style: none; padding: 0; margin: 0; }
  .toc li { margin: 0 0 .45em; break-inside: avoid; }
  .toc li.toc-sc { margin-left: 1.5em; font-size: .92em; }
  .toc a { display: flex; align-items: baseline; gap: .4em; color: inherit; text-decoration: none; }
  .toc-t { text-align: left; hyphens: none; }
  .toc-dots { flex: 1; border-bottom: 1px dotted #888; transform: translateY(-.25em); min-width: 1em; }
  .toc-pg { min-width: 1.8em; text-align: right; font-variant-numeric: tabular-nums; }
  .toc + h1, .toc + h2 { break-before: auto; }
  .align-center, .align-center p { text-align: center; text-indent: 0 !important; hyphens: none; }
  .align-right, .align-right p { text-align: right; text-indent: 0 !important; hyphens: none; }
  .align-justify p { text-align: justify; }
  div[class^="align-"] + p { text-indent: 0 !important; }
  p.img-p { text-align: center; text-indent: 0 !important; margin: .4em 0 1.6em; break-inside: avoid; }
  img.chapter-image { display: block; margin: 0 auto; max-width: 85%; max-height: 42vh; object-fit: contain; }
  p.img-p + p { text-indent: 0 !important; }
  a { color: inherit; text-decoration: none; }
  pre, code { font-family: Consolas, "Courier New", monospace; font-size: .85em; white-space: pre-wrap; text-align: left; }
</style></head><body>${titlePage}${body}</body></html>`;
  },
};
