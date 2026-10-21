const base=require('./electron-builder-windows-candidate.cjs');
module.exports={...base,
 appId:'br.ruy.gestao.windows.layout.20261021',productName:'Sistema Ruy - Layout Original 20261021',
 directories:{output:'../artifacts/ruy-windows-layout-0.6.0-rc.2-final-20261021'},
 extraMetadata:{...base.extraMetadata,main:'windows-layout-entry.cjs',version:'0.6.0-rc.2',ruyRevision:'RUY-WINDOWS-LAYOUT-20261021',ruyAppId:'br.ruy.gestao.windows.layout.20261021'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-Windows-Layout-0.6.0-rc.2-Final-20261021-Setup.${ext}',shortcutName:'Sistema Ruy - Layout Original 20261021'},
};
