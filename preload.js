// =============================================================================
// Crucible — preload bridge
// -----------------------------------------------------------------------------
// The window runs sandboxed (no Node, no disk access). This file is the only
// doorway: it publishes a small, explicit API on `window.crucible` that maps
// each function to one IPC call handled in main.js. Nothing else gets through.
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('crucible', {
  platform: process.platform,

  // Manuscript
  openBook: invoke('book:open'),
  openBookPath: invoke('book:openPath'),
  saveBook: invoke('book:save'),
  saveBookAs: invoke('book:saveAs'),
  listBackups: invoke('book:backups'),
  readBackup: invoke('book:readBackup'),

  // Story memory
  addMemory: invoke('memory:add'),
  chooseChapterImage: invoke('book:chooseImage'),
  readBookImage: invoke('book:readImage'),
  newMemoryNote: invoke('memory:newNote'),
  readMemoryText: invoke('memory:readText'),
  writeMemoryText: invoke('memory:writeText'),
  memoryPath: invoke('memory:path'),
  deleteMemory: invoke('memory:delete'),

  // Music + files
  pickSongs: invoke('music:pickFiles'),
  pickMusicFolder: invoke('music:pickFolder'),
  pickImage: invoke('file:pickImage'),
  fileExists: invoke('file:exists'),
  reveal: invoke('file:reveal'),

  // Settings / AI / export
  getSettings: invoke('settings:get'),
  saveSettings: invoke('settings:save'),
  exportSettings: invoke('settings:export'),
  importSettings: invoke('settings:import'),
  confirmImportedEndpoints: invoke('settings:confirmEndpoints'),
  getVersion: invoke('app:version'),
  packageScan: invoke('package:scan'),
  // (An AbortSignal can't cross this bridge, so cancelling is its own call.)
  packageCancel: () => ipcRenderer.send('package:cancel'),
  packageWrite: (token, opts, onProgress) => {
    const h = (_e, d) => onProgress(d.done, d.total, d.name);
    ipcRenderer.on('package:progress', h);
    return ipcRenderer.invoke('package:write', token, opts).finally(() => ipcRenderer.removeListener('package:progress', h));
  },
  restorePackage: (onProgress) => {
    const h = (_e, d) => onProgress(d.done, d.total, d.name);
    ipcRenderer.on('package:progress', h);
    return ipcRenderer.invoke('package:restore').finally(() => ipcRenderer.removeListener('package:progress', h));
  },
  saveTextFile: invoke('file:saveText'),
  openTextFile: invoke('file:openText'),
  openDataFile: invoke('file:openData'),
  // Blobs can't cross the bridge; send the bytes.
  saveBinary: async ({ suggestedName, blob, kind }) => ipcRenderer.invoke('file:saveBinary', { suggestedName, bytes: new Uint8Array(await blob.arrayBuffer()), kind }),
  aiChat: invoke('ai:chat'),
  exportPdf: invoke('export:pdf'),

  // Spelling
  replaceMisspelling: invoke('spell:replace'),
  onSpelling: (fn) => ipcRenderer.on('spell:suggestions', (_e, d) => fn(d)),

  // Window state
  setDirty: (d) => ipcRenderer.send('state:dirty', d),
  setTitle: (t) => ipcRenderer.send('window:title', t),
  onSaveAndQuit: (fn) => ipcRenderer.on('app:saveAndQuit', fn),
  quitNow: () => ipcRenderer.send('app:quitNow'),
});
