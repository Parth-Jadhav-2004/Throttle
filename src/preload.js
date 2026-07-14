const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('widget', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  refresh: () => ipcRenderer.invoke('refresh-usage'),
  setOpacity: value => ipcRenderer.invoke('set-opacity', value),
  setGridOpacity: value => ipcRenderer.invoke('set-grid-opacity', value),
  setRefreshSeconds: value => ipcRenderer.invoke('set-refresh-seconds', value),
  connect: () => ipcRenderer.invoke('open-login'),
  onUsageState: callback => ipcRenderer.on('usage-state', (_event, state) => callback(state)),
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close')
});
