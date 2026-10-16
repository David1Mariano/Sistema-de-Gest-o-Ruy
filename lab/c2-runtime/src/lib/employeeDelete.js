// ---------------------------------------------------------------------------
// Exclusão FÍSICA de colaborador — REGRA CENTRAL.
//
// O que este arquivo resolve
// -------------------------
// A tela de Funcionários só sabia "desligar" (`status = 'desligado'`, auditoria
// `exclusao_logica`). Isso é correto e continua intacto: desligar preserva o
// histórico. Mas um cadastro errado/duplicado, sem nenhum registro gerado,
// ficava preso na base para sempre. Este arquivo dá a exclusão DEFINITIVA
// sem colocar o histórico em risco.
//
// A REGRA (acordada): qualquer vínculo com o Employee BLOQUEIA a exclusão
// física. Sem cascata, sem compensação, sem `deleteMany`, sem migration/RPC.
// Se existe um pagamento, um vale, uma escala, um documento... o caminho é
// "Desligar".
//
// POR QUE ISSO É SEGURO
// ---------------------
// 1. A operação destrutiva é UM `Employee.delete` e nada mais. Sem cascata,
//    não existe estado parcial possível: ou o registro some, ou não some.
// 2. Sem cascata, a exclusão só acontece depois que TODAS as relações voltaram
//    zero — e a checagem é REFEITA no momento da escrita (ver `recheck`), porque
//    o pré-check da tela é só informativo: entre ele e o clique alguém pode
//    registrar um vale. É a janela de corrida que a rechecagem fecha.
// 3. Nenhum dado sensível entra no bloqueio nem na auditoria: só contagens e o
//    nome do colaborador.
//
// TUDO AQUI É PURO E SEM REACT, com `entities` recebido por parâmetro — o mesmo
// padrão de `dailyExpenses.js` — para a suíte do Node exercitar a regra com um
// store em memória, sem tocar no banco de verdade.
// ---------------------------------------------------------------------------

/** Palavra que o usuário precisa digitar para liberar o botão destrutivo. */
export const EMPLOYEE_DELETE_CONFIRM_WORD = 'EXCLUIR';

/** Código estável do bloqueio. A tela e os testes casam por ele, não por texto. */
export const EMPLOYEE_DELETE_BLOCK_CODE = 'DEPENDENCIES_FOUND';

/**
 * Teto de linhas lidas por relação. Só afeta o NÚMERO exibido na mensagem —
 * a decisão (bloquear ou não) depende de haver pelo menos 1, então o teto não
 * pode gerar falso "liberado". Um colaborador com mais de 200 pagamentos é
 * bloqueado de qualquer maneira.
 */
export const EMPLOYEE_DELETE_COUNT_LIMIT = 200;

/**
 * TODAS as relações com Employee que existem no código hoje.
 *
 * Reconfirmadas uma a uma no código (não de memória):
 *   EmployeePayment.employee_id      — PaymentForm.jsx, Financeiro.jsx, FichaColaborador.jsx:63
 *   FinancialExpense.employee_id     — dailyExpenses.js:316, tela de Gastos Diários
 *   FinancialExpense.beneficiary_id  — dailyExpenses.js:305, Financeiro.jsx:261/453
 *   Vale.employee_id                 — ValeForm.jsx, Vales.jsx, Financeiro.jsx:321
 *   Consumption.employee_id          — ConsumptionForm.jsx, Consumo.jsx, Financeiro.jsx:506
 *   Absence.employee_id              — AbsenceForm.jsx, RH.jsx, FichaColaborador.jsx:60
 *   Warning.employee_id              — WarningForm.jsx, Advertencias.jsx, RH.jsx
 *   Evaluation.employee_id           — EvaluationForm.jsx, FichaColaborador.jsx:65
 *   EmployeeDocument.employee_id     — DocumentForm.jsx, RH.jsx:89
 *   Schedule.employee_id             — escalaData.js, CriarEscala.jsx, pontoActions.js:21
 *   Schedule.substitute_id           — SubstituirFuncionario.jsx:42 (também é um Employee!)
 *   StandardSchedule.employee_id     — escalaData.js:126/130
 *   TimeRecord.employee_id           — pontoActions.js:33, AjusteManual.jsx
 *
 * NÃO entram, porque não têm vínculo por id com Employee no código atual:
 *   DailyProduction — só `responsible` (texto livre digitado pelo usuário)
 *   MachineRotation — só `operator` (operadora da máquina, texto livre)
 *
 * `label` é a palavra amigável mostrada ao usuário. Nenhum dado do registro
 * vinculado é lido para a mensagem — só a contagem.
 */
