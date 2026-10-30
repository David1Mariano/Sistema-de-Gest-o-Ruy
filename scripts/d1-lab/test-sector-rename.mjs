import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {config,validateHome} from '../../server/d1-lab/environment.mjs';
import {poolFor,hashPassword} from '../../server/d1-lab/core.mjs';
import {save} from '../../server/d1-lab/entities.mjs';
import {setSession,base44} from '../../lab/d1/client.mjs';
import {sectorKey,employeesOfSector} from '../../src/lib/sectorUtils.js';

// ETAPA D1.1 — RENOMEAÇÃO SEGURA DE SETORES (laboratório).
// Cobre os 11 testes obrigatórios: sem vínculos, com vínculos+confirmação,
// cancelamento, rollback transacional, preservação de vínculos, permissões,
// duplicidade, conflito de versão, persistência após reinício, offline e
// feedback no navegador. Só dados FICTICIO; nenhum toque em produção.

const exec=promisify(execFile),cli=fileURLToPath(new URL('../d1-lab.mjs',import.meta.url));
const control=(...args)=>exec(process.execPath,[cli,...args],{windowsHide:true,timeout:30000});
const origin='http://127.0.0.1:18087',nativeFetch=globalThis.fetch;
const pool=poolFor(await config()),marker=await validateHome();

const store=new Map(),events=new EventTarget(),messages=[];
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
globalThis.dispatchEvent=e=>events.dispatchEvent(e);
events.addEventListener('d1-error',e=>messages.push(e.detail));

let exitCode=0,passed=0;
const results=[];
const ok=(label,fn)=>fn().then(()=>{results.push(['OK  ',label]);passed++;},e=>{results.push(['FAIL',label+' -> '+(e.status||'')+': '+e.message]);exitCode=1;});

