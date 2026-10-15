import {test} from 'node:test';
import assert from 'node:assert/strict';
import config from '../../lab/d1/vite.config.mjs';
test('Build D1: imports relativos e aliases usam uma única identidade offline',()=>{
 const resolve=input=>{
  const alias=config.resolve.alias.find(a=>typeof a.find==='string'?(input===a.find||input.startsWith(a.find+'/')):a.find.test(input));
  return alias?input.replace(alias.find,alias.replacement):input;
 };
 assert.equal(resolve('./useCurrentUser'),resolve('@/lib/useCurrentUser'));
 assert.equal(resolve('./AuthContext'),resolve('@/lib/AuthContext'));
 assert.equal(resolve('./supabaseClient.js'),resolve('@/lib/supabaseClient'));
 assert.ok(resolve('@/api/base44Client').includes('lab'));
});
