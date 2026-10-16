const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('labRecovery',{submit:passphrase=>ipcRenderer.invoke('ruy-recovery-submit',passphrase)});
