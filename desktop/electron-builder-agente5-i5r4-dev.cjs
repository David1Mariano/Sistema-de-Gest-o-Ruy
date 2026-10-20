const base=require('./electron-builder-agente5.cjs');
module.exports={...base,
 appId:'br.ruy.gestao.agente5.integracao5r4.dev',productName:'Sistema Ruy - I5 R4 Desenvolvimento',
 directories:{output:'../artifacts/agente5-i5r4-dev-20261020'},
 extraMetadata:{...base.extraMetadata,main:'i5r4-entry.cjs',version:'0.5.2-rc.4',ruyRevision:'A5-I5-R4-DEV-20261020',ruyAppId:'br.ruy.gestao.agente5.integracao5r4.dev'},
 nsis:{...base.nsis,perMachine:false,allowElevation:false,include:'nsis-current-user-readback.nsh',
  artifactName:'Sistema-Ruy-A5-I5-R4-DEV-20261020-Setup.${ext}',shortcutName:'Sistema Ruy - I5 R4 Desenvolvimento'},
};
