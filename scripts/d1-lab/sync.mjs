import {config} from '../../server/d1-lab/environment.mjs';
import {poolFor,uuid} from '../../server/d1-lab/core.mjs';
import {synchronizeD1} from '../../server/d1-lab/sync.mjs';
if(!uuid(process.argv[2]))throw Error('Use <UUID de administrador sintético previamente provisionado>.');
const pool=poolFor(await config());
try{console.log(JSON.stringify(await synchronizeD1(pool,process.argv[2])));}finally{await pool.end();}
