import {fail} from './core.mjs';
import {catalogList} from './catalog.mjs';
import {domainList} from './domain.mjs';
import {reportData} from '../../src/lib/reportData.js';
export async function authorizedReport(pool,user,kind,filters,source){
 if(user.role!=='admin')throw fail(403,'Exportação exige autorização administrativa.');
 const allowed=kind==='categories'?['start','end']:kind==='employees'?['search','sector','function','status']:null;
 if(!allowed||Object.keys(filters).some(k=>!allowed.includes(k))||Object.values(filters).some(v=>typeof v!=='string'||v.length>200))throw fail(400,'Filtros de relatório inválidos.');
 const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 if(kind==='categories'&&(!validDate(filters.start)||!validDate(filters.end)||filters.start>filters.end))throw fail(400,'Período inválido.');
 const entity=kind==='categories'?'FinancialExpense':'Employee';
 // Existing lists return the whole authorized scope, without page truncation.
 const records=source?await source.list(user,entity):kind==='employees'?await catalogList(pool,user,entity):await domainList(pool,user,entity);
 return {...reportData(kind,records,filters),issuedAt:new Date().toISOString()};
}
