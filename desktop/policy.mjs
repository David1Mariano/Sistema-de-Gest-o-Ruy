import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const policyDirectory=path.dirname(fileURLToPath(import.meta.url));
const installationPath=fs.existsSync(path.join(policyDirectory,'server/d1-lab/installation.mjs'))?path.join(policyDirectory,'server/d1-lab/installation.mjs'):path.join(policyDirectory,'../server/d1-lab/installation.mjs');
const {installationFor}=await import(pathToFileURL(installationPath));
const installation=installationFor();
const auxiliary=installation?.id==='history-view-dev-20261020'&&process.env.RUY_HISTORY_ACCEPTANCE==='1'&&process.env.RUY_HISTORY_UI_AUX==='1';
const port=auxiliary?18124:Number(process.env.RUY_D1_TEST_API_PORT||18087);
if(![18087,18091,...(auxiliary?[18124]:[]),...(installation?[installation.apiPort]:[])].includes(port)||port!==18087&&process.env.RUY_D1_ALLOW_TESTS!=='1')throw Error('Porta de laboratório inválida.');
export const localOrigin = `http://127.0.0.1:${port}`;
export function allowedNavigation(value) {
  try { const u = new URL(value); return u.origin === localOrigin && !u.username && !u.password; }
  catch { return false; }
}
export function allowedDownload(value){
 try{const url=new URL(value);return url.origin===localOrigin&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='blob:'||/^\/api\/d1\/(?:(?:history|migrated)\/)?attachments\/[a-f0-9-]{36}\/download$/.test(url.pathname)||url.pathname==='/api/d1/delivery/report.csv');}catch{return false;}
}
export const webPreferences = Object.freeze({
  nodeIntegration: false, contextIsolation: true, sandbox: true,
  webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
});
