'use strict';
// The picker window can only do these four things.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('exaPicker', {
  init: () => ipcRenderer.invoke('picker:init'),
  list: (dir) => ipcRenderer.invoke('picker:list', dir),
  send: (paths) => ipcRenderer.invoke('picker:send', paths),
  cancel: () => ipcRenderer.invoke('picker:cancel'),
});
