// ---------------------------------------------------------------------------
// Destinatários de pagamento — a ÚNICA regra de elegibilidade do sistema.
//
// Por que este arquivo existe
// --------------------------
// O RH já representa TODOS os tipos de contratação no MESMO `Employee`, pelo
// campo `hire_type` (ver HIRE_TYPE_LABELS em `rhUtils.js`): CLT, PJ, Diarista,
// Estágio, Autônomo, Outros. Não existe entidade "Freelancer" e não deve
// existir: freelancer/MEI/PJ é um `Employee` com `hire_type` preenchido.
//
// O problema real nunca foi exclusão — era falta de IDENTIFICAÇÃO. O seletor de
// pagamento mostrava apenas "nome · função", então um PJ e um CLT ficavam
// idênticos na lista, e o usuário concluía que freelancer "não entra".
//
// Decisões deliberadas
// --------------------
// - NÃO mapeamos `pj`/`autonomo` para um rótulo genérico "Freelancer": o dono
//   pediu o tipo REAL. O rótulo vem de HIRE_TYPE_LABELS, sem inventar.
// - O rótulo é SÓ apresentação. Nenhum valor persistido muda: quem salva é o
//   `EmployeePayment`, com o mesmo `employee_id` de sempre.
// - `diarista` é elegível, como qualquer contratação ativa.
// - A elegibilidade é a MESMA nos dois seletores (pagamento e gasto diário),
//   para os dois nunca divergirem de novo.
// ---------------------------------------------------------------------------
import { HIRE_TYPE_LABELS } from './rhUtils.js';

// Status que significam "esta pessoa ainda trabalha aqui".
// `inativo` é o único fora: foi o que já excluía alguém da lista, e continua.
// Qualquer status desconhecido (incluindo ausente) conta como ativo, para não
// sumir com gente por um status novo que ninguém mapeou.
const STATUS_INATIVO = 'inativo';

/**
 * A pessoa pode receber pagamento?
 *
 * Regra única, sem exceção escondida: tem `id` e não está inativa.
 * Não olha `hire_type` — CLT, PJ, Diarista e Autônomo pagam igual.
 */
export function isPayableEmployee(employee) {
  if (!employee || !employee.id) return false;
  return employee.status !== STATUS_INATIVO;
}

/** Lista de elegíveis, na ordem em que chegaram (a tela decide o sort). */
export function payableEmployees(employees = []) {
  return (employees || []).filter(isPayableEmployee);
}

/**
 * Rótulo do seletor: "Nome — PJ".
 *
 * Usa o tipo REAL de HIRE_TYPE_LABELS. `hire_type` desconhecido ou ausente não
 * é inventado: some do rótulo e sobra o nome + função, como antes.
 */
export function employeeOptionLabel(employee) {
  if (!employee) return '';
  const partes = [String(employee.name || '').trim()];
  const tipo = String(employee.hire_type || '').trim();
  if (tipo && HIRE_TYPE_LABELS[tipo]) partes.push(HIRE_TYPE_LABELS[tipo]);
  const funcao = String(employee.function || '').trim();
  if (funcao) partes.push(funcao);
  return partes.filter(Boolean).join(' — ');
}

/** Opções prontas para `<select>`/`<option>`, já filtradas. */
export function employeeSelectOptions(employees = []) {
  return payableEmployees(employees).map((employee) => [employee.id, employeeOptionLabel(employee)]);
}

/**
 * A pessoa escolhida, ou null.
 *
 * Usada para preencher `beneficiary_name` no gasto: o NOME puro vai para o
 * registro (é o que o histórico mostra), enquanto o rótulo do seletor — que
 * carrega o tipo de contratação — nunca é gravado.
 */
export function employeeById(employees = [], id) {
  if (!id) return null;
  return (employees || []).find((employee) => employee?.id === id) || null;
}
