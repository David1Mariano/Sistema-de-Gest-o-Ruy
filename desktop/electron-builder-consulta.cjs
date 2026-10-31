const base=require('./electron-builder-operational.cjs');
module.exports={...base,
 directories:{output:'../artifacts/multicomputador-0.10.0-rc.4-20261029/build'},
 files:[...base.files.map(entry=>entry&&entry.to==='dist-d1'?{...entry,from:'../artifacts/multicomputador-0.10.0-rc.4-20261029/frontend-reference/dist-d1'}:entry),
  {from:'../artifacts/multicomputador-0.10.0-rc.4-20261029/public-metadata',to:'.',filter:['central-endpoint.json']},
  {from:'../server/sync-lab',to:'server/sync-lab',filter:['*.mjs','*.sql']},
  {from:'../server/central',to:'server/central',filter:['public-discovery.mjs']}],
 extraMetadata:{...base.extraMetadata,main:'windows-operational-entry.cjs',version:'0.10.0-rc.4',description:'Sistema Ruy - consulta compartilhada',ruyRelease:'RUY-READONLY-OFFICIAL-20261029',ruySharedLab:true,ruySharedClientDefault:true,ruyAuthentication:'user-session',ruyReadOnlyConsultation:true},
 nsis:{...base.nsis,include:'nsis-shared-shortcuts.nsh',createDesktopShortcut:'always',artifactName:'Sistema-Ruy-Compartilhado-0.10.0-rc.4-Setup.${ext}'},
 afterPack:async context=>{
  await base.afterPack?.(context);
  const asar=require('@electron/asar'),path=require('node:path');
  const archive=path.join(context.appOutDir,'resources','app.asar');
  const metadata=JSON.parse(asar.extractFile(archive,'central-endpoint.json'));
  if(metadata.discoveryUrl!=='https://api.ruycaldodecana.com.br/.well-known/sistema-ruy.json'||!metadata.discoveryPublicKey||metadata.endpoint!==null)throw Error('PACKAGED_OFFICIAL_DISCOVERY_REQUIRED');
  for(const file of ['shared-main.mjs','download-policy.mjs','consultation-acceptance.mjs','dist-d1/lab/d1/index.html'])asar.extractFile(archive,path.normalize(file));
  if(asar.listPackage(archive).some(file=>/\.(?:dpapi|pem|key|pfx|ruybak|aesgcm)$/i.test(file)))throw Error('PRIVATE_MATERIAL_IN_PACKAGE_REFUSED');
 },
};
