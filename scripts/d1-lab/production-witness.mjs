import fs from 'node:fs/promises';
import path from 'node:path';
export async function productionWitness(){
 let present=false;
 try{await fs.access(path.join(process.env.LOCALAPPDATA||'','GestaoRuy','producao','active.json'));present=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 let response;
 try{response=await fetch('http://127.0.0.1:8080/__health',{signal:AbortSignal.timeout(3000)});}
 catch(e){
  if(!present&&process.env.RUY_NEW_MACHINE_LAB==='1')return {absentOnNewMachineLab:true};
  throw e;
 }
 if(!response.ok)throw Error('Produção 8080 não está saudável; teste interrompido.');
 const value=await response.json();if(value.service!=='gestao-ruy-production')throw Error('Serviço inesperado na porta 8080.');
 return value;
}
