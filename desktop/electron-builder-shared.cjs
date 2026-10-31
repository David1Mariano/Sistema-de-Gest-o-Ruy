const base=require('./electron-builder-operational.cjs');
module.exports={...base,
 // Same future product/shortcut identity; do not install over Pichau without approval.
 directories:{output:'../artifacts/multicomputador-0.10.0-rc.3-20261028/build'},
 files:[...base.files.map(entry=>entry&&entry.to==='dist-d1'?{...entry,from:'../artifacts/multicomputador-0.10.0-rc.3-20261028/frontend-reference/dist-d1'}:entry),'central-endpoint.json',{from:'../server/sync-lab',to:'server/sync-lab',filter:['*.mjs','*.sql']},{from:'../server/central',to:'server/central',filter:['public-discovery.mjs']}],
 extraMetadata:{...base.extraMetadata,main:'windows-operational-entry.cjs',version:'0.10.0-rc.3',ruyRelease:'RUY-NGROK-HOMOLOGACAO-20261028',ruySharedLab:true,ruySharedClientDefault:true,ruyAuthentication:'user-session'},
 nsis:{...base.nsis,include:'nsis-shared-shortcuts.nsh',createDesktopShortcut:'always',artifactName:'Sistema-Ruy-Compartilhado-0.10.0-rc.3-Setup.${ext}'},
};
