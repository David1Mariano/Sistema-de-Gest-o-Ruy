const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ruyReports',Object.freeze({save:request=>ipcRenderer.invoke('ruy:report:save',request)}));
