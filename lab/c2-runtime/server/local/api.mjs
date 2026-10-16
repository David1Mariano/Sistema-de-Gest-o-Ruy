import http from 'node:http';
import {relayD1} from './d1-relay.mjs';
import { randomBytes } from 'node:crypto';
import { authorize, createUser, digest, fail, hashPassword, mutate, transaction, verifyPassword } from './core.mjs';
import { dependencies } from './c2.mjs';
import { createFinanceRepository, FINANCIAL_ENTITIES } from '../../scripts/local-finance/repository.mjs';
import { createFinanceAttachmentAuthorizer } from '../../scripts/local-finance/attachments.mjs';
import { handleFinance } from './finance.mjs';
import { createOperationsRepository, OPERATION_ENTITIES } from './operations.mjs';
import {isLocalAdmin} from '../../src/lib/localPermissions.mjs';
import {createFirstAccess} from './first-access.mjs';
import {readAuditFeed} from './audit-feed.mjs';
import {runRhBatch,rhBatchStatus} from './rh-batch.mjs';

export function createLocalServer(pool, { origin = 'http://127.0.0.1:18080', secure = false, now = Date.now, finance = false, operations = false, attachmentStore, loginDiagnostics = false,firstAccess=false,d1BridgeOrigin } = {}) {
  if(firstAccess&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Owner bootstrap requires isolated loopback origin.');
  const ownerAccess=firstAccess?createFirstAccess(pool,firstAccess):null;
  const diagnosticFixture=loginDiagnostics?.fixture;
  if(loginDiagnostics&&(!/^ruy_local_test_finance_\d+_[a-f0-9]{8}$/.test(diagnosticFixture||'')||!origin.startsWith('http://127.0.0.1:')))throw Error('Login diagnostics require an isolated loopback synthetic fixture.');
  const operationsRepository=operations ? createOperationsRepository(pool) : null;
  const financeRepository = finance ? createFinanceRepository({pool, enforceCommands:true, authorizeAttachment:attachmentStore && createFinanceAttachmentAuthorizer(attachmentStore)}) : null;
  const attempts = new Map();
  let dummyHash;
  const cookie = (token, age = 28800) => `ruy_local_session=${token}; HttpOnly; SameSite=Strict; Path=/api/local; Max-Age=${age}${secure ? '; Secure' : ''}`;
  return http.createServer(async (req, res) => {
    try{if(await relayD1(req,res,d1BridgeOrigin))return;}
    catch{if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Bridge unavailable.'}));return;}
    const isLogin=req.url?.split('?')[0]==='/api/local/login'&&req.method==='POST';
    const trace={event:'local_login',endpoint:'/api/local/login',mode:'local',version:'agent5-login-diag-v1',fixture:diagnosticFixture,requestId:randomBytes(8).toString('hex'),userFound:null,userActive:null,passwordValid:null};
    const reply = (status, value, headers = {}) => {
      if(loginDiagnostics&&isLogin){
        const diagnostic={requestId:trace.requestId,fixture:diagnosticFixture,version:trace.version,mode:'local',httpStatus:status,emailNonEmpty:trace.emailNonEmpty,passwordNonEmpty:trace.passwordNonEmpty,fixtureEmailMatches:trace.fixtureEmailMatches,userFound:trace.userFound,passwordValid:trace.passwordValid};
        console.info('[RUY_LOGIN_DIAGNOSTIC]',JSON.stringify({...trace,httpStatus:status,code:value.code||`HTTP_${status}`}));
        value={...value,diagnostic};
        headers={...headers,'X-Ruy-Local-Fixture':diagnosticFixture,'X-Ruy-Login-Version':trace.version,'X-Ruy-Login-Request':trace.requestId};
      }
      res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith('/api/local/')) throw fail(404,'Not found.');
      if (!['GET','POST'].includes(req.method)) throw fail(405,'Method not allowed.');
      if (req.headers.origin && req.headers.origin !== origin) throw fail(403,'Origin denied.');
      if (req.method === 'POST' && req.headers.origin !== origin) throw fail(403,'Origin required.');
      if (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) throw fail(403,'Cross-site request denied.');
      if (url.pathname === '/api/local/health' && req.method === 'GET') {
        try {
          await pool.query('SELECT 1');
          return reply(200,{status:'ok'});
        } catch {
          return reply(503,{status:'unavailable'});
        }
      }
      if(loginDiagnostics&&url.pathname==='/api/local/login-diagnostics'&&req.method==='GET'){
        const metadata=(await pool.query('SELECT current_database() AS fixture,current_setting($1) AS postgresql',['server_version'])).rows[0];
        return reply(200,{...metadata,configuredFixture:diagnosticFixture,schemaVersion:3,mode:'local',version:'agent5-login-diag-v1'});
      }
      let body = {};
      if (req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415,'JSON required.');
        const chunks = []; let size = 0;
        const maxBody = url.pathname.startsWith('/api/local/first-access/')?8192:attachmentStore && url.pathname === '/api/local/financeiro/attachments' ? 22 * 1024 * 1024 : 1024 * 1024;
        for await (const chunk of req) { size += chunk.length; if (size > maxBody) throw fail(413,'Request too large.'); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400,'Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400,'Object required.');
      }
      if(ownerAccess&&url.pathname.startsWith('/api/local/first-access/')){
        const result=await ownerAccess(url.pathname.slice('/api/local/first-access/'.length),req.method,body,req);
        const headers=result.headers||{};
        if(result.sessionToken)headers['Set-Cookie']=[headers['Set-Cookie'],cookie(result.sessionToken)];
        return reply(result.status,result.body,headers);
      }
      if (url.pathname === '/api/local/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress;
        const time = now();
        for (const [key,value] of attempts) if (value.until <= time) attempts.delete(key);
        const limit = attempts.get(ip) || { count:0,until:time + 15*60*1000 };
        if (limit.count >= 10) throw fail(429,'Too many login attempts.');
        limit.count++; attempts.set(ip,limit);
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        // Booleans only: never record inputs, password lengths or credentials.
        trace.emailNonEmpty=Boolean(email);
        trace.passwordNonEmpty=typeof body.password==='string'&&body.password.length>0;
        if(loginDiagnostics)trace.fixtureEmailMatches=email==='agent5-browser@example.invalid';
        const user = (await pool.query('SELECT * FROM local_users WHERE email=$1',[email])).rows[0];
        trace.userFound=Boolean(user);trace.userActive=Boolean(user?.active);
        dummyHash ||= hashPassword(randomBytes(24).toString('hex'));
        const valid = await verifyPassword(body.password,user?.password_hash || await dummyHash);
        trace.passwordValid=valid;
        if (!valid || !user?.active) {
          await pool.query('INSERT INTO local_audit(action,details) VALUES($1,$2)',['login_denied',JSON.stringify({ ip })]);
          throw Object.assign(fail(401,'Invalid credentials.'),{code:'INVALID_CREDENTIALS'});
        }
        const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
        await transaction(pool,async client => {
          await client.query("INSERT INTO local_sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[digest(token),user.id,csrf]);
          await client.query('INSERT INTO local_audit(actor,action) VALUES($1,$2)',[user.id,'login']);
        });
        return reply(200,{ user:{ id:user.id,email:user.email,role:user.role }, csrf },{ 'Set-Cookie':cookie(token) });
      }
      const token = (req.headers.cookie || '').match(/(?:^|;\s*)ruy_local_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      if (!token) throw fail(401,'Authentication required.');
      const session = (await pool.query('SELECT u.id,u.email,u.role,u.active,s.csrf FROM local_sessions s JOIN local_users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.active',[digest(token)])).rows[0];
      if (!session) throw fail(401,'Session expired or revoked.');
      if (req.method === 'POST' && req.headers['x-csrf-token'] !== session.csrf) throw fail(403,'CSRF token required.');
      if(url.pathname==='/api/local/administration/audit'&&req.method==='GET')return reply(200,await readAuditFeed(pool,session,{finance,offset:Number(url.searchParams.get('offset')||0),entity:url.searchParams.get('entity'),recordId:url.searchParams.get('recordId')}));
      if(req.method==='POST'&&url.pathname==='/api/local/rh/batch')return reply(200,await runRhBatch(pool,session,body));
      const rhStatus=url.pathname.match(/^\/api\/local\/rh\/batch\/status\/([a-f0-9-]{36})$/);
      if(req.method==='GET'&&rhStatus)return reply(200,await rhBatchStatus(pool,session,rhStatus[1]));
      if(operationsRepository&&url.pathname.startsWith('/api/local/operations/')) {
        if(req.method==='POST'&&url.pathname==='/api/local/operations/commands'){
          if(body.clientToken!==undefined&&body.operationId!==undefined&&body.clientToken!==body.operationId)throw fail(422,'Identificadores de operação divergentes.');
          return reply(200,await operationsRepository.execute(session,body.clientToken??body.operationId,body.command,body.params));
        }
        const entity=url.pathname.match(/^\/api\/local\/operations\/entities\/([A-Za-z]+)(?:\/([A-Za-z0-9_-]{1,120}))?$/);
        if(req.method==='GET'&&entity)return reply(200,{records:entity[2]?[await operationsRepository.get(session,entity[1],entity[2])]:await operationsRepository.list(session,entity[1],JSON.parse(url.searchParams.get('query')||'{}'),Number(url.searchParams.get('offset')||0))});
        const preview=url.pathname.match(/^\/api\/local\/operations\/preview\/([A-Za-z0-9_-]{1,120})$/);
        if(req.method==='GET'&&preview)return reply(200,await operationsRepository.preview(session,preview[1]));
        const operation=url.pathname.match(/^\/api\/local\/operations\/result\/([A-Za-z0-9_:-]{1,100})$/);
        if(req.method==='GET'&&operation)return reply(200,await operationsRepository.operation(session,operation[1]));
        throw fail(404,'Rota operacional não encontrada.');
      }
      if (financeRepository && url.pathname.startsWith('/api/local/financeiro/')) {
        return await handleFinance({req,res,url,body,session,repository:financeRepository,attachmentStore,reply});
      }
      if (url.pathname === '/api/local/me' && req.method === 'GET') return reply(200,{ user:{ id:session.id,email:session.email,role:session.role },csrf:session.csrf,mode:'local',remoteDataRecovered:false });
      if (url.pathname === '/api/local/logout' && req.method === 'POST') {
        await pool.query('DELETE FROM local_sessions WHERE token_hash=$1',[digest(token)]);
        return reply(200,{ ok:true },{ 'Set-Cookie':cookie('',0) });
      }
      if (url.pathname === '/api/local/users' && req.method === 'POST') {
        if (!isLocalAdmin(session.role)) throw fail(403,'Permission denied.');
        const hash = await hashPassword(body.password);
        const user = await transaction(pool,async client => {
          const result = await createUser(client,{ email:body.email,role:body.role,hash });
          await client.query('INSERT INTO local_audit(actor,action,details) VALUES($1,$2,$3)',[session.id,'user_created',JSON.stringify({ userId:result.id,role:result.role })]);
          return result;
        });
        return reply(201,user);
      }
      if (url.pathname === '/api/local/pending' && req.method === 'GET') {
        if (!isLocalAdmin(session.role)) throw fail(403,'Permission denied.');
        return reply(200,(await pool.query('SELECT * FROM local_pending ORDER BY created_at LIMIT 200')).rows);
      }
      const disable = url.pathname.match(/^\/api\/local\/users\/([a-f0-9-]{36})\/disable$/);
      if (disable && req.method === 'POST') {
        if (!isLocalAdmin(session.role)) throw fail(403,'Permission denied.');
        await transaction(pool,async client => {
          await client.query('SELECT pg_advisory_xact_lock(708081)');
          const target = (await client.query('SELECT role,active FROM local_users WHERE id=$1 FOR UPDATE',[disable[1]])).rows[0];
          if (!target) throw fail(404,'User unavailable.');
          if (target.active && isLocalAdmin(target.role) && Number((await client.query("SELECT count(*) FROM local_users WHERE active AND role IN ('admin','super_admin')")).rows[0].count) <= 1) throw fail(409,'Cannot disable last administrator.');
          await client.query('UPDATE local_users SET active=false WHERE id=$1',[disable[1]]);
          await client.query('DELETE FROM local_sessions WHERE user_id=$1',[disable[1]]);
          await client.query('INSERT INTO local_audit(actor,action,details) VALUES($1,$2,$3)',[session.id,'user_disabled',JSON.stringify({userId:disable[1]})]);
        });
        return reply(200,{ok:true});
      }
      const match = url.pathname.match(/^\/api\/local\/records\/([A-Za-z]+)(?:\/([a-zA-Z0-9_-]{1,120}))?$/);
      const employeeInfo=url.pathname.match(/^\/api\/local\/employees\/([a-zA-Z0-9_-]{1,120})\/(dependencies|audit)$/);
      if(employeeInfo && req.method === 'GET') {
        authorize(session,'Employee');
        if(employeeInfo[2]==='dependencies') return reply(200,await dependencies(pool,employeeInfo[1]));
        return reply(200,(await pool.query("SELECT action,actor,details,created_at FROM local_audit WHERE details->>'entity'='Employee' AND details->>'id'=$1 ORDER BY id DESC LIMIT 200",[employeeInfo[1]])).rows);
      }
      if (match) {
        const [,entity,id] = match; authorize(session,entity,req.method==='POST');
        if(entity==='AuditLog')throw fail(409,'A auditoria é registrada pelo servidor. Use a consulta de auditoria.');
        if (financeRepository && FINANCIAL_ENTITIES.includes(entity)) throw fail(409,'Use the transactional finance API.');
        if (operationsRepository && OPERATION_ENTITIES.has(entity)) throw fail(409,'Use the transactional operations API.');
        if (req.method === 'POST') {
          if (!id) throw fail(400,'Record ID required.');
          return reply(200,await mutate(pool,session,entity,id,body));
        }
        const result = id
          ? await pool.query('SELECT * FROM local_records WHERE entity=$1 AND id=$2 AND NOT deleted',[entity,id])
          : await pool.query('SELECT * FROM local_records WHERE entity=$1 AND NOT deleted ORDER BY id LIMIT 200 OFFSET $2',[entity,Math.max(0,Math.min(1000000,Number(url.searchParams.get('offset'))||0))]);
        return reply(200,{ records:result.rows,source:'local-server',remoteDataRecovered:false });
      }
      throw fail(404,'Not found.');
    } catch (error) {
      const status = error.status || (error.code === '23505' || error.code==='saldo_insuficiente' ? 409 : error.code==='23503'||error.code==='23514'||error.name==='StockError'||error instanceof SyntaxError ? 422 : 500);
      const code=error.code==='INVALID_CREDENTIALS'?'INVALID_CREDENTIALS':status===401?'SESSION_REQUIRED':status===403&&/CSRF/.test(error.message)?'CSRF_REQUIRED':status===403&&/Origin|Cross-site/.test(error.message)?'ORIGIN_DENIED':`HTTP_${status}`;
      reply(status,{ error:status===500 ? 'Local service error.' : error.message,code,...(error.code==='DEPENDENCIES_FOUND' ? {code:error.code,dependencies:error.dependencies,total:error.total,resumo:error.resumo} : {}) });
    }
  });
}
