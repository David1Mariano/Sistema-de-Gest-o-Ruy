export * from '../../src/lib/dailyExpenses.js';
import {buildExpensePayload,expenseEditBlocker} from '../../src/lib/dailyExpenses.js';
import {localDomain} from './client.mjs';
export async function saveDailyExpense({form,editing=null,categories=[],centers=[],employees=[],responsibleUser=''}){
 const blocker=editing&&expenseEditBlocker(editing);
 if(blocker)throw Error(blocker);
 const payload=buildExpensePayload(form,{categories,centers,employees,responsibleUser});
 const expense=await localDomain.command('FinancialExpense',editing?.id||null,{...payload,_version:editing?._version});
 return {expense,payment:null,created:!editing,expenseId:expense.id};
}
export async function deleteDailyExpense(){throw Error('Exclusão financeira aguarda cancelamento agregado homologado; histórico preservado.');}
