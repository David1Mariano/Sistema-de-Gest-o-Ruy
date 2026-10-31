const base=require('./electron-builder-consulta.cjs');
module.exports={...base,
 directories:{output:'../artifacts/multicomputador-0.10.0-rc.5-20261029/build'},
 files:base.files.map(entry=>entry?.to==='dist-d1'?{...entry,from:'../artifacts/multicomputador-0.10.0-rc.5-20261029/frontend-reference/dist-d1'}:entry),
 extraMetadata:{...base.extraMetadata,version:'0.10.0-rc.5',ruyRelease:'RUY-OPERATIONAL-CENTRAL-20261029',ruyReadOnlyConsultation:false},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-0.10.0-rc.5-Setup.${ext}'},
};
