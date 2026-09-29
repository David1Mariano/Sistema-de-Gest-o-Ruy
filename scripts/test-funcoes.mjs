// Testes da exclusão/desativação de Funções (JobRole).
//
// O botão "Excluir" faz DESATIVAÇÃO LÓGICA, porque a entity JobRole já tem
// `status` e a tela já tinha um `toggleStatus` pronto — é o padrão do projeto.
// Aqui testamos a REGRA (src/lib/roleUtils.js) e a presença do fluxo na tela.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  activeRoleOptions, employeesUsingRole, roleDeleteBlocker, roleDeletePatch, roleKey,
} from '../src/lib/roleUtils.js';

// Fixtures sintéticos. Nenhum dado real.
const roles = [
  { id: 'j1', name: 'Atendente', sector_name: 'Delivery', status: 'ativo' },
  { id: 'j2', name: 'Cozinheiro', sector_name: 'Produção', status: 'ativo' },
  { id: 'j3', name: 'Motorista', sector_name: 'Delivery', status: 'inativo' },
];
const employees = [
  { id: 'e1', name: 'Ana Prado', function: 'Atendente' },
  { id: 'e2', name: 'Bruno Alves', function: 'atendente ' },
  { id: 'e3', name: 'Carla Reis', function: 'Cozinheiro' },
  { id: 'e4', name: 'Diego Luz', function: 'Função Antiga' },
  { id: 'e5', name: 'Elena Vaz', function: '' },
];
const role = (nome) => roles.find((r) => r.name === nome);

test('FUN1 — função sem colaboradores PODE ser desativada', () => {
  assert.equal(roleDeleteBlocker(role('Cozinheiro'), []), null, 'sem nenhum colaborador, liberado');
  // Pessoas de OUTRAS funções não bloqueiam a exclusão desta.
  const outros = employees.filter((e) => !/cozinheiro/i.test(e.function || ''));
  assert.equal(roleDeleteBlocker(role('Cozinheiro'), outros), null, 'só o vínculo com ESTA função bloqueia');
});

test('FUN2 — função vinculada a colaborador é BLOQUEADA, com a quantidade', () => {
  const msg = roleDeleteBlocker(role('Atendente'), employees);
  assert.ok(msg, 'bloqueia');
  assert.match(msg, /2 colaborador/, 'informa a quantidade');
  assert.match(msg, /Realoque/, 'orienta o que fazer');
});

test('FUN3 — comparação ignora caixa/espaço, sem reescrever dado', () => {
  assert.equal(employeesUsingRole(employees, role('Atendente')).length, 2, '"Atendente" e "atendente " são a mesma');
  assert.equal(roleKey('Atendente'), roleKey('  atendente '));
  assert.equal(employees[1].function, 'atendente ', 'o valor salvo continua intacto');
});

test('FUN4 — desativar NÃO altera os colaboradores (sem cascata)', () => {
  const antes = employees.map((e) => ({ ...e }));
  roleDeleteBlocker(role('Atendente'), employees); // apenas consulta
  assert.deepEqual(employees, antes, 'nenhum colaborador foi tocado');
  assert.deepEqual(roleDeletePatch(role('Atendente')), { status: 'inativo' });
  assert.equal(employees[0].function, 'Atendente', 'vínculo permanece para o histórico');
});

test('FUN5 — exclusão é LÓGICA: alterna status, não apaga a linha', () => {
  assert.deepEqual(roleDeletePatch({ status: 'ativo' }), { status: 'inativo' });
  assert.deepEqual(roleDeletePatch({ status: 'inativo' }), { status: 'ativo' });
});

test('FUN6 — função desativada NÃO aparece para novo vínculo', () => {
  const nomes = activeRoleOptions(roles).map((r) => r.name);
  assert.deepEqual(nomes, ['Atendente', 'Cozinheiro']);
  assert.ok(!nomes.includes('Motorista'), 'inativa fora das opções');
});

