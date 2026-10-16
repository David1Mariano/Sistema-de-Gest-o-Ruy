import {fail,uuid} from './core.mjs';
const types=['salario','adiantamento','diaria_motoboy','diaria_freelancer','hora_extra','comissao','ferias','decimo_terceiro','acerto','outros'];
const methods=['dinheiro','pix','cartao_debito','cartao_credito','transferencia','outro'];
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e9&&Math.abs(value*100-Math.round(value*100))<1e-6;
export function validatePaymentBatch(body){
 if(body.token!=='confirm-local-payroll')throw fail(409,'Confirme o lote local antes de registrar.');
 const items=body.data?.payments;
 if(!Array.isArray(items)||!items.length||items.length>50)throw fail(400,'Lote deve conter de 1 a 50 pagamentos.');
 if(new Set(items.map(p=>p?.employee_id)).size!==items.length)throw fail(409,'Colaborador repetido no lote.');
 for(const p of items){
  if(!p||!uuid(p.employee_id)||p.vale_id||!types.includes(p.payment_type||'outros'))throw fail(409,'Tipo/colaborador inválido; vale exige fluxo RH.');
  if(![p.gross_amount,p.discount_amount,p.net_amount].every(money)||p.net_amount<=0||p.gross_amount<=0||Math.round(p.gross_amount*100)-Math.round(p.discount_amount*100)!==Math.round(p.net_amount*100))throw fail(400,'Valores monetários do lote inválidos.');
  if(!methods.includes(p.payment_method)||!['pago','pendente'].includes(p.status||'pago')||typeof p.observation!=='undefined'&&(typeof p.observation!=='string'||p.observation.length>500))throw fail(400,'Forma, status ou observação do lote inválidos.');
  if(typeof p.payment_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.payment_date)||!Number.isFinite(Date.parse(p.payment_date+'T00:00:00Z'))||new Date(p.payment_date+'T00:00:00Z').toISOString().slice(0,10)!==p.payment_date)throw fail(400,'Data do lote inválida.');
  for(const field of ['reference_start','reference_end','work_date'])if(p[field]&&(typeof p[field]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p[field])||!Number.isFinite(Date.parse(p[field]+'T00:00:00Z'))||new Date(p[field]+'T00:00:00Z').toISOString().slice(0,10)!==p[field]))throw fail(400,'Referência do lote inválida.');
  if(p.days_quantity!==undefined&&(!Number.isFinite(p.days_quantity)||p.days_quantity<=0||p.days_quantity>3650)||p.daily_rate!==undefined&&!money(p.daily_rate))throw fail(400,'Diárias do lote inválidas.');
 }
 return items;
}
