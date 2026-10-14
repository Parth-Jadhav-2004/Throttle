const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('strip', {
  onState: callback => ipcRenderer.on('strip-state', (_event, state) => callback(state)),
  onHover: callback => ipcRenderer.on('strip-hover', (_event, inside) => callback(inside)),
  reportWidth: width => ipcRenderer.send('strip-width', width)
});
