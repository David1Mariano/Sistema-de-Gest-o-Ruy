import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {transaction,createUser,hashPassword,digest,fail} from './core.mjs';
const secret=()=>randomBytes(32).toString('hex');
const equal=(value,hash)=>typeof value==='string'&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&timingSafeEqual(Buffer.from(digest(value),'hex'),Buffer.from(hash,'hex'));
const invalid=()=>fail(403,'Código inválido, expirado ou já utilizado.');
export function createFirstAccess(pool,{mailer=null}={}){
  async function ready(){return Boolean((await pool.query("SELECT to_regclass('public.local_owner_approval') AS table")).rows[0].table);}
  async function rate(ip){
    // Durable bucket survives restart. Serialize independent of C1 sessions.
    const accepted=await transaction(pool,async client=>{
      const result=await client.query(`INSERT INTO local_owner_rate(bucket,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes')
        ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN local_owner_rate.expires_at<=now() THEN 1 ELSE local_owner_rate.attempts+1 END,
        expires_at=CASE WHEN local_owner_rate.expires_at<=now() THEN now()+interval '15 minutes' ELSE local_owner_rate.expires_at END RETURNING attempts`,[digest(ip)]);
      return result.rows[0].attempts<=20;
    });
    if(!accepted)throw fail(429,'Limite de tentativas. Aguarde 15 minutos.');
  }
  const grantCookie=(token,maxAge=600)=>`ruy_owner_grant=${token}; HttpOnly; SameSite=Strict; Path=/api/local/first-access; Max-Age=${maxAge}`;
  return async function handle(path,method,body,req){
    if(path==='status'&&method==='GET')return{status:200,body:{schemaReady:await ready(),mailConfigured:Boolean(mailer),historicalIdentityVerified:false}};
    if(method!=='POST'||!['request','verify','complete'].includes(path))throw fail(404,'Not found.');
    if(!await ready())throw fail(503,'Primeiro acesso ainda não preparado. Execute a aprovação local pelo responsável da instalação.');
    await rate(req.socket.remoteAddress||'unknown');
    if(path==='request'){
      if(!mailer)throw fail(503,'Envio de e-mail não configurado e autorizado. Nenhuma mensagem foi enviada.');
      const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw fail(400,'Informe um e-mail válido.');
      const id=randomUUID(),code=secret();
      const approved=await transaction(pool,async client=>{
        const approval=(await client.query('SELECT * FROM local_owner_approval WHERE email=$1 AND expires_at>now() AND consumed_by IS NULL FOR UPDATE',[email])).rows[0];
        if(!approval)return false;
        if((await client.query('SELECT 1 FROM local_users WHERE email=$1',[email])).rowCount)return false;
        const count=(await client.query("SELECT count(*) FROM local_owner_challenge WHERE approval_id=$1 AND created_at>now()-interval '15 minutes'",[approval.id])).rows[0].count;
        if(Number(count)>=3)throw fail(429,'Limite de solicitações. Aguarde 15 minutos.');
        await client.query("INSERT INTO local_owner_challenge(id,approval_id,code_digest,state,expires_at) VALUES($1,$2,$3,'sending',now()+interval '15 minutes')",[id,approval.id,digest(code)]);
        return true;
      });
      if(approved){
        try{await mailer({email,code,id});}
        catch{await pool.query("UPDATE local_owner_challenge SET state='failed' WHERE id=$1",[id]);throw fail(503,'Envio não confirmado. Não tente ativar com uma mensagem de tentativa anterior.');}
        await pool.query("UPDATE local_owner_challenge SET state='sent' WHERE id=$1",[id]);
      }
      return{status:202,body:{requestId:id,message:'Se houver aprovação local válida, o provedor foi solicitado a enviar a verificação. Confira sua caixa de e-mail.'}};
    }
    if(path==='verify'){
      if(!/^[a-f0-9-]{36}$/.test(body.requestId||''))throw invalid();
      const token=secret(),csrf=secret();
      const ok=await transaction(pool,async client=>{
        const row=(await client.query('SELECT * FROM local_owner_challenge WHERE id=$1 FOR UPDATE',[body.requestId])).rows[0];
        if(!row||row.state!=='sent'||row.attempts>=5||new Date(row.expires_at)<=new Date())return false;
        await client.query('UPDATE local_owner_challenge SET attempts=attempts+1 WHERE id=$1',[row.id]);
        if(!equal(body.code,row.code_digest))return false;
        const valid=(await client.query('SELECT 1 FROM local_owner_approval WHERE id=$1 AND expires_at>now() AND consumed_by IS NULL',[row.approval_id])).rowCount;
        if(!valid)return false;
        await client.query("UPDATE local_owner_challenge SET state='verified',verified_at=now(),grant_digest=$2,csrf_digest=$3,grant_expires_at=now()+interval '10 minutes' WHERE id=$1",[row.id,digest(token),digest(csrf)]);
        return true;
      });
      if(!ok)throw invalid();
      return{status:200,body:{verified:true,csrf},headers:{'Set-Cookie':grantCookie(token)}};
    }
    const token=(req.headers.cookie||'').match(/(?:^|;\s*)ruy_owner_grant=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(!token)throw invalid();
    // Reject invalid capabilities before the expensive password derivation.
    const eligible=(await pool.query("SELECT csrf_digest FROM local_owner_challenge WHERE grant_digest=$1 AND state='verified' AND grant_expires_at>now()",[digest(token)])).rows[0];
    if(!eligible||!equal(req.headers['x-csrf-token'],eligible.csrf_digest))throw fail(403,'Autorização de ativação ou CSRF inválido.');
    const hash=await hashPassword(body.password),sessionToken=secret(),csrf=secret();
    const user=await transaction(pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(708081)');
      const challenge=(await client.query("SELECT * FROM local_owner_challenge WHERE grant_digest=$1 AND state='verified' AND grant_expires_at>now() FOR UPDATE",[digest(token)])).rows[0];
      if(!challenge||!equal(req.headers['x-csrf-token'],challenge.csrf_digest))throw invalid();
      const approval=(await client.query('SELECT * FROM local_owner_approval WHERE id=$1 AND expires_at>now() AND consumed_by IS NULL FOR UPDATE',[challenge.approval_id])).rows[0];
      if(!approval||!['viewer','gerente','admin'].includes(approval.role)||approval.verified_method!=='elevated_windows_installation_admin'||!approval.owner_approval)throw invalid();
      if((await client.query('SELECT 1 FROM local_users WHERE email=$1',[approval.email])).rowCount)throw fail(409,'Conta já existe. Nenhuma senha foi modificada.');
      const profile=await createUser(client,{email:approval.email,hash,role:approval.role});
      await client.query('UPDATE local_owner_approval SET consumed_by=$2,consumed_at=now() WHERE id=$1',[approval.id,profile.id]);
      await client.query("UPDATE local_owner_challenge SET state='consumed',consumed_at=now() WHERE id=$1",[challenge.id]);
      await client.query("INSERT INTO local_sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[digest(sessionToken),profile.id,csrf]);
      let historicalReference=null;try{historicalReference=JSON.parse(approval.owner_approval).historicalReference||null;}catch{/* Legacy email approval has no historical binding. */}
      await client.query('INSERT INTO local_audit(actor,action,details) VALUES($1,$2,$3)',[profile.id,'owner_first_access',JSON.stringify({approvalId:approval.id,approvedBySid:approval.approved_by_sid,role:profile.role,historicalIdentityVerified:false,remoteIdentity:null,historicalReference})]);
      return profile;
    });
    return{status:200,body:{user,csrf,historicalIdentityVerified:false},sessionToken,headers:{'Set-Cookie':grantCookie('',0)}};
  };
}
