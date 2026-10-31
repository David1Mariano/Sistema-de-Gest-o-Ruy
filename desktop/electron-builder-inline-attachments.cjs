const base=require('./electron-builder-pdf.cjs');
module.exports={...base,
 directories:{output:'../artifacts/multicomputador-0.10.0-rc.7-20261030/build'},
 files:base.files.map(entry=>entry?.to==='dist-d1'?{...entry,from:'../artifacts/multicomputador-0.10.0-rc.7-20261030/frontend-reference/dist-d1'}:entry),
 extraMetadata:{...base.extraMetadata,version:'0.10.0-rc.7',ruyRelease:'RUY-INLINE-ATTACHMENTS-20261030'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-0.10.0-rc.7-Setup.${ext}'},
};
