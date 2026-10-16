import {createPurchasePayable} from './purchase-payable.mjs';
import {isLocalAdmin} from '../../src/lib/localPermissions.mjs';
import {createHash} from 'node:crypto';
import {fail,transaction} from './core.mjs';
import {validateMovement,costsAfter,stockDirection,roundQty,UNITS} from '../../src/lib/stockRules.js';
import {canLocalEntity} from '../../src/lib/localPermissions.mjs';
import {computeConsumption} from '../../src/lib/consumptionCalc.js';

export const OPERATION_ENTITIES=new Set(['InventoryItem','StockMovement','Supplier','Purchase','PurchaseItem','RecipeIngredient','ProductionProduct','ProductionOrder','DailyProduction','MachineRotation']);
const links={inventory_item_id:'InventoryItem',preferred_supplier_id:'Supplier',supplier_id:'Supplier',product_id:'ProductionProduct',production_order_id:'ProductionOrder',purchase_id:'Purchase'};
const fields={InventoryItem:['name','sku','category','unit','minimum_stock','preferred_supplier_id','location','status','observation'],Supplier:['name','trade_name','document','contact_name','contact','phone','whatsapp','email','category','payment_terms','pix_key','status','observation'],ProductionOrder:['product_id','product_name','unit','planned_quantity','date','status','priority','responsible','observation'],MachineRotation:['machine_name','product_id','date','minutes','observation']};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=value=>{if(typeof value!=='string'||! /^[A-Za-z0-9_-]{1,120}$/.test(value))throw fail(422,'ID inválido.');return value;};
const qty=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1e9||Math.abs(value*10000-Math.round(value*10000))>0.001)throw fail(422,'Quantidade positiva com até quatro casas decimais obrigatória.');return value;};
function moneyCents(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9||Math.abs(value*100-Math.round(value*100))>0.001)throw fail(422,'Valor monetario deve ter ate duas casas decimais.');return Math.round(value*100);}
const nonnegative=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e9)throw fail(422,'Valor não negativo obrigatório.');return value;};
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)throw fail(422,'Data inválida.');return value;}
function permit(actor,entity,write=false){if(!actor?.active)throw fail(401,'Sessão necessária.');if(!OPERATION_ENTITIES.has(entity))throw fail(422,'Entidade inválida.');if(canLocalEntity(actor.role,entity,write))return;throw fail(403,'Permissão negada.');}
function token(value){if(typeof value!=='string'||! /^[A-Za-z0-9_:-]{1,100}$/.test(value))throw fail(422,'clientToken inválido.');return value;}
function operationKey(value){if(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))return value.toLowerCase();const hex=hash(value);return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;}
const expose=row=>row&&({...row.data,id:row.id,version:row.version,created_date:row.created_date,updated_date:row.updated_date});
async function get(client,entity,recordId){const row=expose((await client.query('SELECT * FROM ruy_operations.record WHERE entity=$1 AND id=$2',[entity,id(recordId)])).rows[0]);if(!row)throw fail(404,'Registro não encontrado.');return row;}
function version(row,expected){if(!Number.isInteger(expected)||row.version!==expected)throw fail(409,'Versão alterada. Recarregue e confira novamente.');}
async function list(client,entity,query={}){return(await client.query('SELECT * FROM ruy_operations.record WHERE entity=$1 AND data @> $2::jsonb ORDER BY id',[entity,JSON.stringify(query)])).rows.map(expose);}

