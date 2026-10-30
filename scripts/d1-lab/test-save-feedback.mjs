import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor,hashPassword} from '../../server/d1-lab/core.mjs';
import {setSession,base44} from '../../lab/d1/client.mjs';
const pool=poolFor(await config()),nativeFetch=globalThis.fetch,origin='http://127.0.0.1:18087';
const store=new Map(),events=new EventTarget(),messages=[];
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
globalThis.dispatchEvent=e=>events.dispatchEvent(e);events.addEventListener('d1-error',e=>messages.push(e.detail));
try{
 const id=randomUUID(),login=`feedback-${id}@example.invalid`,password=randomBytes(24).toString('hex');
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'writer')",[id,login,await hashPassword(password)]);
 const auth=await nativeFetch(origin+'/api/d1/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({login,password})});assert.equal(auth.status,200);
 setSession(await auth.json());const cookie=auth.headers.get('set-cookie').split(';')[0];
 globalThis.fetch=(url,options={})=>nativeFetch(origin+url,{...options,headers:{...options.headers,Cookie:cookie,Origin:origin}});
 const form={name:'Setor teste',description:'Descrição fictícia',role_purpose:'Finalidade fictícia',responsible_name:'FICTICIO RESPONSAVEL',status:'ativo'};
 await assert.rejects(base44.entities.Sector.create(form),e=>e.status===400);assert.match(messages.at(-1),/FICTICIO/);assert.equal(messages.length,1);assert.equal(form.description,'Descrição fictícia');
 form.name='FICTICIO Setor '+id;const created=await base44.entities.Sector.create(form);assert.equal(created.description,form.description);assert.ok(created.id);
 await base44.entities.Sector.list();const edited=await base44.entities.Sector.update(created.id,{...created,description:'Descrição editada pelo mesmo contrato do formulário'});assert.equal(edited._version,2);assert.equal(edited.description,'Descrição editada pelo mesmo contrato do formulário');
 assert.equal((await base44.entities.AuditLog.create({entity_id:created.id})).serverCommitted,true);
 const read=(await base44.entities.Sector.list()).find(r=>r.id===created.id);assert.equal(read.description,edited.description);
 const storage=globalThis.localStorage.setItem;globalThis.localStorage.setItem=()=>{throw Error('Storage bloqueado para teste');};await assert.rejects(base44.entities.Sector.create({...form,name:'FICTICIO Outro '+id}));assert.match(messages.at(-1),/Storage bloqueado/);globalThis.localStorage.setItem=storage;
 const count=(await pool.query('SELECT count(*)::int n FROM lab_outbox WHERE actor=$1',[id])).rows[0].n;assert.equal(count,2);
 console.log('SAVE_FEEDBACK_OK: nome inválido sinalizado uma vez; criar/consultar/editar e auditoria confirmados; erro de storage sinalizado; duas operações pendentes. Sem reinício de serviços.');
}finally{globalThis.fetch=nativeFetch;await pool.end();}
