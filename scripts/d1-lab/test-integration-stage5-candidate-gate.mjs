import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const executable=path.resolve('artifacts/agente5-integracao5-20261019/win-unpacked/Sistema Ruy - Integracao 5 Homologacao.exe');
const home=await fs.mkdtemp(path.join(os.tmpdir(),'ruy-i5-gate-')),evidence=path.join(home,'gate.json');
const env={...process.env,RUY_D1_ALLOW_TESTS:'1',RUY_D1_TEST_API_PORT:'18091'};
delete env.RUY_D1_RESTART_FIXTURE;delete env.ELECTRON_RUN_AS_NODE;
// A smoke failure writes only its error class/stage and exits normally, without a dialog.
const code=await new Promise((r,j)=>{const child=spawn(executable,['--lab-smoke','--lab-evidence='+evidence],{windowsHide:true,stdio:'ignore',env});child.once('error',j);child.once('exit',r);});
const result=JSON.parse(await fs.readFile(evidence+'.failure.json','utf8'));
assert.equal(result.revision,'A5-I5-20261019');assert.equal(result.stage,'environment');assert.equal(result.errorName,'Error');
await fs.writeFile('logs/etapa5/candidate-gate.json',JSON.stringify({actualPackagedExecutable:true,fixtureMissingRefusedBeforeEnvironmentAccess:true,normalExit:true,exitCode:code,revision:result.revision},null,2));console.log('I5_PACKAGED_DEFAULT_BLOCKED');
