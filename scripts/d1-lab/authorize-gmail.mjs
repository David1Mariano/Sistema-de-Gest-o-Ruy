// Explicit browser consent only. Never reads browser tokens, mail or passwords.
import fs from 'node:fs/promises';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {installation,home,seal,validateHome} from '../../server/d1-lab/environment.mjs';
const expectedScopes=['openid','email','https://www.googleapis.com/auth/gmail.send'];
async function main(){
 if(installation?.id!=='final-dev-20261021'||process.env.RUY_GMAIL_BROWSER_CONSENT!=='1')throw Error('EXPLICIT_GMAIL_CONSENT_REQUIRED');
 await validateHome();const file=process.argv[2],from=process.argv[3];
 if(!file||! /^[a-z0-9._+%-]+@gmail\.com$/i.test(from||''))throw Error('LOCAL_OAUTH_CLIENT_FILE_AND_SENDER_REQUIRED');
 // An existing authorization is never overwritten.
 try{await fs.access(home+'/gmail-oauth.dpapi');throw Error('EXISTING_GMAIL_AUTHORIZATION_PRESERVED');}catch(e){if(e.code!=='ENOENT')throw e;}
 const c=JSON.parse(await fs.readFile(file,'utf8')).installed;
 if(!c?.client_id?.endsWith('.apps.googleusercontent.com')||typeof c.client_secret!=='string'||c.auth_uri!=='https://accounts.google.com/o/oauth2/auth'||c.token_uri!=='https://oauth2.googleapis.com/token')throw Error('OFFICIAL_DESKTOP_OAUTH_CLIENT_REQUIRED');
 const verifier=randomBytes(48).toString('base64url'),state=randomBytes(32).toString('hex');let settle,reject;
 const response=new Promise((a,b)=>{settle=a;reject=b;});let received=false;
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');const s=u.searchParams.get('state')||'';
  if(req.method!=='GET'||u.pathname!=='/callback'||received||s.length!==state.length||!timingSafeEqual(Buffer.from(s),Buffer.from(state))){res.writeHead(400);res.end('Solicitacao recusada.');return;}
  received=true;const code=u.searchParams.get('code');res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'"});res.end('Autorização recebida. Volte ao terminal do Sistema Ruy.');
  if(!code)reject(Error('GMAIL_CONSENT_NOT_GRANTED'));else settle(code);
 });
 const timeout=setTimeout(()=>reject(Error('GMAIL_CONSENT_TIMEOUT')),300000);
 try{
  await new Promise((resolve,error)=>{server.once('error',error);server.listen(0,'127.0.0.1',resolve);});
  const redirect='http://127.0.0.1:'+server.address().port+'/callback';
  const query=new URLSearchParams({client_id:c.client_id,redirect_uri:redirect,response_type:'code',scope:expectedScopes.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent',login_hint:from});
  execFile('rundll32.exe',['url.dll,FileProtocolHandler','https://accounts.google.com/o/oauth2/v2/auth?'+query],{windowsHide:true},error=>{if(error)reject(Error('BROWSER_OPEN_FAILED'));});
  const code=await response;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'})});
  if(!r.ok)throw Error('GMAIL_TOKEN_EXCHANGE_FAILED');const tokens=await r.json();
  const scopes=String(tokens.scope||'').split(' ');if(!scopes.includes(expectedScopes[2])||scopes.some(s=>!expectedScopes.includes(s)&&s!=='https://www.googleapis.com/auth/userinfo.email'))throw Error('GMAIL_SCOPE_REFUSED');
  if(typeof tokens.refresh_token!=='string')throw Error('GMAIL_OFFLINE_CONSENT_REQUIRED');
  const account=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+tokens.access_token}});
  if(!account.ok)throw Error('GMAIL_ACCOUNT_CONFIRMATION_FAILED');const user=await account.json();
  if(user.email_verified!==true||String(user.email).toLowerCase()!==from.toLowerCase())throw Error('GMAIL_SENDER_MISMATCH');
  await seal('gmail-oauth.dpapi',{purpose:'RUY_GMAIL_SEND_ONLY',installationId:installation.id,provider:'gmail',from,clientId:c.client_id,clientSecret:c.client_secret,refreshToken:tokens.refresh_token,scopes:expectedScopes,authorizedAt:new Date().toISOString()});
  console.log('GMAIL_AUTHORIZATION_STORED_DPAPI; real delivery still requires a separate confirmed-code test.');
 }finally{clearTimeout(timeout);await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message)?e.message:'GMAIL_AUTHORIZATION_FAILED');process.exitCode=1;});
