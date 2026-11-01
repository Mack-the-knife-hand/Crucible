// =============================================================================
// dataimport.js — import CSV / TSV / JSON into story memory
// -----------------------------------------------------------------------------
// Any spreadsheet or tool that can save CSV or JSON (character lists, place
// gazetteers, timelines, glossaries…) becomes readable notes for the AI:
//   ## Ada Lovelace
//   - **Age:** 36
//   - **Role:** Mathematician
// =============================================================================

const DataImport = {
  // RFC 4180-style CSV/TSV parser (quotes, doubled quotes, newlines in quotes).
  parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const delim = [',', '\t', ';', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    if (rows.length < 2) throw new Error('Expected a header row and at least one data row.');
    const head = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
    return [{ group: '', records: rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]))) }];
  },

  // JSON: an array of objects, an object of arrays (groups), or an object of objects.
  parseJson(text) {
    const data = JSON.parse(text);
    const flat = (o, pre = '') => Object.entries(o).reduce((acc, [k, v]) => {
      const key = pre ? `${pre}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(acc, flat(v, key));
      else acc[key] = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : v == null ? '' : String(v);
      return acc;
    }, {});
    const asRecords = (arr) => arr.filter((x) => x && typeof x === 'object').map((x) => flat(x));
    if (Array.isArray(data)) return [{ group: '', records: asRecords(data) }];
    if (data && typeof data === 'object') {
      const vals = Object.entries(data);
      if (vals.some(([, v]) => Array.isArray(v))) {
        return vals.filter(([, v]) => Array.isArray(v)).map(([k, v]) => ({ group: k, records: asRecords(v) }));
      }
      if (vals.every(([, v]) => v && typeof v === 'object')) {
        return [{ group: '', records: vals.map(([k, v]) => ({ name: k, ...flat(v) })) }];
      }
    }
    throw new Error('Expected a list of records, e.g. [{"name": "…", …}, …]');
  },

  titleKey(records) {
    const keys = Object.keys(records[0] || {});
    return keys.find((k) => /^(name|full ?name|title|character|place|term|label|id)$/i.test(k)) || keys[0];
  },

  toMarkdown(group, records, titleKey) {
    const lines = [];
    if (group) lines.push(`# ${group}`, '');
    records.forEach((r, i) => {
      lines.push(`## ${r[titleKey] || `Record ${i + 1}`}`);
      for (const [k, v] of Object.entries(r)) if (k !== titleKey && String(v).trim()) lines.push(`- **${k}:** ${v}`);
      lines.push('');
    });
    return lines.join('\n');
  },

  async open() {
    if (!(await Memory.requireSaved())) return;
    const f = await window.crucible.openDataFile();
    if (!f) return;
    let groups;
    try {
      groups = /\.json$/i.test(f.name) ? this.parseJson(f.text) : this.parseDelimited(f.text);
    } catch (e) { return toast(`Couldn't read ${f.name}: ${e.message}`, true, 7000); }
    groups = groups.filter((g) => g.records.length);
    const n = groups.reduce((a, g) => a + g.records.length, 0);
    if (!n) return toast('No records found in that file.', true);
    const all = groups.flatMap((g) => g.records);
    const keys = [...new Set(all.flatMap((r) => Object.keys(r)))];
    const tsel = el('select', {}, ...keys.map((k) => el('option', { value: k }, k)));
    tsel.value = this.titleKey(all);
    const mode = el('select', {},
      el('option', { value: 'one' }, 'One note with all records'),
      el('option', { value: 'each' }, `One note per record (${n} notes)`));
    if (n > 300) mode.options[1].disabled = true;
    const base = f.name.replace(/\.[^.]+$/, '');
    const preview = el('pre', { class: 'import-preview' });
    const showPrev = () => { preview.textContent = this.toMarkdown(groups[0].group, groups[0].records.slice(0, 3), tsel.value) + (n > 3 ? `\n… and ${n - 3} more` : ''); };
    tsel.addEventListener('change', showPrev);
    showPrev();
    const fld = (l, i) => el('div', { class: 'field' }, el('label', {}, l), i);
    openModal({
      title: `Import ${f.name} into story memory`,
      wide: true,
      body: el('div', {},
        el('p', { style: 'margin-top:0' }, `${n.toLocaleString()} record(s)${groups.length > 1 ? ` in ${groups.length} groups (${groups.map((g) => g.group).join(', ')})` : ''}, ${keys.length} field(s).`),
        fld('Name each record by', tsel), fld('Create', mode),
        el('div', { class: 'muted', style: 'font-size:12px;margin:8px 0 4px' }, 'Preview'), preview),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Import', accent: true,
          onClick: async () => {
            const made = [];
            if (mode.value === 'one') {
              for (const g of groups) made.push(await this.makeNote(g.group ? `${base} – ${g.group}` : base, this.toMarkdown(g.group, g.records, tsel.value), `Imported from ${f.name}`));
            } else {
              for (const g of groups) for (const r of g.records) made.push(await this.makeNote(String(r[tsel.value] || 'Record'), this.toMarkdown('', [r], tsel.value), g.group || base));
            }
            Memory.render();
            App.showTab('right', 'memory');
            toast(`Imported ${n} record(s) into ${made.length} story-memory note(s)`);
          },
        },
      ],
    });
  },

  async makeNote(name, text, tags) {
    const item = await window.crucible.newMemoryNote({ bookPath: S.path, name });
    await window.crucible.writeMemoryText({ bookPath: S.path, file: item.file, text: `# ${name}\n\n${text}` });
    item.tags = tags;
    Memory.cache[item.file] = `# ${name}\n\n${text}`;
    S.project.memory.push(item);
    markDirty(true);
    return item;
  },
};

if (typeof module !== 'undefined') module.exports = { DataImport };
