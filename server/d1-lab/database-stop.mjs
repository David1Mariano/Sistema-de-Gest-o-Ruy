import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {cluster,validateHome,installation} from './environment.mjs';
// Call only for a database this application started. Never kill pg_ctl or PostgreSQL.
export async function stopStartedDatabase(){
 if(!installation)throw Error('Installation namespace required');
 const marker=await validateHome();
 if(path.resolve(await fs.realpath(cluster)).toLowerCase()!==path.resolve(cluster).toLowerCase())throw Error('Cluster redirection refused');
 await new Promise((resolve,reject)=>{
  const child=spawn(path.join(marker.bin,'pg_ctl.exe'),['-D',cluster,'-m','fast','-w','-t','300','stop'],{windowsHide:true,stdio:'ignore'});
  child.once('error',()=>reject(Error('LAB_DATABASE_SHUTDOWN_PENDING')));
  child.once('exit',code=>code===0?resolve():reject(Error('LAB_DATABASE_SHUTDOWN_PENDING')));
 });
}
