// Immutable namespaces, never destinations supplied by the renderer or a shortcut.
export const installations = Object.freeze({
  'windows-operational':Object.freeze({id:'windows-operational',apiPort:18146,dbPort:55496,database:'ruy_d1_disposable',individualIdentity:true,recoveredPreview:true,operationalCandidate:true,attachments:true,delivery:true,tlsPort:18603,gatewayPort:18604,bridgePort:18605}),
  'windows-layout-20261021':Object.freeze({id:'windows-layout-20261021',apiPort:18144,dbPort:55494,database:'ruy_d1_disposable',individualIdentity:true,recoveredPreview:true,attachments:true,delivery:false,tlsPort:18596,gatewayPort:18597,bridgePort:18598}),
  'windows-candidate-20261021':Object.freeze({id:'windows-candidate-20261021',apiPort:18143,dbPort:55493,database:'ruy_d1_disposable',individualIdentity:true,recoveredPreview:true,attachments:true,delivery:false,tlsPort:18593,gatewayPort:18594,bridgePort:18595}),
  'final-dev-20261021': Object.freeze({id:'final-dev-20261021',apiPort:18133,dbPort:55483,database:'ruy_d1_disposable',attachments:true,delivery:true,tlsPort:18583,gatewayPort:18584,bridgePort:18585}),
  'history-view-dev-20261020': Object.freeze({id:'history-view-dev-20261020',apiPort:18123,dbPort:55473,database:'ruy_d1_disposable',historyOnly:true}),
  'i5r4-dev-20261020': Object.freeze({id:'i5r4-dev-20261020',apiPort:18113,dbPort:55453,database:'ruy_d1_disposable',attachments:true,delivery:true,tlsPort:18553,gatewayPort:18554,bridgePort:18555}),
  'i5r3-20261020': Object.freeze({id:'i5r3-20261020',apiPort:18103,dbPort:55443,database:'ruy_d1_disposable'}),
  'i5r3-peer-20261020': Object.freeze({id:'i5r3-peer-20261020',apiPort:18104,dbPort:55444,database:'ruy_d1_disposable'}),
});
export function installationFor(env=process.env){
  if(!env.RUY_D1_INSTALLATION)return null;
  const value=installations[env.RUY_D1_INSTALLATION];
  if(!value||env.RUY_D1_ALLOW_TESTS!=='1'||env.RUY_D1_RESTART_FIXTURE||env.RUY_D1_TEST_API_PORT!==String(value.apiPort))throw Error('INSTALLATION_CONFLICT');
  return value;
}
