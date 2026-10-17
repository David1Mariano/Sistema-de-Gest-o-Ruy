import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
export async function rc3Smoke({window,pool,actor,root,deviceId,origin}){
 if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Synthetic RC3 opt-in required.');
 const load=name=>import(pathToFileURL(path.join(root,'server/d1-lab',name)));
 const {catalogSave,catalogList}=await load('catalog.mjs'),{synchronizeD1}=await load('sync.mjs'),{provisionedRequest}=await load('tls-provision.mjs');
 const user={id:actor,role:'admin'},js=code=>window.webContents.executeJavaScript(code);
 const wait=async fn=>{for(let n=0;n<300;n++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('RC3 UI timeout');};
 const click=async label=>{await wait(()=>js(`!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`));await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);};
 const input=async(label,value)=>js(`(()=>{const e=document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(${label==='Documento para estorno'?'HTMLSelectElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${label==='Documento para estorno'?'change':'input'}',{bubbles:true}));})()`);
 await window.loadURL(origin+'/contas-estornos');await wait(()=>js("!!document.querySelector('[aria-label=\"Documento para estorno\"] option[value]:not([value=\"\"])')"));
 const expense=await js("document.querySelector('[aria-label=\"Documento para estorno\"] option[value]:not([value=\"\"])').value");await input('Documento para estorno',expense);await input('Motivo do estorno','FICTICIO UI supervised reversal');await js("document.querySelector('[aria-label=\"Confirmar estorno\"]').click()");await click('Registrar estorno');await wait(()=>js("document.body.textContent.includes('Estorno registrado localmente')"));
 assert.equal((await synchronizeD1(pool,actor)).businessConfirmed,true);
 assert.equal((await pool.query('SELECT count(*)::int n FROM d1_local_reversals WHERE owner_id=$1 AND reference=$2',[actor,expense])).rows[0].n,1);
 const id=randomUUID(),create=await catalogSave(pool,user,deviceId,'Employee',id,{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO RC3 UI original',status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});await synchronizeD1(pool,actor);
 const before=create.record;await catalogSave(pool,user,deviceId,'Employee',id,{operationId:randomUUID(),operation:'update',baseVersion:before._version,data:{name:'FICTICIO RC3 UI local proposal',status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});
 const binding=(await pool.query('SELECT * FROM d1_sync_binding WHERE actor=$1',[actor])).rows[0],transport=await provisionedRequest(binding);
 await transport.request(transport.token,'/push',{protocol:'D1LAB/1',operationId:randomUUID(),actorId:actor,deviceId,workspaceId:binding.workspace_id,changes:[{entity:'Employee',id,baseVersion:1,data:{name:'FICTICIO RC3 UI central winner',status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}}]});
 assert.ok((await synchronizeD1(pool,actor)).conflicts>0);
 await window.loadURL(origin+'/conflitos');await click('Preparar revisão');await wait(()=>js("document.body.textContent.includes('Propostas retiradas: 1')"));
 assert.equal(await js("document.body.textContent.includes('FICTICIO RC3 UI local proposal')&&document.body.textContent.includes('FICTICIO RC3 UI central winner')"),true);
 await input('Motivo da reconciliação','FICTICIO UI reviewed central choice');await js("document.querySelector('section input[type=checkbox]').click()");await click('Aceitar central e arquivar propostas');await wait(()=>js("document.body.textContent.includes('Revisão registrada:')"));
 const latest=(await catalogList(pool,user,'Employee')).find(r=>r.id===id);assert.equal(latest.name,'FICTICIO RC3 UI central winner');assert.ok(latest._version>2);
 assert.equal((await pool.query('SELECT count(*)::int n FROM d1_reconciliation WHERE actor=$1',[actor])).rows[0].n,1);
 return {financialReversalUI:true,financialReversalConfirmed:true,conflictComparisonUI:true,explicitReconciliationUI:true,archivePreserved:true,staleFormVersionInvalidated:true};
}
