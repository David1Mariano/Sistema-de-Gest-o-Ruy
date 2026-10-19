// Central test schemas can live in a separate database on the disposable clone.
// This changes only fixture placement, never application transport or persistence.
export function fixtureTarget(kind,{local,central,isolateCentral,allowTests,restartFixture}) {
 if(!['local','central'].includes(kind))throw Error('Unknown fixture target');
 if(isolateCentral==='1'){
  if(allowTests!=='1'||restartFixture!=='e5aaec701010f607'||local.host!=='127.0.0.1'||local.port!==55437)throw Error('Disposable clone required for isolated central');
  return local;
 }
 return kind==='central'?central:local;
}
