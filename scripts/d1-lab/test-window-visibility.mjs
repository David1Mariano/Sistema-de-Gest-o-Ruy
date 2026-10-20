import {test} from 'node:test';
import assert from 'node:assert/strict';
import {revealWindow} from '../../desktop/window-visibility.mjs';
const display={workArea:{x:0,y:0,width:1920,height:1080}};
function fixture({minimized=false,bounds={x:100,y:100,width:1366,height:900}}={}){
 const events=[];
 return {events,isDestroyed:()=>false,isMinimized:()=>minimized,restore:()=>events.push('restore'),getBounds:()=>bounds,setPosition:(x,y)=>events.push({x,y}),show:()=>events.push('show'),focus:()=>events.push('focus')};
}
test('A hidden existing window is shown before focus',()=>{const w=fixture();assert.equal(revealWindow(w,[display]),true);assert.deepEqual(w.events,['show','focus']);});
test('A minimized window is restored and made visible',()=>{const w=fixture({minimized:true});revealWindow(w,[display]);assert.deepEqual(w.events,['restore','show','focus']);});
test('A disconnected monitor cannot leave the title bar unreachable',()=>{const w=fixture({bounds:{x:4000,y:-1200,width:1366,height:900}});revealWindow(w,[display]);assert.deepEqual(w.events,[{x:277,y:90},'show','focus']);});
test('A window on another connected display retains its position',()=>{const w=fixture({bounds:{x:-1800,y:100,width:1366,height:900}});revealWindow(w,[display,{workArea:{x:-1920,y:0,width:1920,height:1080}}]);assert.deepEqual(w.events,['show','focus']);});
test('Oversized windows still have a reachable title bar',()=>{const w=fixture({bounds:{x:8000,y:8000,width:2000,height:1200}});revealWindow(w,[display]);assert.deepEqual(w.events,[{x:0,y:0},'show','focus']);});
test('Missing and destroyed windows are left alone',()=>{assert.equal(revealWindow(null,[display]),false);assert.equal(revealWindow({isDestroyed:()=>true},[display]),false);});
