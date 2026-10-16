import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {guardFinancialBatches} from '../../lab/d1/financial-guards.mjs';
test('Lote legado no build D1 recusa antes de qualquer escrita; fonte oficial preservada',async()=>{
 const file=new URL('../../src/pages/Financeiro.jsx',import.meta.url),original=await fs.readFile(file,'utf8');
 const transformed=guardFinancialBatches(original.replace(/\r\n/g,'\n'));
 const block=transformed.slice(transformed.indexOf('function BatchPaymentDialog('),transformed.indexOf('function ConsumptionDialog('));
 const body=block.slice(block.indexOf('  const save = async () => {')+'  const save = async () => {'.length,block.indexOf('\n  };\n\n  return'));
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;let writes=0;
 const run=new AsyncFunction('base44',body);
 await assert.rejects(run({localDomain:{},entities:new Proxy({},{get(){writes++;throw Error('Escrita não permitida');}})}),/Lote de vales\/adiantamentos indisponível/);
 assert.equal(writes,0);assert.equal(await fs.readFile(file,'utf8'),original);
 assert.throws(()=>guardFinancialBatches('alterado'),/Contrato/);
});
