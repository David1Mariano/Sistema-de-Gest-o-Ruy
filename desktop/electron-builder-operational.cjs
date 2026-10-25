const base=require('./electron-builder-windows-candidate.cjs');
module.exports={...base,
 appId:'br.ruy.gestao.windows.operacional',productName:'Sistema Ruy',
 directories:{output:'../artifacts/sistema-ruy-0.7.0-rc.1-20261024'},
 extraMetadata:{...base.extraMetadata,main:'windows-operational-entry.cjs',version:'0.7.0-rc.1',ruyRevision:'RUY-WINDOWS-OPERATIONAL-20261024',ruyAppId:'br.ruy.gestao.windows.operacional',ruyOperationalWorkspace:true},
 nsis:{...base.nsis,guid:'75c7b9b8-6d06-4bf1-89d1-4e566b45c050',artifactName:'Sistema-Ruy-0.7.0-rc.1-Setup.${ext}',shortcutName:'Sistema Ruy'},
};
