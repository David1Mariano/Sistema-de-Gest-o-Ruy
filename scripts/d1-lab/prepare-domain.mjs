import fs from 'node:fs/promises';
import {config} from '../../server/d1-lab/environment.mjs';
import {pg} from '../../server/d1-lab/core.mjs';
const c=new pg.Client(await config(true));await c.connect();
try{await c.query('BEGIN');await c.query(await fs.readFile(new URL('../../server/d1-lab/domain.sql',import.meta.url),'utf8'));await c.query('COMMIT');console.log('Contrato de documentos preparado somente no D1 sintético.');}
catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}