test('FUN7 — função antiga no Employee NÃO recria opção (sem fantasma)', () => {
  const nomes = activeRoleOptions(roles).map((r) => r.name);
  assert.ok(!nomes.includes('Função Antiga'), 'não vira opção automática');
  assert.equal(employeesUsingRole(employees, 'Função Antiga').length, 1, 'o dado legado segue legível');
});

test('FUN8 — filtro por setor continua funcionando', () => {
  assert.deepEqual(activeRoleOptions(roles, { sector: 'Delivery' }).map((r) => r.name), ['Atendente']);
  assert.deepEqual(activeRoleOptions(roles, { sector: 'Produção' }).map((r) => r.name), ['Cozinheiro']);
  assert.equal(activeRoleOptions(roles, { sector: '' }).length, 2, 'sem filtro traz todas as ativas');
  assert.equal(activeRoleOptions([]).length, 0, 'lista vazia não quebra');
});

test('FUN9 — a tela tem botão Excluir, confirmação e auditoria', async () => {
  const fonte = await readFile(new URL('../src/pages/Funcoes.jsx', import.meta.url), 'utf8');
  // botão existe nas DUAS listas (por setor e "sem setor")
  assert.match(fonte, /Excluir função/, 'botão com rótulo acessível');
  assert.equal((fonte.match(/acaoExcluir\(r\)/g) || []).length, 2, 'presente nas duas listas');
  // confirmação antes de excluir
  assert.match(fonte, /Excluir função\?/, 'abre confirmação');
  assert.match(fonte, /Tem certeza que deseja excluir a função/, 'texto de confirmação');
  assert.match(fonte, /AlertDialogCancel[^>]*>Cancelar</, 'botão Cancelar');
  assert.match(fonte, /onClick=\{confirmRemove\}/, 'a exclusão está no botão de confirmar');
  assert.match(fonte, /if \(!removing \|\| blocker\) return;/, 'cancelar/fechar não executa nada');
  // bloqueio por vínculo
  assert.match(fonte, /roleDeleteBlocker/, 'usa a regra centralizada');
  assert.match(fonte, /disabled=\{removingBusy \|\| Boolean\(blocker\)\}/, 'Excluir desabilitado quando bloqueado');
  assert.ok(!fonte.includes('JobRole.delete'), 'NÃO há exclusão física');
  // auditoria
  assert.match(fonte, /entity_type: 'JobRole'/, 'auditoria na entity certa');
  assert.match(fonte, /action: 'exclusao_logica'/, 'ação de exclusão registrada');
  assert.match(fonte, /old_value: removing\.name/, 'nome da função na auditoria');
});

test('FUN10 — o EmployeeForm não injeta função legada como opção', async () => {
  const form = await readFile(new URL('../src/components/rh/EmployeeForm.jsx', import.meta.url), 'utf8');
  assert.ok(
    !/!roles\.some\(\(r\) => r\.name === form\.function\)/.test(form),
    'o fallback que criava função fantasma foi removido',
  );
  assert.match(form, /activeRoleOptions\(roles, \{ sector: form\.sector \}\)/, 'opções vêm da entity JobRole');
});

test('FUN11 — Setores não foi tocado por esta mudança', async () => {
  // Trava contra regressão: a correção de função não pode mexer na regra de
  // setor nem na tela detalhada de Setores.
  const employeeForm = await readFile(new URL('../src/components/rh/EmployeeForm.jsx', import.meta.url), 'utf8');
  assert.match(employeeForm, /activeSectorOptions\(sectors\)/, 'setor continua usando a regra própria');
  assert.match(employeeForm, /<option value="">Sem setor<\/option>/, 'opção Sem setor intacta');
  const setores = await readFile(new URL('../src/pages/Setores.jsx', import.meta.url), 'utf8');
  assert.match(setores, /Ver detalhes do setor/, 'tela de Setores intacta');
});

