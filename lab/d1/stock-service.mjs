import {request,getSession} from './client.mjs';
import {catalogFields} from '../../server/d1-lab/catalog-contract.mjs';
export const newClientToken=()=>crypto.randomUUID();
async function durable(key,input,build,route){
 if(getSession()?.user.role!=='admin')throw Error('Estoque do piloto exige administrador sintético.');
 const storageKey='ruy-d1-stock:'+getSession().user.id+':'+key,fingerprint=JSON.stringify(input),prior=JSON.parse(localStorage.getItem(storageKey)||'null');
 if(prior&&prior.fingerprint!==fingerprint)throw Error('Há tentativa não confirmada; reenvie os mesmos campos.');
 const envelope=prior||{fingerprint,body:build()};localStorage.setItem(storageKey,JSON.stringify(envelope));
 try{const result=await request(route,envelope.body);localStorage.removeItem(storageKey);globalThis.dispatchEvent(new Event('d1-changed'));return result;}
 catch(e){if(e.status>=400&&e.status<500&&![408,429].includes(e.status))localStorage.removeItem(storageKey);throw e;}
}
export async function criarItemComEstoqueInicial({item,openingQty=0,unitCost=0}){
 const data=Object.fromEntries(Object.entries(item).filter(([k])=>catalogFields.InventoryItem.includes(k)));
 const initialMilli=Math.round(Number(openingQty)*1000),unitCents=Math.round(Number(unitCost)*100);
 const result=await durable('create',{data,initialMilli,unitCents},()=>({itemId:crypto.randomUUID(),operationId:crypto.randomUUID(),data,initialMilli,unitCents}),'/operations/create-item');
 return {item:result.record,itemId:result.record.id,openingQty:Number(openingQty)};
}
export const ajustarSaldo=async({item,targetBalance,clientToken})=>durable('adjust:'+item.id,{id:item.id,targetBalance,baseVersion:item._stockVersion},()=>({operationId:clientToken||crypto.randomUUID(),kind:'adjust',itemId:item.id,targetMilli:Math.round(Number(targetBalance)*1000),baseVersion:item._stockVersion,unitCents:Math.round(Number(item.average_cost||0)*100)}),'/operations/command');
export const buscarVinculosDoItem=async()=>{throw Error('Exclusão de estoque aguarda homologação; cadastro e histórico serão preservados.');};
export const excluirOuDesativarItem=buscarVinculosDoItem;
export const reativarItem=buscarVinculosDoItem;
