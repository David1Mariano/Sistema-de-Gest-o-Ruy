import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {authorizedReport} from '../../server/d1-lab/reports.mjs';
import {reportData,filterReportEmployees} from '../../src/lib/reportData.js';
import {reportHTML} from '../../desktop/report-html.mjs';
import {safeReportDestination,installReportExport} from '../../desktop/report-export.mjs';
const period={start:'2026-10-01',end:'2026-10-31'};
const expenses=[{date:'2026-10-01',amount:0.1,category_name:'Água',status:'pago'},{date:'2026-10-31',amount:0.2,category_name:'Água',status:'pago'},{date:'2026-10-12',amount:500,status:'cancelado'},{date:'2026-09-30',amount:100,status:'pago'}];
test('category report preserves period, cancellation rules and integer-cent total without replaying payments',()=>{
 const r=reportData('categories',expenses,period);assert.deepEqual(r.rows,[['Água',30]]);assert.equal(r.totalCents,30);
 assert.equal(reportData('categories',[],period).totalCents,0);
});
test('employee filters and all rows preserve accents and exclude unauthorized fields',()=>{
 const rows=Array.from({length:1300},(_,i)=>({name:'FICTICIO João '+i,status:'ativo',sector:'A',password:'NEVER_EXPORT',cpf:'NEVER_EXPORT'}));
 const r=reportData('employees',rows,{});assert.equal(r.rows.length,1300);assert.equal(r.rows[0].length,7);assert.ok(!JSON.stringify(r).includes('NEVER_EXPORT'));assert.equal(filterReportEmployees(rows,{sector:'B'}).length,0);
});
test('server rejects role, entity, unknown filters and invalid/reversed dates before consulting source',async()=>{
 let calls=0;const source={list:async()=>{calls++;return expenses;}};
 await assert.rejects(()=>authorizedReport(null,{role:'reader'},'categories',period,source),e=>e.status===403);
 for(const [kind,filters] of [['unknown',{}],['categories',{...period,path:'x'}],['categories',{...period,start:'2026-02-30'}],['categories',{start:period.end,end:period.start}]])await assert.rejects(()=>authorizedReport(null,{role:'admin'},kind,filters,source),e=>e.status===400);
 assert.equal(calls,0);assert.equal((await authorizedReport(null,{role:'admin'},'categories',period,source)).totalCents,30);
});
test('server does not bypass source grant',async()=>{
 await assert.rejects(()=>authorizedReport(null,{role:'admin'},'employees',{}, {list:async()=>{throw Object.assign(Error(),{status:403});}}),e=>e.status===403);
});
test('HTML escapes data, uses A4 with repeated header and no remote assets',()=>{
 const r=reportData('employees',[{name:'FICTICIO <img src=x onerror=alert(1)> João',status:'ativo'}],{});r.issuedAt='2026-10-26T12:00:00Z';
 const html=reportHTML(r);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('26/10/2026'));assert.ok(html.includes('table-header-group'));assert.ok(html.includes('A4 landscape'));assert.ok(!html.includes('https://'));
});
test('issuance date follows local Windows date rather than truncating UTC',()=>{
 const previous=process.env.TZ;process.env.TZ='America/Sao_Paulo';
 try{const report={...reportData('categories',[],period),issuedAt:'2026-10-27T01:00:00Z'};assert.ok(reportHTML(report).includes('Emissão: 26/10/2026'));}
 finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
test('destination protects internal paths, existing junction parents and invalid names',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-report-path-'));const internal=path.join(root,'internal');await fs.mkdir(internal);
 await assert.rejects(()=>safeReportDestination(path.join(internal,'data.pdf'),[internal]));
 await assert.rejects(()=>safeReportDestination(path.join(root,'CON.pdf'),[]));
 await assert.rejects(()=>safeReportDestination(path.join(root,'data.dpapi'),[]));
 assert.equal(await safeReportDestination(path.join(root,'report.pdf'),[internal]),path.join(root,'report.pdf'));
 await fs.rm(root,{recursive:true});
});
test('IPC cancellation creates no renderer/file and unauthorized sender is rejected',async()=>{
 let handler,created=0,dialogCalls=0;const wc={mainFrame:{url:'http://127.0.0.1:18133/financeiro'},session:{fetch:async()=>({ok:true,json:async()=>reportData('categories',expenses,period)})}};
 installReportExport({ipcMain:{handle:(_n,h)=>handler=h},BrowserWindow:class{constructor(){created++;}},dialog:{showSaveDialog:async()=>{dialogCalls++;return {canceled:true};}},app:{getPath:()=>os.tmpdir()},window:{webContents:wc},origin:'http://127.0.0.1:18133'});
 const input={kind:'categories',filters:period,expectedRows:[['Água',30]]};
 assert.ok((await handler({sender:{},senderFrame:wc.mainFrame},input)).error);
 assert.deepEqual(await handler({sender:wc,senderFrame:wc.mainFrame},input),{cancelled:true});assert.equal(created,0);assert.equal(dialogCalls,1);
 const stale=await handler({sender:wc,senderFrame:wc.mainFrame},{...input,expectedRows:[]});assert.match(stale.error,/atualizada/);assert.equal(dialogCalls,1);
});
