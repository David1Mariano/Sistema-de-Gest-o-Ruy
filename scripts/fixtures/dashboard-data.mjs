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

// 5 advertências, 1 cancelada — o cenário exigido para a Direção.
// Status taken from the real model (WARNING_STATUS): pendente | tratada | cancelada.
export const warningsFive = [
  { id: 'f1', date: end, employee_id: 'a', status: 'pendente' },
  { id: 'f2', date: end, employee_id: 'b', status: 'pendente' },
  { id: 'f3', date: '2026-05-04', employee_id: 'a', status: 'tratada' },
  { id: 'f4', date: '2025-11-20', employee_id: 'b', status: 'tratada' },
  { id: 'f5', date: end, employee_id: 'c', status: 'cancelada' },
];

// Datas misturadas de propósito, para provar que a Direção NÃO é a mensal:
// mês atual, mês anterior, antiga e uma cancelada. As três válidas contam
// independentemente da data; a cancelada nunca conta na Direção.
export const warningsMultiMonth = [
  { id: 'm1', date: end, employee_id: 'a', status: 'pendente' },
  { id: 'm2', date: '2026-08-15', employee_id: 'b', status: 'tratada' },
  { id: 'm3', date: '2025-01-10', employee_id: 'c', status: 'tratada' },
  { id: 'm4', date: end, employee_id: 'c', status: 'cancelada' },
];
