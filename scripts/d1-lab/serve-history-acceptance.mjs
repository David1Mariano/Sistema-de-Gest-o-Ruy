if(process.env.RUY_HISTORY_ACCEPTANCE!=='1'||process.env.RUY_D1_INSTALLATION!=='history-view-dev-20261020')throw Error('EXPLICIT_HISTORY_ACCEPTANCE_REQUIRED');
const {shutdown}=await import('../../server/d1-lab/start.mjs');
process.stdin.setEncoding('utf8');
process.stdin.on('data',text=>{if(text.trim()==='shutdown')shutdown().then(()=>process.exit(0));});
// A test helper must not remain orphaned after its controlling terminal closes.
process.stdin.on('end',()=>shutdown().then(()=>process.exit(0)));
