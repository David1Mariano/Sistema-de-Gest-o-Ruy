// Testes da visão detalhada de Setores.
//
// Exercitam a DERIVAÇÃO (src/lib/sectorUtils.js), onde mora toda a regra: quem
// pertence ao setor, contagem por status, resumo de funções e pesquisa. A página
// só consome essas funções, então testá-las cobre o comportamento sem navegador.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  SECTOR_STATUS_FILTERS, employeeAdmissionLabel, employeeDisplayName, employeeMatchesStatusFilter,
  employeeStatusLabel, employeesOfSector, filterSectorEmployees, sectorEmployeeSummary,
  sectorFunctionSummary, sectorKey,
} from '../src/lib/sectorUtils.js';

// Fixtures sintéticos. Nenhum dado real.
const setores = [
  { id: 's1', name: 'Produção', description: 'Preparo dos produtos', role_purpose: 'Garantir a produção', status: 'ativo' },
  { id: 's2', name: 'Delivery', description: 'Atendimento e montagem', role_purpose: 'Entregar pedidos', status: 'ativo' },
  { id: 's3', name: 'Administrativo', description: '', role_purpose: '', status: 'inativo' },
];

const colaboradores = [
  { id: 'e1', name: 'Maria Souza', social_name: 'Mari', sector: 'Produção', function: 'Produção de assados', status: 'ativo', admission_date: '2024-02-01' },
  { id: 'e2', name: 'Joao Lima', social_name: '', sector: 'Produção', function: 'Auxiliar', status: 'ativo', admission_date: '2024-05-10' },
  { id: 'e3', name: 'Carlos Dias', social_name: '', sector: 'Produção', function: 'Cozinheiro', status: 'afastado', admission_date: '' },
  { id: 'e4', name: 'Ana Prado', social_name: 'Aninha', sector: 'Delivery', function: 'Atendimento', status: 'ativo', admission_date: '2025-01-05' },
  { id: 'e5', name: 'Bruno Alves', social_name: '', sector: 'Delivery', function: 'Atendimento', status: 'desligado', admission_date: '2023-03-01' },
  { id: 'e6', name: 'Paula Reis', social_name: '', sector: '', function: '', status: 'ativo', admission_date: '' },
];

const setor = (nome) => setores.find((s) => s.name === nome);
const doSetor = (nome) => employeesOfSector(colaboradores, setor(nome));


test('S1 — abrir um setor entrega o registro correto', () => {
  const alvo = setor('Produção');
  assert.equal(alvo.id, 's1');
  assert.equal(alvo.name, 'Produção');
  assert.equal(alvo.description, 'Preparo dos produtos', 'descrição é exibida');
  assert.equal(alvo.role_purpose, 'Garantir a produção', 'função na empresa é exibida');
});

test('S2 — colaboradores do setor aparecem; de outro setor não', () => {
  const producao = doSetor('Produção');
  assert.equal(producao.length, 3);
  assert.deepEqual(producao.map((e) => e.id), ['e1', 'e2', 'e3']);
  assert.ok(!producao.some((e) => e.sector === 'Delivery'), 'nenhum de outro setor');
  assert.ok(!producao.some((e) => !e.sector), 'colaborador sem setor não entra');
});

test('S3 — comparação de setor ignora caixa e espaço', () => {
  assert.equal(sectorKey('Produção'), sectorKey('  producao '));
  assert.equal(employeesOfSector(colaboradores, { name: 'produção' }).length, 3, 'outra grafia encontra os mesmos');
});

test('S4 — contagem total e por status correta', () => {
  assert.deepEqual(sectorEmployeeSummary(doSetor('Produção')), { total: 3, ativos: 2, afastados: 1, desligados: 0, outros: 0 });
  const d = sectorEmployeeSummary(doSetor('Delivery'));
  assert.equal(d.total, 2);
  assert.equal(d.ativos, 1);
  assert.equal(d.desligados, 1, 'desligado continua contado');
});

