import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
const paths=execFileSync('git',['diff','--cached','--name-only','--diff-filter=ACMR','-z'],{encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
if(!paths.length)throw Error('Nenhum arquivo staged para revisar.');
const failures=[];
for(const file of paths){
 if(/(^|\/)(?:node_modules|artifacts|logs|backups|cluster)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:dpapi|ruybak|dump|backup|keybundle|pfx|p12|pem|key|sqlite3?|db|exe)$/i.test(file))failures.push({file,reason:'arquivo privado/gerado não pode ser commitado'});
 const staged=execFileSync('git',['show',':'+file],{maxBuffer:16*1024*1024,windowsHide:true});
 if(staged.length>10*1024*1024)failures.push({file,reason:'arquivo grande fora do contrato de fonte'});
 if(/\.(ttf|ico|png)$/.test(file)){
  if(!/^(lab\/d1\/public\/fonts\/|desktop\/assets\/)/.test(file))failures.push({file,reason:'binário fora dos assets revisados'});
  continue;
 }
 const text=staged.toString('utf8');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]{16,}|postgres(?:ql)?:\/\/[^\s'"<>]+:[^\s'"<>]+@/i.test(text))failures.push({file,reason:'possível credencial privada; revisar sem imprimir conteúdo'});
 if(staged.includes(0))failures.push({file,reason:'binário inesperado'});
}
// Também comprova que dumps/instaladores locais não entraram no conjunto staged.
const result={filesReviewed:paths.length,failures};
await fs.writeFile('logs/staged-content-review.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));if(failures.length)process.exitCode=1;
