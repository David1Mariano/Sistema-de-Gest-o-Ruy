import {reconciliationPlan,reconcile} from './reconciliation.mjs';
import {deliveryEnabled,assertDeliveryDatabase} from './delivery.mjs';
import {attachmentsEnabled} from './capabilities.mjs';
import {enqueueAttachment,transferAttachment,fetchAttachment,listLocalAttachments,localAttachment,authorizeAttachmentRecord} from './attachment-transfer.mjs';
import {provisionedRequest} from './tls-provision.mjs';
import http from 'node:http';
import {employeeDeleteCheck} from './employee-delete.mjs';
import {randomBytes} from 'node:crypto';
import {digest,fail,hashPassword,verifyPassword,transaction} from './core.mjs';
import {API_PORT,installation} from './environment.mjs';
import {entitiesRoute,staticRoute} from './routes.mjs';
import {backupStatus} from './backup.mjs';
import {catalogRoute} from './catalog.mjs';
import {syncReady,syncStatus,synchronizeD1} from './sync.mjs';
import {operationalCommand,operationalState,createStockItem} from './operations.mjs';
import {domainRoute,domainList} from './domain.mjs';
import {deliveryCSV} from './delivery-report.mjs';
export const origin=`http://127.0.0.1:${API_PORT}`;
export function createServer(pool,deviceId,{history=null,historyOnly=false,identity=null,port=API_PORT}={}) {
  if(port!==API_PORT&&!(process.env.RUY_HISTORY_ACCEPTANCE==='1'&&installation?.id==='history-view-dev-20261020'&&port===18124))throw Error('API_PORT_OVERRIDE_REFUSED');
  const origin=`http://127.0.0.1:${port}`;
  let dummy;
  const cookie=(token,age=28800)=>`ruy_d1_lab=${token}; HttpOnly; SameSite=Strict; Path=/api/d1; Max-Age=${age}`;
  const server=http.createServer(async(req,res)=>{
    if(installation&&req.url==='/health'&&/^[a-f0-9]{64}$/.test(process.env.RUY_D1_OWNER_NONCE||''))res.setHeader('X-Ruy-Owner',process.env.RUY_D1_OWNER_NONCE);
    const reply=(status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body));};
    try{
      if(req.headers.host!==`127.0.0.1:${port}`)throw fail(403,'Host recusado.');
      if(req.headers.origin&&req.headers.origin!==origin)throw fail(403,'Origem recusada.');
      if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw fail(403,'Cross-site recusado.');
      if(!['GET','POST'].includes(req.method))throw fail(405,'Método recusado.');
      const url=new URL(req.url,origin);
      if(await staticRoute(req,res,url))return;
      if(url.pathname==='/health'&&req.method==='GET'){
        await pool.query('SELECT 1');return reply(200,{service:'ruy-d1-lab',mode:'synthetic-only',syncEnabled:false,...(historyOnly?{historyReadOnly:true}:{}),...(installation?{installationId:installation.id,pid:process.pid}:{})});
      }
      let body={};
      if(req.method==='POST'){
        if(req.headers.origin!==origin)throw fail(403,'Origem obrigatória.');
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'JSON obrigatório.');
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>(url.pathname.startsWith('/api/d1/attachments')&&attachmentsEnabled()?1024*1024:16384))throw fail(413,'Limite de conteúdo.');chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'JSON inválido.');}
        if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'Objeto JSON obrigatório.');
      }
      if(url.pathname==='/api/d1/account/config'&&req.method==='GET')return reply(200,{enabled:Boolean(identity)});
      if(identity&&req.method==='POST'&&['register','resend','verify','reset-request','reset','bootstrap'].some(action=>url.pathname==='/api/d1/account/'+action)){
        if(url.pathname.endsWith('/bootstrap')){await identity.throttle('bootstrap|'+req.socket.remoteAddress);return reply(200,await identity.bootstrap(body));}
        return reply(200,await identity.route(url,body,req.socket.remoteAddress));
      }
      if(url.pathname==='/api/d1/login'&&req.method==='POST'){
        const login=typeof body.login==='string'?body.login.trim().toLowerCase():'';
        if(login.length>254)throw fail(400,'Identificador inválido.');
        if(identity)await identity.throttle('login-ip|'+req.socket.remoteAddress,30);
        const attemptKey=digest(req.socket.remoteAddress+'|'+login);
        const limit=(await pool.query(`INSERT INTO lab_attempts(address,attempts,expires_at) VALUES($1,1,now()+$2::interval)
          ON CONFLICT(address) DO UPDATE SET attempts=CASE WHEN lab_attempts.expires_at<now() THEN 1 ELSE lab_attempts.attempts+1 END,
          expires_at=CASE WHEN lab_attempts.expires_at<now() THEN now()+$2::interval ELSE lab_attempts.expires_at END RETURNING attempts`,[attemptKey,identity?'30 minutes':'15 minutes'])).rows[0];
        if(limit.attempts>(identity?5:10))throw fail(429,'Aguarde antes de tentar novamente.');
        const user=(await pool.query('SELECT * FROM lab_users WHERE login=$1',[login])).rows[0];
        let passwordHash=user?.password_hash;
        if(!passwordHash){dummy ||= (identity?identity.hashPassword:hashPassword)(randomBytes(24).toString('hex')).catch(error=>{dummy=null;throw error;});passwordHash=await dummy;}
        const valid=await (identity?identity.verifyPassword:verifyPassword)(body.password,passwordHash);
        if(!valid||!user?.active||(identity&&!await identity.allowed(user.id))){await pool.query("INSERT INTO lab_audit(action) VALUES('login_denied')");throw fail(401,'Credenciais inválidas.');}
        const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
        await transaction(pool,async c=>{
          const active=(await c.query('SELECT id FROM lab_users WHERE id=$1 AND active FOR SHARE',[user.id])).rowCount;
          if(!active)throw fail(401,'Conta revogada.');
          await c.query("INSERT INTO lab_sessions VALUES($1,$2,$3,now()+interval '8 hours')",[digest(token),user.id,csrf]);
          await c.query("INSERT INTO lab_audit(actor,action) VALUES($1,'login')",[user.id]);
          await c.query('DELETE FROM lab_attempts WHERE address=$1',[attemptKey]);
        });
        return reply(200,{user:identity?await identity.publicUser(user.id):{id:user.id,role:user.role},csrf,deviceId,...(historyOnly?{historyOnly:true}:{})},{'Set-Cookie':cookie(token)});
      }
      const token=(req.headers.cookie||'').match(/(?:^|;\s*)ruy_d1_lab=([a-f0-9]{64})(?:;|$)/)?.[1];
      if(!token)throw fail(401,'Sessão obrigatória.');
      const user=(await pool.query('SELECT u.id,u.role,s.csrf FROM lab_sessions s JOIN lab_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active',[digest(token)])).rows[0];
      if(!user)throw fail(401,'Sessão expirada/revogada.');
      if(identity&&!await identity.allowed(user.id))throw fail(401,'Conta pendente ou revogada.');
      if(req.method==='POST'&&req.headers['x-csrf-token']!==user.csrf)throw fail(403,'CSRF obrigatório.');
      if(url.pathname.startsWith('/api/d1/account/')){
        if(!identity)throw fail(503,'Contas individuais não habilitadas neste perfil.');
        if(req.method!=='POST'&&url.pathname!=='/api/d1/account/users')throw fail(405,'Método recusado.');
        return reply(200,await identity.route(url,body,req.socket.remoteAddress,user));
      }
      if(url.pathname==='/api/d1/history'||url.pathname.startsWith('/api/d1/history/')){
        if(!history)throw fail(503,'Perfil histórico não habilitado.');
        await history.route(req,res,url,user,reply);return;
      }
      if(historyOnly&&!['/api/d1/me','/api/d1/logout'].includes(url.pathname))throw fail(403,'Perfil histórico não permite operações locais.');
      if(url.pathname.startsWith('/api/d1/attachments')&&attachmentsEnabled()){
        if(url.pathname==='/api/d1/attachments'&&req.method==='GET')return reply(200,await listLocalAttachments(pool,user.id));
        if(url.pathname==='/api/d1/attachments/remote'&&req.method==='GET'){
          const id=url.searchParams.get('record');await authorizeAttachmentRecord(pool,user.id,id);
          const binding=(await pool.query('SELECT * FROM d1_sync_binding WHERE actor=$1',[user.id])).rows[0];if(!binding)throw fail(403,'Dispositivo nao provisionado.');
          const transport=await provisionedRequest(binding);return reply(200,await transport.request(transport.token,'/attachments?record='+id));
        }
        if(url.pathname==='/api/d1/attachments'&&req.method==='POST')return reply(200,await enqueueAttachment(pool,user.id,body));
        const download=url.pathname.match(/^\/api\/d1\/attachments\/([a-f0-9-]{36})\/download$/);
        if(download&&req.method==='GET'&&!url.search){
          const file=await localAttachment(pool,user.id,download[1]);
          if(!/^FICTICIO-[a-zA-Z0-9_-]+\.(pdf|png|jpg|webp|txt)$/.test(file.filename))throw fail(503,'Nome de arquivo invalido.');
          const bytes=Buffer.from(file.bytes,'base64');
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':bytes.length,'Content-Disposition':'attachment; filename="'+file.filename+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(bytes);return;
        }
        const match=url.pathname.match(/^\/api\/d1\/attachments\/([a-f0-9-]{36})(?:\/(send|fetch))?$/);
        if(match&&!match[2]&&req.method==='GET')return reply(200,await localAttachment(pool,user.id,match[1]));
        if(match&&match[2]&&req.method==='POST'){
          const binding=(await pool.query('SELECT * FROM d1_sync_binding WHERE actor=$1',[user.id])).rows[0];
          if(!binding)throw fail(403,'Dispositivo nao provisionado.');
          const transport=await provisionedRequest(binding);
          return reply(200,await (match[2]==='send'?transferAttachment:fetchAttachment)(pool,user.id,match[1],transport));
        }
        throw fail(404,'Rota de anexo inexistente.');
      }
      if(url.pathname==='/api/d1/delivery/report.csv'&&req.method==='GET'&&!url.search){
        const csv=deliveryCSV(await domainList(pool,user,'DeliveryOrder'));
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="FICTICIO-delivery.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(csv);return;
      }
      if(url.pathname==='/api/d1/delivery/status'&&req.method==='GET'){
        if(user.role!=='admin')throw fail(403,'Delivery exige administrador de laboratório.');
        let ready=false;if(deliveryEnabled()){await assertDeliveryDatabase(pool);ready=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='d2_catalog'::regclass AND conname='d2_catalog_entity_check' AND pg_get_constraintdef(oid) LIKE '%DeliveryOrder%') AS ready")).rows[0].ready;}
        return reply(200,{enabled:!!ready,labOnly:true,operationalSyncEnabled:false,externalProvidersEnabled:false,paymentIntegration:false});
      }
      if(url.pathname==='/api/d1/me'&&req.method==='GET')return reply(200,{user:identity?await identity.publicUser(user.id):{id:user.id,role:user.role},csrf:user.csrf,deviceId,...(historyOnly?{historyOnly:true}:{})});
      if(url.pathname==='/api/d1/logout'&&req.method==='POST'){
        await pool.query('DELETE FROM lab_sessions WHERE token_hash=$1',[digest(token)]);return reply(200,{ok:true},{'Set-Cookie':cookie('',0)});
      }
      if(url.pathname==='/api/d1/pending'&&req.method==='GET'){
        const ready=await syncReady(pool);
        const result=ready?await pool.query("SELECT o.operation_id,o.device_id,o.actor,o.entity,o.record_id,o.operation,o.base_version,o.record_version,coalesce(q.state,'pending') AS state,o.protocol_version,o.created_at,q.confirmed_at,count(*) OVER()::int AS total FROM lab_outbox o LEFT JOIN d1_sync_queue q USING(operation_id) WHERE o.actor=$1 AND coalesce(q.state,'pending') NOT IN ('acknowledged','resolved') ORDER BY o.created_at,o.operation_id LIMIT 200",[user.id]):await pool.query('SELECT operation_id,device_id,actor,entity,record_id,operation,base_version,record_version,state,protocol_version,created_at,confirmed_at,count(*) OVER()::int as total FROM lab_outbox WHERE actor=$1 ORDER BY created_at,operation_id LIMIT 200',[user.id]);
        return reply(200,{pending:result.rows,total:result.rows[0]?.total??0,syncEnabled:false});
      }
      if(url.pathname==='/api/d1/sync-status'&&req.method==='GET'){
        return reply(200,{...await syncStatus(pool,user.id),backup:user.role==='admin'?await backupStatus():null});
      }
      if(url.pathname==='/api/d1/reconciliation/plan'&&req.method==='GET')return reply(200,await reconciliationPlan(pool,user));
      if(url.pathname==='/api/d1/reconciliation/apply'&&req.method==='POST')return reply(200,await reconcile(pool,user,body));
      if(url.pathname==='/api/d1/sync-now'&&req.method==='POST'){
        if(Object.keys(body).length)throw fail(400,'O usuário/dispositivo não pode ser escolhido pelo formulário.');
        return reply(200,{...await synchronizeD1(pool,user.id),backup:user.role==='admin'?await backupStatus():null});
      }
      const domain=await domainRoute(pool,user,deviceId,req,url,body);
      const employeeCheck=url.pathname.match(/^\/api\/d1\/employees\/([0-9a-f-]+)\/dependencies$/);
      if(employeeCheck&&req.method==='GET')return reply(200,await employeeDeleteCheck(pool,user,employeeCheck[1]));
      if(domain)return reply(200,domain);
      const catalog=await catalogRoute(pool,user,deviceId,req,url,body);
      if(url.pathname==='/api/d1/operations/state'&&req.method==='GET')return reply(200,await operationalState(pool,user));
      if(url.pathname==='/api/d1/operations/command'&&req.method==='POST')return reply(200,await operationalCommand(pool,user,deviceId,body));
      if(url.pathname==='/api/d1/operations/create-item'&&req.method==='POST')return reply(200,await createStockItem(pool,user,deviceId,body));
      if(catalog)return reply(200,catalog);
      const handled=await entitiesRoute(pool,user,deviceId,req,url,body);
      if(handled)return reply(200,handled);
      throw fail(404,'Rota não implementada no laboratório.');
    }catch(e){reply(e.status||(e.code==='23505'?409:500),{error:e.status?e.message:'Falha local; consultar estado do laboratório.'});}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  return server;
}
