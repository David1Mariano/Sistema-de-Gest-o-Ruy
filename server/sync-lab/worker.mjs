import {pool as openPool} from './environment.mjs';
import {synchronize} from './sync.mjs';
const mode=process.argv[2];if(!['A','B'].includes(mode))throw Error('Worker somente A/B.');
const {pool,config}=await openPool(mode);
try{console.log(JSON.stringify(await synchronize(pool,config)));}finally{await pool.end();}
