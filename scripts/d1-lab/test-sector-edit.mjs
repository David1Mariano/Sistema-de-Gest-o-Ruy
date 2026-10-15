import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor,hashPassword} from '../../server/d1-lab/core.mjs';
import {setSession,base44} from '../../lab/d1/client.mjs';

const pool=poolFor(await config()),nativeFetch=globalThis.fetch,origin='http://127.0.0.1:18087';
const store=new Map(),events=new EventTarget(),messages=[];
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
globalThis.dispatchEvent=e=>events.dispatchEvent(e);events.addEventListener('d1-error',e=>messages.push(e.detail));

const sk=v=>String(v??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
async function diag(){
  const secs=(await pool.query("SELECT data FROM d1_records WHERE entity='Sector' ORDER BY data->>'name'")).rows.map(r=>r.data);
  const jrs=(await pool.query("SELECT data FROM d1_records WHERE entity='JobRole'")).rows.map(r=>r.data);
  const emps=(await pool.query("SELECT data FROM d1_records WHERE entity='Employee'")).rows.map(r=>r.data);
  console.log('--- SETORES no banco (nome | status | resp) ---');
  for(const s of secs)console.log(`  [${s.name}] status=${s.status} resp=${JSON.stringify(s.responsible_name)}`);
  console.log('--- FUNCOES (sector_name) ---');
  for(const j of jrs)console.log(`  [${j.name}] -> setor=[${j.sector_name}]`);
  console.log('--- COLABORADORES (sector) ---');
  for(const e of emps)console.log(`  [${e.name}] setor=[${e.sector}]`);
  console.log('--- SETORES COM VINCULO (rename bloquearia) ---');
  for(const s of secs){
    const vinc=jrs.some(j=>sk(j.sector_name||j.sector)===sk(s.name))||emps.some(e=>sk(e.sector)===sk(s.name));
    console.log(`  [${s.name}] vinculado=${vinc}`);
  }
}

let exitCode=0;
try{
  await diag();
  const id=randomUUID(),login=`editedit-${id}@example.invalid`,password=randomBytes(24).toString('hex');
  await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'writer')",[id,login,await hashPassword(password)]);
  const auth=await nativeFetch(origin+'/api/d1/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({login,password})});
  assert.equal(auth.status,200);
  setSession(await auth.json());const cookie=auth.headers.get('set-cookie').split(';')[0];
  globalThis.fetch=(url,options={})=>nativeFetch(origin+url,{...options,headers:{...options.headers,Cookie:cookie,Origin:origin}});

  const suffix=randomUUID().slice(0,8);
  const results=[];
  const ok=(label,fn)=>fn().then(()=>{results.push(['OK  ',label]);},e=>{results.push(['FAIL',label+' -> '+(e.status||'')+': '+e.message]);exitCode=1;});

  // ---- A: setor COM vinculo ----
  const linkedName=`FICTICIO ComVinculo ${suffix}`;
  const s1=await base44.entities.Sector.create({name:linkedName,description:'desc original',role_purpose:'finalidade',responsible_name:'FICTICIO RESP ORIGINAL',status:'ativo'});
  await base44.entities.JobRole.create({name:`FICTICIO Funcao ${suffix}`,sector_name:linkedName,sector_id:s1.id,status:'ativo'});

  await ok('A1 descricao sem mudar nome (com vinculo)',async()=>{
    const r=await base44.entities.Sector.update(s1.id,{name:linkedName,description:'DESCRICAO EDITADA',role_purpose:'finalidade',responsible_name:'FICTICIO RESP ORIGINAL',status:'ativo'});
    assert.equal(r.description,'DESCRICAO EDITADA');
  });
  await ok('A2 responsavel sem mudar nome (com vinculo)',async()=>{
    const r=await base44.entities.Sector.update(s1.id,{name:linkedName,description:'DESCRICAO EDITADA',role_purpose:'finalidade',responsible_name:'FICTICIO RESP EDITADO',status:'ativo'});
    assert.equal(r.responsible_name,'FICTICIO RESP EDITADO');
  });
  await ok('A3 trocar status (com vinculo)',async()=>{
    let r=await base44.entities.Sector.update(s1.id,{name:linkedName,description:'DESCRICAO EDITADA',role_purpose:'finalidade',responsible_name:'FICTICIO RESP EDITADO',status:'inativo'});
    assert.equal(r.status,'inativo');
    r=await base44.entities.Sector.update(s1.id,{name:linkedName,description:'DESCRICAO EDITADA',role_purpose:'finalidade',responsible_name:'FICTICIO RESP EDITADO',status:'ativo'});
    assert.equal(r.status,'ativo');
  });
  await ok('A4 RENAME com vinculo deve bloquear 409',async()=>{
    const n=messages.length;
    await assert.rejects(base44.entities.Sector.update(s1.id,{name:`FICTICIO ComVinculo RENOMEADO ${suffix}`,description:'DESCRICAO EDITADA',role_purpose:'finalidade',responsible_name:'FICTICIO RESP EDITADO',status:'ativo'}),e=>e.status===409);
    assert.match(messages.at(-1)||'',/Renomeação com vínculos/);
    assert.equal(messages.length,n+1,'mensagem deve chegar ao frontend');
    const cur=(await base44.entities.Sector.list()).find(r=>r.id===s1.id);
    assert.equal(cur.name,linkedName,'nome nao pode ter mudado');
  });

  // ---- B: setor SEM vinculo ----
  const freeName=`FICTICIO SemVinculo ${suffix}`;
  const s2=await base44.entities.Sector.create({name:freeName,description:'livre',role_purpose:'fp',responsible_name:'FICTICIO RESP LIVRE',status:'ativo'});
  await ok('B1 edicao descricao (sem vinculo)',async()=>{
    const r=await base44.entities.Sector.update(s2.id,{name:freeName,description:'livre EDITADA',role_purpose:'fp',responsible_name:'FICTICIO RESP LIVRE',status:'ativo'});
    assert.equal(r.description,'livre EDITADA');
  });
  await ok('B2 RENAME sem vinculo deve PASSAR',async()=>{
    const novo=`FICTICIO SemVinculo Renomeado ${suffix}`;
    const r=await base44.entities.Sector.update(s2.id,{name:novo,description:'livre EDITADA',role_purpose:'fp',responsible_name:'FICTICIO RESP LIVRE',status:'ativo'});
    assert.equal(r.name,novo);
  });

  // ---- C: update parcial SEM chave name ----
  await ok('C1 update parcial SEM chave name (com vinculo)',async()=>{
    const r=await base44.entities.Sector.update(s1.id,{description:'PARCIAL SEM NAME'});
    assert.equal(r.description,'PARCIAL SEM NAME');
    assert.equal(r.name,linkedName);
  });

  // ---- D: rename que NAO altera chave normalizada (caixa/espaco) com vinculo ----
  const dName=`FICTICIO CaixaAcento ${suffix}`;
  const s3=await base44.entities.Sector.create({name:dName,description:'d',role_purpose:'fp',responsible_name:'FICTICIO R',status:'ativo'});
  await base44.entities.JobRole.create({name:`FICTICIO FuncaoD ${suffix}`,sector_name:dName,sector_id:s3.id,status:'ativo'});
  await ok('D1 rename so caixa/espaco (mesma chave) com vinculo NAO bloqueia',async()=>{
    const variado=`  ${dName.toUpperCase()}  `;
    const r=await base44.entities.Sector.update(s3.id,{name:variado,description:'d',role_purpose:'fp',responsible_name:'FICTICIO R',status:'ativo'});
    // Backend NAO faz trim no armazenamento, mas sectorKey normaliza a COMPARACAO:
    // a chave continua igual, logo o rename NAO e bloqueado. Guardamos o valor cru.
    assert.equal(r.name,variado);
    assert.notEqual(r.name,dName.trim(),'valor bruto difere do original (caixa/espaco)');
  });

  console.log('\n--- RESULTADOS ---');
  for(const [st,label] of results)console.log(`  ${st} ${label}`);

  const after=await base44.entities.Sector.list();
  const p1=after.find(r=>r.id===s1.id);
  console.log('\n--- PERSISTENCIA (nova listagem via API) ---');
  console.log(`  com vinculo: name=[${p1?.name}] desc=[${p1?.description}] resp=[${p1?.responsible_name}] status=${p1?.status} _v=${p1?._version}`);
  // Leitura DIRETA no PostgreSQL de laboratório (independente do cache do cliente)
  const db1=(await pool.query('SELECT data,version,name_key FROM d1_records WHERE id=$1',[s1.id])).rows[0];
  const db2=(await pool.query('SELECT data,version,name_key FROM d1_records WHERE id=$1',[s2.id])).rows[0];
  console.log('--- PERSISTENCIA (leitura direta PostgreSQL ruy_d1_disposable) ---');
  console.log(`  com vinculo: name=[${db1.data.name}] desc=[${db1.data.description}] resp=[${db1.data.responsible_name}] status=${db1.data.status} v=${db1.version} name_key=[${db1.name_key}]`);
  console.log(`  sem vinculo (renomeado): name=[${db2.data.name}] desc=[${db2.data.description}] v=${db2.version} name_key=[${db2.name_key}]`);
  console.log(`  "pagina atualizada" = nova listagem API + nova query SQL -> mesmos valores confirmam persistencia.`);
  if(exitCode===0)console.log('\nSECTOR_EDIT_OK');else console.log('\nSECTOR_EDIT_FAIL');
} catch(e){
  console.error('ERRO FATAL:',e.status||'',e.message);exitCode=1;
} finally {
  globalThis.fetch=nativeFetch;
  await pool.end();
}
process.exit(exitCode);
