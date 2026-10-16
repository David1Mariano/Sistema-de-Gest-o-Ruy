import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
export async function autonomySmoke({window,waitFor,origin,pool,actor,credentials,recover,crashApi,crashPostgres}){
 const js=code=>window.webContents.executeJavaScript(code);
 const api=(route,body)=>js(`(async()=>{const me=await (await fetch('/api/d1/me')).json();const r=await fetch('/api/d1'+${JSON.stringify(route)},{method:${body?'"POST"':'"GET"'},headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:${body?JSON.stringify(JSON.stringify(body)):'undefined'}});return {status:r.status,value:await r.json()};})()`);
 assert.equal(await js("(async()=>{try{await fetch('https://example.invalid');return false;}catch{return true;}})()"),true);
 const id=randomUUID(),create={operationId:randomUUID(),operation:'create',baseVersion:null,data:{name:'FICTICIO Autonomia H',status:'ativo'}};
 const first=await api('/entities/Sector/'+id,create);assert.equal(first.status,200);
 const before=(await pool.query('SELECT * FROM lab_outbox WHERE record_id=$1 ORDER BY operation_id',[id])).rows;
 await crashApi();assert.equal(await recover(),true);
 assert.equal((await api('/me')).value.user.id,actor);
 assert.equal((await api('/entities/Sector/'+id,create)).value.replay,true);
 assert.deepEqual((await pool.query('SELECT * FROM lab_outbox WHERE record_id=$1 ORDER BY operation_id',[id])).rows,before);
 const edit={operationId:randomUUID(),operation:'update',baseVersion:1,data:{name:'FICTICIO Autonomia H editado'}};
 assert.equal((await api('/entities/Sector/'+id,edit)).status,200);
 const queue=(await pool.query('SELECT * FROM lab_outbox WHERE record_id=$1 ORDER BY operation_id',[id])).rows;
 await crashPostgres();assert.equal(await recover(),true);
 assert.equal((await api('/entities/Sector/'+id,edit)).value.replay,true);
 const after=(await pool.query('SELECT * FROM lab_outbox WHERE record_id=$1 ORDER BY operation_id',[id])).rows;assert.deepEqual(after,queue);
 const row=(await pool.query('SELECT data,version FROM d1_records WHERE id=$1',[id])).rows[0];assert.equal(Number(row.version),2);
 assert.equal((await api('/logout',{})).status,200);
 const relogin=await api('/login',{login:credentials.login,password:credentials.password});assert.equal(relogin.status,200);assert.equal(relogin.value.user.id,actor);
 await window.loadURL(origin+'/setores');await waitFor("document.body.textContent.includes('FICTICIO Autonomia H editado')");
 assert.equal((await api('/me')).value.user.id,actor);
 assert.notEqual(await js("document.querySelector('[aria-label^=\"Nuvem:\"]')?.getAttribute('aria-label')"),'Nuvem: operações confirmadas');
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return {actor,id,apiCrashRecovered:true,postgresImmediateStopRecovered:true,offlineSessionSurvived:true,offlinePasswordRelogin:true,createReadEdit:true,networkBlocked:true,queueBefore:hash(queue),queueAfter:hash(after),operationCount:after.length,noFalseGreen:true};
}
