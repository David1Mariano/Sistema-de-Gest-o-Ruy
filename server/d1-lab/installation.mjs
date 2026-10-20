// Immutable namespaces, never destinations supplied by the renderer or a shortcut.
export const installations = Object.freeze({
  'i5r3-20261020': Object.freeze({id:'i5r3-20261020',apiPort:18103,dbPort:55443,database:'ruy_d1_disposable'}),
  'i5r3-peer-20261020': Object.freeze({id:'i5r3-peer-20261020',apiPort:18104,dbPort:55444,database:'ruy_d1_disposable'}),
});
export function installationFor(env=process.env){
  if(!env.RUY_D1_INSTALLATION)return null;
  const value=installations[env.RUY_D1_INSTALLATION];
  if(!value||env.RUY_D1_ALLOW_TESTS!=='1'||env.RUY_D1_RESTART_FIXTURE||env.RUY_D1_TEST_API_PORT!==String(value.apiPort))throw Error('INSTALLATION_CONFLICT');
  return value;
}
