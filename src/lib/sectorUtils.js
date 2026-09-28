// Setores — derivação de dados da visão detalhada.
//
// TUDO aqui é DERIVADO do cadastro de colaboradores. Nenhuma contagem,
// lista ou resumo é persistido: a fonte da verdade continua sendo
// `Employee.sector` e `Employee.function`. Se um colaborador muda de setor, a
// próxima leitura já reflete a mudança, sem sincronizar nada.
//
// O vínculo setor<->colaborador é por NOME (`Employee.sector` guarda o texto do
// setor), padrão que já existia em `Setores.jsx`. Comparamos normalizado para
// que " Produção " e "produção" caiam no mesmo setor.
import { EMPLOYEE_STATUS } from './rhUtils.js';

// Sem acento, sem caixa, espaços colapsados. Usado só para COMPARAR — o valor
// exibido continua sendo o original, para não reescrever dado do usuário.
export function sectorKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Colaboradores de um setor. `employees` é a lista inteira; filtramos aqui.
export function employeesOfSector(employees = [], sector) {
  const alvo = sectorKey(sector?.name ?? sector);
  if (!alvo) return [];
  return (employees || []).filter((employee) => sectorKey(employee?.sector) === alvo);
}

// Status que o filtro da tela agrupa. O projeto tem 7 status reais
// (rhUtils.EMPLOYEE_STATUS); cada filtro abaixo é um CONJUNTO deles, e
// "desligado"/"inativo" nunca somem da lista: aparecem em Todos.
export const SECTOR_STATUS_FILTERS = {
  todos: null,
  ativos: ['ativo', 'em_experiencia'],
  afastados: ['afastado', 'ferias', 'folga'],
  desligados: ['desligado', 'inativo'],
};

export function employeeMatchesStatusFilter(status, filter) {
  const lista = SECTOR_STATUS_FILTERS[filter];
  if (!lista) return true;
  return lista.includes(status);
}

// Contadores derivados. Nenhum número é guardado no setor.
export function sectorEmployeeSummary(employees = []) {
  const base = { total: 0, ativos: 0, afastados: 0, desligados: 0, outros: 0 };
  for (const employee of employees || []) {
    base.total += 1;
    if (employeeMatchesStatusFilter(employee?.status, 'ativos')) base.ativos += 1;
    else if (employeeMatchesStatusFilter(employee?.status, 'afastados')) base.afastados += 1;
    else if (employeeMatchesStatusFilter(employee?.status, 'desligados')) base.desligados += 1;
    else base.outros += 1;
  }
  return base;
}

