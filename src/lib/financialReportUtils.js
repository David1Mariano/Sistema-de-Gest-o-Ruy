export const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export const fmt=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
export function exportFinancialCsv(data,start,end){
 const rows=[['RELATÓRIO FINANCEIRO',`${start} a ${end}`],[],['Tipo','Data','Descrição','Valor','Status']];
 data.revenues.forEach(x=>rows.push(['Receita',x.date,x.description,Number(x.net_amount||0),x.status]));
 data.expenses.forEach(x=>rows.push(['Despesa',x.date,x.description,-Number(x.amount||0),x.status]));
 data.payables.forEach(x=>rows.push(['Conta a pagar',x.due_date,x.description,-Number(x.amount||0),x.status]));
 data.receivables.forEach(x=>rows.push(['Conta a receber',x.expected_date,x.description,Number(x.net_amount||0),x.status]));
 data.reconciliations.forEach(x=>rows.push(['Conciliação',x.date,x.reference_description||x.reference_type,Number(x.difference||0),x.status]));
 rows.push([],['RODÍZIO DE MÁQUINAS'],['Dia','Operadora','Máquina','Meta vendas','Meta transações','Gerente','Contato']);
 data.rotations.forEach(x=>rows.push([x.weekday,x.operator,x.terminal,x.sales_goal,x.transaction_goal,x.manager_name,x.manager_phone]));
 const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(';')).join('\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download=`relatorio-financeiro-${start}-${end}.csv`;a.click();URL.revokeObjectURL(a.href);
}