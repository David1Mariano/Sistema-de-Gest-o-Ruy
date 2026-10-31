const base=require('./electron-builder-no-centers.cjs');
module.exports={...base,
 directories:{output:'../artifacts/multicomputador-0.10.0-rc.11-20261030/build'},
 files:base.files.map(entry=>entry?.to==='dist-d1'?{...entry,from:'../artifacts/multicomputador-0.10.0-rc.11-20261030/frontend-reference/dist-d1'}:entry),
 extraMetadata:{...base.extraMetadata,version:'0.10.0-rc.11',ruyRelease:'RUY-FINANCIAL-INTEGRATION-20261030'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-0.10.0-rc.11-Setup.${ext}'},
};
