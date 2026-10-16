import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const restartFixture=process.env.RUY_D1_RESTART_FIXTURE;
if(restartFixture&&(!/^[a-f0-9]{16}$/.test(restartFixture)||process.env.RUY_D1_ALLOW_TESTS!=='1'))throw Error('Fixture de restart inválida.');
export const DB_PORT = restartFixture?55437:55436;
export const API_PORT = Number(process.env.RUY_D1_TEST_API_PORT||18087);
if(![18087,18091].includes(API_PORT)||API_PORT!==18087&&process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Porta auxiliar exige laboratório explícito.');
export const home = path.join(process.env.LOCALAPPDATA || '', 'GestaoRuy', restartFixture?'agente5-restart-'+restartFixture:'etapa-d1-lab');
export const cluster = path.join(home, 'cluster');
export const database = 'ruy_d1_disposable';
export function windows() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw Error('Windows LOCALAPPDATA necessário.');
}
export function powershell(command, input) {
  windows();
  const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',command], {
    input, encoding:'utf8', windowsHide:true, timeout:30000,
  });
  if (result.status !== 0 || result.error) throw Error('Operação Windows protegida falhou; nenhum segredo foi impresso.');
  return result.stdout.trim();
}
export async function seal(file, value) {
  const encrypted = powershell("$v=[Console]::In.ReadToEnd(); ConvertFrom-SecureString (ConvertTo-SecureString $v -AsPlainText -Force)",JSON.stringify(value));
  await fs.writeFile(path.join(home,file),encrypted,{flag:'wx'});
}
export async function unseal(file) {
  const encrypted = await fs.readFile(path.join(home,file),'utf8');
  return JSON.parse(powershell("$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}",encrypted));
}
export function binding() {
  return createHash('sha256').update(powershell("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid")).digest('hex');
}
export async function validateHome() {
  windows();
  const marker=JSON.parse(await fs.readFile(path.join(home,'lab.json'),'utf8'));
  if(marker.purpose!=='RUY_D1_SYNTHETIC_ONLY' || marker.machine!==binding()) throw Error('Laboratório ausente, clonado ou de outro computador.');
  if(restartFixture&&(marker.restartFixture!==restartFixture||marker.port!==55437))throw Error('Cluster de restart não identificado.');
  const real=await fs.realpath(home);
  if(real.toLowerCase()!==path.resolve(home).toLowerCase()) throw Error('Redirecionamento de diretório recusado.');
  return marker;
}
export async function config(owner=false) {
  await validateHome();
  const c=await unseal(owner?'owner.dpapi':'app.dpapi');
  if(c.host!=='127.0.0.1'||c.port!==DB_PORT||c.database!==database||c.user!==(owner?'ruy_d1_owner':'ruy_d1_app')) throw Error('Destino fora do laboratório recusado.');
  return c;
}
export function pgCommand(bin, name, args, input) {
  const result=spawnSync(path.join(bin,name+'.exe'),args,{input,windowsHide:true,encoding:'utf8',timeout:30000,
    stdio:name==='pg_ctl'?['ignore','ignore','ignore']:'pipe'});
  if(result.status!==0 || result.error) throw Error(`PostgreSQL ${name} falhou (${result.status}); consultar log local protegido.`);
  return result.stdout?.trim();
}
export async function createHome(bin) {
  windows();
  // Sem criação recursiva sobre cluster existente e sem remoção automática.
  await fs.mkdir(path.dirname(home),{recursive:true});
  await fs.mkdir(home);
  const sid=powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value');
  execFileSync('icacls.exe',[home,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{windowsHide:true,stdio:'ignore'});
  const marker={purpose:'RUY_D1_SYNTHETIC_ONLY',deviceId:randomUUID(),machine:binding(),bin,createdAt:new Date().toISOString()};
  await fs.writeFile(path.join(home,'lab.json'),JSON.stringify(marker,null,2),{flag:'wx'});
  return marker;
}
