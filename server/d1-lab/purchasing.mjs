import {randomUUID} from 'node:crypto';
import {fail,uuid} from './core.mjs';
import {syncHash} from './sync-contract.mjs';
import {unwrapDomain} from './domain-contract.mjs';
import {applyOperational} from './operations.mjs';
export {isPurchase} from './purchase-contract.mjs';
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const cents=v=>Number.isSafeInteger(v)&&v>=0&&v<=1e11;
const clean=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['id','_version','created_date','updated_date'].includes(k)));
const stableId=value=>{const h=syncHash(value);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);};
async function owned(c,actor,entity,id){if(!uuid(id))throw fail(400,'Referencia invalida.');const r=(await c.query('SELECT * FROM d2_catalog WHERE owner_id=$1 AND entity=$2 AND id=$3 FOR UPDATE',[actor,entity,id])).rows[0];if(!r)throw fail(409,'Referencia indisponivel no escopo.');return r;}
export async function purchasePreview(c,actor,record){
 const purchase=unwrapDomain(record),balances=[];
 for(const item of [...purchase.items].sort((a,b)=>a.inventory_item_id.localeCompare(b.inventory_item_id))){const row=await owned(c,actor,'InventoryItem',item.inventory_item_id);if(row.data.status!=='ativo')throw fail(409,'Item de estoque inativo.');const b=(await c.query('SELECT quantity_milli,quota_milli,version FROM d1_stock_balances WHERE owner_id=$1 AND item_id=$2 FOR UPDATE',[actor,item.inventory_item_id])).rows[0];balances.push({itemId:item.inventory_item_id,baseVersion:Number(b?.version||0),quantityMilli:Number(b?.quantity_milli||0),quotaMilli:Number(b?.quota_milli||0)});}
 const payable=await owned(c,actor,'AccountsPayable',purchase.accounts_payable_id),p=unwrapDomain(payable);
 if(Math.round(p.amount*100)!==purchase.total_cents)throw fail(409,'Compra e conta a pagar divergentes.');
 return {token:syncHash({id:record.id,version:Number(record.version),purchase,balances,payableVersion:Number(payable.version)}),balances,totalCents:purchase.total_cents,canReceive:purchase.status==='aguardando_recebimento'&&['pendente','pago'].includes(p.status),canCancel:purchase.status!=='cancelada'&&p.status==='pendente'};
}
export async function preparePurchase({c,actor,deviceId,body,old,save,changes}){
 if(body.action==='save'){
  if(old&&(old.status!=='aguardando_recebimento'||old.source_device_id!==deviceId))throw fail(409,'Compra recebida ou cancelada nao pode ser regravada.');
  const allowed=['supplier_id','date','due_date','document_number','items','discount_cents','freight_cents','other_cents'];
  if(!body.data||Object.keys(body.data).some(k=>!allowed.includes(k)))throw fail(400,'Campos derivados de compra nao podem ser enviados.');
  const d=body.data;if(!validDate(d.date)||!validDate(d.due_date)||typeof d.document_number!=='string'||d.document_number.length>80||![d.discount_cents,d.freight_cents,d.other_cents].every(cents)||!Array.isArray(d.items)||d.items.length<1||d.items.length>10)throw fail(400,'Compra, vencimento ou itens invalidos.');
  if(d.items.some(i=>!i||typeof i!=='object'||Array.isArray(i)))throw fail(400,'Item de compra invalido.');
  if(new Set(d.items.map(i=>i.id)).size!==d.items.length||new Set(d.items.map(i=>i.inventory_item_id)).size!==d.items.length)throw fail(400,'Itens duplicados na compra.');
  if(d.document_number.trim()&&(await c.query("SELECT 1 FROM d2_catalog WHERE owner_id=$1 AND entity='Purchase' AND id<>$2 AND (data->>'payload_json')::jsonb->>'supplier_id'=$3 AND lower(trim((data->>'payload_json')::jsonb->>'document_number'))=lower(trim($4)) AND (data->>'payload_json')::jsonb->>'status'<>'cancelada'",[actor.id,body.id,d.supplier_id,d.document_number])).rowCount)throw fail(409,'Documento de fornecedor ja registrado.');
  const supplier=await owned(c,actor.id,'Supplier',d.supplier_id);if(supplier.data.status!=='ativo')throw fail(409,'Fornecedor inativo.');
  const items=[];let subtotal=0;
  for(const i of d.items){if(!i||Object.keys(i).some(k=>!['id','inventory_item_id','quantity_milli','unit_cents'].includes(k))||!uuid(i.id)||!Number.isSafeInteger(i.quantity_milli)||i.quantity_milli<=0||i.quantity_milli>1e9||!cents(i.unit_cents))throw fail(400,'Quantidade ou custo invalido.');const item=await owned(c,actor.id,'InventoryItem',i.inventory_item_id);if(item.data.status!=='ativo')throw fail(409,'Item inativo.');const total=Number((BigInt(i.quantity_milli)*BigInt(i.unit_cents)+500n)/1000n);if(!cents(total))throw fail(400,'Total de item excedido.');subtotal+=total;items.push({...i,item_name:item.data.name,unit:item.data.unit,total_cents:total});}
  const total=subtotal-d.discount_cents+d.freight_cents+d.other_cents;if(!cents(subtotal)||!cents(total)||total<=0||d.discount_cents>subtotal)throw fail(400,'Total da compra invalido.');
  const payableId=old?.accounts_payable_id||randomUUID();let payable;
  if(old){payable=await owned(c,actor.id,'AccountsPayable',payableId);if(unwrapDomain(payable).status!=='pendente')throw fail(409,'Conta vinculada liquidada ou cancelada.');}
  const data={...d,items,supplier_name:supplier.data.name,subtotal_cents:subtotal,total_cents:total,status:'aguardando_recebimento',stock_posted:false,accounts_payable_id:payableId,source_device_id:deviceId,responsible_user:actor.id,receipt_operations:[]};
  if(JSON.stringify({...data,receipt_operations:items.map(()=>randomUUID()),received_date:'2000-01-01',cancellation_reason:'x'.repeat(300),cancelled_by:actor.id}).length>4000)throw fail(413,'Compra excede limite de documento; reduza os itens antes de salvar.');
  await save('AccountsPayable',payableId,{description:'Compra - '+supplier.data.name,issue_date:d.date,due_date:d.due_date,amount:total/100,beneficiary_name:supplier.data.name,beneficiary_type:'fornecedor',purchase_id:body.id,supplier_id:d.supplier_id,status:'pendente',priority:'normal',responsible_user:actor.id},payable);
  return data;
 }
 if(!old||!['confirm','cancel'].includes(body.action)||old.status==='cancelada'||old.source_device_id!==deviceId)throw fail(409,'Transicao de compra recusada.');
 const record=(await c.query('SELECT * FROM d2_catalog WHERE id=$1 FOR UPDATE',[body.id])).rows[0];const plan=await purchasePreview(c,actor.id,record);if(body.token!==plan.token)throw fail(409,'Conferencia de compra ou saldo mudou.');
 const data=clean(old),payable=await owned(c,actor.id,'AccountsPayable',old.accounts_payable_id),p=unwrapDomain(payable);
 if(body.action==='confirm'){
  if(!plan.canReceive)throw fail(409,'Compra ja recebida.');data.receipt_operations=[];
  for(const item of old.items){const b=plan.balances.find(x=>x.itemId===item.inventory_item_id);const op=await applyOperational(c,actor,deviceId,{operationId:stableId(body.operationId+item.id),kind:'entry',itemId:item.inventory_item_id,baseVersion:b.baseVersion,quantityMilli:item.quantity_milli,unitCents:item.unit_cents},async()=>{},{enqueue:false});changes.push({entity:'OperationalEvent',record:op.record});data.receipt_operations.push(op.operationId);}
  data.status='recebida';data.stock_posted=true;data.received_date=new Date().toISOString().slice(0,10);
 }else{
  if(!plan.canCancel||typeof body.reason!=='string'||body.reason.trim().length<8||body.reason.length>300)throw fail(409,'Cancelamento exige motivo e conta pendente.');
  if(old.stock_posted)for(let i=0;i<old.items.length;i++){const item=old.items[i],b=plan.balances.find(x=>x.itemId===item.inventory_item_id);const op=await applyOperational(c,actor,deviceId,{operationId:stableId(body.operationId+item.id),kind:'reversal',referenceId:old.receipt_operations[i],reason:body.reason,inputs:[{itemId:item.inventory_item_id,baseVersion:b.baseVersion}]},async()=>{},{enqueue:false});changes.push({entity:'OperationalEvent',record:op.record});}
  await save('AccountsPayable',payable.id,{...clean(p),status:'cancelado'},payable);data.status='cancelada';data.cancellation_reason=body.reason.trim();data.cancelled_by=actor.id;
 }
 return data;
}
