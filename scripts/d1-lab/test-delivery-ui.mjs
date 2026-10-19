import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {createDomainAdapter} from '../../lab/d1/domain-client.mjs';
test('Delivery Windows workspace renders inline order item controls without a modal dependency',async()=>{
 const vite=await createServer({configFile:'lab/d1/vite.config.mjs',server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
 try{const {DeliveryWorkspace}=await vite.ssrLoadModule('/lab/d1/Delivery.jsx');const html=renderToStaticMarkup(React.createElement(DeliveryWorkspace,{orders:[],catalogs:{},busy:false}));for(const label of ['Salvar pedido','Adicionar item','Quantidade','Entregador','Clientes','Cardápio','Entregadores','Recebimento'])assert.ok(html.includes(label)||html.toLowerCase().includes(label.toLowerCase()));assert.equal(html.includes('role="dialog"'),false);}finally{await vite.close();}
});
test('Delivery UI adapter preserves the same aggregate and UUID after unknown response',async()=>{
 const original=globalThis.localStorage,dispatch=globalThis.dispatchEvent;const storage=new Map(),calls=[];
 globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};globalThis.dispatchEvent=()=>{};
 let fail=true;const adapter=createDomainAdapter({getSession:()=>({user:{id:'synthetic',role:'admin'}}),signal:e=>{throw e;},request:async(route,body)=>{calls.push({route,body:structuredClone(body)});if(fail)throw Object.assign(Error('FICTICIO lost response'),{status:503});return {operationId:body.operationId,record:{id:body.id},domainRecord:{id:body.id,_version:1}};}});
 try{const data={date:'2026-10-19',items:[{id:crypto.randomUUID(),menuItemId:crypto.randomUUID(),quantityMilli:1000}],provider:'own'};await assert.rejects(adapter.command('DeliveryOrder',null,data));fail=false;await adapter.command('DeliveryOrder',null,data);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[1].route,'/domain/command');assert.equal(storage.size,0);}finally{globalThis.localStorage=original;globalThis.dispatchEvent=dispatch;}
});
