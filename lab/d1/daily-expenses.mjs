export * from '../../src/lib/dailyExpenses.js';
import {buildExpensePayload,expenseEditBlocker} from '../../src/lib/dailyExpenses.js';
import {localDomain} from './client.mjs';
export async function saveDailyExpense({form,editing=null,categories=[],centers=[],employees=[],responsibleUser=''}){
  const blocker=editing&&expenseEditBlocker(editing);
  if(blocker)throw Error(blocker);
  const payload=buildExpensePayload(form,{categories,centers,employees,responsibleUser});
  // Clearing the payee must clear the previous employee reference in a patch.
  payload.employee_id=payload.employee_id||'';
  // File bindings are committed by the attachment service, never by a financial
  // command. Re-sending their projected URLs makes an authorized edit fail.
  const domain=localDomain;
  if(domain.attachments){delete payload.proof_url;delete payload.invoice_url;}
  const expense=await domain.command('FinancialExpense',editing?.id||null,{...payload,_version:editing?._version});
  return {expense,payment:null,created:!editing,expenseId:expense.id};
}
/**
 * Exclusão/cancelamento autorizado de FinancialExpense na camada D1.
 *
 * Regras de negócio (espelhadas do server/d1-lab/domain.mjs):
 *   - Só é permitido para gastos manuais (origin_type='manual') ou
 *     pagamentos_colaborador (origin_type='pagamento_colaborador').
 *   - Contas a pagar (origin_type='conta_pagar') NUNCA podem ser canceladas
 *     diretamente: o agregado de origem (AccountsPayable) é quem deve ser
 *     cancelado, e a despesa é cancelada em cascata.
 *   - Se houver linked_payment_id ativo, o pagamento vinculado é cancelado
 *     primeiro (status='cancelado'), preservando a rastreabilidade.
 *   - Auditoria financeira é registrada como OperationalEvent de reversão.
 *   - Versionamento: exige _version atual e usa compare-and-swap.
 *
 * @param {object} opts
 * @param {object} opts.expense - registro FinancialExpense carregado da tela.
 * @param {object[]} [opts.payments] - pagamentos vinculados (EmployeePayment).
 * @param {object[]} [opts.vales] - vales vinculados (Vale).
 * @param {boolean} [opts.revalidate=true] - revalida vínculos com dados atuais.
 * @param {object} [opts.domain] - injeção do domínio D1 (para testes).
 */
export async function deleteDailyExpense({expense,payments=[],vales=[],revalidate=true,domain}={}){
  if(!expense?.id)throw Error('Gasto inexistente: identificador ausente.');
  const domain_=domain||localDomain;
  const expenseId=expense.id;
  const originType=expense.origin_type;
  // Contas a pagar: bloqueio por regra de negócio. O cancelamento deve vir
  // do agregado de origem (AccountsPayable), que cancela a despesa em cascata.
  if(originType==='conta_pagar')throw Error('Esta conta a pagar é um lançamento agregado; exclua-a pela tela de Contas a Pagar para preservar o vínculo e o histórico.');
  // Vinculo com Vale: bloqueio. O Vale é dono da despesa.
  if(expense.origin_type==='vale'||vales.some(v=>v.financial_expense_id===expenseId||v.id===expense.origin_id)){
    throw Error('Gasto vinculado a Vale não pode ser excluído; cancele o Vale na tela de Vales para preservar a rastreabilidade.');
  }
  // Vinculo com pagamento ativo: cancela o pagamento primeiro.
  const linkedPayment=(payments||[]).find(p=>p.financial_expense_id===expenseId&&p.status!=='cancelado');
  if(linkedPayment){
    const paymentId=linkedPayment.id;
    try{
      await domain_.command('EmployeePayment',paymentId,{...linkedPayment,_version:linkedPayment._version,status:'cancelado',cancellation_id:crypto.randomUUID(),observation:(linkedPayment.observation||'')+' | Gasto vinculado cancelado.'},'cancel',{baseVersion:linkedPayment._version});
    }catch(error){
      throw Error('Pagamento vinculado não pôde ser cancelado: '+(error?.message||'falha na reconciliação')+'. O gasto permanece.');
    }
  }
  // Vinculo com conta a pagar (por accounts_payable_id): bloqueio.
  if(expense.accounts_payable_id)throw Error('Despesa vinculada a conta a pagar; cancle a conta a pagar para preservar o vínculo.');
  // Exigência de confirmação explícita e versionamento.
  if(!expense._version)throw Error('Recarregue o gasto antes de excluir: a versão atual é necessária para evitar conflito.');
  // Envia o comando de cancelamento para o domínio D1.
  await domain_.command('FinancialExpense',expenseId,{status:'cancelado',cancellation_id:crypto.randomUUID(),observation:(expense.observation||'')+' | Cancelado pelo usuário.'},'cancel',{baseVersion:expense._version});
  return {expenseId,cancelledPayment:linkedPayment?.id||null};
}