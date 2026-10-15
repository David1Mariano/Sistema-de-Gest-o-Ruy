import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import pg from 'pg';
import {powershell,binding,pgCommand} from '../local-lab/environment.mjs';
export {pgCommand};
export const home=path.join(process.env.LOCALAPPDATA||'','GestaoRuy','etapa-c2-sync');
export const cluster=path.join(home,'cluster');
export const dbPort=55435;
export const ports={A:18084,B:18085,central:18086};
export const dbNames={A:'ruy_c2_a',B:'ruy_c2_b',central:'ruy_c2_central'};
export async function seal(name,value){
 const encrypted=powershell("ConvertFrom-SecureString (ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force)",JSON.stringify(value));
 await fs.writeFile(path.join(home,name+'.dpapi'),encrypted,{flag:'wx'});
}
export async function unseal(name){
 const data=await fs.readFile(path.join(home,name+'.dpapi'),'utf8');
 return JSON.parse(powershell("$s=ConvertTo-SecureString ([Console]::In.ReadToEnd());$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}",data));
}
export async function marker(){
 const value=JSON.parse(await fs.readFile(path.join(home,'lab.json'),'utf8'));
 if(value.purpose!=='RUY_C2_SYNTHETIC_ONLY'||value.machine!==binding()||(await fs.realpath(home)).toLowerCase()!==path.resolve(home).toLowerCase())throw Error('Destino C2 fora do laboratório.');
 return value;
}
export async function createHome(value){
 if(process.platform!=='win32'||!process.env.LOCALAPPDATA)throw Error('Requer Windows.');
 await fs.mkdir(path.dirname(home),{recursive:true});await fs.mkdir(home);
 const sid=powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
 execFileSync('icacls.exe',[home,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true,stdio:'ignore'});
 await fs.writeFile(path.join(home,'lab.json'),JSON.stringify({...value,purpose:'RUY_C2_SYNTHETIC_ONLY',machine:binding()},null,2),{flag:'wx'});
}
export async function config(mode,owner=false){
 if(!Object.hasOwn(ports,mode))throw Error('Dispositivo desconhecido.');
 await marker();const c=await unseal(owner?'owner':mode);
 const db=owner?{...c,database:dbNames[mode]}:c.db;
 if(db.host!=='127.0.0.1'||db.port!==dbPort||db.database!==dbNames[mode]||db.user!==(owner?'ruy_c2_owner':`ruy_c2_${mode.toLowerCase()}_app`))throw Error('Banco não pertence à simulação C2.');
 return owner?db:c;
}
export async function pool(mode){
 const c=await config(mode);const p=new pg.Pool({...c.db,max:6,connectionTimeoutMillis:3000,statement_timeout:5000});
 p.on('error',()=>console.error('Conexão C2 interrompida.'));return {pool:p,config:c};
}
export function run(bin,name,args){return pgCommand(bin,name,args);}
export function checkPort(port){
 const result=spawnSync('powershell.exe',['-NoProfile','-Command',`if(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue){exit 1}`],{windowsHide:true,stdio:'ignore'});
 if(result.status!==0)throw Error('Porta C2 ocupada; nenhum processo encerrado.');
}
