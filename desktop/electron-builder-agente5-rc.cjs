const base=require('./electron-builder-agente5.cjs');
module.exports={...base,
 productName:'Sistema Ruy - Candidato RC1 Homologacao',
 directories:{output:'../artifacts/agente5-rc1-20261017'},
 extraMetadata:{...base.extraMetadata,version:'0.5.1-rc.1',ruyRevision:'A5-RC1-20261017'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-A5-RC1-20261017-Setup.${ext}',shortcutName:'Sistema Ruy - RC1 Homologacao'},
};
