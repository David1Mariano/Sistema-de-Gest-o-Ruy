const base=require('./electron-builder-windows-layout.cjs');
module.exports={...base,
 directories:{output:'../artifacts/ruy-windows-modulos-0.6.0-rc.3-20261022'},
 extraMetadata:{...base.extraMetadata,version:'0.6.0-rc.3'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-Windows-Modulos-0.6.0-rc.3-20261022-Setup.${ext}'},
};