async function login(loginName,password){
 const r=await nativeFetch(origin+'/api/d1/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({login:loginName,password})});
 assert.equal(r.status,200);
 const body=await r.json();
 return {...body,cookie:r.headers.get('set-cookie').split(';')[0]};
}
function useSession(s){
 setSession(s);
 globalThis.fetch=(url,options={})=>nativeFetch(origin+url,{...options,headers:{...options.headers,Cookie:s.cookie,Origin:origin}});
}
async function createEmployee(ownerId,name,sector,functionName){
 const id=randomUUID();
 await pool.query("INSERT INTO d1_records(id,owner_id,entity,data,name_key) VALUES($1,$2,'Employee',$3,$4)",[id,ownerId,{name,social_name:'',sector,function:functionName,status:'ativo',admission_date:'2026-01-01'},'fixture-'+id]);
 return id;
}
const dbRow=id=>pool.query('SELECT data,version,name_key FROM d1_records WHERE id=$1',[id]).then(r=>r.rows[0]&&{...r.rows[0],version:Number(r.rows[0].version)});
const auditCount=(action,operationId)=>pool.query('SELECT count(*)::int n FROM lab_audit WHERE action=$1 AND operation_id=$2',[action,operationId]).then(r=>r.rows[0].n);

const suffix=randomUUID().slice(0,8);
let writer,admin,viewer,writerUser;

try{
 const uid=randomUUID(),uname=`rename-${uid}@example.invalid`,pw=randomBytes(24).toString('hex');
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'writer')",[uid,uname,await hashPassword(pw)]);
 writer=await login(uname,pw); writerUser={id:uid,role:'writer'};
 const aid=randomUUID(),aaname=`rename-admin-${aid}@example.invalid`,apw=randomBytes(24).toString('hex');
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[aid,aaname,await hashPassword(apw)]);
 admin=await login(aaname,apw);
 assert.equal(admin.user.role,'admin');
 const vid=randomUUID(),vuname=`rename-viewer-${vid}@example.invalid`,vpw=randomBytes(24).toString('hex');
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'viewer')",[vid,vuname,await hashPassword(vpw)]);
 viewer=await login(vuname,vpw);
 useSession(writer);

 const linkedName=`FICTICIO Renomeavel ${suffix}`;
 const s=await base44.entities.Sector.create({name:linkedName,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'});
 const jr1=await base44.entities.JobRole.create({name:`FICTICIO Funcao A ${suffix}`,sector_name:linkedName,sector_id:s.id,status:'ativo'});
 const jr2=await base44.entities.JobRole.create({name:`FICTICIO Funcao B ${suffix}`,sector_name:linkedName,sector_id:s.id,status:'ativo'});
 const e1=await createEmployee(uid,`FICTICIO Colab 1 ${suffix}`,linkedName,`FICTICIO Funcao A ${suffix}`);
 const e2=await createEmployee(uid,`FICTICIO Colab 2 ${suffix}`,linkedName,`FICTICIO Funcao A ${suffix}`);
 await base44.entities.Sector.list(); await base44.entities.JobRole.list();

 const freeName=`FICTICIO Livre ${suffix}`;
 const sFree=await base44.entities.Sector.create({name:freeName,description:'livre',role_purpose:'fp',responsible_name:'FICTICIO R',status:'ativo'});
 await base44.entities.Sector.list();
 await ok('A1 renomear setor SEM vinculos nao pede confirmacao',async()=>{
  const novo=`FICTICIO Livre Renomeado ${suffix}`;
  const r=await base44.entities.Sector.update(sFree.id,{name:novo,description:'livre',role_purpose:'fp',responsible_name:'FICTICIO R',status:'ativo'});
  assert.equal(r.name,novo);
  assert.equal((await dbRow(sFree.id)).data.name,novo);
 });

 await ok('B1 renomear COM vinculos exige confirmacao e aplica cascata',async()=>{
  const novo=`FICTICIO Renomeavel NOVO ${suffix}`;
  const cols=employeesOfSector(await base44.entities.Employee.list('-created_date',1000),s).length;
  const roles=(await base44.entities.JobRole.list('-created_date',1000)).filter(r=>sectorKey(r.sector_name)===sectorKey(s.name)).length;
  assert.equal(cols,2); assert.equal(roles,2,'contagem de vinculos correta');
  const r=await base44.entities.Sector.update(s.id,{name:novo,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   {confirmRename:true,renameImpact:{colaboradores:cols,funcoes:roles}});
  assert.equal(r.name,novo);
  const j1=await dbRow(jr1.id),j2=await dbRow(jr2.id),p1=await dbRow(e1),p2=await dbRow(e2);
  assert.equal(j1.data.sector_name,novo); assert.equal(j2.data.sector_name,novo);
  assert.equal(p1.data.sector,novo); assert.equal(p2.data.sector,novo);
  assert.equal(j1.version,2,'versao da funcao +1'); assert.equal(p1.version,2,'versao do colaborador +1');
  const sec=await dbRow(s.id); assert.equal(sec.data.name,novo); assert.equal(sec.version,2,'versao do setor +1');
  assert.equal(sec.name_key,sectorKey(novo),'name_key acompanha o novo nome');
 });

 await ok('C1 SEM confirmRename (cancelar) o servidor recusa e nada muda',async()=>{
  const antes=await dbRow(s.id);
  await assert.rejects(base44.entities.Sector.update(s.id,{name:`FICTICIO NAO PODE ${suffix}`,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'}),
   e=>e.status===409&&/Renomea..o com v.nculos/.test(e.message));
  const depois=await dbRow(s.id);
  assert.equal(depois.data.name,antes.data.name,'nome nao mudou');
  assert.equal(depois.version,antes.version,'versao nao mudou');
  assert.equal((await dbRow(e1)).data.sector,antes.data.name,'colaborador intacto');
 });

 await ok('D1 renameImpact divergente do estado real e recusado',async()=>{
  await assert.rejects(base44.entities.Sector.update(s.id,{name:`FICTICIO X ${suffix}`,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   {confirmRename:true,renameImpact:{colaboradores:99,funcoes:99}}),e=>e.status===409&&/Impacto confirmado difere/.test(e.message));
 });


 await ok('E1 falha na cascata faz ROLLBACK total (setor + vinculos)',async()=>{
  const antes=await dbRow(s.id),jAntes=await dbRow(jr1.id),eAntes=await dbRow(e1);
  const body={operationId:randomUUID(),operation:'update',baseVersion:Number(antes.version),
   data:{name:`FICTICIO ROLLBACK ${suffix}`,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   confirmRename:true,renameImpact:{colaboradores:2,funcoes:2}};
  await assert.rejects(save(pool,writerUser,marker.deviceId,'Sector',s.id,body,()=>{throw Error('falha simulada na cascata');}));
  assert.equal((await dbRow(s.id)).data.name,antes.data.name,'setor desfeito');
  assert.equal((await dbRow(s.id)).version,antes.version,'versao do setor desfeita');
  assert.equal((await dbRow(jr1.id)).data.sector_name,jAntes.data.sector_name,'funcao desfeita');
  assert.equal((await dbRow(jr1.id)).version,jAntes.version,'versao da funcao desfeita');
  assert.equal((await dbRow(e1)).data.sector,eAntes.data.sector,'colaborador desfeito');
 });

 await ok('F1 ids e campos preservados; somente o campo de vinculo muda',async()=>{
  const j=await dbRow(jr1.id),e=await dbRow(e1);
  assert.equal(j.data.sector_id,s.id,'sector_id da funcao preservado');
  assert.equal(j.data.name,`FICTICIO Funcao A ${suffix}`,'nome da funcao preservado');
  assert.equal(e.data.name,`FICTICIO Colab 1 ${suffix}`,'nome do colaborador preservado');
  assert.equal(e.data.function,`FICTICIO Funcao A ${suffix}`,'funcao do colaborador preservada');
  assert.equal(e.data.status,'ativo','status preservado');
 });

 await ok('G1 viewer nao consegue renomear (403 no servidor)',async()=>{
  const cur=await dbRow(s.id);
  await assert.rejects(save(pool,{id:vid,role:'viewer'},marker.deviceId,'Sector',s.id,{operationId:randomUUID(),operation:'update',baseVersion:Number(cur.version),
   data:{name:`FICTICIO VIEWER ${suffix}`,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   confirmRename:true,renameImpact:{colaboradores:2,funcoes:2}}),e=>e.status===403);
  // e o cliente D1 tambem barra antes de qualquer requisicao
  useSession(viewer);
  await assert.rejects(base44.entities.Sector.update(s.id,{name:`FICTICIO VIEWER ${suffix}`,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'}),
   e=>/permiss.o somente de consulta/.test(e.message));
  useSession(writer);
  assert.equal((await dbRow(s.id)).data.name,`FICTICIO Renomeavel NOVO ${suffix}`,'nome nao mudou com viewer');
 });

 await ok('H1 renomear para nome de OUTRO setor e recusado (409)',async()=>{
  const outro=`FICTICIO Destino ${suffix}`;
  await base44.entities.Sector.create({name:outro,description:'x',role_purpose:'fp',responsible_name:'FICTICIO R',status:'ativo'});
  await base44.entities.Sector.list();
  await assert.rejects(base44.entities.Sector.update(s.id,{name:outro,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   {confirmRename:true,renameImpact:{colaboradores:2,funcoes:2}}),e=>e.status===409&&/existe um setor/.test(e.message));
  assert.equal((await dbRow(s.id)).data.name,`FICTICIO Renomeavel NOVO ${suffix}`,'nome original mantido');
 });

 await ok('I1 baseVersion velho e recusado (409) e nada muda',async()=>{
  const cur=await dbRow(s.id);
  await assert.rejects(save(pool,writerUser,marker.deviceId,'Sector',s.id,{operationId:randomUUID(),operation:'update',baseVersion:1,
   data:{name:`FICTICIO VELHO ${suffix}`,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   confirmRename:true,renameImpact:{colaboradores:2,funcoes:2}}),e=>e.status===409&&/Conflito de vers.o/.test(e.message));
  assert.equal((await dbRow(s.id)).version,Number(cur.version),'versao preservada');
 });

 await ok('J1 renomeacao com cascata gera auditoria e outbox',async()=>{
  const nomeAntes=(await dbRow(s.id)).data.name;
  const novo=`FICTICIO Renomeavel AUDIT ${suffix}`;
  const r=await base44.entities.Sector.update(s.id,{name:novo,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   {confirmRename:true,renameImpact:{colaboradores:2,funcoes:2}});
  assert.equal(r.name,novo);
  // O cliente devolve so o record; localizamos a operacao de renomeacao no outbox.
  const op=(await pool.query("SELECT operation_id,result FROM lab_outbox WHERE entity='Sector' AND record_id=$1 AND result ? 'rename' ORDER BY created_at DESC LIMIT 1",[s.id])).rows[0];
  assert.ok(op,'outbox registra a renomeacao');
  assert.equal(op.result.rename.from,nomeAntes,'rename.from correto');
  assert.equal(op.result.rename.to,novo,'rename.to correto');
  assert.equal(op.result.rename.colaboradores,2); assert.equal(op.result.rename.funcoes,2);
  assert.equal(op.result.cascata.filter(c=>c.entity==='JobRole').length,2,'2 funcoes na cascata');
  assert.equal(op.result.cascata.filter(c=>c.entity==='Employee').length,2,'2 colaboradores na cascata');
  assert.equal(await auditCount('Sector:rename_cascade',op.operation_id),1,'auditoria da cascata');
  assert.equal(await auditCount('Sector:update',op.operation_id),1,'auditoria geral');
 });

 // ---- K: persistencia apos reinicio da API ----
 await ok('K1 dados sobrevivem ao reinicio da API do laboratorio',async()=>{
  const nomeAtual=(await dbRow(s.id)).data.name;
  const before=(await base44.entities.Sector.list()).find(r=>r.id===s.id);
  await control('stop-api'); await control('start-api');
  useSession(writer);
  const after=(await base44.entities.Sector.list()).find(r=>r.id===s.id);
  assert.equal(after.name,nomeAtual,'nome persistido apos reinicio');
  assert.equal(after._version,before._version,'versao persistida');
  assert.equal((await dbRow(e1)).data.sector,nomeAtual,'colaborador persistido');
  assert.equal((await dbRow(jr1.id)).data.sector_name,nomeAtual,'funcao persistida');
 });

 // ---- L: funcionamento offline (somente loopback) ----
 await ok('L1 renomeacao funciona sem rede externa (loopback apenas)',async()=>{
  if(process.env.RUY_D1_NETWORK_GUARD==='1'){
   await assert.rejects(nativeFetch('https://example.invalid/'),e=>e.code==='ENETUNREACH');
  }
  const nomeAtual=(await dbRow(s.id)).data.name;
  const novo=`FICTICIO OFFLINE ${suffix}`;
  const r=await base44.entities.Sector.update(s.id,{name:novo,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   {confirmRename:true,renameImpact:{colaboradores:2,funcoes:2}});
  assert.equal(r.name,novo,'renomeou via 127.0.0.1 sem saida externa');
  assert.equal((await dbRow(e1)).data.sector,novo,'cascata tambem offline');
  // volta para o nome usado pelos testes seguintes
  await base44.entities.Sector.update(s.id,{name:nomeAtual,description:'desc',role_purpose:'fp',responsible_name:'FICTICIO RESP',status:'ativo'},
   {confirmRename:true,renameImpact:{colaboradores:2,funcoes:2}});
 });

 // ---- M: feedback no navegador (estatico: o form D1 monta dialogo de impacto) ----
 await ok('M1 form D1 exige confirmacao e envia renameImpact coerente',async()=>{
  const {readFile}=await import('node:fs/promises');
  const form=await readFile(new URL('../../lab/d1/SectorForm.jsx',import.meta.url),'utf8');
  assert.match(form,/setImpact\(\{ cols, funs \}\)/,'abre dialogo de impacto');
  assert.match(form,/colaborador\(es\) vinculado\(s\)/,'informa contagem de colaboradores');
  assert.match(form,/fun..o\(..s\) vinculada\(s\)/,'informa contagem de funcoes');
  assert.match(form,/confirmRename: true/,'envia confirmRename no confirmar');
  assert.match(form,/renameImpact: \{ colaboradores: impact\?\.cols \?\? 0, funcoes: impact\?\.funs \?\? 0 \}/,'envia o impacto exibido');
  assert.match(form,/Cancelar/,'permite cancelar a confirmacao');
  assert.match(form,/data-testid="d1-rename-impact"/,'dialogo identificavel no DOM');
  // o form oficial de producao continua intocado (padrao do test-api.mjs)
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const ex=promisify(execFile);
  const official=(await ex('git',['show','9d7e59e:src/components/rh/SectorForm.jsx'],{encoding:'utf8',maxBuffer:2e6})).stdout.replace(/\r\n/g,'\n');
  const atual=(await readFile(new URL('../../src/components/rh/SectorForm.jsx',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
  assert.equal(atual,official,'src/components/rh/SectorForm.jsx da producao permanece byte-identico');
 });

 console.log('\\n--- RESULTADOS (renomeacao segura D1.1) ---');
 for(const [st,label] of results)console.log(`  ${st} ${label}`);
 console.log(`\\n${passed}/${results.length} cenarios aprovados.`);
}catch(e){
 console.error('ERRO FATAL:',e.status||'',e.message);exitCode=1;
}finally{
 globalThis.fetch=nativeFetch;
 await pool.end().catch(()=>{});
}
process.exit(exitCode);