// Resumo das funções presentes no setor.
//
// Normaliza a CHAVE para agrupar "Cozinheiro" e "cozinheiro " no mesmo grupo,
// mas exibe o rótulo com a grafia mais frequente — o projeto grava a primeira
// variação que o usuário digitou.
export function sectorFunctionSummary(employees = []) {
  const grupos = new Map();
  for (const employee of employees || []) {
    const bruto = String(employee?.function ?? '').trim();
    const key = sectorKey(bruto);
    if (!key) continue; // sem função: não inventa linha
    const atual = grupos.get(key) || { nome: bruto, total: 0 };
    atual.total += 1;
    grupos.set(key, atual);
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

// Pesquisa por nome, nome social/apelido e função. Sem acento e sem caixa.
export function employeeMatchesSectorSearch(employee = {}, term) {
  const query = sectorKey(term);
  if (!query) return true;
  return sectorKey([employee.name, employee.social_name, employee.function].join(' ')).includes(query);
}

// Aplica busca + filtro de status. É a única fonte da tabela exibida.
export function filterSectorEmployees(employees = [], { search = '', statusFilter = 'todos' } = {}) {
  return (employees || []).filter((employee) => (
    employeeMatchesSectorSearch(employee, search)
    && employeeMatchesStatusFilter(employee?.status, statusFilter)
  ));
}

// ---------------------------------------------------------------------------
// SETORES FANTASMAS
//
// Existe um risco real aqui: `Employee.sector` guarda um TEXTO, e nada garante
// que esse texto ainda exista na entity `Sector`. Vários colaboradores carregam
// nomes de setores que foram apagados/renomeados na tela de Setores — são os
// "setores fantasmas".
//
// REGRA DEFINITIVA, aplicada em um único lugar:
//   - As OPÇÕES de setor vêm EXCLUSIVAMENTE da entity `Sector`, e só das
//     ATIVAS. `Employee.sector` NUNCA gera opção. Não recriamos Sector a partir
//     de valor legado e não mantemos lista fixa.
//   - O VÍNCULO atual do continua sendo `Employee.sector` (não migramos para id
//     nesta fase). Para saber ONDE a pessoa está, olhamos `Employee.sector`;
//     para saber quais setores EXISTEM, olhamos `Sector`. Os dois conceitos não
//     se misturam.
//
// Risco arquitetural documentado: o vínculo é textual. Renomear um setor não
// atualiza os colaboradores, e dois setores com nomes equivalentes podem
// receber as mesmas pessoas. Corrigir isso exige `sector_id` no Employee, o que
// é migração e fica para uma fase futura com autorização.

// "Sem setor": rótulo e valor do seletor. O valor é string vazia, que é o
// formato que o projeto já usava para "sem setor" (Employee.empty.sector = '').
export const SEM_SETOR_LABEL = 'Sem setor';
export const SEM_SETOR_VALUE = '';

// Opções de setor para o seletor. ÚNICA fonte: `Sector`, apenas ativos,
// deduplicados por nome equivalente e ordenados.
export function activeSectorOptions(sectors = []) {
  const seen = new Set();
  const out = [];
  for (const sector of sectors || []) {
    if (sector?.status !== 'ativo') continue; // desativado não é opção para novo vínculo
    const key = sectorKey(sector.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(sector);
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

// Estado do vínculo atual do colaborador frente à entity Sector.
//   'vazio'    -> sem setor (o padrão de "Sem setor")
//   'ok'       -> setor ativo e válido
//   'inativo'  -> o setor existe mas está desativado (não pode ser escolhido)
//   'fantasma' -> o texto não corresponde a nenhum Sector (dado legado)
export function resolveEmployeeSector(sectors = [], sector) {
  const nome = String(sector ?? '').trim();
  if (!nome) return { nome: '', estado: 'vazio' };
  const key = sectorKey(nome);
  const encontrado = (sectors || []).find((s) => sectorKey(s?.name) === key);
  if (!encontrado) return { nome, estado: 'fantasma' };
  if (encontrado.status !== 'ativo') return { nome, estado: 'inativo' };
  return { nome, estado: 'ok' };
}

// Mensagem do vínculo quando ele não é "ok". `null` quando está tudo certo.
export function sectorLinkWarning(sectors = [], sector) {
  const { nome, estado } = resolveEmployeeSector(sectors, sector);
  if (estado === 'fantasma') return `${nome} (setor não cadastrado)`;
  if (estado === 'inativo') return `${nome} (setor inativo)`;
  return null;
}

// Rótulo e estilo do status, reaproveitando os rótulos que o RH já usa.
export const employeeStatusLabel = (status) => EMPLOYEE_STATUS[status]?.label || status || '—';
export const employeeStatusStyle = (status) => EMPLOYEE_STATUS[status]?.style || 'bg-slate-100 text-slate-500 border-slate-200';

// Data de entrada já no formato brasileiro; vazio vira "—".
export function employeeAdmissionLabel(value) {
  if (!value) return '—';
  const data = new Date(value);
  if (Number.isNaN(data.getTime())) return String(value);
  return data.toLocaleDateString('pt-BR');
}

// Rótulo de exibição do nome: prefere o social quando existir, sem perder o
// nome completo (que continua disponível no title).
export const employeeDisplayName = (employee = {}) => (
  String(employee.social_name || '').trim() || String(employee.name || '').trim() || 'Sem nome'
);
