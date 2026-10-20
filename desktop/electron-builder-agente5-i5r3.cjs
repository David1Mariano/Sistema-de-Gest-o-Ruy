const base=require('./electron-builder-agente5.cjs');
module.exports={...base,
 appId:'br.ruy.gestao.agente5.integracao5r3.homologacao',
 productName:'Sistema Ruy - I5 R3 Homologacao',
 directories:{output:'../artifacts/agente5-integracao5r3-20261020'},
 extraMetadata:{...base.extraMetadata,main:'i5r3-entry.cjs',version:'0.5.2-rc.3',ruyRevision:'A5-I5-R3-20261020',ruyAppId:'br.ruy.gestao.agente5.integracao5r3.homologacao'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-A5-I5-R3-20261020-Setup.${ext}',shortcutName:'Sistema Ruy - I5 R3 Homologacao'},
};
