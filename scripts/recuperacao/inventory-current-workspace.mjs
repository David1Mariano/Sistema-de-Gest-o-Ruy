// Read-only inventory of the CURRENT installation, including post-import data.
// No row values, names, credentials or individual financial values are emitted.
import fs from 'node:fs/promises';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {config,home,installation,unseal} from '../../server/d1-lab/environment.mjs';
import {pg,poolFor} from '../../server/d1-lab/core.mjs';
if(installation?.id!=='windows-operational'||process.env.RUY_CURRENT_INVENTORY!=='1')throw Error('Explicit current-workspace read-only inventory required');
let pool,source;
try{
 pool=poolFor(await config());const client=await pool.connect();let tables,entities;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const names=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  tables=[];for(const {tablename} of names){if(!/^[a-z_][a-z0-9_]*$/.test(tablename))throw Error('Unexpected table identifier');tables.push({table:tablename,rows:Number((await client.query('SELECT count(*)::text n FROM public."'+tablename+'"')).rows[0].n)});}
  entities={};for(const table of ['d1_records','d2_catalog'])entities[table]=(await client.query(`SELECT entity,count(*)::int records FROM ${table} GROUP BY entity ORDER BY entity`)).rows;
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 const profile=await unseal('recovered-source.dpapi');source=new pg.Client(profile.config);await source.connect();
 const historical=(await source.query("SELECT entity,count(*)::int records FROM history.records GROUP BY entity ORDER BY entity")).rows;
 const attachments=(await source.query('SELECT state,count(*)::int files,sum(bytes)::text bytes FROM history.attachments GROUP BY state ORDER BY state')).rows;
 const report={purpose:'CURRENT_RUY_READ_ONLY_INVENTORY',createdAt:new Date().toISOString(),installation:installation.id,port:installation.dbPort,operationalTables:tables,operationalEntities:entities,historicalEntities:historical,historicalAttachments:attachments,operationalAndHistoricalKeptSeparate:true};
 const directory=path.join(home,'migration-inventory');await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'inventory-'+Date.now()+'-'+randomBytes(4).toString('hex')+'.json'),JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({readOnly:true,tableCounts:tables,entityCounts:entities,historicalRecords:historical.reduce((n,r)=>n+r.records,0),historicalAttachments:attachments.reduce((n,r)=>n+r.files,0),individualValuesExported:false}));
}catch(error){console.error(JSON.stringify({readOnly:true,failed:true,code:error.code||'INVENTORY_FAILED'}));process.exitCode=1;}
finally{await pool?.end();await source?.end();}
