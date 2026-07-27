const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  refresh: () => ipcRenderer.invoke('refresh-usage'),
  setOpacity: value => ipcRenderer.invoke('set-opacity', value),
  setGridOpacity: value => ipcRenderer.invoke('set-grid-opacity', value),
  setRefreshSeconds: value => ipcRenderer.invoke('set-refresh-seconds', value),
  connect: () => ipcRenderer.invoke('open-login'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  openMobilePairing: () => ipcRenderer.invoke('open-mobile-pairing'),
  getMobileAccessStatus: () => ipcRenderer.invoke('get-mobile-access-status'),
  enableMobileAccess: () => ipcRenderer.invoke('enable-mobile-access'),
  getMobilePairing: () => ipcRenderer.invoke('get-mobile-pairing'),
  onUsageState: callback => ipcRenderer.on('usage-state', (_event, state) => callback(state)),
  onDockState: callback => ipcRenderer.on('dock-state', (_event, state) => callback(state)),
  dockTransitionComplete: (finalState, generation) =>
    ipcRenderer.send('dock-transition-complete', { finalState, generation }),
  hideDock: () => ipcRenderer.send('hide-dock')
});
