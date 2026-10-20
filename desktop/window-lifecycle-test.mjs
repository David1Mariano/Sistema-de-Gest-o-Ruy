// Explicit synthetic acceptance path, never used by the regular shortcut.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {revealWindow} from './window-visibility.mjs';
export async function windowLifecycleTest({app,window,screen,log}){
 assert.equal(process.env.RUY_D1_ALLOW_TESTS,'1');
 const wait=async check=>{for(let n=0;n<200;n++){if(check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Window lifecycle timeout');};
 revealWindow(window,screen.getAllDisplays());await wait(()=>window.isVisible());
 const initialBounds=window.getBounds();
 window.minimize();await wait(()=>window.isMinimized());
 revealWindow(window,screen.getAllDisplays());await wait(()=>!window.isMinimized()&&window.isVisible());
 window.setPosition(100000,100000);revealWindow(window,screen.getAllDisplays());
 const bounds=window.getBounds();assert.ok(screen.getAllDisplays().some(({workArea:a})=>bounds.x>=a.x&&bounds.x<a.x+a.width&&bounds.y>=a.y&&bounds.y<a.y+a.height));
 window.hide();assert.equal(window.isVisible(),false);
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('RUY_'))delete env[key];delete env.ELECTRON_RUN_AS_NODE;
 let timer;
 try{
  const second=new Promise((r,j)=>{timer=setTimeout(()=>j(Error('Second instance timeout')),15000);app.once('second-instance',r);});
  const child=spawn(process.execPath,['--lab-window-peer'],{windowsHide:true,stdio:'ignore',env});
  const exited=new Promise((r,j)=>{child.once('error',j);child.once('exit',r);});
  await second;assert.equal(await exited,0);await wait(()=>window.isVisible());
 }finally{clearTimeout(timer);}
 const output={packaged:app.isPackaged,initialWindowVisible:true,minimizedRestored:true,offscreenRecovered:true,hiddenWindowRecoveredBySecondInstance:true,peerHadNoRuyEnvironment:true,initialBounds,finalBounds:window.getBounds(),ownWindowOnly:true};
 await fs.writeFile(path.join(app.getPath('userData'),'window-test.json'),JSON.stringify(output,null,2));
 log('window-tests-passed');
}
