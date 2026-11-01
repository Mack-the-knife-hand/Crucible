// =============================================================================
// settings.js — AI providers & preferences
// -----------------------------------------------------------------------------
// Store as many AIs as you like and switch from the "AI" dropdown in the top
// bar. Three connection types cover almost everything:
//   Anthropic          Claude models
//   OpenAI-compatible  OpenAI, and anything that speaks the same API:
//                      Ollama / LM Studio (local, free), OpenRouter, Groq,
//                      Mistral, DeepSeek, xAI, Together…
//   Google Gemini      Gemini models
// API keys are encrypted with your operating system's keychain and never
// shown again after you save them.
// =============================================================================

const Settings = {
  // Who made Crucible, and why. (Change AUTHOR to update the name everywhere.)
  AUTHOR: 'Mack',
  authorNote() {
    return el('div', { class: 'about-note' },
      el('p', {}, 'I made Crucible because I love you, and because I think your ideas are good.'),
      el('p', {}, 'Your stories deserve to be written, finished and read. Crucible is free, and it will stay free: no paywalls, no subscriptions, no limits on what you can create. Everything you write with it belongs to you.'),
      el('p', {}, 'So write the thing you\'ve been carrying around. Put your stories out there for the world to enjoy.'),
      el('p', { class: 'about-sign' }, `— ${this.AUTHOR}`));
  },

  async about() {
    const version = await window.crucible.getVersion?.().catch(() => '') || window.CRUCIBLE_VERSION || '';
    openModal({
      title: 'About Crucible',
      body: el('div', { class: 'about' },
        App.logo(),
        el('div', { class: 'about-title' }, 'Crucible'),
        el('div', { class: 'muted about-sub' }, `Version ${version} · made by ${this.AUTHOR}`),
        this.authorNote(),
        el('p', { class: 'muted', style: 'font-size:12px;line-height:1.6' },
          'A free manuscript editor. Your books, notes and API keys stay on your computer or your drive. Crucible only connects to the AI services you add, and only when you use them. No accounts, no tracking.'),
        el('p', { class: 'muted', style: 'font-size:11.5px;line-height:1.6;margin-bottom:0' },
          `Copyright © 2026 ${this.AUTHOR}. MIT License with the Commons Clause: free for everyone to use, change and share; Crucible itself may not be sold. Includes marked (MIT) and DOMPurify (Apache 2.0). See LICENSE and THIRD_PARTY_LICENSES.md.`)),
      buttons: [{ label: 'Close', accent: true }],
    });
  },

  // A settings file (Import, a restored backup, a different Crucible folder)
  // wants to add AIs or change where one sends your writing. Show exactly
  // which servers, and only change anything if you say so.
  reviewEndpoints(r, source = 'This file') {
    if (!r?.endpointChanges?.length || !r.confirmToken) return Promise.resolve(false);
    return new Promise((resolve) => {
      const list = el('ul', { class: 'ep-list' });
      for (const c of r.endpointChanges) {
        list.append(el('li', {},
          el('strong', {}, c.name), ': ',
          c.fromHost ? [el('span', { class: 'muted' }, c.fromHost), ' → '] : el('span', { class: 'muted' }, 'new AI at '),
          el('code', {}, c.toHost),
          c.to && c.to !== c.toHost ? el('div', { class: 'hint', style: 'margin:2px 0 0' }, c.to) : null));
      }
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      openModal({
        title: 'Check these AI addresses',
        body: el('div', {},
          el('p', { style: 'margin-top:0' }, `${source} would send your writing to these AI servers:`),
          list,
          el('p', { class: 'muted', style: 'font-size:12.5px' }, 'Whenever you use the AI, your passages, notes and story memory go to these addresses. Only accept if you recognise every one. If you choose "Keep my current AIs", everything else in the file is still imported, and no AI address changes.')),
        buttons: [
          { label: 'Keep my current AIs', onClick: () => { finish(false); toast('Your AI addresses were left unchanged.', false, 5000); } },
          {
            label: 'Use these addresses', accent: true, onClick: async () => {
              try {
                const res = await window.crucible.confirmImportedEndpoints(r.confirmToken);
                App.reloadSettings(res.settings);
                toast(`AI addresses updated.${res.keysMissing ? ` Enter the API key for ${res.keysMissing} of them in Settings.` : ' Keys for any changed address must be entered again.'}`, false, 7000);
                finish(true);
              } catch (e) { toast(`Couldn't update: ${e.message}`, true, 6000); finish(false); }
            },
          },
        ],
        onClose: () => finish(false),
      });
    });
  },

  PRESETS: [
    { name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5', needsKey: true },
    { name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', needsKey: true },
    { name: 'Google Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: '', needsKey: true },
    { name: 'Ollama (local)', type: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', needsKey: false },
    { name: 'LM Studio (local)', type: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', needsKey: false },
    { name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', needsKey: true },
    { name: 'Groq', type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: '', needsKey: true },
    { name: 'Custom (OpenAI-compatible)', type: 'openai', baseUrl: '', model: '', needsKey: true },
  ],

  open() {
    // Work on a copy; nothing is saved until you press Save.
    const draft = S.settings.providers.map((p) => ({ ...p }));
    let activeId = S.settings.activeProviderId || draft[0]?.id || null;
    const ui = { ...S.settings.ui };
    const listBox = el('div');

    const renderList = () => {
      listBox.innerHTML = '';
      if (!draft.length) listBox.append(el('div', { class: 'empty' }, 'No AIs yet. Add one below.'));
      draft.forEach((p, i) => {
        const field = (label, input, hint) => el('div', { class: 'field' }, el('label', {}, label), input, hint ? el('div', { class: 'hint' }, hint) : null);
        const inp = (key, attrs = {}) => {
          const n = el('input', { value: p[key] ?? '', ...attrs });
          n.addEventListener('input', () => (p[key] = n.value));
          return n;
        };
        const type = el('select');
        [['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI-compatible'], ['gemini', 'Google Gemini']]
          .forEach(([v, t]) => type.append(el('option', { value: v }, t)));
        type.value = p.type;
        type.onchange = () => (p.type = type.value);
        const key = el('input', { type: 'password', placeholder: p.hasKey ? '•••••••• stored — type to replace' : 'Paste API key (leave blank for local servers)' });
        key.addEventListener('input', () => (p.newApiKey = key.value));
        const status = el('span', { class: 'muted' });

        listBox.append(el('div', { class: `prov-card ${p.id === activeId ? 'active' : ''}` },
          el('div', { class: 'row', style: 'display:flex;gap:8px;align-items:center;margin-bottom:4px' },
            el('label', { class: 'check' }, el('input', {
              type: 'radio', name: 'activeProv', checked: p.id === activeId,
              onchange: () => { activeId = p.id; renderList(); },
            }), 'Default'),
            el('strong', { style: 'flex:1' }, p.name || 'Unnamed'),
            status,
            el('button', {
              class: 'small', onclick: async () => {
                status.textContent = 'saving & testing…';
                await save();
                const r = await window.crucible.aiChat({
                  providerId: p.id, system: 'You are a connection test.',
                  messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
                });
                status.textContent = r.ok ? `✓ ${snippet(r.text, 30)}` : `✕ ${snippet(r.error, 70)}`;
                status.style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
              },
            }, 'Test'),
            el('button', { class: 'small ghost danger', onclick: () => { draft.splice(i, 1); if (activeId === p.id) activeId = draft[0]?.id || null; renderList(); } }, 'Remove')),
          field('Name', inp('name')),
          field('Connection type', type),
          field('Base URL', inp('baseUrl', { placeholder: 'https://…' }), p.hasKey ? 'Your key is only ever sent to this address. Changing it (or the connection type) clears the saved key, so type the key again.' : ''),
          field('Model', inp('model', { placeholder: p.type === 'anthropic' ? 'claude-sonnet-5-5' : 'model name from your provider' }),
            'The exact model ID from your provider\'s docs (for Ollama, run "ollama list").'),
          field('API key', key, S.settings.keyStorage === 'session'
            ? 'This computer has no secure key storage (such as a system keyring), so Crucible keeps keys in memory only and never writes them to disk. You\'ll need to enter them again each time you start Crucible.'
            : ''),
          field('Max reply tokens', inp('maxTokens', { type: 'number', placeholder: '4096' })),
          field('Temperature', inp('temperature', { type: 'number', step: '0.1', placeholder: 'provider default' })),
          field('Timeout (seconds)', inp('timeoutSec', { type: 'number', placeholder: '180' }), 'Raise this for slow local models.')));
      });
    };

    const presetSel = el('select');
    presetSel.append(el('option', { value: '' }, '+ Add an AI…'));
    this.PRESETS.forEach((p, i) => presetSel.append(el('option', { value: i }, p.name)));
    presetSel.onchange = () => {
      const pr = this.PRESETS[presetSel.value];
      presetSel.value = '';
      if (!pr) return;
      const p = { id: uid(), name: pr.name, type: pr.type, baseUrl: pr.baseUrl, model: pr.model, maxTokens: 4096, temperature: '', timeoutSec: pr.needsKey ? 180 : 600 };
      draft.push(p);
      if (!activeId) activeId = p.id;
      renderList();
    };

    // ---- "Your settings" section: where they live + export/import
    const c = window.crucible;
    const where = el('div', {});
    const version = el('span', { class: 'muted' });
    c.getVersion?.().then((v) => (version.textContent = `Crucible ${v} · ${c.platform === 'web' ? 'browser edition' : 'desktop edition'}`));
    const renderWhere = async () => {
      where.innerHTML = '';
      if (c.platform !== 'web') {
        where.append(el('p', { class: 'muted', style: 'margin:4px 0' }, 'Settings are kept in your user profile and carry over to every new version automatically. To move them to another computer or to the browser edition, export a settings file.'));
        return;
      }
      if (c.storageMode !== 'folder') {
        where.append(el('p', { class: 'muted', style: 'margin:4px 0' }, 'This browser can\'t write to folders, so settings live in the browser only. Export a settings file to keep or move them.'));
        return;
      }
      const info = await c.homeInfo();
      const keys = el('input', { type: 'checkbox', checked: S.settings.keysInFile !== false });
      keys.onchange = () => persistSettings({ keysInFile: keys.checked }).then(() => toast(keys.checked ? 'API keys will be kept in the settings file' : 'API keys will stay in this browser only'));
      where.append(
        el('div', { class: 'field' }, el('label', {}, 'Crucible folder'),
          el('div', { style: 'display:flex;gap:8px;align-items:center' },
            el('strong', {}, info ? info.name : 'not chosen'),
            el('span', { class: 'muted' }, info ? (info.connected ? '· saving to crucible-settings.json' : '· not opened this session') : ''),
            el('span', { class: 'spacer' }),
            el('button', { class: 'small', onclick: async () => { const r = await c.connectHome(!!info?.connected); if (r.ok) { App.reloadSettings(r.settings); toast(r.loaded ? 'Settings loaded from that folder' : 'Settings file created there'); await Settings.reviewEndpoints(r, 'This folder'); renderWhere(); } } },
              info?.connected ? 'Change…' : info ? `Open ${info.name}` : 'Choose…'))),
        el('div', { class: 'hint', style: 'margin:-4px 0 6px 160px;font-size:11.5px' }, 'The folder holding crucible.html (e.g. your thumb drive). Your settings are saved there so they travel with it.'),
        el('div', { class: 'field' }, el('label', {}, 'API keys in file'), el('label', { class: 'check' }, keys, 'Keep API keys in crucible-settings.json')),
        el('div', { class: 'hint', style: 'margin:-4px 0 6px 160px;font-size:11.5px;color:var(--warn)' }, 'Convenient on a thumb drive, but anyone who gets the drive could use your keys. Set a spending limit with your AI provider.'));
    };
    renderWhere();
    const inclKeys = el('input', { type: 'checkbox' });
    const exportBtn = el('button', {
      class: 'small', onclick: async () => {
        const data = await c.exportSettings({ includeKeys: inclKeys.checked });
        const p = await c.saveTextFile({ suggestedName: 'crucible-settings.json', text: JSON.stringify(data, null, 2) });
        if (p) toast('Settings exported');
      },
    }, 'Export settings…');
    const importBtn = el('button', {
      class: 'small', onclick: async () => {
        const text = await c.openTextFile();
        if (!text) return;
        try {
          const r = await c.importSettings(JSON.parse(text));
          App.reloadSettings(r.settings);
          await Settings.reviewEndpoints(r, 'This settings file');
          const notes = [];
          if (r.keysMissing) notes.push(`${r.keysMissing} API key(s) weren't in the file, so re-enter them`);
          if (r.skippedSongs) notes.push(`${r.skippedSongs} song(s) belong to the other edition and were skipped`);
          toast(`Imported ${r.providers} AI provider(s)${notes.length ? `. ${notes.join('; ')}.` : ''}`, false, 7000);
          modal.close();
          Settings.open();
        } catch (e) { toast(`Import failed: ${e.message}`, true, 6000); }
      },
    }, 'Import settings…');

    // Story memory limit (characters sent to the AI with each message)
    const ML = SettingsCore.MEMORY_LIMIT;
    let memoryLimit = SettingsCore.clampMemoryLimit(S.settings.memoryLimit);
    const memInput = el('input', { type: 'number', min: ML.MIN, max: ML.MAX, step: 10000, value: memoryLimit, style: 'width:140px' });
    const memHint = el('div', { class: 'hint' });
    const memPresets = el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;margin-top:6px' });
    const showMem = () => {
      memHint.textContent = `≈ ${Math.round(memoryLimit / 4).toLocaleString()} tokens ≈ ${Math.round(memoryLimit / 6).toLocaleString()} words. Sent with every message, so higher = slower and, on paid AIs, more costly per message. `
        + (memoryLimit > 400000 ? 'Above ~400,000 characters, check that your AI model accepts this much (most local models don\'t). If it\'s too much, the AI will reply with an error.' : `Range ${ML.MIN.toLocaleString()} – ${ML.MAX.toLocaleString()}. Default ${ML.DEFAULT.toLocaleString()}.`);
    };
    memInput.addEventListener('input', () => { if (memInput.value) { memoryLimit = SettingsCore.clampMemoryLimit(memInput.value); showMem(); } });
    memInput.addEventListener('change', () => { memInput.value = memoryLimit; });
    [[120000, '120k (default)'], [250000, '250k'], [500000, '500k'], [1000000, '1M'], [2000000, '2M (max)']].forEach(([v, label]) =>
      memPresets.append(el('button', { class: 'small', onclick: () => { memoryLimit = v; memInput.value = v; showMem(); } }, label)));
    showMem();

    const fontSize = el('input', { type: 'number', min: '12', max: '28', value: ui.fontSize });
    fontSize.oninput = () => { ui.fontSize = +fontSize.value; document.documentElement.style.setProperty('--editor-size', ui.fontSize + 'px'); };

    const save = async () => {
      await persistSettings({ providers: draft, activeProviderId: activeId, ui, memoryLimit });
      // Re-sync the draft with what was stored (keys become "stored" flags).
      S.settings.providers.forEach((sp) => { const d = draft.find((x) => x.id === sp.id); if (d) { d.hasKey = sp.hasKey; delete d.newApiKey; } });
    };

    const modal = openModal({
      title: 'Settings',
      wide: true,
      body: el('div', {},
        el('h3', { style: 'margin:4px 0 8px;font-family:var(--serif);font-weight:500' }, 'AI providers'),
        el('p', { class: 'muted', style: 'margin-top:0' }, 'Add as many as you like and switch between them from the AI dropdown in the top bar.'),
        listBox,
        presetSel,
        el('h3', { style: 'margin:22px 0 8px;font-family:var(--serif);font-weight:500' }, 'Writing'),
        el('div', { class: 'field' }, el('label', {}, 'Editor text size (px)'), fontSize),
        el('h3', { style: 'margin:22px 0 8px;font-family:var(--serif);font-weight:500' }, 'AI context'),
        el('div', { class: 'field' }, el('label', {}, 'Story memory limit'),
          el('div', {}, el('div', { style: 'display:flex;align-items:center;gap:8px' }, memInput, el('span', { class: 'muted' }, 'characters')), memPresets),
          memHint),
        el('h3', { style: 'margin:22px 0 8px;font-family:var(--serif);font-weight:500' }, 'Your settings'),
        version,
        where,
        el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px' },
          exportBtn, el('label', { class: 'check', style: 'font-size:12px' }, inclKeys, 'include API keys'), importBtn),
        el('h3', { style: 'margin:22px 0 8px;font-family:var(--serif);font-weight:500' }, App.logo('small'), 'About Crucible'),
        el('div', { class: 'muted', style: 'font-size:12px;margin:-2px 0 6px' }, `Made by ${Settings.AUTHOR}`),
        Settings.authorNote(),
        el('p', { class: 'muted', style: 'font-size:12px;line-height:1.6;margin:0' },
          'Crucible is a free manuscript editor. Your books, notes and API keys stay on your computer (or your drive); Crucible only connects to the AI services you add here, and only when you use them. No accounts, no tracking.',
          el('br'), el('br'),
          'Licence: MIT with the Commons Clause. Free for everyone to use, change and share; Crucible itself may not be sold. Everything you write with it is yours to publish and sell.',
          el('br'), 'Includes marked (Markdown parser, MIT License) and DOMPurify (HTML sanitizer, Apache License 2.0). See LICENSE and THIRD_PARTY_LICENSES.md.'),
        el('p', { class: 'muted', style: 'font-size:11.5px' }, 'Export/import works between computers, browsers, and the desktop and browser editions. Your books\' change pools, AI chats and story memory are stored with each book, so they always come along.')),
      buttons: [{ label: 'Cancel', onClick: () => App.applyUi() }, { label: 'Save', accent: true, onClick: save }],
    });
    renderList();
  },
};
