import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {config,validateHome,API_PORT,installation} from '../../server/d1-lab/environment.mjs';
import {poolFor,hashPassword} from '../../server/d1-lab/core.mjs';
import {domainCommand} from '../../server/d1-lab/domain.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||!(['i5r4-dev-20261020','final-dev-20261021'].includes(installation?.id)||!installation&&process.env.RUY_D1_TEST_API_PORT==='18091'))throw Error('Explicit synthetic test on auxiliary port 18091 required.');
let pool=poolFor(await config());const marker=await validateHome(),actor=randomUUID(),password=randomBytes(24).toString('hex');
let checks=0;const results=[];
const check=async(name,fn)=>{await fn();checks++;results.push(name);console.log('PASS '+name);};
const origin='http://127.0.0.1:'+API_PORT;let session;
const api=async(route,body)=>{const r=await fetch(origin+'/api/d1'+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:session?.cookie||'','X-CSRF-Token':session?.csrf||''},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
const command=(entity,data,id=randomUUID(),baseVersion=null)=>({operationId:randomUUID(),entity,id,baseVersion,action:'save',data});
const send=async body=>{const r=await api('/domain/command',body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const snapshot=async()=>{const s={};for(const table of ['d2_catalog','d1_stock_balances','d1_stock_movements','d1_operation_events'])s[table]=(await pool.query(`SELECT to_jsonb(t) r FROM ${table} t WHERE owner_id=$1 ORDER BY id`,[actor]).catch(async e=>{if(e.code!=='42703')throw e;return pool.query(`SELECT to_jsonb(t) r FROM ${table} t WHERE owner_id=$1 ORDER BY item_id`,[actor]);})).rows;s.outbox=(await pool.query('SELECT * FROM lab_outbox WHERE actor=$1 ORDER BY operation_id',[actor])).rows;return s;};
const {createServer}=await import('../../server/d1-lab/api.mjs');
const server=createServer(pool,marker.deviceId);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(API_PORT,'127.0.0.1',resolve);});
try{
 await pool.query("INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,'admin')",[actor,actor+'@example.invalid',await hashPassword(password)]);
 const login=await fetch(origin+'/api/d1/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:actor+'@example.invalid',password})});assert.equal(login.status,200);session={...await login.json(),cookie:login.headers.get('set-cookie').split(';')[0]};
 const raw=randomUUID();let product,order,daily;
 await check('cadastro de estoque compatível e receita atômica com ingredientes',async()=>{
  assert.equal((await api('/operations/create-item',{operationId:randomUUID(),itemId:raw,data:{name:'FICTICIO insumo '+actor.slice(0,8),unit:'kg',status:'ativo',minimum_stock:0},initialMilli:10000,unitCents:250})).status,200);
  const cmd=command('ProductionProduct',{name:'FICTICIO receita '+actor.slice(0,8),yield_quantity:10,yield_unit:'un',status:'ativo',ingredients:[{inventory_item_id:raw,quantity:2}]});
  const r=await send(cmd);product=r.domainRecord;assert.equal(product.ingredients.length,1);assert.equal(product.total_cost,5);assert.equal((await send(cmd)).replay,true);
  assert.equal((await api('/domain/command',{...cmd,data:{...cmd.data,yield_quantity:20}})).status,409);
  const fractional=(await send(command('ProductionProduct',{...cmd.data,name:'FICTICIO receita fracionada '+actor.slice(0,8),yield_quantity:3,total_cost:999,unit_cost:1.6666666667}))).domainRecord;
  assert.equal(fractional.total_cost,5);assert.equal(fractional.unit_cost,1.67);
 });
 await check('edição de ficha usa CAS e conserva versão anterior no histórico',async()=>{
  product=(await send(command('ProductionProduct',{...product,instructions:'FICTICIO preparo'},product.id,1))).domainRecord;
  assert.equal(product._version,2);assert.equal((await api('/domain/command',command('ProductionProduct',{...product},product.id,1))).status,409);
 });
 await check('diário registra perdas sem concluir antes da confirmação',async()=>{
  order=(await send(command('ProductionOrder',{date:'2026-10-15',product_id:product.id,planned_quantity:10,produced_quantity:0,priority:'normal',status:'planejada',responsible:'FICTICIO operador'}))).domainRecord;
  daily=(await send(command('DailyProduction',{date:'2026-10-15',product_id:product.id,production_order_id:order.id,produced_quantity:10,loss_quantity:1,leftover_quantity:1,losses:[{quantity:1,reason:'FICTICIO queimado',responsible:'FICTICIO operador',date:'2026-10-15',unit:'un'}]}))).domainRecord;
  assert.equal(daily.local_status,'rascunho');assert.equal(daily.recipe_snapshot[0].quantity,2);
  const saved=(await api('/domain/ProductionOrder')).body.records[0];assert.equal(saved.status,'em_producao');assert.equal(saved.produced_quantity,0);
 });
 await check('perdas inválidas e duplicação de ordem não gravam parcialmente',async()=>{
  const before=await snapshot();
  assert.equal((await api('/domain/command',command('DailyProduction',{...daily,loss_quantity:20}))).status,400);
  assert.equal((await api('/domain/command',command('DailyProduction',{...daily}))).status,409);
  assert.deepEqual(await snapshot(),before);
 });
 await check('preview autoritativa detecta saldo alterado antes da confirmação',async()=>{
  const preview=(await api('/domain/preview/'+daily.id)).body;assert.equal(preview.inputs[0].quantityMilli,2000);
  assert.equal((await api('/operations/command',{operationId:randomUUID(),kind:'entry',itemId:raw,baseVersion:1,quantityMilli:1000,unitCents:250})).status,200);
  assert.equal((await api('/domain/command',{operationId:randomUUID(),entity:'DailyProduction',id:daily.id,baseVersion:1,action:'confirm',token:preview.token})).status,409);
 });
 let confirmedCommand;
 await check('confirmação baixa uma vez, mesmo após ACK perdido/reenvio',async()=>{
  const preview=(await api('/domain/preview/'+daily.id)).body;
  confirmedCommand={operationId:randomUUID(),entity:'DailyProduction',id:daily.id,baseVersion:1,action:'confirm',token:preview.token};
  daily=(await send(confirmedCommand)).domainRecord;assert.equal((await send(confirmedCommand)).replay,true);
  const saved=(await api('/domain/ProductionOrder')).body.records.find(row=>row.id===order.id);assert.equal(saved.status,'concluida');assert.equal(saved.produced_quantity,10);
  assert.equal((await api('/operations/state')).body.balances[0].quantity_milli,'9000');
  assert.equal((await api('/domain/command',{...confirmedCommand,operationId:randomUUID(),baseVersion:2})).status,409);
 });
 await check('cancelamento devolve insumos atomicamente e mantém diário/movimentos',async()=>{
  const cmd={operationId:randomUUID(),entity:'DailyProduction',id:daily.id,baseVersion:daily._version,action:'cancel'};
  daily=(await send(cmd)).domainRecord;assert.equal(daily.local_status,'cancelado');assert.equal((await send(cmd)).replay,true);
  assert.equal((await api('/operations/state')).body.balances[0].quantity_milli,'11000');
  assert.equal((await api('/domain/command',{...cmd,operationId:randomUUID(),baseVersion:daily._version})).status,409);
 });
 let expense;
 await check('gasto com colaborador e pagamento nascem vinculados no mesmo commit',async()=>{
  const employeeId=randomUUID();assert.equal((await api('/catalog/Employee/'+employeeId,{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO colaborador '+actor.slice(0,8),status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}})).status,200);
  const cmd=command('FinancialExpense',{description:'FICTICIO diária',date:'2026-10-15',amount:123.45,status:'pago',beneficiary_type:'colaborador',beneficiary_id:employeeId,payment_method:'dinheiro'});
  expense=(await send(cmd)).domainRecord;assert.equal((await send(cmd)).replay,true);
  const payments=(await api('/domain/EmployeePayment')).body.records;assert.equal(payments.length,1);assert.equal(payments[0].financial_expense_id,expense.id);assert.equal(payments[0].net_amount,123.45);
  assert.equal((await api('/operations/state')).body.accounts.length,0);
 });
 await check('edição sincroniza pagamento; falha antes de commit reverte agregado/fila',async()=>{
  expense=(await send(command('FinancialExpense',{...expense,amount:125.01},expense.id,expense._version))).domainRecord;
  assert.equal((await api('/domain/EmployeePayment')).body.records[0].net_amount,125.01);
  const before=await snapshot();await assert.rejects(domainCommand(pool,{id:actor,role:'admin'},marker.deviceId,command('FinancialExpense',{...expense,amount:150},expense.id,expense._version),()=>{throw Error('FICTICIO crash antes do commit');}));assert.deepEqual(await snapshot(),before);
 });
 await check('receitas e contas persistem; centavos, anexos e quitação incompleta são rejeitados',async()=>{
  const r=await send(command('Revenue',{date:'2026-10-15',description:'FICTICIO venda',gross_amount:100,fee_amount:2.05,net_amount:97.95,status:'recebido'}));assert.equal(r.domainRecord.net_amount,97.95);
  await send(command('AccountsPayable',{description:'FICTICIO conta',due_date:'2026-10-20',amount:99.99,status:'pendente'}));
  const before=await snapshot();
  for(const cmd of [command('Revenue',{date:'2026-10-15',gross_amount:1.001,fee_amount:0,net_amount:1.001,status:'recebido'}),command('FinancialExpense',{...expense,proof_url:'https://example.invalid/private'}),command('AccountsPayable',{description:'FICTICIO conta',due_date:'2026-10-20',amount:99,status:'pago'})])assert.ok((await api('/domain/command',cmd)).status>=400);
  assert.deepEqual(await snapshot(),before);
 });
 await check('caixa recalcula valores adulterados e fechamento recusa duplicidade',async()=>{
  const movement=(await send(command('CashMovement',{date:'2026-10-15',operator_name:'FICTICIO caixa',cash:100,pix:20,debit:0,credit:0,voucher:0,opening_fund:10,withdrawals:5,expenses:2,counted_balance:123,expected_balance:999,difference:999,status:'conferido',account_allocations:'{}'}))).domainRecord;assert.equal(movement.expected_balance,123);assert.equal(movement.difference,0);
  assert.equal((await api('/domain/command',command('CashMovement',{date:'2026-10-15',operator_name:'FICTICIO caixa',cash:'invalido',status:'conferido'}))).status,400);
  const close={date:'2026-10-15',cashier:'caixa_1',shift:'manha',operator_name:'FICTICIO caixa',opening_fund:10,cash_sales:100,withdrawals_total:5,counted_cash:105,status:'conferido'};
  await send(command('FechamentoCaixa',close));assert.equal((await api('/domain/command',command('FechamentoCaixa',close))).status,409);
  await send(command('Sangria',{date:'2026-10-15',amount:5,responsible:'FICTICIO caixa',purpose:'FICTICIO teste',status:'ativo'}));
 });
 await check('pagamento individual e quitação vinculada são agregados idempotentes',async()=>{
  const pay=command('EmployeePayment',{employee_id:expense.beneficiary_id,payment_type:'salario',gross_amount:100,discount_amount:10,net_amount:90,payment_date:'2026-10-15',payment_method:'pix',status:'pago'});
  const p=(await send(pay)).domainRecord;assert.equal((await send(pay)).replay,true);
  assert.ok((await api('/domain/FinancialExpense')).body.records.some(e=>e.id===p.financial_expense_id&&e.amount===90));
  const pending=(await api('/domain/AccountsPayable')).body.records[0];
  const settle=command('AccountsPayable',{...pending,status:'pago',paid_date:'2026-10-15',payment_method_planned:'pix'},pending.id,pending._version);
  const settled=(await send(settle)).domainRecord;assert.equal((await send(settle)).replay,true);
  assert.ok((await api('/domain/FinancialExpense')).body.records.some(e=>e.id===settled.financial_expense_id&&e.origin_id===pending.id));
  assert.equal((await api('/domain/command',{...settle,operationId:randomUUID(),baseVersion:settled._version})).status,409);
  assert.equal((await api('/domain/Vale')).status,200);
 });
 await check('cartão/delivery criam recebível atômico e recebimento atualiza origem uma vez',async()=>{
  for(const [entity,data] of [['CardReceivable',{sale_date:'2026-10-15',expected_date:'2026-10-16',gross_amount:100,fee_amount:2,net_amount:98,acquirer:'FICTICIO adquirente',status:'a_receber'}],['DeliverySettlement',{reference_start:'2026-10-15',reference_end:'2026-10-15',expected_date:'2026-10-16',gross_amount:100,discount_amount:1,commission_amount:10,delivery_fee_amount:2,other_fee_amount:0,net_amount:87,channel:'ifood',status:'a_receber'}]]){
   const create=command(entity,data),source=(await send(create)).domainRecord;assert.equal((await send(create)).replay,true);
   const title=(await api('/domain/AccountsReceivable')).body.records.find(r=>r.id===source.accounts_receivable_id);assert.equal(title.source_id,source.id);
   const receive=command('AccountsReceivable',{...title,status:'recebido',received_date:'2026-10-16'},title.id,title._version);const received=(await send(receive)).domainRecord;assert.equal((await send(receive)).replay,true);
   assert.equal((await api('/domain/'+entity)).body.records.find(r=>r.id===source.id).status,'recebido');
   assert.equal((await api('/domain/command',{...receive,operationId:randomUUID(),baseVersion:received._version})).status,409);
  }
  const card=(await send(command('CardReceivable',{sale_date:'2026-10-15',expected_date:'2026-10-16',gross_amount:20,fee_amount:1,net_amount:19,status:'a_receber'}))).domainRecord;
  const title=(await api('/domain/AccountsReceivable')).body.records.find(r=>r.id===card.accounts_receivable_id);
  const cancellation=command('AccountsReceivable',{...title,status:'cancelado'},title.id,title._version);await send(cancellation);assert.equal((await send(cancellation)).replay,true);
  assert.equal((await api('/domain/CardReceivable')).body.records.find(r=>r.id===card.id).status,'cancelado');
 });
 await check('recorrência gera título e próximo vencimento no mesmo commit; conferência recalcula diferença',async()=>{
  const recurring=(await send(command('RecurringExpense',{name:'FICTICIO aluguel',amount:500,frequency:'mensal',next_due_date:'2026-01-31',status:'ativo'}))).domainRecord;
  const generate={operationId:randomUUID(),entity:'RecurringExpense',id:recurring.id,baseVersion:recurring._version,action:'generate'};
  const next=(await send(generate)).domainRecord;assert.equal(next.next_due_date,'2026-02-28');assert.equal((await send(generate)).replay,true);
  assert.equal((await api('/domain/AccountsPayable')).body.records.filter(p=>p.recurring_expense_id===recurring.id).length,1);
  const reconciliation=(await send(command('ManualReconciliation',{date:'2026-10-15',expected_amount:100,actual_amount:99.99,difference:999,status:'conciliado'}))).domainRecord;
  assert.equal(reconciliation.difference,-0.01);assert.equal(reconciliation.status,'divergente');
  await send(command('MachineRotation',{weekday:'segunda',operator:'FICTICIO operadora',terminal:'FICTICIO terminal',sales_goal:100,transaction_goal:10,status:'ativo'}));
  for(const source of ['Revenue','FinancialExpense','AccountsPayable','AccountsReceivable','CardReceivable','DeliverySettlement','ManualReconciliation','MachineRotation'])assert.equal((await api('/domain/'+source)).status,200);
 });
 await check('permissão é verificada no servidor e não pelo formulário',async()=>{
  await pool.query("UPDATE lab_users SET role='viewer' WHERE id=$1",[actor]);assert.equal((await api('/domain/Revenue')).status,403);assert.equal((await api('/domain/command',command('Revenue',{}))).status,403);await pool.query("UPDATE lab_users SET role='admin' WHERE id=$1",[actor]);
 });

 console.log('MODULE_CHECKS '+JSON.stringify({checks,syntheticOnly:true,physicalWindows:false,sharedClusterRestarted:false}));
}finally{await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();}
