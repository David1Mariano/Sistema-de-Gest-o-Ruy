import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ESLint} from 'eslint';
test('A3 adapted lint coverage validates the existing C2 CommonJS guard',async()=>{
 const eslint=new ESLint(),filePath='scripts/sync-lab/network-guard.cjs';
 const config=await eslint.calculateConfigForFile(filePath);assert.equal(config.languageOptions.sourceType,'commonjs');assert.equal(config.rules['no-undef'][0],2);
 const [invalid]=await eslint.lintText('module.exports = () => missingStage2Symbol;\n',{filePath});assert.ok(invalid.messages.some(m=>m.ruleId==='no-undef'));
 const [actual]=await eslint.lintFiles([filePath]);assert.equal(actual.errorCount,0);
});
