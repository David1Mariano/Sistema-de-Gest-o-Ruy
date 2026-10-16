const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('labSetup',{
 choosePostgres:()=>ipcRenderer.invoke('ruy-setup-pg'),
 create:account=>ipcRenderer.invoke('ruy-setup-create',account),
});
