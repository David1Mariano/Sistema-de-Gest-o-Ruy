import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
export async function sharedHistoryAcceptance({window,fixture,profileRoot,local,wait,evaluate}){
 const h=fixture.history;assert.ok(h?.auditId&&h?.attachmentId);
 const get=async route=>{const r=await local(route);assert.equal(r.status,200,JSON.stringify(r));return r.body;};
 const go=async(route,text)=>{await evaluate(`history.pushState({},'',${JSON.stringify(route)});dispatchEvent(new PopStateEvent('popstate'));`);await wait(()=>evaluate(`document.querySelector('main')?.innerText.includes(${JSON.stringify(text)})`));};
 await go('/auditoria','FICTICIO Auditoria historica compartilhada');
 assert.ok((await get('/domain/AuditLog')).records.some(r=>r.id===h.auditId&&r._historical));
 await fs.writeFile(path.join(profileRoot,'history-audit.png'),(await window.webContents.capturePage()).toPNG());
 await go('/estoque','FICTICIO Insumo historico');
 const state=await get('/operations/state'),movement=state.movements.find(m=>m.id===h.movementId);assert.ok(movement?._historical);assert.equal(movement.quantity,1);assert.equal(state.balances.some(b=>b.item_id===h.inventoryId),false);
 const masters=(await get('/catalog/InventoryItem')).records;assert.equal(masters.find(r=>r.id===h.inventoryId).current_stock,17.5);
 const working=state.movements.filter(m=>m.item_id===fixture.stockId&&!m._historical);assert.ok(working.length>=2);assert.ok(working.every(m=>m.quantity===Math.abs(m.quantity_milli)/1000&&m.balance_after===m.balance_after_milli/1000&&m.total_cost>0));
 await fs.writeFile(path.join(profileRoot,'history-stock.png'),(await window.webContents.capturePage()).toPNG());
 await go('/gastos-diarios?tab=gastos','Financeiro');
 await wait(()=>evaluate("!![...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='Tudo')"));
 await evaluate("[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='Tudo').click()");
 await wait(()=>evaluate("document.querySelector('main').innerText.includes('FICTICIO Despesa historica compartilhada')"));
 const record=(await get('/domain/FinancialExpense')).records.find(r=>r.id===h.expenseId);assert.equal(record._readOnly,true);assert.equal(record.amount,7);assert.equal(record.proof_url,'/api/d1/attachments/'+h.attachmentId+'/download');
 const proof=await get('/attachments/'+h.attachmentId);assert.equal(proof.sha256,h.sha256);assert.equal(createHash('sha256').update(Buffer.from(proof.bytes,'base64')).digest('hex'),h.sha256);
 const downloaded=await evaluate(`(async()=>{const r=await fetch(${JSON.stringify(record.proof_url)});const b=await r.arrayBuffer();return {status:r.status,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(v=>v.toString(16).padStart(2,'0')).join('')};})()`);assert.equal(downloaded.status,200);assert.equal(downloaded.hash,h.sha256);
 assert.notEqual((await local('/attachments/'+h.quarantineId)).status,200);
 const before=await get('/operations/state');
 const attempt=await local('/domain/command',{entity:'FinancialExpense',id:h.expenseId,baseVersion:1,operationId:randomUUID(),action:'save',data:{amount:8,status:'pago'}});assert.equal(attempt.status,409);assert.deepEqual((await get('/operations/state')).accounts,before.accounts);
 await fs.writeFile(path.join(profileRoot,'shared-window.png'),(await window.webContents.capturePage()).toPNG());
 return {auditVisible:true,historicalStockVisible:true,historicalQuantityPreserved:true,noHistoricalLedgerReplay:true,attachmentBytesAndHash:true,authenticatedDownload:true,quarantineBlocked:true,historicalWriteBlocked:true};
}
