const base=require('./electron-builder-windows-candidate.cjs');
const fs=require('node:fs');
module.exports={...base,
 electronDist:require('node:path').dirname(require('electron')),

 files:[...base.files.flatMap(pattern=>pattern==='*.mjs'?fs.readdirSync(__dirname).filter(name=>name.endsWith('.mjs')&&!/-(?:smoke|test)\.mjs$/.test(name)):pattern==='*.cjs'?fs.readdirSync(__dirname).filter(name=>name.endsWith('.cjs')&&!name.startsWith('electron-builder-')):[pattern]),{from:'../server/central',to:'server/central',filter:['context.mjs']}],
 appId:'br.ruy.gestao.windows.operacional',productName:'Sistema Ruy',
 directories:{output:'../artifacts/instalador-universal-20261026/build'},
 extraMetadata:{...base.extraMetadata,main:'windows-operational-entry.cjs',version:'0.7.1-rc.2',ruyRelease:'RUY-PDF-20261026',ruyRevision:'RUY-WINDOWS-OPERATIONAL-20261024',ruyAppId:'br.ruy.gestao.windows.operacional',ruyOperationalWorkspace:true},
 nsis:{...base.nsis,guid:'75c7b9b8-6d06-4bf1-89d1-4e566b45c050',artifactName:'Sistema-Ruy-0.7.1-rc.2-Setup.${ext}',shortcutName:'Sistema Ruy'},
};
