// =============================================================================
// package.js — "Package & back up": everything into one .zip, saved wherever
// you choose (another drive, cloud folder, home PC…).
// -----------------------------------------------------------------------------
// Browser edition: the whole Crucible folder (crucible.html, your books with
// their .crucible folders, chapter images, music…), a fresh copy of your
// settings, and the open book if it lives elsewhere.
// Desktop edition: recent books, playlist songs, settings, the browser edition
// and (optionally) the program itself.
// A "READ ME" inside the zip explains how to restore it.
// =============================================================================

const Package = {
  fmt(b) {
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
    return `${(b / 1073741824).toFixed(2)} GB`;
  },

  async open() {
    if (S.dirty && S.path) {
      if (!(await App.save(true))) return toast('Save failed, so the package was not made.', true);
      if (S.dirty) return toast('New changes arrived during saving. Save them before making the backup.', true, 7000);
      toast('Saved your book first');
    }
    let scan;
    try { scan = await window.crucible.packageScan(); } catch (e) { return toast(`Couldn't scan your files: ${e.message}`, true, 7000); }

    const checks = {};
    const list = el('div', { class: 'pk-groups' });
    const totalEl = el('strong');
    const refresh = () => {
      const t = scan.groups.filter((g) => checks[g.id].checked).reduce((a, g) => [a[0] + g.count, a[1] + g.bytes], [0, 0]);
      totalEl.textContent = `${t[0].toLocaleString()} files · about ${this.fmt(t[1])} before compression`;
    };
    for (const g of scan.groups) {
      const box = el('input', { type: 'checkbox', checked: g.checked, disabled: !g.optional });
      box.addEventListener('change', refresh);
      checks[g.id] = box;
      list.append(el('label', { class: `pk-row check ${g.optional ? '' : 'fixed'}` }, box,
        el('span', { class: 'pk-label' }, g.label),
        el('span', { class: 'muted' }, g.id === 'settings' ? 'fresh copy' : `${g.count.toLocaleString()} file${g.count === 1 ? '' : 's'} · ${this.fmt(g.bytes)}`)));
    }
    const keys = el('input', { type: 'checkbox', checked: scan.keysInFile });
    refresh();

    const body = el('div', { class: 'pk' },
      el('p', { style: 'margin-top:0' }, scan.source
        ? ['Everything in your Crucible folder ', el('strong', {}, scan.source), ' goes into one .zip file, saved wherever you choose.']
        : 'Your books, settings and Crucible itself go into one .zip file, saved wherever you choose.'),
      list,
      el('label', { class: 'check pk-keys' }, keys, 'Include API keys in the settings copy'),
      el('div', { class: 'hint', style: 'margin:2px 0 8px 24px' }, 'Handy for moving to a new drive, but anyone with the zip could use them. Leave unticked for a backup you\'ll store somewhere less safe.'),
      el('p', {}, 'Total: ', totalEl),
      scan.notes.length ? el('ul', { class: 'pk-notes' }, ...scan.notes.map((n) => el('li', {}, n))) : null,
      el('p', { class: 'muted', style: 'font-size:12px;margin-bottom:0' }, 'Tip: save it to a different drive than the one Crucible is on (your PC, a second thumb drive, a cloud folder). A backup on the same drive is lost with it.'));

    const m = openModal({
      title: '📦 Package & back up',
      body,
      buttons: [
        { label: 'Cancel' },
        { label: 'Choose where to save…', accent: true, onClick: () => { this.run(scan, checks, keys.checked, m); return false; } },
      ],
    });
  },

  readme(scan, groups, includeKeys, version) {
    const d = new Date();
    const lines = [
      'CRUCIBLE BACKUP',
      '===============',
      `Made: ${d.toLocaleString()}`,
      `Crucible ${version} (${window.crucible.platform === 'web' ? 'browser edition' : 'desktop edition'})`,
      scan.source ? `From the Crucible folder: ${scan.source}` : '',
      '',
      'WHAT\'S INSIDE',
      ...scan.groups.filter((g) => groups[g.id] !== false).map((g) => `- ${g.label}${g.id === 'settings' ? '' : `: ${g.count} file(s), ${this.fmt(g.bytes)}`}`),
      `- API keys ${includeKeys ? 'ARE included in crucible-settings.json. Keep this file private.' : 'are NOT included. Re-enter them in Settings after restoring.'}`,
      '',
      'TO RESTORE',
      '1. Unzip this file into an empty folder (e.g. a new thumb drive): right-click → Extract All.',
      '2. Double-click crucible.html (open it in Edge or Chrome).',
      '3. On the welcome screen choose "Choose Crucible folder…" and pick the folder you unzipped into.',
      '   Your settings load from crucible-settings.json and your books are listed.',
      '',
      'Desktop edition: install or unzip the program, then Settings → Import settings… and pick',
      'crucible-settings.json from this backup. Open your books from the Books folder.',
      ...(scan.notes.length ? ['', 'NOTES', ...scan.notes.map((n) => `- ${n}`)] : []),
    ];
    return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\r\n');
  },

  async run(scan, checks, includeKeys, modal) {
    const groups = Object.fromEntries(Object.entries(checks).map(([k, b]) => [k, b.checked]));
    const version = await window.crucible.getVersion();
    const mbody = modal.modal.querySelector('.mbody');
    const footer = modal.modal.querySelector('footer');
    const ctl = new AbortController();
    const bar = el('div', { class: 'meter-fill', style: 'width:0%' });
    const label = el('div', { class: 'muted pk-file' }, 'Waiting for you to choose where to save…');
    const pct = el('strong', {}, '');
    footer.innerHTML = '';
    footer.append(el('button', { onclick: () => { ctl.abort(); window.crucible.packageCancel?.(); label.textContent = 'Cancelling…'; } }, 'Cancel'));
    mbody.innerHTML = '';
    mbody.append(el('div', { class: 'pk-progress' },
      el('div', { class: 'meter-row' }, el('span', {}, 'Packaging…'), pct),
      el('div', { class: 'meter-bar' }, bar), label));
    const t0 = Date.now();
    let r;
    try {
      r = await window.crucible.packageWrite(scan.token, { groups, includeKeys, readme: this.readme(scan, groups, includeKeys, version) },
        (done, total, name) => {
          const p = total ? Math.min(100, (done / total) * 100) : 100;
          bar.style.width = `${p}%`;
          pct.textContent = `${p.toFixed(0)}%`;
          label.textContent = `${this.fmt(done)} of ${this.fmt(total)} · ${name}`;
        }, ctl.signal);
    } catch (e) {
      modal.close();
      return toast(`Packaging failed: ${e.message}`, true, 8000);
    }
    if (r.canceled) { modal.close(); return toast('Package cancelled. Nothing was saved.'); }
    const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    mbody.innerHTML = '';
    mbody.append(el('div', {},
      el('p', { style: 'margin-top:0' }, '✓ Backup saved: ', el('strong', {}, r.name)),
      el('p', { class: 'muted' }, `${r.files.toLocaleString()} files, ${this.fmt(r.bytes)} compressed, in ${secs} s. Saved to ${r.where}.`),
      (r.sameFolder || r.sameDrive) ? el('p', { class: 'pk-warn' }, '⚠ This backup is on the same drive as your Crucible files. If that drive is lost or fails, the backup goes with it. Copy it somewhere else too.') : null,
      el('p', { class: 'muted', style: 'font-size:12px' }, 'Removing the thumb drive now? Close this tab first, then use Windows\' "Safely Remove" (browsers can\'t eject drives themselves).')));
    footer.innerHTML = '';
    footer.append(el('button', { class: 'accent', onclick: () => modal.close() }, 'Done'));
    S.lastPackage = Date.now();
  },

  // ------------------------------------------------------------ restore --
  async restore() {
    if (!(await App.confirmDiscard())) return;
    const web = window.crucible.platform === 'web';
    const ok = await confirmModal('Restore from a backup',
      web ? 'Pick a "Crucible backup …zip", then the place to restore it (e.g. a new thumb drive). Crucible unpacks it into a NEW folder there, so nothing is overwritten, and switches to it with all your settings and books.'
        : 'Pick a "Crucible backup …zip", then where to restore it. Crucible unpacks it into a NEW folder, adds the backup\'s AI providers and settings to this computer\'s, and lists its books in File ▾ → Recent.',
      'Choose backup…');
    if (!ok) return;
    const bar = el('div', { class: 'meter-fill', style: 'width:0%' });
    const label = el('div', { class: 'muted pk-file' }, 'Waiting for you to choose…');
    const ctl = new AbortController();
    const m = openModal({
      title: 'Restoring backup',
      body: el('div', { class: 'pk-progress' }, el('div', { class: 'meter-bar' }, bar), label),
      buttons: [{ label: 'Cancel', onClick: () => { ctl.abort(); window.crucible.packageCancel?.(); return false; } }],
    });
    let r;
    try {
      r = await window.crucible.restorePackage((done, total, name) => {
        bar.style.width = `${total ? (done / total) * 100 : 100}%`;
        label.textContent = `${this.fmt(done)} of ${this.fmt(total)} · ${name}`;
      }, ctl.signal);
    } catch (e) { m.close(); return toast(`Restore failed: ${e.message}`, true, 9000); }
    m.close();
    if (r.canceled) return toast(r.partial ? `Restore cancelled. A partly restored folder was left at ${r.partial}; delete it if you don't need it.` : 'Restore cancelled', !!r.partial, 8000);
    if (!r.ok) return toast(r.reason, true, 8000);
    App.reloadSettings(r.settings);
    toast(`Restored ${r.files} files into ${r.folder}`, false, 6000);
    await Settings.reviewEndpoints(r.imported, 'This backup');
    if (web) App.showBookChooser();
    else if (r.books?.length) {
      await App.openPath(r.books[0]).catch(() => {});
      if (r.imported?.keysMissing) toast(`${r.imported.keysMissing} API key(s) weren't in the backup. Re-enter them in Settings.`, true, 7000);
    }
  },
};
