import {transaction,fail,uuid} from '../d1-lab/core.mjs';
export async function sharedAccounts(pool,identity,auth,deviceToken,sessionToken,body){
 const allowed=['/account/users','/account/authorize','/account/reject','/account/change-password'];
 if(!allowed.includes(body?.route))throw fail(404,'Rota de identidade desconhecida.');
 return transaction(pool,async c=>{
  let p=await auth.authorize(deviceToken,sessionToken,c);if(p.role!=='admin')throw fail(403,'Administração central restrita.');
  // Same ordering as every central write, including membership/session updates.
  await c.query('SELECT cursor FROM d1_central_clock WHERE singleton FOR UPDATE');
  p=await auth.authorize(deviceToken,sessionToken,c,true);
  if(body.route==='/account/users')return {users:(await c.query('SELECT u.id,u.login,m.role,u.active,a.full_name,a.verified_at,a.approved_at,a.revoked_at FROM shared_memberships m JOIN lab_users u ON u.id=m.user_id JOIN identity_accounts a ON a.user_id=u.id WHERE m.workspace_id=$1 ORDER BY a.created_at',[p.workspace_id])).rows};
  const input=body.input||{};
  if(body.route!=='/account/change-password'){
   if(!uuid(input.userId))throw fail(400,'Identificador de conta obrigat?rio.');
   if(input.userId===p.actor_id||!(await c.query('SELECT 1 FROM shared_memberships WHERE workspace_id=$1 AND user_id=$2 FOR UPDATE',[p.workspace_id,input.userId])).rowCount)throw fail(403,'Usuário fora do espaço autorizado ou alteração da própria concessão.');
   if(body.route==='/account/authorize'&&(!['admin','writer','viewer'].includes(input.role)||typeof input.active!=='boolean'))throw fail(400,'Permissão inválida.');
  }
  // Identity's existing transaction is nested in this transaction via savepoint.
  let n=0;const scopedPool={query:(...a)=>c.query(...a),async connect(){const s='shared_identity_'+(++n);return {async query(sql,args){if(sql==='BEGIN')return c.query('SAVEPOINT '+s);if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT '+s);if(sql==='ROLLBACK')return c.query('ROLLBACK TO SAVEPOINT '+s);return c.query(sql,args);},release(){}};}};
  const scoped=identity.withPool(scopedPool);
  const result=await scoped.route(new URL('http://127.0.0.1/api/d1'+body.route),input,'shared-'+p.device_id,{id:p.actor_id,role:p.role});
  const target=body.route==='/account/change-password'?p.actor_id:input.userId;
  if(body.route==='/account/authorize')await c.query('UPDATE shared_memberships SET role=$3,active=$4 WHERE workspace_id=$1 AND user_id=$2',[p.workspace_id,target,input.role,input.active]);
  if(body.route==='/account/reject')await c.query('UPDATE shared_memberships SET active=false WHERE workspace_id=$1 AND user_id=$2',[p.workspace_id,target]);
  await c.query('UPDATE d1_principals SET active=false WHERE actor_id=$1',[target]);await c.query('DELETE FROM shared_sessions WHERE token_hash IN (SELECT token_hash FROM d1_principals WHERE actor_id=$1)',[target]);
  await c.query('UPDATE d1_central_clock SET cursor=cursor+1 WHERE singleton');return result;
 });
}
