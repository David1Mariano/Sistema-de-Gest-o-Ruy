import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function payrollSmoke(window,waitFor,origin,pool,actor,{catalogSave,marker}){
 const ids=[randomUUID(),randomUUID()],names=['FICTICIO Lote interface I um','FICTICIO Lote interface I dois'];
 for(let i=0;i<ids.length;i++)await catalogSave(pool,{id:actor,role:'admin'},marker.deviceId,'Employee',ids[i],{operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:names[i],status:'ativo',hire_type:'clt',admission_date:'2026-01-01'}});
 const js=async code=>{
  const result=await window.webContents.executeJavaScript(`(()=>{try{${code};return {ok:true};}catch(e){return {ok:false,error:e.message};}})()`);
  if(!result.ok)throw Error('Payroll UI: '+result.error);
 };
 const click=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Botão ausente');b.click();})()`);
 const rows=async()=> (await pool.query("SELECT entity,data FROM d2_catalog WHERE owner_id=$1 AND entity IN ('EmployeePayment','FinancialExpense') ORDER BY id",[actor])).rows;
 await window.loadURL(origin+'/financeiro');await waitFor("document.body.textContent.includes('Gastos & Pagamentos')");await click('Pagamento');await waitFor("!!document.querySelector('#multiPay')");
 await js("document.querySelector('#multiPay').click()");
 await waitFor(JSON.stringify(names)+".every(name=>document.querySelector('[role=dialog]')?.textContent.includes(name))");
 for(let i=0;i<ids.length;i++){
  await js(`(()=>{const e=[...document.querySelectorAll('[role=dialog] input[type=checkbox]')].find(e=>e.id!=='multiPay'&&e.parentElement.textContent.includes(${JSON.stringify(names[i])}));if(!e)throw Error('Colaborador ausente');e.click();})()`);
  await waitFor("[...document.querySelectorAll('[role=dialog] input')].filter(e=>e.type!=='checkbox'&&e.closest('.w-32')).length==="+(i+1));
  await js(`(()=>{const e=[...document.querySelectorAll('[role=dialog] input')].find(e=>e.closest('.w-32')&&e.closest('.w-32').parentElement.textContent.includes(${JSON.stringify(names[i])}));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(10+i))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 }
 const before=await rows();await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Registrar 2 pagamento(s)'&&!b.disabled)");
 await js("window.__iConfirmCount=0;window.__iAccept=false;window.confirm=()=>{window.__iConfirmCount++;return window.__iAccept;}");
 await click('Registrar 2 pagamento(s)');await waitFor('window.__iConfirmCount===1');assert.deepEqual(await rows(),before);
 await js('window.__iAccept=true');await click('Registrar 2 pagamento(s)');await waitFor("!document.querySelector('[role=dialog]')");
 const result=(await rows()).map(row=>({entity:row.entity,...JSON.parse(row.data.payload_json)}));
 const payments=result.filter(row=>row.entity==='EmployeePayment'&&ids.includes(row.employee_id)),expenses=result.filter(row=>row.entity==='FinancialExpense');
 assert.equal(payments.length,2);assert.equal(expenses.length,2);assert.equal(payments.reduce((sum,p)=>sum+p.net_amount,0),21);
 for(const payment of payments)assert.ok(expenses.some(expense=>expense.linked_payment_id&&expense.amount===payment.net_amount));
 await window.loadURL(origin+'/financeiro');await waitFor("document.body.textContent.includes('Gastos & Pagamentos')");assert.equal((await rows()).length,5);
 return {officialForm:true,confirmationCancelledWithoutWrites:true,twoPayments:true,twoLinkedExpenses:true,total:21,reloadPersisted:true,externalTransfer:false};
}
