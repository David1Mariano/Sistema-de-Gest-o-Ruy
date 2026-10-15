// Entrada exclusivamente via stdin; não aceitar senha em argumentos/variáveis de ambiente.
import {config} from '../../server/d1-lab/environment.mjs';
import {pg,hashPassword} from '../../server/d1-lab/core.mjs';
import {randomUUID} from 'node:crypto';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>4096)throw Error('Entrada excedeu limite.');}
let credentials;
try{credentials=JSON.parse((process.argv.includes('--base64-stdin')?Buffer.from(input.trim(),'base64').toString('utf8'):input).replace(/^\uFEFF/,''));}catch{throw Error('Entrada de criação local inválida.');}
if(!/^[a-z0-9._-]+@example\.invalid$/.test(credentials.login||''))throw Error('Use somente login fictício @example.invalid.');
const hash=await hashPassword(credentials.password);credentials.password='';
const roleIndex=process.argv.indexOf('--role'),role=roleIndex<0?'writer':process.argv[roleIndex+1];
if(!['admin','writer','viewer'].includes(role))throw Error('Perfil de laboratório inválido.');
const pool=new pg.Client(await config(true));await pool.connect();
try{
 const id=randomUUID();await pool.query('INSERT INTO lab_users(id,login,password_hash,role) VALUES($1,$2,$3,$4)',[id,credentials.login,hash,role]);
 console.log(JSON.stringify({id,role,syntheticOnly:true}));
}catch(e){if(e.code==='23505')throw Error('Login fictício já existe; conta preservada.');throw Error('Criação local falhou.');}finally{await pool.end();}
