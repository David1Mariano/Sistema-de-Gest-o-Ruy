import {test} from 'node:test';
import assert from 'node:assert/strict';
import {base44,setSession,request,localDomain} from '../../lab/d1/client.mjs';
import {randomUUID,createHash} from 'node:crypto';

test('Client upgrade resumes a legacy intention with the same UUID',async()=>{
 const previous=globalThis.fetch,storage=globalThis.localStorage,dispatch=globalThis.dispatchEvent;
 const actor=randomUUID(),id=randomUUID(),operationId=randomUUID(),data={name:'FICTICIO Legacy intention',status:'ativo'};
 const store=new Map();
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 globalThis.dispatchEvent=()=>true;setSession({user:{id:actor,role:'admin'},csrf:'synthetic'});
 const fingerprint=createHash('sha256').update(JSON.stringify({data,confirmRename:false,renameImpact:null})).digest('hex');
 store.set('ruy-d1-command:'+actor+':ExpenseCategory:create',JSON.stringify({id,fingerprint,body:{operationId,operation:'create',baseVersion:null,data}}));
 globalThis.fetch=async(_url,options)=>{assert.equal(JSON.parse(options.body).operationId,operationId);return new Response(JSON.stringify({record:{...data,id,_version:1},operationId,replay:true}));};
 try{assert.equal((await base44.entities.ExpenseCategory.create(data)).id,id);assert.equal(store.size,0);}
 finally{setSession(null);globalThis.fetch=previous;globalThis.localStorage=storage;globalThis.dispatchEvent=dispatch;}
});
test('Cliente: resposta 5xx mantém o mesmo envelope e troca de sessão invalida leitura em voo',async()=>{
 const previous=globalThis.fetch,store=new Map(),commands=[];
 globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};globalThis.dispatchEvent=()=>true;
 try{
  setSession({user:{id:'synthetic-admin',role:'admin'},csrf:'test'});
  globalThis.fetch=async(_url,options)=>{commands.push(JSON.parse(options.body));return new Response(JSON.stringify({error:'Erro sintético após transporte'}),{status:503});};
  const data={name:'FICTICIO Retry',status:'ativo'};
  await assert.rejects(base44.entities.ExpenseCategory.create(data));await assert.rejects(base44.entities.ExpenseCategory.create(data));
  assert.equal(store.size,1);assert.equal(commands[0].operationId,commands[1].operationId);
  let release;
  globalThis.fetch=()=>new Promise(r=>{release=r;});
  const pending=request('/catalog/Employee');setSession({user:{id:'synthetic-other',role:'viewer'}});
  release(new Response(JSON.stringify({records:[{name:'FICTICIO PRIVATE'}]})));
  await assert.rejects(pending,e=>e.status===401);
  setSession({user:{id:'synthetic-admin',role:'admin'},csrf:'test'});
  let respond,started;
  const entered=new Promise(resolve=>{started=resolve;});
  globalThis.fetch=(_url,options)=>{commands.push(JSON.parse(options.body));started();return new Promise(resolve=>{respond=resolve;});};
  const mutation=localDomain.command('Revenue',null,{date:'2026-10-15',description:'FICTICIO retry',gross_amount:1,fee_amount:0,net_amount:1,status:'recebido'});
  await entered;const uncertainOperation=commands.at(-1).operationId;
  setSession({user:{id:'synthetic-other',role:'viewer'}});
  respond(new Response(JSON.stringify({operationId:uncertainOperation})));
  await assert.rejects(mutation,e=>e.d1SessionChanged===true);
  assert.ok([...store.values()].some(value=>JSON.parse(value).body.operationId===uncertainOperation));
  setSession({user:{id:'synthetic-admin',role:'admin'},csrf:'test'});
  globalThis.fetch=async(_url,options)=>{commands.push(JSON.parse(options.body));return new Response(JSON.stringify({error:'FICTICIO indisponível'}),{status:503});};
  await assert.rejects(localDomain.command('Revenue',null,{date:'2026-10-15',description:'FICTICIO retry',gross_amount:1,fee_amount:0,net_amount:1,status:'recebido'}));
  assert.equal(commands.at(-1).operationId,uncertainOperation);
 }finally{setSession(null);globalThis.fetch=previous;}
});
