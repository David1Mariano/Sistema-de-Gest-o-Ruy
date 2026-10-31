import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openDpapi,json} from '../../scripts/homologacao/common.mjs';
import {createIdentity} from '../d1-lab/identity.mjs';
import {userSessions} from '../sync-lab/user-sessions.mjs';
import {createSharedApi} from '../sync-lab/shared-server.mjs';
import {createCentralHistory} from './history.mjs';
import {createConsultationHistory} from './consultation-history.mjs';
import {backupCentral} from './backup.mjs';
import {fail} from '../d1-lab/core.mjs';

// Production uses the existing shared command engine and identity format.
// The archive stays in its immutable database, with selective operational holds.
export async function startOperationalExtension({root,p,historyPool,identityPepper,override=null}){
 const config=override||await json(path.join(root,'operational.json'));
 if(config.contract!=='RUY-OPERATIONAL-RELEASE/1'||!config.enabled||!config.authorized||config.database.host!=='127.0.0.1'||config.database.port!==55483||!/^ruy_central_prod_[a-f0-9]{16}$/.test(config.database.database)||!/^ruy_central_[a-f0-9]{16}$/.test(config.database.user)||config.workspaceId!==p.workspaceId)throw Error('EXPLICIT_PRODUCTION_RELEASE_REQUIRED');
 const secret=await openDpapi(path.join(root,'operational.dpapi'));
 const pool=new pg.Pool({...config.database,password:secret.databasePassword,max:8,connectionTimeoutMillis:3000,statement_timeout:10000,application_name:'ruy_operational_central'});
 let timer,backupFlight,lastBackup=0,backupHealthy=false,api;
 try{
  const loaded={root,profile:{mode:'controlled',database:config.database,history:{...config.history,database:config.history.database},pgBin:config.pgBin},secrets:{databasePassword:secret.databasePassword,historyPassword:secret.historyPassword,backupKey:secret.backupKey}};
  const history=await createCentralHistory({pool:historyPool,central:pool,profile:{database:config.database,history:config.history}});
  const grants=new Map(p.grants.map(g=>[g.userId,g]));
  const authorize=principal=>{const g=grants.get(principal.actor_id);if(!g||principal.workspace_id!==config.workspaceId||g.role!==principal.role)throw fail(403,'Conta sem permissão para esta central operacional.');return g;};
  const historical=createConsultationHistory({pool:historyPool,allowed:principal=>{const g=authorize(principal);return g.entities.filter(e=>(principal.role==='admin'||['Employee','Sector','JobRole'].includes(e))&&(e!=='AuditLog'||g.audit));},grant:authorize});
  let anchor;const anchorFile=path.join(root,'history-backup-anchor-'+config.database.database+'.json');try{anchor=await json(anchorFile);}catch(error){if(error.code!=='ENOENT')throw error;}
  const backup=()=>{if(backupFlight)return backupFlight;backupFlight=backupCentral(root,{pool,historical:historyPool,loaded,includeHistory:!anchor,historyReference:anchor}).then(async result=>{if(!anchor){anchor={file:path.basename(result.file),sha256:result.sha256,datasetSha256:config.history.datasetSha256};await fs.writeFile(anchorFile,JSON.stringify(anchor),{flag:'wx'});}lastBackup=Date.now();backupHealthy=true;await fs.writeFile(path.join(root,override?'backup-status-isolated-'+config.database.database+'.json':'backup-status.json'),JSON.stringify({at:new Date().toISOString(),database:config.database.database,healthy:true,intervalMinutes:15,lastBackup:result},null,2));return result;}).catch(error=>{backupHealthy=false;throw error;}).finally(()=>{backupFlight=null;});return backupFlight;};
  await backup();timer=setInterval(()=>void backup().catch(()=>{}),15*60*1000);
  const health=async()=>{const row=(await pool.query('SELECT active,maintenance FROM central_deployment WHERE singleton')).rows[0];return row?.active&&!row?.maintenance&&backupHealthy&&Date.now()-lastBackup<30*60*1000;};
  if(!await health())throw Error('PRODUCTION_DISABLED_OR_BACKUP_NOT_HEALTHY');
  const identity=createIdentity({pool,pepper:Buffer.from(identityPepper,'hex'),sender:async()=>{throw fail(503,'Envio de e-mail ainda não provisionado.');}}),authentication=userSessions(pool,identity);
  const supportedRelease=release=>['0.10.0-rc.5','0.10.0-rc.6','0.10.0-rc.7','0.10.0-rc.8','0.10.0-rc.9','0.10.0-rc.10','0.10.0-rc.11','0.10.0-rc.12'].includes(release);
  const policy={authorize,connection:{operationalEnabled:true,minimumClientRelease:'0.10.0-rc.5'},
   rejected:failure=>fs.appendFile(path.join(root,override?'request-failures-isolated.jsonl':'request-failures.jsonl'),JSON.stringify({at:new Date().toISOString(),...failure})+'\n'),
   async beforeWrite(principal,route,body,release){const access=authorize(principal);if(route.endsWith('/domain-query')&&body?.route?.startsWith('/domain/financial-audit')&&access.audit!==true)throw fail(403,'Auditoria financeira não autorizada para esta conta.');if(!route.endsWith('/domain-query')&&!(route.endsWith('/account')&&body?.route==='/account/users')&&!supportedRelease(release))throw fail(422,'Atualize o Sistema Ruy para 0.10.0-rc.5 antes de cadastrar ou alterar registros.');if(route.endsWith('/push'))throw fail(403,'Reenvio de snapshots offline bloqueado. Use os comandos transacionais online.');if(route.endsWith('/operation')&&body?.kind==='journal'&&!(await pool.query('SELECT financial_opening_approved FROM central_operation_policy WHERE workspace_id=$1',[principal.workspace_id])).rows[0]?.financial_opening_approved)throw fail(422,'Lançamentos manuais de abertura exigem saldos conferidos. Registre novas receitas pelo documento de recebimento.');if(route.includes('/attachments/')&&typeof body?.sha256==='string'&&(await historyPool.query("SELECT 1 FROM history.attachments WHERE state<>'linked' AND sha256=$1 LIMIT 1",[body.sha256])).rowCount)throw fail(422,'Arquivo em quarentena: associação depende de conferência e autorização.');},
   async query(principal,route){return historical.route(principal,route);},
   async snapshot(principal,snapshot,release){authorize(principal);const openingApproved=(await pool.query('SELECT financial_opening_approved FROM central_operation_policy WHERE workspace_id=$1',[principal.workspace_id])).rows[0]?.financial_opening_approved===true;const holds=(await pool.query('SELECT record_id,reason FROM central_operation_holds WHERE workspace_id=$1',[principal.workspace_id])).rows;
    for(const row of snapshot.records){const held=holds.filter(h=>h.record_id===row.id);if(held.length){row.data={...row.data,_reviewPending:held.map(h=>h.reason),_stockOpeningApproved:false};if(row.entity==='InventoryItem')row.data.name='[PENDENTE DE CLASSIFICAÇÃO] '+row.data.name;}if(!openingApproved&&row.entity==='FinancialAccount'&&row.data.payload_json){const account=JSON.parse(row.data.payload_json);row.data.payload_json=JSON.stringify({...account,initial_balance:null,current_balance:null,opening_balance_unknown:true});}}
    if(principal.role==='admin'&&authorize(principal).attachments){const bindings=(await pool.query("SELECT DISTINCT ON(b.record_id,b.field) b.record_id,b.field,b.object_id,o.filename,o.media_type,b.created_at,octet_length(o.bytes) AS size FROM d1_attachment_bindings b LEFT JOIN d1_attachment_objects o ON o.workspace_id=b.workspace_id AND o.id=b.live_object_id WHERE b.workspace_id=$1 ORDER BY b.record_id,b.field,b.created_at DESC,b.operation_id DESC",[principal.workspace_id])).rows;for(const row of snapshot.records){const fields=bindings.filter(b=>b.record_id===row.id);if(!fields.length)continue;const data=row.data.payload_json?JSON.parse(row.data.payload_json):{...row.data};for(const f of fields){data[f.field]='/api/d1/attachments/'+f.object_id+'/download';data._attachmentFields={...data._attachmentFields,[f.field]:{id:f.object_id,filename:f.filename,mediaType:f.media_type,size:f.size,uploadedAt:f.created_at}};}row.data=row.data.payload_json?{...row.data,payload_json:JSON.stringify(data)}:data;}}
    if(snapshot.business)snapshot.business={...snapshot.business,openingBalancesKnown:openingApproved,balanceMeaning:openingApproved?'reconciled-central-ledger':'movements-since-activation'};
    return {...snapshot,consultationOnly:!supportedRelease(release),operationalEnabled:supportedRelease(release),openingBalancesApproved:openingApproved,operationalRestrictions:{historicalEffectsImmutable:true,financialOpeningPending:!openingApproved,heldStockIds:holds.filter(h=>h.reason==='STOCK_OPENING_PENDING').map(h=>h.record_id)}};
   }};
  api=createSharedApi({pool,identity,authentication,history,policy,writable:health,context:{operational:true,lab:false,target:config.database}});
  return {api,health,backup,async stop(){clearInterval(timer);await backupFlight?.catch(()=>{});await pool.end();}};
 }catch(error){clearInterval(timer);await pool.end();throw error;}
}
