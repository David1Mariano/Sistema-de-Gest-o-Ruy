import {buildFinancialDashboard} from './financialDashboard.js';
import {EMPLOYEE_STATUS,tenure} from './rhUtils.js';
export function filterReportEmployees(employees,filters={}) {
 const {search='',sector='',function:job='',status=''}=filters;
 return employees.filter(e=>[e.name,e.social_name,e.sector,e.function,e.unit].join(' ').toLowerCase().includes(search.toLowerCase())&&(!sector||e.sector===sector)&&(!job||e.function===job)&&(status?e.status===status:e.status!=='inativo')).sort((a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR',{sensitivity:'base'}));
}
export const categoryReportRows=rows=>rows.map(r=>[r.nome,Math.round(r.total*100)]);
export const employeeReportRows=rows=>rows.map(e=>[[e.name,e.social_name?`"${e.social_name}"`:null].filter(Boolean).join(' / ')||'—',e.function||'—',e.sector||'—',e.default_start_time?`${e.default_start_time}–${e.default_end_time||''}`:'—',e.admission_date?tenure(e.admission_date):'—',e.phone||'—',(EMPLOYEE_STATUS[e.status]||EMPLOYEE_STATUS.inativo).label]);
export function reportData(kind,records,filters={}) {
 if(kind==='categories'){
  const rows=categoryReportRows(buildFinancialDashboard({expenses:records},filters.start,filters.end).byCategory);
  return {kind,filters,columns:['Categoria','Valor'],rows,totalCents:rows.reduce((sum,r)=>sum+r[1],0)};
 }
 if(kind==='employees')return {kind,filters,columns:['Colaborador','Função','Setor','Horário','Entrada (tempo de casa)','Telefone','Status'],rows:employeeReportRows(filterReportEmployees(records,filters))};
 throw Error('Relatório não autorizado.');
}