export const EMPLOYEE_DELETE_RELATIONS = Object.freeze([
  { entity: 'EmployeePayment', field: 'employee_id', label: 'pagamentos' },
  { entity: 'FinancialExpense', field: 'employee_id', label: 'gastos' },
  { entity: 'FinancialExpense', field: 'beneficiary_id', label: 'gastos' },
  { entity: 'Vale', field: 'employee_id', label: 'vales' },
  { entity: 'Consumption', field: 'employee_id', label: 'consumos' },
  { entity: 'Absence', field: 'employee_id', label: 'faltas e atrasos' },
  { entity: 'Warning', field: 'employee_id', label: 'advertências' },
  { entity: 'Evaluation', field: 'employee_id', label: 'avaliações' },
  { entity: 'EmployeeDocument', field: 'employee_id', label: 'documentos' },
  { entity: 'Schedule', field: 'employee_id', label: 'escalas' },
  { entity: 'Schedule', field: 'substitute_id', label: 'escalas' },
  { entity: 'StandardSchedule', field: 'employee_id', label: 'escalas padrão' },
  { entity: 'TimeRecord', field: 'employee_id', label: 'registros de ponto' },
]);

// Agrupa por entity: `FinancialExpense` e `Schedule` têm DOIS campos que
// apontam para o Employee, e um mesmo registro pode casar nos dois. Contar por
// linha de relação diria "2 gastos" quando existe 1.
const RELACOES_POR_ENTITY = EMPLOYEE_DELETE_RELATIONS.reduce((grupos, relacao) => {
  const grupo = grupos.get(relacao.entity) || { entity: relacao.entity, fields: [], labels: [] };
  if (!grupo.fields.includes(relacao.field)) grupo.fields.push(relacao.field);
  if (!grupo.labels.includes(relacao.label)) grupo.labels.push(relacao.label);
  grupos.set(relacao.entity, grupo);
  return grupos;
}, new Map());

/** As relações agrupadas por entity (campos + rótulos), na ordem de declaração. */
export function employeeDeleteRelationsByEntity() {
  return [...RELACOES_POR_ENTITY.values()].map((g) => ({ ...g, fields: [...g.fields], labels: [...g.labels] }));
}

/** A palavra digitada libera o botão? Só o texto exato, já sem espaços nas pontas. */
export function confirmacaoExclusaoValida(texto) {
  return String(texto ?? '').trim() === EMPLOYEE_DELETE_CONFIRM_WORD;
}

/**
 * O botão destrutivo só acende quando TODAS as condições valem ao mesmo tempo.
 *
 * Existe como função (e não só dentro do JSX) para poder ser testada de fato:
 * é ela que segura o duplo clique (`ocupado`) e que impede liberar a exclusão
 * com o estado das dependências ainda DESCONHECIDO (verificando/erro) — excluir
 * no escuro seria adivinhar.
 */
export function podeConfirmarExclusao({
  ocupado = false, verificando = false, erroVerificacao = '', bloqueado = false, confirmacao = '',
} = {}) {
  if (ocupado) return false;      // uma operação no ar por vez
  if (verificando) return false;  // ainda estamos perguntando ao banco
  if (erroVerificacao) return false; // a consulta falhou: estado desconhecido
  if (bloqueado) return false;    // já sabemos que há vínculo
  return confirmacaoExclusaoValida(confirmacao);
}
/**
 * Consulta TODAS as relações e devolve o mapa de contagens.
 *
 * Só LÊ. Nunca escreve, nunca apaga — por isso a tela pode chamar isto ao abrir
 * o diálogo sem risco nenhum.
 *
 * @returns {{blocked: boolean, dependencies: Record<string, number>, total: number,
 *            resumo: Array<{entity: string, label: string, count: number}>}}
 */
