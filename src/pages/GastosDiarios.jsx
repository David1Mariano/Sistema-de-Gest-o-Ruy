import { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import DailyExpensesPanel from '@/components/financeiro/DailyExpensesPanel';

const EMPTY = {
  expenses: [], categories: [], centers: [], employees: [],
  suppliers: [], accounts: [], vales: [], payments: [],
};

// Area "Gastos Diários" como página própria.
//
// Reaproveita EXATAMENTE o mesmo `DailyExpensesPanel` que a aba do Financeiro
// já usa — não existe um segundo sistema de gastos.
//
// Estados separados de propósito:
//   'initial'    -> primeira carga; a tela pode mostrar "Carregando gastos..."
//   'refreshing' -> já há dados; a tabela e os totais CONTINUAM na tela
//   'ready'/'erro'-> nada de loading
//
// Uma falha de rede NUNCA vira lista vazia: cada entity é lida com `.catch` e o
// valor ANTERIOR é preservado, para o total não cair para R$ 0,00 sozinho.
export default function GastosDiarios() {
  const [status, setStatus] = useState('initial');
  const [data, setData] = useState(EMPTY);
  const [failure, setFailure] = useState('');
  const loadedOnce = useRef(false);
  // Descarta respostas antigas: só a última carga concluída atualiza a tela.
  const requestId = useRef(0);
  // Espelho do estado em ref: permite que `load` leia o valor anterior sem
  // depender de `data`. Sem isso, `load` mudaria a cada setData e o
  // useEffect entraria em loop (reload -> setData -> render -> load...).
  const dataRef = useRef(EMPTY);

  const load = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setStatus(loadedOnce.current ? 'refreshing' : 'initial');

    const ler = async (name, sort, limit, key) => {
      try {
        const list = base44.entities[name]?.list;
        if (typeof list !== 'function') return dataRef.current[key];
        const rows = await list.call(base44.entities[name], sort, limit);
        return Array.isArray(rows) ? rows : dataRef.current[key];
      } catch {
        return dataRef.current[key]; // falha conserva o que já estava na tela
      }
    };

    const [expenses, categories, centers, employees, suppliers, accounts, vales, payments] = await Promise.all([
      ler('FinancialExpense', '-date', 1000, 'expenses'),
      ler('ExpenseCategory', 'name', 300, 'categories'),
      ler('CostCenter', 'name', 300, 'centers'),
      ler('Employee', 'name', 500, 'employees'),
      ler('Supplier', 'name', 500, 'suppliers'),
      ler('FinancialAccount', 'name', 100, 'accounts'),
      ler('Vale', '-date', 1000, 'vales'),
      ler('EmployeePayment', '-payment_date', 1000, 'payments'),
    ]);

    if (requestId.current !== id) return; // resposta velha: descarta
    const vazio = !expenses.length && loadedOnce.current;
    const novo = { expenses, categories, centers, employees, suppliers, accounts, vales, payments };
    dataRef.current = novo;
    setData(novo);
    setFailure(vazio ? 'Não foi possível atualizar os gastos agora. Exibindo os últimos dados carregados.' : '');
    loadedOnce.current = true;
    setStatus('ready');
  }, []);

  // Recarrega SOMENTE as categorias: criar/reativar categoria não deve
  // derrubar a tela inteira (era o que travava o Gerenciador).
  const reloadCategories = useCallback(async () => {
    try {
      const categories = await base44.entities.ExpenseCategory.list('name', 300);
      if (!Array.isArray(categories)) return;
      const novo = { ...dataRef.current, categories };
      dataRef.current = novo;
      setData(novo);
    } catch {
      setFailure('A categoria foi salva, mas a lista não pôde ser atualizada.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <DailyExpensesPanel
    rows={data.expenses}
    loading={status === 'initial'}
    refreshing={status === 'refreshing'}
    failure={failure}
    data={data}
    onSaved={load}
    onCategoriesChanged={reloadCategories}
  />;
}
