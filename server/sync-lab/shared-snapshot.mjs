import {projectEmployee} from '../d1-lab/catalog-contract.mjs';
import {businessSnapshot} from './business.mjs';
// A consistent, authorized bootstrap; no local ownership substitution.
export async function sharedSnapshot(pool,deviceToken,sessionToken,auth,{history=null}={}){
 const c=await pool.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const p=await auth.authorize(deviceToken,sessionToken,c);
  const head=Number((await c.query('SELECT cursor FROM d1_central_clock WHERE singleton')).rows[0].cursor);
  let records=(await c.query('SELECT id,entity,data,version FROM d1_central_records WHERE workspace_id=$1 ORDER BY entity,id',[p.workspace_id])).rows.map(r=>({...r,version:Number(r.version)}));
  if(history){const old=await history.list(p);const working=new Set(records.map(r=>r.id));records=[...old.filter(r=>!working.has(r.id)),...records];}
  if(p.role!=='admin')records=records.filter(r=>['Employee','Sector','JobRole'].includes(r.entity)).map(r=>({...r,data:r.entity==='Employee'?projectEmployee(r.data,p.role):r.data}));
  const business=p.role==='admin'?await businessSnapshot(c,p.workspace_id,head):undefined;
  await c.query('COMMIT');return {head,records,...(business?{business}:{}),complete:true};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
