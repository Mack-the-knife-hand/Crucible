// =============================================================================
// settings-core.js — how settings survive new versions of Crucible
// -----------------------------------------------------------------------------
// Shared by the desktop back end (main.js) and the browser edition.
//
// 1. migrateSettings(): every version reads settings through this. It fills in
//    defaults for anything new and NEVER drops fields it doesn't recognise, so
//    upgrading (or even downgrading) keeps everything you've set up.
//    When a future version renames or reshapes a setting, the conversion goes
//    in the "upgrade steps" block below, keyed on the schema number.
//
// 2. portableSettings() / mergeImported(): the "Export settings" file
//    (crucible-settings.json). Works between computers, browsers, and between
//    the desktop and browser editions.
// =============================================================================

(function (root) {
  const SETTINGS_SCHEMA = 2;
  // Story memory sent to the AI with each message, in characters.
  // DESIGN DECISION (author's requirement): MAX is deliberately set far above
  // what most models accept today (2,000,000 chars ≈ 500k tokens) so Crucible
  // can grow as models get larger context windows. Do NOT lower it to match
  // current models. The default stays conservative; users raise it when
  // their model can handle it. To allow more in future, raise MAX here only.
  // Both editions and the Settings screen read it from this one place.
  const MEMORY_LIMIT = { DEFAULT: 120000, MIN: 10000, MAX: 2000000 };
  const clampMemoryLimit = (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) return MEMORY_LIMIT.DEFAULT;
    return Math.min(MEMORY_LIMIT.MAX, Math.max(MEMORY_LIMIT.MIN, n));
  };

  function defaultSettings() {
    return {
      schema: SETTINGS_SCHEMA,
      providers: [],
      activeProviderId: null,
      playlist: [],
      volume: 0.7,
      ui: { theme: 'dark', fontSize: 17, view: 'edit', leftCollapsed: false, rightCollapsed: false, autosave: false },
      recent: [],
      recentHome: [],     // books inside your Crucible folder (paths relative to it)
      keysInFile: true,   // browser edition: keep API keys in crucible-settings.json
      memoryLimit: MEMORY_LIMIT.DEFAULT, // story memory characters sent per message
      dailyGoal: 0,       // writing goal, words per day (0 = off)
      personas: [],       // your own beta readers
    };
  }

  function migrateSettings(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const from = Number(raw.schema) || 1;
    const s = Object.assign(defaultSettings(), raw);
    s.ui = Object.assign(defaultSettings().ui, raw.ui || {});
    for (const k of ['providers', 'playlist', 'recent', 'recentHome', 'personas']) if (!Array.isArray(s[k])) s[k] = [];
    s.dailyGoal = Math.max(0, Math.round(Number(s.dailyGoal) || 0));
    s.memoryLimit = clampMemoryLimit(s.memoryLimit);

    // ---- upgrade steps (add new ones at the bottom) ----
    if (from < 2) {
      // 1.0 → 1.1: no renames; panel-collapse settings added with defaults above.
    }

    s.schema = Math.max(SETTINGS_SCHEMA, from); // never stamp a newer file as older
    return s;
  }

  const songPlatform = (p) => (/^(h|df|sess|mem|home):/.test(String(p)) ? 'web' : 'desktop');

  // What goes into a settings file. plainKeyOf(provider) returns the real key.
  function portableSettings(s, { includeKeys = false, plainKeyOf = () => '', platform = 'web', version = '' } = {}) {
    return {
      crucibleSettings: true,
      schema: SETTINGS_SCHEMA,
      app: version,
      from: platform,
      exportedAt: new Date().toISOString(),
      includesKeys: !!includeKeys,
      providers: (s.providers || []).map((p) => {
        const { apiKey, hasKey, newApiKey, ...rest } = p;
        const key = includeKeys ? plainKeyOf(p) : '';
        return { ...rest, ...(key ? { apiKey: key } : {}), hadKey: !!(apiKey || hasKey) };
      }),
      activeProviderId: s.activeProviderId,
      playlist: (s.playlist || []).filter((x) => !String(x.path).startsWith('sess:')).map((x) => ({ ...x, platform: songPlatform(x.path) })),
      volume: s.volume,
      ui: s.ui,
      recentHome: s.recentHome || [],
      keysInFile: s.keysInFile !== false,
      memoryLimit: s.memoryLimit,
      dailyGoal: s.dailyGoal,
      personas: s.personas || [],
    };
  }

  // A saved API key only ever goes to the address it was entered for. If a
  // provider's address or type changes (by editing it, or because an imported
  // file or backup says so), its key is dropped and must be typed again, so a
  // doctored settings file can't redirect your key to someone else's server.
  // Only the scheme and server name are case-insensitive; the path and query
  // are compared exactly (/TenantA and /tenanta can be different accounts).
  function normUrl(u) {
    const t = String(u || '').trim();
    try {
      const x = new URL(t); // lower-cases scheme + host, drops default ports
      return `${x.protocol}//${x.host}${x.pathname.replace(/\/+$/, '')}${x.search}`;
    } catch { return t.replace(/\/+$/, ''); }
  }
  // "where requests go", for showing to the user
  function hostOf(u) { try { return new URL(String(u)).host || String(u); } catch { return String(u || '(none)'); } }
  function endpointChanged(old, p) {
    return !!old && (normUrl(old.baseUrl) !== normUrl(p.baseUrl) || (old.type || '') !== (p.type || ''));
  }
  function keyFor(old, p, newKey) {
    if (newKey) return newKey;
    if (!old || endpointChanged(old, p)) return '';
    return old.apiKey || '';
  }

  // Merge a settings file into the current settings. encrypt(plain) stores a key.
  // replace: true  → the file is the source of truth (your Crucible folder's
  //                  settings file); providers/songs not in it are dropped.
  // replace: false → "Import settings": adds and updates, never removes.
  //
  // endpoints: 'ask' (default) → a file never changes where an AI sends your
  //   text, and never adds a new AI, by itself. Those changes are left out
  //   and listed in result.endpointChanges; the app shows them and, only if
  //   you agree, merges again with endpoints: 'apply'. "Approved" means
  //   exactly what's in your current settings (they only get there through
  //   your own edits or an explicit OK), so a rejected address is asked about
  //   again next time, never applied. While changes are withheld, your
  //   existing AIs and your choice of AI are left exactly as they are, even
  //   in replace mode.
  function mergeImported(current, file, { platform = 'web', encrypt = (k) => k, replace = false, endpoints = 'ask' } = {}) {
    if (!file || file.crucibleSettings !== true) throw new Error("That isn't a Crucible settings file.");
    const next = migrateSettings(current);
    const oldById = new Map(next.providers.map((p) => [p.id, p]));
    const byId = replace ? new Map() : new Map(oldById);
    const endpointChanges = [];
    let keysMissing = 0;
    for (const p of file.providers || []) {
      if (!p || !p.id || typeof p.id !== 'string') continue;
      const old = oldById.get(p.id);
      const { apiKey, hadKey, hasKey, ...rest } = p;
      let merged = { ...(old || {}), ...rest };
      const isNew = !old;
      if (isNew || endpointChanged(old, merged)) {
        endpointChanges.push({ id: p.id, name: String(merged.name || 'Unnamed'), from: isNew ? null : String(old.baseUrl || ''), to: String(merged.baseUrl || ''), fromHost: isNew ? null : hostOf(old.baseUrl), toHost: hostOf(merged.baseUrl), type: merged.type });
        if (endpoints !== 'apply') {
          if (isNew) continue; // not added without your OK
          merged = { ...merged, baseUrl: old.baseUrl, type: old.type }; // address unchanged
        }
      }
      const stored = keyFor(old, merged, apiKey ? encrypt(apiKey) : '');
      if ((hadKey || (old && old.apiKey)) && !stored) keysMissing++;
      byId.set(p.id, { ...merged, apiKey: stored || '' });
    }
    const withheld = endpoints !== 'apply' && endpointChanges.length > 0;
    if (replace && withheld) for (const [id, old] of oldById) if (!byId.has(id)) byId.set(id, old); // keep your AIs
    next.providers = [...byId.values()];
    // An imported file never switches which AI you're using. Your own Crucible
    // folder's file (replace: true) may, but only when nothing is withheld.
    const hadActive = !!next.activeProviderId && byId.has(next.activeProviderId);
    const wantActive = (replace && !withheld) || !hadActive;
    if (wantActive && file.activeProviderId && byId.has(file.activeProviderId)) next.activeProviderId = file.activeProviderId;
    if (!byId.has(next.activeProviderId)) next.activeProviderId = next.providers[0] ? next.providers[0].id : null;

    const incoming = (file.playlist || []).filter((x) => x && x.path && !String(x.path).startsWith('sess:'));
    const usable = incoming.filter((x) => (x.platform || songPlatform(x.path)) === platform);
    const base = replace ? [] : next.playlist;
    const have = new Set(base.map((x) => x.path));
    next.playlist = [...base, ...usable.filter((x) => !have.has(x.path)).map(({ platform: _p, ...r }) => r)];
    if (file.ui) next.ui = { ...next.ui, ...file.ui };
    if (typeof file.volume === 'number') next.volume = file.volume;
    if (Array.isArray(file.recentHome)) next.recentHome = file.recentHome;
    if (typeof file.keysInFile === 'boolean') next.keysInFile = file.keysInFile;
    if (file.memoryLimit != null) next.memoryLimit = clampMemoryLimit(file.memoryLimit);
    if (file.dailyGoal != null) next.dailyGoal = Math.max(0, Math.round(Number(file.dailyGoal) || 0));
    if (Array.isArray(file.personas)) {
      const have = new Set((replace ? [] : next.personas).map((p) => p.name));
      next.personas = [...(replace ? [] : next.personas), ...file.personas.filter((p) => p && p.name && !have.has(p.name))];
    }
    return { next, keysMissing, skippedSongs: incoming.length - usable.length, providers: (file.providers || []).length, endpointChanges };
  }

  const api = { SETTINGS_SCHEMA, MEMORY_LIMIT, clampMemoryLimit, defaultSettings, migrateSettings, portableSettings, mergeImported, endpointChanged, keyFor, normUrl, hostOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SettingsCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
