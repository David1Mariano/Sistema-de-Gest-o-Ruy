const base=require('./electron-builder-agente5.cjs');
module.exports={...base,
 appId:'br.ruy.gestao.agente5.integracao5.homologacao',
 productName:'Sistema Ruy - Integracao 5 Homologacao',
 directories:{output:'../artifacts/agente5-integracao5-20261019'},
 extraMetadata:{...base.extraMetadata,version:'0.5.2-rc.1',ruyRevision:'A5-I5-20261019',ruyAppId:'br.ruy.gestao.agente5.integracao5.homologacao'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-A5-I5-20261019-Setup.${ext}',shortcutName:'Sistema Ruy - I5 Homologacao'},
};
