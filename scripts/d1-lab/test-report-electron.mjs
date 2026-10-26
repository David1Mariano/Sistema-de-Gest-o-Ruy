// Synthetic-only Electron rendering acceptance. Save selection is simulated here;
// native-dialog acceptance must be recorded separately, never inferred.
import {app,BrowserWindow} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {installReportExport} from '../../desktop/report-export.mjs';
import {reportData} from '../../src/lib/reportData.js';
const output=path.resolve('artifacts/pdf-acceptance-'+Date.now());
app.setPath('userData',path.join(os.tmpdir(),'ruy-pdf-synthetic-'+Date.now()));
async function run(){
await app.whenReady();await fs.mkdir(output,{recursive:true});
app.removeAllListeners('window-all-closed');app.on('window-all-closed',()=>{});
const record=data=>fs.writeFile(path.join(output,'result.json'),JSON.stringify(data));
await record({stage:'ready'});
try{
 const employeeRows=Array.from({length:180},(_,i)=>({name:`FICTICIO João da Conceição ${String(i).padStart(3,'0')} Nome extenso para conferir quebra de linha`,function:'Operação e conferência',sector:'Produção',phone:'FICTICIO',status:'ativo'}));
 const expenseRows=Array.from({length:90},(_,i)=>({date:'2026-10-15',category_name:`Categoria sintética ${i} — manutenção, alimentação e operação`,amount:100.01+i,status:'pago'}));
 for(const [kind,records,filters] of [['employees',employeeRows,{}],['categories',expenseRows,{start:'2026-10-01',end:'2026-10-31'}]]){
  let handler;const report={...reportData(kind,records,filters),issuedAt:'2026-10-26T12:00:00Z'};
  const wc={mainFrame:{url:'http://127.0.0.1:18133/'},session:{fetch:async()=>({ok:true,json:async()=>report})}};
  installReportExport({ipcMain:{handle:(_n,h)=>handler=h},BrowserWindow,dialog:{showSaveDialog:async()=>({filePath:path.join(output,kind+'.pdf')})},app:{getPath:name=>name==='documents'?output:path.join(os.tmpdir(),'ruy-pdf-data'),getAppPath:()=>path.resolve('desktop')},window:{webContents:wc},origin:'http://127.0.0.1:18133'});
  await record({stage:kind});
  const result=await handler({sender:wc,senderFrame:wc.mainFrame},{kind,filters,expectedRows:report.rows});await record({stage:kind,result});assert.equal(result.saved,true,JSON.stringify(result));
  const bytes=await fs.readFile(path.join(output,kind+'.pdf'));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const existing=await handler({sender:wc,senderFrame:wc.mainFrame},{kind,filters,expectedRows:report.rows});assert.match(existing.error,/já existe/);
 }
 const result={passed:true,output,realElectronPDF:true,nativeDialogTested:false,installedAppTested:false,synthetic:true};await record(result);console.log(JSON.stringify(result));
}catch(error){await record({passed:false,message:error.message});console.error(JSON.stringify({passed:false,message:error.message}));process.exitCode=1;}finally{app.quit();}
}
run().catch(()=>{process.exitCode=1;app.quit();});
