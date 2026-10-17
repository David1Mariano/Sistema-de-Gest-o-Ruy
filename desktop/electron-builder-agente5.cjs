const base=require('./package.json').build;
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
// Resolve the complete production graph explicitly: junctions can confuse builder's collector.
const modules=new Map();
function collect(name,from){
 const resolve=createRequire(from);let directory=path.dirname(resolve.resolve(name));
 while(!fs.existsSync(path.join(directory,'package.json')))directory=path.dirname(directory);
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
 if(modules.has(name)){if(modules.get(name).version!==manifest.version)throw Error('Conflicting production dependency versions');return;}
 modules.set(name,{directory,version:manifest.version});
 for(const child of Object.keys(manifest.dependencies||{}))collect(child,path.join(directory,'package.json'));
}
collect('pg',path.join(__dirname,'../package.json'));
module.exports={...base,
 appId:'br.ruy.gestao.agente5.homologacao',productName:'Sistema Ruy - Homologacao Agente 5',
 directories:{output:'../artifacts/agente5-homolog-20261017'},
 files:[...base.files,'recovery-renderer.js','!electron-builder-*.cjs',...Array.from(modules,([name,value])=>({from:value.directory,to:'node_modules/'+name,filter:['**/*','!test/**','!tests/**']}))],
 extraMetadata:{ruyRevision:'A5-HOMOLOG-20261017',ruyAppId:'br.ruy.gestao.agente5.homologacao'},
 nsis:{...base.nsis,artifactName:'Sistema-Ruy-A5-Homolog-20261017-Setup.${ext}',shortcutName:'Sistema Ruy - Homologacao Agente 5'},
};
