import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {list,save} from './entities.mjs';
import {fail} from './core.mjs';
const root=fileURLToPath(new URL('../../dist-d1/',import.meta.url));
export async function staticRoute(req,res,url){
 if(req.method!=='GET'||url.pathname.startsWith('/api/')||url.pathname==='/health')return false;
 const name=/^\/(assets|fonts)\//.test(url.pathname)?url.pathname.slice(1):'lab/d1/index.html';
 if(!/^((assets|fonts)\/[A-Za-z0-9_.-]+|lab\/d1\/index.html)$/.test(name))throw fail(404,'Asset inválido.');
 const bytes=await fs.readFile(path.join(root,name));
 const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.ttf')?'font/ttf':name.endsWith('.woff2')?'font/woff2':name.endsWith('.txt')?'text/plain':'text/html; charset=utf-8';
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; frame-src blob:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});res.end(bytes);return true;
}
export async function entitiesRoute(pool,user,deviceId,req,url,body){
 const match=url.pathname.match(/^\/api\/d1\/entities\/(Sector|JobRole|Employee)(?:\/([0-9a-f-]+))?$/i);
 if(!match)return null;
 if(req.method==='GET')return {records:await list(pool,user,match[1])};
 return save(pool,user,deviceId,match[1],match[2],body);
}
