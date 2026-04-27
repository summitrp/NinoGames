'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window
  winMinimize:  () => ipcRenderer.send('win-minimize'),
  winMaximize:  () => ipcRenderer.send('win-maximize'),
  winClose:     () => ipcRenderer.send('win-close'),
  openExternal: url => ipcRenderer.send('open-external', url),
  openPath:     p   => ipcRenderer.send('open-path', p),
  onWindowState: cb => ipcRenderer.on('window-state', (_e, s) => cb(s)),

  // Search / game info
  search:        (q, p, src) => ipcRenderer.invoke('search', { query: q, page: p, source: src }),
  getGamePage:   url    => ipcRenderer.invoke('get-game-page', url),
  fetchUpcoming:  ()    => ipcRenderer.invoke('fetch-upcoming'),
  fetchDiscovery: ()    => ipcRenderer.invoke('fetch-discovery'),

  // Library
  getLibrary:    ()        => ipcRenderer.invoke('get-library'),
  scanLibrary:   ()        => ipcRenderer.invoke('scan-library'),
  removeGame:    id        => ipcRenderer.invoke('remove-game', id),
  uninstallGame: id        => ipcRenderer.invoke('uninstall-game', id),
  launchGame:    id        => ipcRenderer.invoke('launch-game', id),

  // Wishlist
  getWishlist:    ()     => ipcRenderer.invoke('get-wishlist'),
  isWishlisted:   id     => ipcRenderer.invoke('is-wishlisted', id),
  toggleWishlist: game   => ipcRenderer.invoke('toggle-wishlist', game),

  // Downloads
  startDownload:         opts => ipcRenderer.invoke('start-download', opts),
  cancelDownload:  id      => ipcRenderer.invoke('cancel-download', id),
  pauseDownload:   id      => ipcRenderer.invoke('pause-download', id),
  resumeDownload:  id      => ipcRenderer.invoke('resume-download', id),

  // Settings
  getSettings:  ()  => ipcRenderer.invoke('get-settings'),
  saveSettings: s   => ipcRenderer.invoke('save-settings', s),
  pickFolder:   ()  => ipcRenderer.invoke('pick-folder'),

  // Extra game actions
  addToSteam:         opts => ipcRenderer.invoke('add-to-steam', opts),
  addDesktopShortcut: opts => ipcRenderer.invoke('add-desktop-shortcut', opts),

  // Events from main
  onDownloadProgress: cb => ipcRenderer.on('download-progress', (_e, d) => cb(d)),
  onDownloadDone:     cb => ipcRenderer.on('download-done',     (_e, d) => cb(d)),
  onDownloadStatus:   cb => ipcRenderer.on('download-status',   (_e, d) => cb(d)),
  onExtractProgress:  cb => ipcRenderer.on('extract-progress',  (_e, d) => cb(d)),
  onLibraryUpdated:   cb => ipcRenderer.on('library-updated',   (_e)    => cb()),

  // DevTools panel
  checkAria2:            ()       => ipcRenderer.invoke('check-aria2'),
  getDevtoolsInfo:       ()       => ipcRenderer.invoke('get-devtools-info'),
  captureScraperPreview: (gameId) => ipcRenderer.invoke('capture-scraper-preview', gameId),
  openDevTools:          ()       => ipcRenderer.send('open-devtools'),
  onToggleDevtoolsPanel: cb       => ipcRenderer.on('toggle-devtools-panel', () => cb()),

  // Verify
  verifyInstall: (gameId) => ipcRenderer.invoke('verify-install', gameId),
});
