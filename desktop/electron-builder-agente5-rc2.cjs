const base=require('./electron-builder-agente5.cjs');
module.exports={...base,
 productName:'Sistema Ruy - Candidato RC2 Homologacao',
 directories:{output:'../artifacts/agente5-rc2-20261017'},
 extraMetadata:{...base.extraMetadata,version:'0.5.1-rc.2',ruyRevision:'A5-RC2-20261017'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-A5-RC2-20261017-Setup.${ext}',shortcutName:'Sistema Ruy - RC2 Homologacao'},
};