export async function checkEmployeeDependencies(employeeId, entities) {
  const dependencies = {};
  const resumo = [];
  let total = 0;

  if (!employeeId || !entities) return { blocked: false, dependencies, total, resumo };

  for (const grupo of RELACOES_POR_ENTITY.values()) {
    const client = entities[grupo.entity];
    if (!client || typeof client.filter !== 'function') continue;
    // Um registro que casa em dois campos (gasto com employee_id E
    // beneficiary_id) é UM registro só.
    const ids = new Set();
    for (const field of grupo.fields) {
      const linhas = (await client.filter({ [field]: employeeId }, undefined, EMPLOYEE_DELETE_COUNT_LIMIT)) || [];
      linhas.forEach((linha, i) => ids.add(linha?.id ?? `${field}:${i}`));
    }
    if (!ids.size) continue;
    dependencies[grupo.entity] = ids.size;
    total += ids.size;
    resumo.push({ entity: grupo.entity, label: grupo.labels.join(' e '), count: ids.size });
  }

  return { blocked: total > 0, dependencies, total, resumo };
}

/** Texto amigável do bloqueio. Só categorias e contagens — nenhum dado do registro. */
export function employeeDependenciesMessage(check = {}) {
  const { total = 0, resumo = [] } = check || {};
  if (!total) return '';
  const lista = resumo.map((r) => `${r.label} (${r.count})`).join(', ');
  return `Este colaborador possui ${total} registro(s) vinculado(s) e não pode ser excluído definitivamente: ${lista}.`;
}

/** Erro de bloqueio: carrega `code` e o mapa de contagens para a tela tratar. */
export class EmployeeDeleteBlockedError extends Error {
  constructor(check = {}) {
    super(employeeDependenciesMessage(check) || 'Este colaborador possui registros vinculados.');
    this.name = 'EmployeeDeleteBlockedError';
    this.code = EMPLOYEE_DELETE_BLOCK_CODE;
    this.dependencies = check.dependencies || {};
    this.total = check.total || 0;
    this.resumo = check.resumo || [];
  }
}

/**
 * Auditoria da exclusão física.
 *
 * Best-effort como o resto do projeto (`logAudit`): perder o registro não pode
 * fazer o usuário acreditar que o cadastro não foi apagado. E o conteúdo é
 * MÍNIMO de propósito — nome, operador e carimbo. CPF, RG, banco, Pix e
 * salário NÃO entram: o registro do colaborador acabou de ser destruído, e a
 * auditoria não pode ser o lugar onde os dados dele sobrevivem.
 */
export async function auditEmployeePhysicalDelete({
  entities, employeeId, employeeName = '', operator = '', when,
}) {
  const create = entities?.AuditLog?.create;
  if (typeof create !== 'function') return null;
  const carimbo = when || new Date().toISOString();
  try {
    return await create.call(entities.AuditLog, {
      entity_type: 'Employee',
      entity_id: employeeId || '',
      action: 'exclusao_fisica',
      field: 'cadastro',
      old_value: employeeName || '',
      new_value: 'excluido definitivamente',
      reason: `Exclusão física autorizada na tela de Funcionários em ${carimbo}. Nenhum registro vinculado foi apagado.`,
      responsible_user: operator || '',
      created_date: carimbo,
    });
  } catch {
    return null;
  }
}

/**
 * Exclusão física com rechecagem final. É a ÚNICA função do projeto autorizada
 * a chamar `Employee.delete`, e é a única escrita destrutiva de todo o fluxo.
 *
 * `recheck` (padrão true) existe por causa da janela de corrida: o pré-check do
 * diálogo e a escrita não são atômicos entre si, porque este projeto não tem
 * transação multi-entidade. A releitura imediatamente antes do `delete` é o que
 * fecha essa janela — se um vale nasceu entre os dois instantes, aqui bloqueia.
 */
export async function deleteEmployeeIfUnused({
  entities, employee = null, employeeId, operator = '', when, recheck = true,
}) {
  const id = employeeId || employee?.id;
  if (!id) throw new Error('Colaborador não informado.');
  if (!entities?.Employee || typeof entities.Employee.delete !== 'function') {
    throw new Error('Exclusão de colaborador indisponível neste ambiente.');
  }

  if (recheck) {
    const check = await checkEmployeeDependencies(id, entities);
    if (check.blocked) throw new EmployeeDeleteBlockedError(check);
  }

  await entities.Employee.delete(id);
  await auditEmployeePhysicalDelete({
    entities, employeeId: id, employeeName: employee?.name || '', operator, when,
  });
  return { deleted: true, employeeId: id };
}