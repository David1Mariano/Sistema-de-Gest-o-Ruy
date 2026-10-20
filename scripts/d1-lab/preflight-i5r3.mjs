import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {installation,validateHome,config,home,unseal} from '../../server/d1-lab/environment.mjs';
if(installation?.id!=='i5r3-20261020')throw Error('R3 explicit environment required');
const destination=path.join(process.env.LOCALAPPDATA,'Programs','Sistema-Ruy-I5R3-Homologacao-20261020');
try{await fs.lstat(destination);throw Error('INSTALL_DESTINATION_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
for(const port of [installation.apiPort,installation.dbPort]){
 if(port===installation.dbPort)continue; // Validated PostgreSQL may already run in this namespace.
 const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
}
const marker=await validateHome();await config();
const certificates=await unseal('installation-tls.dpapi');
if(certificates.installationId!==installation.id)throw Error('CERTIFICATE_INSTALLATION_CONFLICT');
try{await fs.access(path.join(home,'backups','backup.lock'));throw Error('BACKUP_IN_PROGRESS');}catch(error){if(error.code!=='ENOENT')throw error;}
console.log(JSON.stringify({installationId:installation.id,destination,dataHome:home,deviceId:marker.deviceId,apiPort:installation.apiPort,dbPort:installation.dbPort,operationalSync:false,installerExecuted:false}));
