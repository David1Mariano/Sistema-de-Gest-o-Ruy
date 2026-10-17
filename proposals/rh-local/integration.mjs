import {RH_ENTITIES} from './rh-contract.mjs';
export function patchCore(source) {
  const importLine="import { guardC2 } from './c2.mjs';";
  const guardLine='    await guardC2(client,entity,id,operation,payload,confirmation);';
  if(!source.includes(importLine)||!source.includes(guardLine))throw Error('Core baseline changed.');
  return source.replace(importLine,importLine+"\nimport { guardRh } from './rh-contract.mjs';").replace(guardLine,'    await guardRh(client,entity,id,operation,payload,confirmation);\n'+guardLine);
}
export function patchEntities(source) {
  const line="new Set(['Employee','Sector','JobRole','SystemSettings'])";
  if(!source.includes(line))throw Error('C2 baseline changed.');
  return source.replace(line,"new Set(['Employee','Sector','JobRole','SystemSettings',"+[...RH_ENTITIES].map(name=>"'"+name+"'").join(',')+'])');
}
export function patchFacade(source) {
  const before="localClient = LOCAL_C2_ENTITIES.has(name) ? createLocalEntity(name,localSession) : null;";
  if(!source.includes(before))throw Error('Facade baseline changed.');
  // Existing facade already reads the exported allowlist. No runtime replacement needed.
  return source;
}
