// Read projection only: an expense remains one central document, never a second
// payable or payment. Existing aggregate links take precedence over projections.
export function expenseObligations(expenses=[],payables=[]){
 const represented=new Set(payables.map(p=>p.financial_expense_id).filter(Boolean));
 const payableIds=new Set(payables.map(p=>p.id));
 return [...payables,...expenses.filter(e=>!e._historical&&!e._readOnly&&!represented.has(e.id)&&!e.accounts_payable_id&&!payableIds.has(e.id)&&['pendente','pago','cancelado'].includes(e.status)).map(e=>({...e,_expenseObligation:true,_expenseId:e.id,due_date:e.due_date||e.date,issue_date:e.date,payment_method_planned:e.payment_method,document_url:e.invoice_url,financial_expense_id:e.id}))];
}

export function uniqueFinancialDocuments(expenses=[],payables=[]){
 const result=new Map(expenses.map(e=>[e.id,e]));
 for(const p of payables){
  if(result.has(p.id)||p.financial_expense_id&&result.has(p.financial_expense_id)||expenses.some(e=>e.accounts_payable_id===p.id))continue;
  result.set(p.id,{...p,date:p.due_date||p.issue_date,_payableObligation:true});
 }
 return [...result.values()];
}
