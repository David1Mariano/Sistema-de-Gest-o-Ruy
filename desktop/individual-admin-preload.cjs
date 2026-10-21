const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('ruyAdmin',Object.freeze({details:()=>ipcRenderer.invoke('ruy-admin-details'),provision:body=>ipcRenderer.invoke('ruy-admin-provision',body)}));
