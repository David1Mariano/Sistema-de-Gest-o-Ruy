import { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import DailyExpensesPanel from '@/components/financeiro/DailyExpensesPanel';

// Área "Gastos Diários" como página própria.
//
// Reaproveita EXATAMENTE o mesmo `DailyExpensesPanel` que a aba do Financeiro
// já usa — não existe um segundo sistema de gastos. Esta página é só a entrada
// direta pelo atalho do painel inicial, carregando as mesmas entidades
// (FinancialExpense, ExpenseCategory, CostCenter, Employee, Supplier, Vale,
// EmployeePayment, FinancialAccount).
export default function GastosDiarios() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({
    expenses: [], categories: [], centers: [], employees: [],
    suppliers: [], accounts: [], vales: [], payments: [],
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expenses, categories, centers, employees, suppliers, accounts, vales, payments] = await Promise.all([
        base44.entities.FinancialExpense.list('-date', 1000).catch(() => []),
        base44.entities.ExpenseCategory.list('name', 300).catch(() => []),
        base44.entities.CostCenter.list('name', 300).catch(() => []),
        base44.entities.Employee.list('name', 500).catch(() => []),
        base44.entities.Supplier.list('name', 500).catch(() => []),
        base44.entities.FinancialAccount.list('name', 100).catch(() => []),
        base44.entities.Vale.list('-date', 1000).catch(() => []),
        base44.entities.EmployeePayment.list('-payment_date', 1000).catch(() => []),
      ]);
      setData({ expenses, categories, centers, employees, suppliers, accounts, vales, payments });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <DailyExpensesPanel
    rows={data.expenses}
    loading={loading}
    data={data}
    onSaved={load}
  />;
}
