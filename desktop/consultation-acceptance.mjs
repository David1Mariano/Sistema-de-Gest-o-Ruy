// Only runs with the existing, strictly isolated Electron test profile gate.
import fs from 'node:fs/promises';
import path from 'node:path';
export async function consultationClientSmoke({window,profileRoot,app}){
 const evaluate=code=>window.webContents.executeJavaScript(code);
 for(let i=0;i<100;i++){
  if(await evaluate("!!document.querySelector('input[name=email]')&&!!document.querySelector('input[name=password]')"))break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 const result=await evaluate(`(async()=>{
  const response=await fetch('/api/d1/connection');const connection=await response.json();
  return {originalLoginFirst:!!document.querySelector('input[name=email]')&&!!document.querySelector('input[name=password]'),centralAvailable:response.ok&&connection.available===true,noDeviceApproval:!document.body.innerText.includes('configurar dispositivo'),noCertificatePrompt:!document.body.innerText.includes('certificado próprio')};
 })()`);
 result.packaged=app.isPackaged;result.version=app.getVersion();result.isolatedProfile=true;result.operationalLoginAttempted=false;
 result.passed=result.packaged&&result.originalLoginFirst&&result.centralAvailable&&result.noDeviceApproval&&result.noCertificatePrompt;
 await fs.writeFile(path.join(profileRoot,'consultation-client-result.json'),JSON.stringify(result,null,2),{flag:'wx'});
 if(!result.passed)throw Error('PACKAGED_CONSULTATION_LOGIN_FAILED');
}
