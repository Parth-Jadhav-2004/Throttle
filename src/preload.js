const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getState: () => ipcRenderer.invoke('get-state'),
  updateSettings: patch => ipcRenderer.invoke('update-settings', patch),
  refresh: provider => ipcRenderer.invoke('refresh', provider),
  connect: provider => ipcRenderer.invoke('open-login', provider),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  openMobilePairing: () => ipcRenderer.invoke('open-mobile-pairing'),
  getMobileAccessStatus: () => ipcRenderer.invoke('get-mobile-access-status'),
  enableMobileAccess: () => ipcRenderer.invoke('enable-mobile-access'),
  getMobilePairing: () => ipcRenderer.invoke('get-mobile-pairing'),
  suspendShortcut: suspended => ipcRenderer.invoke('suspend-shortcut', suspended),
  copyScreenshot: rect => ipcRenderer.invoke('copy-screenshot', rect),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  reportIssue: () => ipcRenderer.invoke('report-issue'),
  reportSize: height => ipcRenderer.send('popup-size', height),
  setTrayImage: payload => ipcRenderer.send('tray-image', payload),
  hide: () => ipcRenderer.send('hide-popup'),
  quit: () => ipcRenderer.send('quit'),
  onUsageState: callback => ipcRenderer.on('usage-state', (_event, state) => callback(state)),
  onShown: callback => ipcRenderer.on('popup-shown', (_event, payload) => callback(payload)),
  onHidden: callback => ipcRenderer.on('popup-hidden', () => callback())
});
