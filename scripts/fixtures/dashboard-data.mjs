// Synthetic records only. Never imported by the app or written to a database.
export const start = '2026-09-01';
export const end = '2026-09-30';
export const expenses = [
  { id: 'e1', date: start, amount: 100, classification: 'despesa_operacional', category_name: 'Operação', status: 'pago', storage_path: 'fixture/proof.pdf' },
  { id: 'e2', date: end, amount: 200, classification: 'pagamento_colaborador', category_name: 'Pessoas', status: 'pago' },
  { id: 'e3', date: `${end}T23:59:59`, amount: 300, classification: 'compra_insumo', category_name: 'Insumos', status: 'pendente' },
  { id: 'e4', date: end, amount: 400, classification: 'adiantamento_colaborador', category_name: 'Pessoas', status: 'pago', proof_url: 'fixture.pdf' },
];
export const payments = [
  { id: 'p1', payment_date: end, payment_type: 'diaria_motoboy', net_amount: 80, status: 'pago', employee_id: 'a' },
  { id: 'p2', payment_date: end, payment_type: 'salario', net_amount: 200, status: 'pago', employee_id: 'b', financial_expense_id: 'e2' },
  { id: 'p3', work_date: start, payment_type: 'diaria_motoboy', net_amount: 20, status: 'pago', employee_id: 'b' },
];
export const vales = [{ id: 'v1', amount: 400, date: end, status: 'pendente', financial_expense_id: 'e4' }];
export const warnings = [
  { id: 'w1', date: start, employee_id: 'a', status: 'pendente' },
  { id: 'w2', date: end, employee_id: 'b', status: 'tratada' },
  { id: 'w3', date: '2026-08-31', employee_id: 'a', status: 'pendente' },
  { id: 'w4', date: end, employee_id: 'b', status: 'cancelada' },
];
