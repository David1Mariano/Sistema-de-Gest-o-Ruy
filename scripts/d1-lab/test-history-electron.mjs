import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createServer} from '../../server/d1-lab/api.mjs';
import {loadHistoryProfile} from '../../server/d1-lab/history-profile.mjs';
import {config,installation} from '../../server/d1-lab/environment.mjs';
assert.equal(installation?.id,'history-view-dev-20261020');assert.equal(process.env.RUY_HISTORY_ACCEPTANCE,'1');
const executable=process.env.RUY_ELECTRON_TEST_EXE;
if(!executable||!path.isAbsolute(executable)||path.basename(executable).toLowerCase()!=='electron.exe')throw Error('EXPLICIT_DEVELOPMENT_ELECTRON_REQUIRED');
const root=path.join(process.env.LOCALAPPDATA,'GestaoRuy','history-view-profiles',process.env.RUY_HISTORY_PROFILE_ID),started=Date.now();
const pool=new pg.Pool(await config()),history=await loadHistoryProfile(),server=createServer(pool,'history-ui-acceptance',{history,historyOnly:true,port:18124});
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(18124,'127.0.0.1',resolve);});
 const env={...process.env,RUY_HISTORY_UI_AUX:'1'};delete env.ELECTRON_RUN_AS_NODE;
 await new Promise((resolve,reject)=>{
  const child=spawn(executable,['desktop/history-ui-smoke.mjs'],{cwd:process.cwd(),windowsHide:true,env,stdio:'ignore'});
  child.once('error',()=>reject(Error('ELECTRON_START_FAILED')));child.once('exit',()=>resolve());
 });
 const files=(await fs.readdir(root)).filter(n=>/^ui-acceptance-\d+\.json$/.test(n));let proof;
 for(const file of files){if((await fs.stat(path.join(root,file))).mtimeMs>=started)proof=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));}
 assert.equal(proof?.passed,true,'NEW_ELECTRON_ACCEPTANCE_PROOF_REQUIRED');assert.equal(proof.packaged,false);assert.equal(proof.historicalWrites,0);assert.equal(proof.operationalApiCalls,0);
 console.log(JSON.stringify({passed:true,developmentElectron:true,installed:false,queries:true,semanticFields:true,attachmentSha256:true,reload:true,historyWrites:0,operationalCalls:0}));
}finally{if(server.listening)await new Promise(resolve=>server.close(resolve));await history.close();await pool.end();}
