import fs from 'node:fs/promises';
import path from 'node:path';
import {installation,seal,unseal} from './environment.mjs';
export async function claimInstallation(executable){
 if(!installation)throw Error('INSTALLATION_REQUIRED');
 const actual=await fs.realpath(executable);
 if(path.resolve(actual).toLowerCase()!==path.resolve(executable).toLowerCase())throw Error('INSTALLATION_REDIRECTION_REFUSED');
 let binding;
 try{binding=await unseal('installation-location.dpapi');}
 catch(error){if(error.code!=='ENOENT')throw error;await seal('installation-location.dpapi',{installationId:installation.id,executable:actual});return;}
 if(binding.installationId!==installation.id||binding.executable.toLowerCase()!==actual.toLowerCase())throw Error('INSTALLATION_LOCATION_CONFLICT');
}
