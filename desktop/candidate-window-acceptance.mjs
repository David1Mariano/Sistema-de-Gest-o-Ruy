// Opt-in verification of our own freshly packaged executable; never an authentication bypass.
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
export async function candidateWindowAcceptance({app,root,metadata}){
 if(!process.argv.includes('--candidate-window-test'))return false;
 if(!app.isPackaged||metadata.ruyOperationalWorkspace!==true)throw Error('PACKAGED_OPERATIONAL_ACCEPTANCE_REQUIRED');
 const context=process.env.RUY_CANDIDATE_WINDOW_CONTEXT;if(!/^packaged-window-test-[a-f0-9]{16}\.dpapi$/.test(context||''))throw Error('PACKAGED_ACCEPTANCE_CONTEXT_REQUIRED');
 const {unseal,installation}=await import(pathToFileURL(path.join(root,'server/d1-lab/environment.mjs'))),c=await unseal(context);
 const originalFs=createRequire(import.meta.url)('original-fs');
 if(installation?.id!=='windows-operational'||c.purpose!=='RUY_PACKAGED_WINDOW_ACCEPTANCE'||c.installationId!==installation.id||c.expiresAt<Date.now()||c.nonce!==process.env.RUY_CANDIDATE_WINDOW_NONCE||path.resolve(c.executable).toLowerCase()!==path.resolve(await fs.realpath(app.getPath('exe'))).toLowerCase()||createHash('sha256').update(originalFs.readFileSync(root)).digest('hex')!==c.asarSha256)throw Error('PACKAGED_ACCEPTANCE_CONTEXT_REFUSED');
 return true;
}
