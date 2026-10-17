import fs from 'node:fs/promises';
import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor} from '../../server/d1-lab/core.mjs';
import {provisionTLS} from '../../server/d1-lab/tls-provision.mjs';
if(process.env.RUY_D1_ALLOW_TESTS!=='1'||!process.env.RUY_MTLS_PROVISION_FILE)throw Error('Protected laboratory provisioning file and opt-in required.');
const value=JSON.parse(await fs.readFile(process.env.RUY_MTLS_PROVISION_FILE,'utf8'));
const pool=poolFor(await config());
try{
 const result=await provisionTLS(pool,{actorId:value.actorId,deviceId:value.deviceId,workspaceId:value.workspaceId,token:value.token,endpoint:value.endpoint,
  authorizedPrivateLab:process.argv.includes('--authorized-private-lab'),key:await fs.readFile(value.keyFile,'utf8'),cert:await fs.readFile(value.certFile,'utf8'),ca:await fs.readFile(value.caFile,'utf8')});
 console.log(JSON.stringify(result));
}finally{await pool.end();}
