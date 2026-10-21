const base=require('./electron-builder-agente5.cjs');
module.exports={...base,
 appId:'br.ruy.gestao.windows.candidate.20261021',productName:'Sistema Ruy - Candidata Windows 20261021',
 directories:{output:'../artifacts/ruy-windows-0.6.0-rc.1-20261021'},
 files:[...base.files,'individual-admin-renderer.js','!*-smoke.mjs','!*-test.mjs'],
 electronDist:'C:/Users/Pichau/gestao-ruy-windows-oficial-20261015/desktop/node_modules/electron/dist',
 extraMetadata:{...base.extraMetadata,main:'windows-candidate-entry.cjs',version:'0.6.0-rc.1',ruyRevision:'RUY-WINDOWS-CANDIDATE-20261021',ruyAppId:'br.ruy.gestao.windows.candidate.20261021',ruyIndividualIdentity:true,ruyRecoveredPreview:true},
 nsis:{...base.nsis,perMachine:false,allowElevation:false,include:'nsis-current-user-readback.nsh',artifactName:'Sistema-Ruy-Windows-0.6.0-rc.1-20261021-Setup.${ext}',shortcutName:'Sistema Ruy - Candidata Windows 20261021'},
};
