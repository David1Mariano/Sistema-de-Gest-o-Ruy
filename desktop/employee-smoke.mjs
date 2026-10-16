import assert from 'node:assert/strict';
export async function employeeSmoke(window,waitFor,origin,pool,actor){
 if(process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Synthetic UI opt-in required');
 const js=code=>window.webContents.executeJavaScript(code);
 const click=label=>js(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Action unavailable');button.click();})()`);
 const field=(label,value)=>js(`(()=>{const l=[...document.querySelector('[role=dialog]').querySelectorAll('label')].find(l=>l.textContent.trim()===${JSON.stringify(label)});const e=l?.parentElement.querySelector('input,textarea');if(!e)throw Error('Field unavailable');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await window.loadURL(origin+'/funcionarios');await waitFor("document.body.textContent.includes('Novo colaborador')");
 await click('Novo colaborador');await waitFor("!!document.querySelector('[role=dialog] input')");
 const bounds=await js("(()=>{const d=document.querySelector('[role=dialog]'),r=d.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,viewport:innerHeight,scrollable:d.scrollHeight>d.clientHeight,overflow:getComputedStyle(d).overflowY};})()");
 assert.ok(bounds.top>=0&&bounds.bottom<=bounds.viewport+1&&bounds.overflow==='auto');
 await field('Nome completo *','FICTICIO Agente5 Windows E2E');await field('Data de entrada','2026-01-01');
 await click('Salvar colaborador');await waitFor("!document.querySelector('[role=dialog]')&&document.body.textContent.includes('FICTICIO Agente5 Windows E2E')");
 let row=(await pool.query("SELECT * FROM d1_records WHERE owner_id=$1 AND entity='Employee' AND data->>'name'=$2",[actor,'FICTICIO Agente5 Windows E2E'])).rows[0];assert.ok(row);
 await js("document.querySelector('button[title=Editar]').click()");await waitFor("!!document.querySelector('[role=dialog] input')");
 await field('Nome completo *','FICTICIO Agente5 Windows Editado');await click('Salvar colaborador');
 await waitFor("!document.querySelector('[role=dialog]')&&document.body.textContent.includes('FICTICIO Agente5 Windows Editado')");
 await window.reload();await waitFor("document.body.textContent.includes('FICTICIO Agente5 Windows Editado')");
 await js("document.querySelector('button[title=\"Excluir definitivamente\"]').click()");await waitFor("!!document.querySelector('input[aria-label=\"Confirmação da exclusão\"]')");
 await js("(()=>{const e=document.querySelector('input[aria-label=\"Confirmação da exclusão\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'EXCLUIR');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Confirmar exclusão local'&&!b.disabled)");
 await click('Confirmar exclusão local');await waitFor("!document.querySelector('[role=dialog]')&&!document.body.textContent.includes('FICTICIO Agente5 Windows Editado')");
 row=(await pool.query('SELECT * FROM d1_records WHERE id=$1',[row.id])).rows[0];assert.equal(row.data._deleted,'true');assert.equal(row.version,'3');
 assert.equal((await pool.query("SELECT count(*)::int n FROM lab_audit a JOIN lab_outbox o USING(operation_id) WHERE o.record_id=$1",[row.id])).rows[0].n,3);
 return {created:true,edited:true,queriedAfterReload:true,authorizedTombstone:true,auditCount:3,id:row.id,bounds,networkPhysicallyDisconnected:false};
}
