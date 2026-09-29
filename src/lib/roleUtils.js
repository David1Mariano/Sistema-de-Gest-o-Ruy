// Funções (JobRole) — regras de exclusão e de listagem.
//
// A entity `JobRole` JÁ tem `status` ('ativo'/'inativo') e a tela de Funções já
// tinha um `toggleStatus` pronto. Ou seja: o padrão do projeto para "excluir" uma
// função é DESATIVAÇÃO LÓGICA, não exclusão física. Isso preserva o histórico
// e é coerente com o que Setores faz.
//
// Vínculo: `Employee.function` guarda o TEXTO do nome da função (o EmployeeForm
// salva `value={r.name}`). Portanto o vínculo é por NOME, igual ao setor. Não
// migramos para id aqui.
import { sectorKey } from './sectorUtils.js';

// Reexportado para as telas não precisarem lembrar de onde vem o normalizador.
export { sectorKey as roleKey };

// Opções de função para o seletor do colaborador. ÚNICA fonte: `JobRole`, apenas
// ATIVAS. `Employee.function` nunca gera opção — é o que evita a "função
// fantasma" quando alguém desativa uma função que já está em uso.
export function activeRoleOptions(roles = [], { sector = '' } = {}) {
  const alvo = sectorKey(sector);
  const seen = new Set();
  const out = [];
  for (const role of roles || []) {
    if (role?.status !== 'ativo') continue;
    // Mantém o mesmo filtro de setor que o EmployeeForm já usava.
    if (alvo && sectorKey(role.sector_name) !== alvo) continue;
    const key = sectorKey(role.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(role);
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

// Colaboradores que usam a função. Comparação normalizada (trim/caixa/acentos),
// mas NENHUM dado salvo é reescrito.
export function employeesUsingRole(employees = [], role) {
  const key = sectorKey(role?.name ?? role);
  if (!key) return [];
  return (employees || []).filter((employee) => sectorKey(employee?.function) === key);
}

// Bloqueio de exclusão/desativação: só o vínculo com colaboradores impede.
// Nenhum outro motivo bloqueia — e nada é alterado em cascata.
export function roleDeleteBlocker(role, employees = []) {
  if (!role?.id) return 'Função não encontrada.';
  const vinculados = employeesUsingRole(employees, role);
  if (vinculados.length) {
    return `Esta função está vinculada a ${vinculados.length} colaborador(es). `
      + 'Realoque esses colaboradores antes de desativar a função.';
  }
  return null;
}

// O que o botão "Excluir" realmente faz: DESATIVAÇÃO LÓGICA, reaproveitando o
// `status` que a entity já tem. Não apaga a linha, então o histórico continua.
export const roleDeletePatch = (role) => ({
  status: role?.status === 'ativo' ? 'inativo' : 'ativo',
});
