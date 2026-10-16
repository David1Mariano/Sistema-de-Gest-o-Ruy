import {fail} from './core.mjs';
import {isLocalAdmin} from '../../src/lib/localPermissions.mjs';

export async function readAuditFeed(pool,user,{finance=false,offset=0,entity=null,recordId=null}={}) {
  if(!isLocalAdmin(user?.role))throw fail(403,'Permissão de administrador necessária.');
  if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw fail(400,'Página inválida.');
  const financial=finance?`UNION ALL SELECT 'finance:'||a.sequence::text AS id,
    CASE WHEN a.before_data IS NULL THEN 'criacao' ELSE 'alteracao' END AS action,
    a.entity AS entity_type,a.record_id AS entity_id,a.before_data AS before_data,a.after_data,
    a.recorded_at AS created_at,u.email AS responsible_user
    FROM ruy_finance.audit a LEFT JOIN local_users u ON u.id::text=a.actor_id`:'';
  const result=await pool.query(`WITH events AS (
    SELECT 'core:'||a.id::text AS id,
    CASE a.action WHEN 'create' THEN 'criacao' WHEN 'update' THEN 'alteracao' WHEN 'delete' THEN 'exclusao_logica' ELSE a.action END AS action,
    COALESCE(a.details->>'entity','Sistema') AS entity_type,COALESCE(a.details->>'id',a.details->>'recordId','') AS entity_id,
    a.details->'before' AS before_data,a.details->'after' AS after_data,a.created_at,u.email AS responsible_user
    FROM local_audit a LEFT JOIN local_users u ON u.id=a.actor ${financial})
    SELECT * FROM events WHERE ($1::text IS NULL OR entity_type=$1) AND ($2::text IS NULL OR entity_id=$2)
    ORDER BY created_at DESC,id DESC LIMIT 200 OFFSET $3`,[entity,recordId,offset]);
  return {records:result.rows.map(row=>({id:row.id,action:row.action,entity_type:row.entity_type,entity_id:row.entity_id,
    created_date:new Date(row.created_at).toISOString(),responsible_user:row.responsible_user||'Sistema',
    old_value:row.before_data?JSON.stringify(row.before_data):'',new_value:row.after_data?JSON.stringify(row.after_data):''}))};
}