export function createOperationsRepository(pool) {
  async function preview(client,productionId) {
    const production=await get(client,'DailyProduction',productionId);
    const grouped=new Map();
    const consumption=computeConsumption({record:production,product:{yield_quantity:production.yield_snapshot},ingredients:production.recipe_snapshot});
    if(consumption.state!=='ok')throw fail(422,'Ficha técnica inválida.');
    for(const {ingredient:ing,needed:rawNeeded} of consumption.rows){const needed=roundQty(rawNeeded);if(needed<=0)throw fail(422,'Consumo arredondado a zero. Revise a ficha técnica.');grouped.set(ing.inventory_item_id,roundQty((grouped.get(ing.inventory_item_id)||0)+needed));}
    const rows=[];
    for(const [itemId,needed] of [...grouped].sort(([a],[b])=>a.localeCompare(b))){const item=await get(client,'InventoryItem',itemId);rows.push({itemId,name:item.name,unit:item.unit,needed,available:item.current_stock,version:item.version,sufficient:item.current_stock>=needed});}
    const reviewHash=hash({productionId,version:production.version,recipe:production.recipe_snapshot,rows});
    return{production,rows,reviewHash,canConfirm:!production.consumption_confirmed&&rows.every(r=>r.sufficient)};
  }
  return {
    async list(actor,entity,query={},offset=0){permit(actor,entity);if(!query||typeof query!=='object'||Array.isArray(query)||!Number.isInteger(offset)||offset<0||offset>1000000)throw fail(422,'Consulta inválida.');if(entity==='MachineRotation'&&query.rotation_kind==='terminal'&&!isLocalAdmin(actor.role))throw fail(403,'Permissao financeira necessaria.');return(await pool.query("SELECT * FROM ruy_operations.record WHERE entity=$1 AND data @> $2::jsonb AND ($4::boolean OR COALESCE(data->>'rotation_kind','production')<>'terminal') ORDER BY id LIMIT 200 OFFSET $3",[entity,JSON.stringify(query),offset,entity!=='MachineRotation'||isLocalAdmin(actor.role)])).rows.map(expose);},
    async get(actor,entity,recordId){permit(actor,entity);const row=await get(pool,entity,recordId);if(entity==='MachineRotation'&&row.rotation_kind==='terminal'&&!isLocalAdmin(actor.role))throw fail(403,'Permissao financeira necessaria.');return row;},
    async preview(actor,productionId){permit(actor,'DailyProduction');return transaction(pool,async client=>{await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return preview(client,productionId);});},
    async operation(actor,clientToken){permit(actor,'StockMovement');const row=(await pool.query('SELECT result FROM ruy_operations.operation WHERE client_token=$1 AND actor=$2',[token(clientToken),actor.id])).rows[0];return row?{found:true,...row.result}:{found:false};},
    async execute(actor,clientToken,command,params) {
      permit(actor,'StockMovement',true);
      token(clientToken);const operationId=operationKey(clientToken);
      if(!params||typeof params!=='object'||Array.isArray(params))throw fail(422,'Operação inválida.');
      const target=command==='save'?params.entity:({saveTerminalRotation:'MachineRotation',saveProduct:'ProductionProduct',createInventory:'InventoryItem',adjustInventory:'InventoryItem',move:'StockMovement',registerProduction:'DailyProduction',confirmProduction:'DailyProduction',createPurchase:'Purchase',receivePurchase:'Purchase'})[command];
      permit(actor,target,true);
      const requestHash=hash({command,params});
      return transaction(pool,async client=>{
        // All commands of this development module share a lock. This prevents
        // recipe/stock races and gives consistent lock ordering across commands.
        await client.query('SELECT pg_advisory_xact_lock(708085)');
        if(command==='createPurchase'&&params.dueDate){if(!isLocalAdmin(actor.role))throw fail(403,'Permissao financeira necessaria.');await client.query('SELECT pg_advisory_xact_lock(708086)');}
        const prior=(await client.query('SELECT * FROM ruy_operations.operation WHERE id=$1',[operationId])).rows[0];
        if(prior){if(prior.client_token!==clientToken||prior.actor!==actor.id||prior.request_hash!==requestHash)throw fail(409,'Operação reutilizada com outra intenção.');return prior.result;}
        const audits=[],records=[];
        async function save(entity,recordId,data,expected) {
          const before=expose((await client.query('SELECT * FROM ruy_operations.record WHERE entity=$1 AND id=$2 FOR UPDATE',[entity,id(recordId)])).rows[0]);
          if(before)version(before,expected);else if(expected!==undefined)throw fail(404,'Registro não encontrado.');
          const clean={...data};for(const key of ['id','version','created_date','updated_date'])delete clean[key];
          const saved=expose(before?(await client.query('UPDATE ruy_operations.record SET data=$3,version=version+1,updated_date=clock_timestamp() WHERE entity=$1 AND id=$2 RETURNING *',[entity,recordId,clean])).rows[0]:(await client.query('INSERT INTO ruy_operations.record(entity,id,data) VALUES($1,$2,$3) RETURNING *',[entity,recordId,clean])).rows[0]);
          for(const [field,target] of Object.entries(links))if(clean[field])await client.query('INSERT INTO ruy_operations.relationship VALUES($1,$2,$3,$4,$5) ON CONFLICT(entity,record_id,field) DO UPDATE SET target_entity=EXCLUDED.target_entity,target_id=EXCLUDED.target_id',[entity,recordId,field,target,id(clean[field])]);
          audits.push({entity,recordId,before,after:saved});records.push({entity,...saved});return saved;
        }
        async function movement(item,type,quantity,unitCost,originType,originId,index,movementDate=params.date) {
          validateMovement({item,type,quantity,unit:item.unit});
          const direction=stockDirection(type),balance=roundQty(item.current_stock+(direction==='entrada'?quantity:-quantity));
          if(balance>1e9)throw fail(422,'Limite de saldo excedido.');
          const costs=costsAfter({item,type,quantity,unitCost});
          const updated=await save('InventoryItem',item.id,{...item,current_stock:balance,average_cost:costs.average,last_cost:direction==='entrada'&&unitCost>0?unitCost:item.last_cost},item.version);
          await save('StockMovement',`${operationId}_${index}`,{operation_id:operationId,inventory_item_id:item.id,item_name:item.name,type,direction,quantity,unit:item.unit,unit_cost:unitCost||0,balance_before:item.current_stock,balance_after:balance,origin_type:originType,origin_id:originId,responsible_user:actor.id,date:movementDate});
          return updated;
        }
        if(command==='save') {
          const entity=params.entity,allowed=fields[entity];if(!allowed)throw fail(422,'Use o comando de negócio desta entidade.');
          const data=params.data;if(!data||Array.isArray(data)||Object.keys(data).some(k=>!allowed.includes(k)))throw fail(422,'Campos não permitidos.');
          const before=params.expectedVersion!==undefined?await get(client,entity,params.id):null;
          const merged={...(before||{}),...data};
          if(['InventoryItem','Supplier'].includes(entity)&&!String(merged.name||'').trim())throw fail(422,'Nome obrigatório.');
          if(entity==='InventoryItem'){if(!UNITS.includes(merged.unit))throw fail(422,'Unidade inválida.');if(before&&merged.unit!==before.unit&&(await list(client,'StockMovement',{inventory_item_id:before.id})).length)throw fail(409,'Unidade de item movimentado não pode ser alterada.');merged.minimum_stock=nonnegative(merged.minimum_stock||0);if(before&&merged.status==='inativo'&&before.current_stock!==0)throw fail(409,'Item com saldo deve permanecer ativo.');merged.preferred_supplier_name=merged.preferred_supplier_id?(await get(client,'Supplier',merged.preferred_supplier_id)).name:'';if(!before){merged.current_stock=0;merged.average_cost=0;merged.last_cost=0;}}
          if(entity==='ProductionOrder'){await get(client,'ProductionProduct',merged.product_id);merged.planned_quantity=qty(merged.planned_quantity);date(merged.date);if(before?.status==='concluida')throw fail(409,'Ordem concluída não pode ser editada.');if(before&&before.product_id!==merged.product_id&&(await list(client,'DailyProduction',{production_order_id:before.id})).length)throw fail(409,'Ordem com produção vinculada não pode trocar de produto.');if(!before){merged.status='pendente';merged.produced_quantity=0;}else if(!['pendente','cancelada'].includes(merged.status))throw fail(422,'Situação inválida.');if(merged.planned_quantity<(merged.produced_quantity||0))throw fail(422,'Planejamento inferior à produção confirmada.');}
          if(entity==='MachineRotation'){if(before?.rotation_kind==='terminal')throw fail(409,'Rodizio de terminal requer comando financeiro proprio.');merged.rotation_kind='production';await get(client,'ProductionProduct',merged.product_id);date(merged.date);qty(merged.minutes);if(!String(merged.machine_name||'').trim())throw fail(422,'Máquina obrigatória.');}
          await save(entity,params.id,merged,params.expectedVersion);
        } else if(command==='saveTerminalRotation') {
          if(!isLocalAdmin(actor.role))throw fail(403,'Permissao financeira necessaria.');
          const data=params.data,allowed=['weekday','operator','terminal','sales_goal','transaction_goal','manager_name','manager_phone','start_time','end_time','status','observation'];
          if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!allowed.includes(k)))throw fail(422,'Campos de rodizio invalidos.');
          const before=params.expectedVersion!==undefined?await get(client,'MachineRotation',params.id):null;
          if(before&&before.rotation_kind!=='terminal')throw fail(409,'Rodizio de producao nao pode ser convertido em terminal.');
          const merged={...(before||{}),...data};
          if(!['segunda','terca','quarta','quinta','sexta','sabado','domingo'].includes(merged.weekday)||!['ativo','inativo'].includes(merged.status||'ativo'))throw fail(422,'Dia ou situacao invalida.');
          for(const key of ['operator','terminal','manager_name','manager_phone','observation']){const max=key==='observation'?4000:200;if(merged[key]!==undefined&&typeof merged[key]!=='string')throw fail(422,'Texto de rodizio invalido.');merged[key]=String(merged[key]||'').trim();if(merged[key].length>max||['operator','terminal'].includes(key)&&!merged[key])throw fail(422,'Operadora e terminal obrigatorios, com tamanho valido.');}
          merged.sales_goal=moneyCents(merged.sales_goal||0)/100;const goal=merged.transaction_goal??0;
          if(!Number.isSafeInteger(goal)||goal<0||goal>1e9)throw fail(422,'Meta de transacoes deve ser inteira e nao negativa.');merged.transaction_goal=goal;
          if(merged.start_time!==undefined&&typeof merged.start_time!=='string'||merged.end_time!==undefined&&typeof merged.end_time!=='string')throw fail(422,'Horario invalido.');const start=merged.start_time||'',end=merged.end_time||'',time=/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
          if(Boolean(start)!==Boolean(end)||(start&&(!time.test(start)||!time.test(end)||end<=start)))throw fail(422,'Informe ambos horarios, com horario final posterior ao inicial no mesmo dia.');
          const clean=Object.fromEntries(allowed.map(key=>[key,merged[key]??'']));clean.status||='ativo';clean.rotation_kind='terminal';
          await save('MachineRotation',params.id,clean,params.expectedVersion);
        } else if(command==='saveProduct') {
          const {name,yield_quantity,yield_unit,ingredients}=params;
          if(!String(name||'').trim()||!UNITS.includes(yield_unit)||!Array.isArray(ingredients)||!ingredients.length||ingredients.length>100)throw fail(422,'Produto, rendimento, unidade e ingredientes obrigatórios.');
          qty(yield_quantity);const seen=new Set(),ingredientItems=new Map();
          for(const ing of ingredients){if(seen.has(ing.inventory_item_id))throw fail(422,'Ingrediente duplicado.');seen.add(ing.inventory_item_id);qty(ing.quantity);ingredientItems.set(ing.inventory_item_id,await get(client,'InventoryItem',ing.inventory_item_id));}
          const total_cost=ingredients.reduce((sum,ing)=>sum+ing.quantity*(ingredientItems.get(ing.inventory_item_id).average_cost||0),0);
          await save('ProductionProduct',params.id,{name,yield_quantity,yield_unit,total_cost,unit_cost:total_cost/yield_quantity,category:String(params.category||''),preparation_time_minutes:nonnegative(params.preparation_time_minutes||0),instructions:String(params.instructions||''),status:params.status==='inativo'?'inativo':'ativo'},params.expectedVersion);
          for(const old of await list(client,'RecipeIngredient',{product_id:params.id,active:true}))await save('RecipeIngredient',old.id,{...old,active:false},old.version);
          for(const [i,ing] of ingredients.entries()){const item=await get(client,'InventoryItem',ing.inventory_item_id);if(ing.unit&&ing.unit!==item.unit)throw fail(422,'Unidade do ingrediente incompatível.');await save('RecipeIngredient',`${operationId}_${i}`,{product_id:params.id,inventory_item_id:item.id,inventory_item_name:item.name,product_name:name,quantity:ing.quantity,unit:item.unit,unit_cost:item.average_cost||0,total_cost:ing.quantity*(item.average_cost||0),active:true});}
        } else if(command==='createInventory') {
          const data=params.data;if(!data||Object.keys(data).some(k=>!fields.InventoryItem.includes(k)))throw fail(422,'Campos não permitidos.');
          if(!String(data.name||'').trim()||!UNITS.includes(data.unit))throw fail(422,'Nome e unidade obrigatórios.');
          nonnegative(params.openingQuantity);nonnegative(params.unitCost||0);date(params.date);
          if((await client.query('SELECT 1 FROM ruy_operations.record WHERE entity=$1 AND id=$2',['InventoryItem',id(params.id)])).rowCount)throw fail(409,'Item já existe.');
          const preferred_supplier_name=data.preferred_supplier_id?(await get(client,'Supplier',data.preferred_supplier_id)).name:'';
          const item=await save('InventoryItem',params.id,{...data,preferred_supplier_name,minimum_stock:nonnegative(data.minimum_stock||0),current_stock:0,average_cost:0,last_cost:0,status:'ativo'});
          if(params.openingQuantity>0)await movement(item,'entrada_ajuste',params.openingQuantity,params.unitCost||0,'saldo_inicial',item.id,0);
        } else if(command==='adjustInventory') {
          const item=await get(client,'InventoryItem',params.itemId);version(item,params.expectedVersion);
          const balance=nonnegative(params.targetBalance),difference=roundQty(balance-item.current_stock);date(params.date);
          if(params.confirmation!=='CONFIRMAR AJUSTE')throw fail(422,'Confirmação de ajuste obrigatória.');
          if(!['inventario','entrada_ajuste','saida_ajuste','saida_perda'].includes(params.reason))throw fail(422,'Motivo inválido.');
          if(params.reason==='entrada_ajuste'&&difference<0||['saida_ajuste','saida_perda'].includes(params.reason)&&difference>0)throw fail(422,'Motivo incompatível com o novo saldo.');
          if(difference===0)throw fail(422,'O novo saldo ? igual ao saldo atual.');
          await movement(item,difference>0?'entrada_ajuste':params.reason==='saida_perda'?'saida_perda':'saida_ajuste',Math.abs(difference),item.average_cost,'inventario',item.id,0);
        } else if(command==='move') {
          const item=await get(client,'InventoryItem',params.itemId);version(item,params.expectedVersion);qty(params.quantity);nonnegative(params.unitCost||0);
          if(!['entrada_manual','saida_manual','saida_perda'].includes(params.type))throw fail(422,'Tipo manual inválido.');
          if(stockDirection(params.type)==='saida'&&params.confirmation!=='CONFIRMAR SAIDA')throw fail(422,'Confirme explicitamente a saída.');
          date(params.date);await movement(item,params.type,params.quantity,params.unitCost,'manual',item.id,0);
        } else if(command==='registerProduction') {
          const product=await get(client,'ProductionProduct',params.productId);qty(params.quantity);date(params.date);if(params.losses!==undefined&&(!Array.isArray(params.losses)||params.losses.length>100||params.losses.some(l=>!l||typeof l!=='object'||!(l.quantity>0)||!Number.isFinite(l.quantity)||!String(l.reason||'').trim())))throw fail(422,'Perdas inválidas.');
          const recipe=await list(client,'RecipeIngredient',{product_id:product.id,active:true});if(!recipe.length)throw fail(422,'Produto sem ficha técnica.');
          if(params.orderId){const order=await get(client,'ProductionOrder',params.orderId);if(order.product_id!==product.id||order.status!=='pendente')throw fail(409,'Ordem indisponível para este produto.');}
          await save('DailyProduction',params.id,{product_id:product.id,production_order_id:params.orderId||null,produced_quantity:params.quantity,date:params.date,status:'registrada',consumption_confirmed:false,yield_snapshot:product.yield_quantity,product_name:product.name,unit:product.yield_unit,responsible:String(params.responsible||''),observation:String(params.observation||''),losses:params.losses||[],loss_quantity:nonnegative(params.loss_quantity||0),leftover_quantity:nonnegative(params.leftover_quantity||0),recipe_snapshot:recipe.map(r=>({inventory_item_id:r.inventory_item_id,quantity:r.quantity,unit:r.unit})),responsible_user:actor.id});
        } else if(command==='confirmProduction') {
          if(params.confirmation!=='CONFIRMAR BAIXA')throw fail(422,'Confirmação de baixa obrigatória.');
          const review=await preview(client,params.productionId);if(review.production.consumption_confirmed)throw fail(409,'Produção já teve consumo confirmado.');
          if(review.reviewHash!==params.reviewHash)throw fail(409,'Prévia alterada. Confira novamente antes da baixa.');
          if(!review.canConfirm)throw fail(409,'Estoque insuficiente. Nenhuma baixa realizada.');
          for(const [i,row] of review.rows.entries()){const item=await get(client,'InventoryItem',row.itemId);if(review.production.recipe_snapshot.some(ing=>ing.inventory_item_id===item.id&&ing.unit!==item.unit))throw fail(409,'Unidade alterada. Revise a ficha técnica.');await movement(item,'consumo_producao',row.needed,item.average_cost,'producao',review.production.id,i,review.production.date);}
          const production=review.production;
          if(production.production_order_id){const order=await get(client,'ProductionOrder',production.production_order_id);if(order.status!=='pendente'||order.product_id!==production.product_id)throw fail(409,'Ordem indisponível para este produto.');const total=roundQty(order.produced_quantity+production.produced_quantity);if(total>order.planned_quantity)throw fail(409,'Produção excede a ordem. Revise o planejamento.');await save('ProductionOrder',order.id,{...order,produced_quantity:total,status:total===order.planned_quantity?'concluida':'pendente'},order.version);}
          await save('DailyProduction',production.id,{...production,consumption_confirmed:true,status:'concluida',consumption_confirmed_by:actor.id,consumption_confirmed_at:new Date().toISOString()},production.version);
        } else if(command==='createPurchase') {
          const supplier=await get(client,'Supplier',params.supplierId);date(params.date);if(!Array.isArray(params.items)||!params.items.length||params.items.length>100)throw fail(422,'Itens obrigatorios.');
          if(params.invoice_url)throw fail(422,'Anexo de compra ainda indisponivel. Nenhum registro criado.');
          if(params.dueDate){date(params.dueDate);if(params.confirmation!=='CONFIRMAR COMPRA E CONTA')throw fail(422,'Confirme a compra e a conta a pagar.');}
          const discount=moneyCents(params.discount||0),freight=moneyCents(params.freight||0),otherCosts=moneyCents(params.otherCosts||0);
          let subtotal=0;const seen=new Set(),lines=[];
          for(const line of params.items){const item=await get(client,'InventoryItem',line.itemId);if(seen.has(item.id))throw fail(422,'Item duplicado.');seen.add(item.id);qty(line.quantity);const cost=moneyCents(line.unitCost);const total=Math.round(line.quantity*cost);subtotal+=total;if(!Number.isSafeInteger(subtotal))throw fail(422,'Limite de total excedido.');lines.push({item,quantity:line.quantity,unitCost:cost/100,total:total/100});}
          if(discount>subtotal)throw fail(422,'Desconto superior ao subtotal.');
          const total=subtotal-discount+freight+otherCosts;if(total<=0||total>1e11)throw fail(422,'Total de compra invalido.');
          const purchase=await save('Purchase',params.id,{supplier_id:supplier.id,supplier_name:supplier.trade_name||supplier.name,date:params.date,status:'pendente',document_number:String(params.document_number||''),observation:String(params.observation||''),subtotal:subtotal/100,discount:discount/100,freight:freight/100,other_costs:otherCosts/100,total_amount:total/100,due_date:params.dueDate||null,payment_method:String(params.paymentMethod||''),responsible_user:actor.id});
          for(const [i,line] of lines.entries())await save('PurchaseItem',`${operationId}_${i}`,{purchase_id:params.id,inventory_item_id:line.item.id,item_name:line.item.name,quantity:line.quantity,unit_cost:line.unitCost,total_cost:line.total,unit:line.item.unit});
          if(params.dueDate){const payable=await createPurchasePayable(client,actor,operationId,purchase,params);records.push(payable);audits.push({entity:'AccountsPayable',recordId:payable.id,before:null,after:payable});await save('Purchase',purchase.id,{...purchase,accounts_payable_id:payable.id,category_id:payable.category_id||null,cost_center_id:payable.cost_center_id||null},purchase.version);}
        } else if(command==='receivePurchase') {
          if(params.confirmation!=='CONFIRMAR ENTRADA')throw fail(422,'Confirmação de recebimento obrigatória.');
          const purchase=await get(client,'Purchase',params.purchaseId);version(purchase,params.expectedVersion);if(purchase.status!=='pendente')throw fail(409,'Compra já recebida.');date(params.date);
          for(const [i,line] of (await list(client,'PurchaseItem',{purchase_id:purchase.id})).entries()){const item=await get(client,'InventoryItem',line.inventory_item_id);if(item.unit!==line.unit)throw fail(409,'Unidade alterada desde a compra.');await movement(item,'entrada_compra',line.quantity,line.unit_cost,'compra',purchase.id,i);}
          await save('Purchase',purchase.id,{...purchase,status:'recebida',stock_posted:true,received_date:params.date,received_by:actor.id},purchase.version);
        } else throw fail(422,'Comando desconhecido.');
        const result={records};
        await client.query('INSERT INTO ruy_operations.operation(id,client_token,actor,request_hash,result) VALUES($1,$2,$3,$4,$5)',[operationId,clientToken,actor.id,requestHash,result]);
        for(const audit of audits)await client.query('INSERT INTO local_audit(actor,action,details) VALUES($1,$2,$3)',[actor.id,'operations_command',{operationId,clientToken,command,entity:audit.entity,recordId:audit.recordId,before:audit.before??null,after:audit.after}]);
        return result;
      });
    },
  };
}