test('S5 — função aparece e o resumo agrupa por função', () => {
  assert.equal(doSetor('Produção')[0].function, 'Produção de assados');
  // Todos com 1 pessoa: o desempate é alfabético, então a ordem é previsível.
  assert.deepEqual(sectorFunctionSummary(doSetor('Produção')).map((f) => f.nome), ['Auxiliar', 'Cozinheiro', 'Produção de assados']);

test('S7 — pesquisa por nome, apelido e função', () => {
  const producao = doSetor('Produção');
  assert.equal(filterSectorEmployees(producao, { search: 'maria' })[0].id, 'e1');
  assert.equal(filterSectorEmployees(producao, { search: 'mari' })[0].id, 'e1', 'apelido');
  assert.equal(filterSectorEmployees(producao, { search: 'cozinheiro' })[0].id, 'e3', 'função');
  assert.equal(filterSectorEmployees(producao, { search: 'joao' })[0].id, 'e2', 'sem acento');
  assert.equal(filterSectorEmployees(producao, { search: 'delivery' }).length, 0, 'não acha de outro setor');
  assert.equal(filterSectorEmployees(producao, { search: '   ' }).length, 3, 'busca vazia não filtra');
});

test('S8 — setor sem colaboradores não é erro', () => {
  const vazios = doSetor('Administrativo');
  assert.equal(vazios.length, 0);
  assert.equal(sectorEmployeeSummary(vazios).total, 0);
  assert.deepEqual(sectorFunctionSummary(vazios), []);
  assert.equal(filterSectorEmployees(vazios, { search: 'maria' }).length, 0);
});

test('S9 — trocar o setor do colaborador reflete na lista (fonte é Employee)', () => {
  assert.ok(doSetor('Produção').some((e) => e.id === 'e2'));
  const depois = colaboradores.map((e) => (e.id === 'e2' ? { ...e, sector: 'Delivery' } : e));
  assert.equal(employeesOfSector(depois, setor('Produção')).some((e) => e.id === 'e2'), false, 'saiu de Produção');
  assert.ok(employeesOfSector(depois, setor('Delivery')).some((e) => e.id === 'e2'), 'entrou em Delivery');
  assert.equal(doSetor('Produção').length, 3, 'a origem não foi mutada');
});

test('S10 — campo vazio não vira texto inventado', () => {
  assert.equal(employeesOfSector(colaboradores, { name: '' }).length, 0);
  assert.equal(sectorFunctionSummary([{ function: '' }, { function: '   ' }]).length, 0, 'sem função não gera linha');
  assert.equal(employeeAdmissionLabel(''), '—');
  assert.equal(employeeAdmissionLabel(null), '—');
  assert.equal(employeeDisplayName({}), 'Sem nome');
  assert.equal(employeeStatusLabel(''), '—');

test('S11 — colaborador desligado continua na lista e no filtro', () => {
  const delivery = doSetor('Delivery');
  assert.equal(delivery.length, 2, 'desligado não some do total');
  assert.equal(filterSectorEmployees(delivery, { search: 'bruno' })[0].id, 'e5', 'localizável pela busca');
  const porStatus = filterSectorEmployees(delivery, { statusFilter: 'desligados' });
  assert.equal(porStatus.length, 1);
  assert.equal(porStatus[0].id, 'e5');
});

test('S12 — filtro de status cobre os 7 status reais do RH', () => {
  assert.equal(SECTOR_STATUS_FILTERS.todos, null, '"Todos" não filtra');
  for (const status of ['ativo', 'em_experiencia', 'folga', 'ferias', 'afastado', 'desligado', 'inativo']) {
    assert.ok(employeeMatchesStatusFilter(status, 'todos'), `${status} aparece em Todos`);
  }
  assert.equal(employeeMatchesStatusFilter('ativo', 'ativos'), true);
  assert.equal(employeeMatchesStatusFilter('em_experiencia', 'ativos'), true);
  assert.equal(employeeMatchesStatusFilter('ferias', 'afastados'), true);
  assert.equal(employeeMatchesStatusFilter('inativo', 'desligados'), true);
  assert.equal(employeeMatchesStatusFilter('ativo', 'desligados'), false);
});

test('S13 — rótulos e preferências de exibição reaproveitam o padrão do RH', () => {
  assert.equal(employeeStatusLabel('ativo'), 'Ativo');
  assert.equal(employeeStatusLabel('afastado'), 'Afastado');
  assert.equal(employeeStatusLabel('desligado'), 'Desligado');
  assert.equal(employeeStatusLabel('em_experiencia'), 'Em experiência');
  assert.equal(employeeAdmissionLabel('2024-02-01').length, 10, 'data em formato brasileiro');
  assert.equal(employeeDisplayName({ social_name: 'Mari', name: 'Maria Souza' }), 'Mari', 'apelido tem preferência');
  assert.equal(employeeDisplayName({ name: 'Maria Souza' }), 'Maria Souza');
});

// 17 + 1: a página navega para a ficha existente e o card abre o detalhe
test('S14 — clique no colaborador usa a ficha existente; o card abre o detalhe', async () => {
  const fonte = await readFile(new URL('../src/pages/Setores.jsx', import.meta.url), 'utf8');
  assert.match(fonte, /navigate\(`\/funcionarios\/\$\{e\.id\}`\)/, 'navega para a ficha');
  assert.match(fonte, /setSelectedId\(s\.id\)/, 'clique do card abre o detalhe');
  assert.match(fonte, /Ver detalhes do setor/, 'indicação visual de card clicável');
  assert.match(fonte, /Voltar para os setores/, 'há como voltar para a lista');
  assert.ok(!fonte.includes('Employee.create'), 'não cria cadastro de colaborador');
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/funcionarios\/:id"/, 'a ficha já existe na rota');
});


// Setor ANTIGO: cadastrado antes de `role_purpose` existir no registro.
test('S16 — setor antigo sem role_purpose continua funcionando, sem texto inventado', async () => {
  const antigo = { id: 's9', name: 'Expedição', description: 'Envios do dia', status: 'ativo' };
  // 1) Não quebra: o registro segue utilizável e a lista de colaboradores existe.
  assert.equal(antigo.role_purpose, undefined, 'campo simplesmente ausente');
  assert.ok(antigo.description, 'description legado intacto');
  assert.equal(employeesOfSector(colaboradores, antigo).length, 0, 'setor sem ninguém não é erro');
  assert.equal(sectorEmployeeSummary(employeesOfSector(colaboradores, antigo)).total, 0);

  // 2) A tela mostra "Não informado" em vez de inventar descrição da função.
  const fonte = await readFile(new URL('../src/pages/Setores.jsx', import.meta.url), 'utf8');
  assert.match(fonte, /selected\.role_purpose \|\| 'Não informado'/, 'estado vazio é "Não informado"');
  assert.match(fonte, /selected\.description \|\| 'Não informado'/, 'description vazio também não inventa');

  // 3) O campo continua editável: o formulário carrega o valor anterior vazio.
  const form = await readFile(new URL('../src/components/rh/SectorForm.jsx', import.meta.url), 'utf8');
  assert.match(form, /\{\s*\.\.\.empty,\s*\.\.\.editing\s*\}/, 'ao editar, o registro existente é carregado');
  assert.match(form, /value=\{form\.role_purpose\}/, 'campo editável');

  // 4) Ao salvar, usa o MESMO fluxo de create/update já existente + auditoria.
  assert.match(form, /base44\.entities\.Sector\.update\(editing\.id, form\)/);
  assert.match(form, /base44\.entities\.Sector\.create\(form\)/);
  assert.match(form, /logAudit\(\{[\s\S]*entity_type: 'Sector'/, 'auditoria preservada');
  assert.match(form, /editing \? 'alteracao' : 'criacao'/, 'mesmas ações de auditoria');
});

test('S17 — role_purpose sobrevive ao fluxo de edição sem perder description', async () => {
  const form = await readFile(new URL('../src/components/rh/SectorForm.jsx', import.meta.url), 'utf8');
  const empty = form.match(/const empty = \{([^}]*)\}/)[1];
  assert.match(empty, /role_purpose/, 'campo novo no formulário vazio');
  assert.match(empty, /description/, 'campo antigo preservado no formulário vazio');
  // Nenhum campo redundante além de description + role_purpose.
  const campos = empty.split(',').map((p) => p.trim().split(':')[0].trim()).filter(Boolean);
  assert.deepEqual(campos.sort(), ['description', 'name', 'responsible_name', 'role_purpose', 'status']);
});


  assert.equal(employeeStatusLabel('status_novo'), 'status_novo', 'não oculta status novo');
});

  const delivery = sectorFunctionSummary(doSetor('Delivery'));
  assert.equal(delivery.length, 1, '"Atendimento" aparece uma vez');
  assert.equal(delivery[0].total, 2, 'duas pessoas com a mesma função');
});

test('S6 — resumo normaliza caixa/espaço e ordena por quantidade', () => {
  const resumo = sectorFunctionSummary([{ function: 'Cozinheiro' }, { function: ' cozinheiro ' }, { function: 'Auxiliar' }]);
  assert.equal(resumo.length, 2, 'variações viram um grupo só');
  assert.equal(resumo[0].nome, 'Cozinheiro');
  assert.equal(resumo[0].total, 2);
  assert.equal(resumo[1].nome, 'Auxiliar');
});
