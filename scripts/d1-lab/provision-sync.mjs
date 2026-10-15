import {randomBytes,randomUUID} from 'node:crypto';
import {config,validateHome,seal} from '../../server/d1-lab/environment.mjs';
import {config as centralConfig} from '../../server/sync-lab/environment.mjs';
import {pg,uuid,digest} from '../../server/d1-lab/core.mjs';
const actor=process.argv[2],workspace=process.argv[3]||randomUUID();
if(!uuid(actor)||!uuid(workspace))throw Error('Use <UUID usuário admin sintético> [UUID workspace sintético].');
const marker=await validateHome(),local=new pg.Client(await config(true)),central=new pg.Client(await centralConfig('central',true));
await local.connect();await central.connect();
try{
 const user=(await local.query("SELECT id FROM lab_users WHERE id=$1 AND active AND role='admin' AND login LIKE '%@example.invalid'",[actor])).rows[0];
 if(!user)throw Error('Administrador fictício ativo obrigatório.');
 if((await local.query('SELECT 1 FROM d1_sync_binding WHERE actor=$1',[actor])).rowCount)throw Error('Vínculo existente preservado; reprovisionamento recusado.');
 const token=randomBytes(32).toString('hex');
 await central.query("INSERT INTO d1_principals(token_hash,device_id,actor_id,workspace_id,role) VALUES($1,$2,$3,$4,'admin')",[digest(token),marker.deviceId,actor,workspace]);
 await seal('sync-'+actor+'.dpapi',{purpose:'D1_C2_TEST_ONLY',actorId:actor,deviceId:marker.deviceId,workspaceId:workspace,token});
 await local.query('INSERT INTO d1_sync_binding(actor,device_id,workspace_id) VALUES($1,$2,$3)',[actor,marker.deviceId,workspace]);
 console.log(JSON.stringify({actor,workspace,mode:'central-test-only',operationalSyncEnabled:false}));
}finally{await local.end();await central.end();}
