const base=require('./electron-builder-operacao.cjs');
module.exports={...base,
 directories:{output:'../artifacts/multicomputador-0.10.0-rc.6-20261030/build'},
 files:base.files.map(entry=>entry?.to==='dist-d1'?{...entry,from:'../artifacts/multicomputador-0.10.0-rc.6-20261030/frontend-reference/dist-d1'}:entry),
 extraMetadata:{...base.extraMetadata,version:'0.10.0-rc.6',description:'Sistema Ruy — operação central e comprovantes PDF',ruyRelease:'RUY-CENTRAL-PDF-20261030'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-0.10.0-rc.6-Setup.${ext}'},
};
