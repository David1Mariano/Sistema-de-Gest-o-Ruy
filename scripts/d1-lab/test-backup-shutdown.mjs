import {test} from 'node:test';import assert from 'node:assert/strict';
import {finishBackupBeforeExit} from '../../desktop/controlled-exit.mjs';
test('backup longer than ten seconds completes before shutdown without blocking the event loop',{timeout:18000},async()=>{
 let completed=false,notified=false,heartbeat=false;const backup=new Promise(resolve=>setTimeout(()=>{completed=true;resolve();},11000));
 const waiting=finishBackupBeforeExit(backup,()=>{notified=true;});setTimeout(()=>{heartbeat=true;},50);
 await new Promise(resolve=>setTimeout(resolve,10100));assert.equal(notified,true);assert.equal(heartbeat,true);assert.equal(completed,false);
 await waiting;assert.equal(completed,true);
});
test('backup failure propagates rather than reporting completion',async()=>{await assert.rejects(()=>finishBackupBeforeExit(Promise.reject(Error('SYNTHETIC_BACKUP_FAILED'))),/SYNTHETIC_BACKUP_FAILED/);});
