// Exclusão DEFINITIVA de colaborador — a regra, a tela e o diálogo.
//
// A regra central está em `src/lib/employeeDelete.js` e é pura: recebe `entities`
// por parâmetro (mesmo padrão de `dailyExpenses.js`), então esta suíte roda com
// um store EM MEMÓRIA. Nenhum dado real, nenhum banco, nenhum colaborador real.
//
// O que está travado aqui:
//   - o caminho "Desligar" continua intacto (exclusão lógica + auditoria própria);
//   - qualquer vínculo com o Employee bloqueia a exclusão física;
//   - bloqueio não apaga NADA, nem o Employee nem as dependências;
//   - zero dependências => UM `Employee.delete`, e só um;
//   - a rechecagem final fecha a janela entre o pré-check e o clique;
//   - a auditoria não carrega CPF/RG/Pix/salário;
//   - as cores novas têm variante escura.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import {
  EMPLOYEE_DELETE_BLOCK_CODE, EMPLOYEE_DELETE_CONFIRM_WORD, EMPLOYEE_DELETE_RELATIONS,
  EmployeeDeleteBlockedError, checkEmployeeDependencies,
  confirmacaoExclusaoValida, deleteEmployeeIfUnused, employeeDependenciesMessage,
  employeeDeleteRelationsByEntity, podeConfirmarExclusao,
} from '../src/lib/employeeDelete.js';

const ler = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const tela = () => ler('src/pages/Funcionarios.jsx');
const dialogo = () => ler('src/components/rh/EmployeeDeleteDialog.jsx');
const servico = () => ler('src/lib/employeeDelete.js');
const folhaCss = () => ler('src/index.css');

// --- Banco em memória ------------------------------------------------------
// Reproduz a interface de `base44.entities.X` que o serviço usa: filter, get,
// list, create, update, delete, deleteMany. Todas as entidades declaradas nas
// relações existem MESMO sem registro: entity ausente não pode virar "zero
// dependências" por acidente.
const ENTIDADES = ['Employee', 'AuditLog', ...employeeDeleteRelationsByEntity().map((r) => r.entity)];

function criarBanco(seed = {}) {
  const linhas = new Map(ENTIDADES.map((n) => [n, []]));
  const chamadas = [];
  const falhas = { EmployeeDelete: null };
  let seq = 0;

  const entities = {};
  for (const nome of ENTIDADES) {
    entities[nome] = {
      async filter(query = {}, _sort, limit) {
        const achadas = linhas.get(nome).filter((r) => Object.entries(query).every(([k, v]) => r[k] === v));
        return limit ? achadas.slice(0, limit) : achadas;
      },
      async list() { return [...linhas.get(nome)]; },
      async get(id) { return linhas.get(nome).find((r) => r.id === id) || null; },
      async create(data) {
        chamadas.push({ op: 'create', entity: nome });
        const rec = { id: `id_${++seq}`, ...data };
        linhas.get(nome).push(rec);
        return rec;
      },
      async update(id, patch) {
        chamadas.push({ op: 'update', entity: nome, id });
        const atual = linhas.get(nome).find((r) => r.id === id);
        if (!atual) return null;
        Object.assign(atual, patch);
        return atual;
      },
      async delete(id) {
        if (nome === 'Employee' && falhas.EmployeeDelete) throw falhas.EmployeeDelete;
        chamadas.push({ op: 'delete', entity: nome, id });
        linhas.set(nome, linhas.get(nome).filter((r) => r.id !== id));
        return { id };
      },
      async deleteMany() {
        chamadas.push({ op: 'deleteMany', entity: nome });
        return { deleted: 0 };
      },
    };
  }

  const semear = (entity, registros = []) => {
    for (const r of registros) linhas.get(entity).push({ id: `seed_${++seq}`, ...r });
  };

  // O colaborador de exemplo (sempre presente) e o que vier no seed. Os dados
  // sensíveis existem aqui para provar que a auditoria NÃO os carrega.
  semear('Employee', [{
    id: 'colab_1', name: 'Ana Prado', function: 'Atendente', sector: 'Delivery', status: 'ativo',
    cpf: '123.456.789-00', rg: '12.345.678-9', bank: 'Banco X', pix_key: 'ana@pix', salary: 3200,
  }]);
  for (const [entity, registros] of Object.entries(seed)) semear(entity, registros);

  return {
    entities,
    semear,
    linhas,
    chamadas,
    falhas,
    colaborador: () => linhas.get('Employee').find((r) => r.id === 'colab_1'),
    vagas: () => linhas.get('Employee').length,
    destrucoes: () => chamadas.filter((c) => c.op === 'delete' || c.op === 'deleteMany'),
  };
}

// Aponta para o colaborador REAL do banco em memória, para que a auditoria
// receba o nome — igual à tela, que passa a linha que está na lista.
const deletar = (banco) => deleteEmployeeIfUnused({
  entities: banco.entities,
  employee: banco.colaborador(),
  employeeId: 'colab_1',
  operator: 'Teste',
  when: '2026-09-30T12:00:00.000Z',
});
// === 1 e 2: os dois botões, um ao lado do outro, com papéis distintos ======
test('1 — o botão Desligar continua sendo exclusão LÓGICA, sem nada físico', async () => {
  const src = await tela();
  assert.match(src, /const onDesligar = async \(e\) => \{/);
  assert.match(src, /if \(!confirm\(`Inativar o cadastro de \$\{e\.name\}\? \(exclusão lógica\)`\)\) return;/);
  assert.match(src, /base44\.entities\.Employee\.update\(e\.id, \{ status: 'desligado' \}\)/);
  assert.match(src, /action: 'exclusao_logica'/);
  assert.match(src, /title="Desligar"/);
  // O CORPO do desligamento, e não um trecho largo: o comentário que vem logo
  // depois menciona `Employee.delete` e não pode ser confundido com a ação.
  const corpo = src.slice(src.indexOf('const onDesligar'));
  const bloco = corpo.slice(0, corpo.indexOf('\n  };'));
  assert.equal(/Employee\.delete|\.deleteMany\(/.test(bloco), false, 'o desligamento não apaga nada');
});

test('2 — o botão Excluir é separado e destrutivo, com outro ícone e tooltip', async () => {
  const src = await tela();
  assert.match(src, /onClick=\{\(\) => setExcluindo\(e\)\}/, 'botão próprio abre o diálogo');
  assert.match(src, /title="Excluir definitivamente"/, 'tooltip de exclusão definitiva');
  assert.match(src, /<UserX className="w-4 h-4" \/>/, 'ícone distinto do Trash2 do Desligar');
  assert.match(src, /className="p-1\.5 rounded-md hover:bg-rose-100 text-red-600"/, 'cor destrutiva distinta');
  // As duas ações coexistem na linha.
  assert.match(src, /title="Desligar"[\s\S]{0,900}title="Excluir definitivamente"/);
});

// === 3, 4 e 7: o diálogo ====================================================
test('3 — clicar em Excluir abre o diálogo de confirmação', async () => {
  const src = await tela();
  assert.match(src, /const \[excluindo, setExcluindo\] = useState\(null\)/);
  assert.match(src, /<EmployeeDeleteDialog[\s\S]{0,200}open=\{Boolean\(excluindo\)\}/);
  assert.match(src, /onConfirm=\{confirmarExclusaoFisica\}/);
  const dlg = await dialogo();
  assert.match(dlg, /<AlertDialogTitle>Excluir definitivamente\?<\/AlertDialogTitle>/);
  assert.match(dlg, /não poderá ser desfeita/);
  assert.match(dlg, /Se houver qualquer registro vinculado, a exclusão será bloqueada/);
});

test('4 — o nome, a função e o status do colaborador aparecem no diálogo', async () => {
  const dlg = await dialogo();
  assert.match(dlg, /\{employee\.name\}/, 'nome do colaborador');
  assert.match(dlg, /\{employee\.function \|\| 'Sem função'\}/);
  assert.match(dlg, /EMPLOYEE_STATUS\[employee\?\.status\]/, 'status');
});

test('7 — cancelar não altera nada: só fecha e zera o estado', async () => {
  const src = await tela();
  assert.match(src, /onClose=\{\(\) => setExcluindo\(null\)\}/);
  const dlg = await dialogo();
  assert.match(dlg, /const fechar = \(\) => \{ if \(ocupado\) return; onClose\?\.\(\); \};/);
  assert.match(dlg, /onOpenChange=\{\(o\) => \{ if \(!o\) fechar\(\); \}\}/);
  assert.equal(/Employee\.delete|\.deleteMany\(/.test(dlg), false, 'o diálogo nunca escreve no banco');
});
// === 5 e 6: a confirmação digitada =========================================
test('5 — sem a palavra, o botão destrutivo fica desabilitado', async () => {
  assert.equal(confirmacaoExclusaoValida(''), false);
  assert.equal(confirmacaoExclusaoValida('excluir'), false, 'maiúsculas/minúsculas importam');
  assert.equal(confirmacaoExclusaoValida('EXCLUIR!'), false);
  assert.equal(podeConfirmarExclusao({ confirmacao: '' }), false);
  const dlg = await dialogo();
  assert.match(dlg, /disabled=\{!podeConfirmar\}/);
  assert.match(dlg, /Digite \{EMPLOYEE_DELETE_CONFIRM_WORD\} para confirmar/);
});

test('6 — a palavra exata libera o botão (e só ela)', () => {
  assert.equal(confirmacaoExclusaoValida(EMPLOYEE_DELETE_CONFIRM_WORD), true);
  assert.equal(confirmacaoExclusaoValida('  EXCLUIR  '), true, 'espaço nas pontas é tolerado');
  assert.equal(confirmacaoExclusaoValida('excluir'), false);
  assert.equal(confirmacaoExclusaoValida('EXCLUIR tudo'), false);
  assert.equal(podeConfirmarExclusao({ confirmacao: 'EXCLUIR' }), true);
});

// === 8 a 18: cada relação real bloqueia, uma a uma =========================
// Um teste por entidade declarada no mapa. Se alguém tirar uma entidade da
// lista, o teste correspondente cai — a cobertura É a própria lista.
const RELACOES = employeeDeleteRelationsByEntity();
for (const [i, relacao] of RELACOES.entries()) {
  test(`8.${i + 1} — ${relacao.entity} (${relacao.fields.join(' + ')}) bloqueia a exclusão`, async () => {
    for (const campo of relacao.fields) {
      const banco = criarBanco({ [relacao.entity]: [{ [campo]: 'colab_1', date: '2026-09-01' }] });
      const check = await checkEmployeeDependencies('colab_1', banco.entities);
      assert.equal(check.blocked, true, `${relacao.entity}.${campo} precisa bloquear`);
      assert.equal(check.dependencies[relacao.entity], 1);
      await assert.rejects(deletar(banco), (e) => e.code === EMPLOYEE_DELETE_BLOCK_CODE);
      assert.equal(banco.vagas(), 1, 'o Employee continua na base');
      assert.deepEqual(banco.destrucoes(), [], 'nada foi apagado');
    }
  });
}

// === 19: nenhuma relação pode passar BATIDA =================================
test('19a — toda entidade do mapa existe de verdade no cliente (nenhum nome errado)', async () => {
  // Um nome digitado errado aqui significaria "filtro em entity que não existe"
  // => zero dependências => exclusão liberada sem checagem nenhuma. É o pior
  // modo de falha possível, então tem teste.
  const cliente = await ler('src/api/base44Client.js');
  const existentes = new Set((cliente.match(/'[A-Za-z]+',/g) || []).map((m) => m.replace(/['\s,]/g, '')));
  const typos = [...new Set(EMPLOYEE_DELETE_RELATIONS.map((r) => r.entity))].filter((e) => !existentes.has(e));
  assert.deepEqual(typos, [], `nomes de entity inexistentes: ${typos.join(', ')}`);
});

test('19b — nenhuma entidade que grava employee_id/beneficiary_id fica de fora do mapa', async () => {
  const encontradas = new Set();
  const campos = /\b(employee_id|beneficiary_id|substitute_id)\s*:/;
  const criar = async (dir) => {
    for (const entrada of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      const caminho = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) { await criar(caminho); continue; }
      if (!/\.(js|jsx)$/.test(entrada.name)) continue;
      const fonte = await readFile(new URL(`../${caminho}`, import.meta.url), 'utf8');
      for (const m of fonte.matchAll(/entities\.([A-Za-z]+)\.(?:create|bulkCreate|update)\(/g)) {
        if (campos.test(fonte.slice(m.index, m.index + 400))) encontradas.add(m[1]);
      }
    }
  };
  await criar('src');
  const noMapa = new Set(EMPLOYEE_DELETE_RELATIONS.map((r) => r.entity));
  const faltando = [...encontradas].filter((e) => !noMapa.has(e));
  assert.deepEqual(faltando, [], `entidades vinculadas que NÃO bloqueiam: ${faltando.join(', ')}`);
});
test('19c — a lista de relações é a conferida no código, sem sobra e sem falta', async () => {
  const conferidas = [
    'Absence', 'Consumption', 'EmployeeDocument', 'EmployeePayment', 'Evaluation',
    'FinancialExpense', 'Schedule', 'StandardSchedule', 'TimeRecord', 'Vale', 'Warning',
  ];
  const noMapa = [...new Set(EMPLOYEE_DELETE_RELATIONS.map((r) => r.entity))].sort();
  assert.deepEqual(noMapa, [...conferidas].sort(), 'a lista de relações mudou em relação à auditoria');
  // DailyProduction e MachineRotation foram exigidas na lista original, mas no
  // código atual elas guardam só texto livre (`responsible`/`operator`) e NÃO
  // têm vínculo por id com o Employee. Entrá-las daria um falso positivo.
  assert.equal(noMapa.includes('DailyProduction'), false, 'DailyProduction não guarda employee_id');
  assert.equal(noMapa.includes('MachineRotation'), false, 'MachineRotation não guarda employee_id');
  const producao = await ler('src/components/producao/DailyProductionDialog.jsx');
  const rodizio = await ler('src/components/relatorios/MachineRotationDialog.jsx');
  assert.equal(/employee_id/.test(producao), false, 'DailyProduction sem employee_id no código');
  assert.equal(/employee_id/.test(rodizio), false, 'MachineRotation sem employee_id no código');
});

// === 20: bloqueio não apaga nada ===========================================
test('20 — com vínculo, NADA é apagado (nem o Employee, nem a dependência)', async () => {
  const banco = criarBanco({
    EmployeePayment: [{ employee_id: 'colab_1', net_amount: 100 }],
    Vale: [{ employee_id: 'colab_1', amount: 50 }],
    Warning: [{ employee_id: 'colab_1', category: 'atraso' }],
  });
  await assert.rejects(deletar(banco), EmployeeDeleteBlockedError);
  assert.deepEqual(banco.destrucoes(), [], 'zero operações destrutivas');
  assert.equal(banco.vagas(), 1, 'o colaborador continua listado');
  assert.equal(banco.linhas.get('EmployeePayment').length, 1, 'o pagamento continua');
  assert.equal(banco.linhas.get('Vale').length, 1, 'o vale continua');
  assert.equal(banco.linhas.get('Warning').length, 1, 'a advertência continua');
  assert.equal(banco.linhas.get('AuditLog').length, 0, 'nem chegou a auditar exclusão');
});

test('20b — o bloqueio devolve contagem por tipo, sem dado sensível', async () => {
  const banco = criarBanco({
    EmployeePayment: [{ employee_id: 'colab_1' }, { employee_id: 'colab_1' }],
    Vale: [{ employee_id: 'colab_1' }],
    Warning: [{ employee_id: 'colab_1' }],
  });
  const check = await checkEmployeeDependencies('colab_1', banco.entities);
  assert.deepEqual(check.dependencies, { EmployeePayment: 2, Vale: 1, Warning: 1 });
  assert.equal(check.total, 4);
  const msg = employeeDependenciesMessage(check);
  assert.match(msg, /não pode ser excluído definitivamente/);
  assert.match(msg, /pagamentos \(2\)/);
  assert.match(msg, /vales \(1\)/);
  assert.match(msg, /advertências \(1\)/);
  assert.equal(/123\.456|@pix|Banco X|salário/i.test(msg), false, 'sem dado sensível na mensagem');
});

test('20c — um gasto com employee_id E beneficiary_id conta uma vez só', async () => {
  const banco = criarBanco({
    FinancialExpense: [{ employee_id: 'colab_1', beneficiary_id: 'colab_1', amount: 20 }],
  });
  const check = await checkEmployeeDependencies('colab_1', banco.entities);
  assert.equal(check.dependencies.FinancialExpense, 1, 'é UM gasto, não dois');
  assert.equal(check.total, 1);
});

test('20d — vínculos de OUTRO colaborador não bloqueiam este', async () => {
  const banco = criarBanco({
    Vale: [{ employee_id: 'outro_colab' }],
    EmployeePayment: [{ employee_id: 'outro_colab' }],
  });
  const check = await checkEmployeeDependencies('colab_1', banco.entities);
  assert.equal(check.blocked, false);
  await deletar(banco);
  assert.equal(banco.vagas(), 0, 'exclusão liberada para quem não tem vínculo');
  assert.equal(banco.linhas.get('Vale').length, 1, 'o vale do outro continua intacto');
});
// === 21, 22 e 27: o caminho liberado ======================================
test('21 — zero dependências permite a exclusão física', async () => {
  const banco = criarBanco();
  const check = await checkEmployeeDependencies('colab_1', banco.entities);
  assert.equal(check.blocked, false);
  assert.deepEqual(check.dependencies, {});
  const r = await deletar(banco);
  assert.equal(r.deleted, true);
  assert.equal(banco.vagas(), 0, 'a linha saiu da base');
});

test('22 — Employee.delete acontece exatamente uma vez, e é a única escrita', async () => {
  const banco = criarBanco();
  await deletar(banco);
  const del = banco.chamadas.filter((c) => c.op === 'delete');
  assert.equal(del.length, 1, 'uma única chamada destrutiva');
  assert.deepEqual(del[0], { op: 'delete', entity: 'Employee', id: 'colab_1' });
  assert.equal(banco.chamadas.filter((c) => c.op === 'deleteMany').length, 0, 'nenhum deleteMany');
  const foraDoEmployee = banco.chamadas.filter((c) => (c.op === 'delete' || c.op === 'deleteMany') && c.entity !== 'Employee');
  assert.deepEqual(foraDoEmployee, [], 'nenhuma outra entity é apagada');
});

test('27 — no sucesso, o cadastro some da lista', async () => {
  const src = await tela();
  assert.match(src, /await deleteEmployeeIfUnused\(\{ entities: base44\.entities, employee: colaborador, operator: currentUserName\(\) \}\);/);
  // A remoção da lista acontece DEPOIS do await: se o serviço lançar, a linha fica.
  const ordem = src.indexOf('await deleteEmployeeIfUnused');
  assert.ok(ordem > 0 && ordem < src.indexOf('setEmployees((lista) => lista.filter'), 'remove só depois de confirmar');
  assert.match(src, /setEmployees\(\(lista\) => lista\.filter\(\(x\) => x\.id !== colaborador\.id\)\)/);
  assert.match(src, /setExcluindo\(null\)/, 'fecha o diálogo');
  assert.match(src, /toast\(\{ title: 'Colaborador excluído definitivamente\.' \}\)/);
  assert.match(src, /await load\(\);/, 'recarrega sem F5');
  const banco = criarBanco();
  await deletar(banco);
  assert.deepEqual(await banco.entities.Employee.list(), []);
});

// === 23 e 24: auditoria ====================================================
test('23 — o sucesso audita exclusao_fisica com id, nome, operador e carimbo', async () => {
  const banco = criarBanco();
  await deletar(banco);
  const logs = banco.linhas.get('AuditLog');
  assert.equal(logs.length, 1, 'um evento de auditoria');
  const log = logs[0];
  assert.equal(log.entity_type, 'Employee');
  assert.equal(log.entity_id, 'colab_1');
  assert.equal(log.action, 'exclusao_fisica');
  assert.equal(log.old_value, 'Ana Prado', 'nome do colaborador');
  assert.equal(log.responsible_user, 'Teste', 'operador');
  assert.equal(log.created_date, '2026-09-30T12:00:00.000Z', 'timestamp');
  assert.match(log.reason, /2026-09-30T12:00:00\.000Z/);
  assert.match(log.reason, /Nenhum registro vinculado foi apagado/);
});

test('24 — a auditoria NÃO carrega CPF, RG, banco, Pix nem salário', async () => {
  const banco = criarBanco();
  await deletar(banco);
  const bruto = JSON.stringify(banco.linhas.get('AuditLog'));
  for (const proibido of ['123.456.789-00', '12.345.678-9', 'Banco X', 'ana@pix', '3200']) {
    assert.equal(bruto.includes(proibido), false, `auditoria vazou ${proibido}`);
  }
  for (const chave of ['cpf', 'rg', 'bank', 'pix_key', 'salary']) {
    assert.equal(bruto.includes(`"${chave}"`), false, `auditoria tem a chave ${chave}`);
  }
  const src = await servico();
  const bloco = src.slice(src.indexOf('export async function auditEmployeePhysicalDelete'), src.indexOf('export async function deleteEmployeeIfUnused'));
  for (const campo of ['cpf', 'rg', 'bank', 'pix_key', 'salary']) {
    assert.equal(bloco.includes(campo), false, `o serviço de auditoria cita ${campo}`);
  }
});

test('24b — auditoria best-effort: falhar o log não desfaz a exclusão nem estoura', async () => {
  const banco = criarBanco();
  banco.entities.AuditLog.create = async () => { throw new Error('sem espaço'); };
  const r = await deletar(banco);
  assert.equal(r.deleted, true);
  assert.equal(banco.vagas(), 0, 'o Employee foi apagado mesmo sem auditoria');
});
// === 25: duplo clique ======================================================
test('25 — o duplo clique é bloqueado por estado, não por boa vontade', async () => {
  const dlg = await dialogo();
  assert.match(dlg, /const \[ocupado, setOcupado\] = useState\(false\)/);
  assert.match(dlg, /if \(!podeConfirmar\) return;/, 'segundo clique não sai');
  assert.match(dlg, /setOcupado\(true\);/, 'trava antes de chamar');
  assert.match(dlg, /\{ocupado \? 'Excluindo\.\.\.' : 'Excluir definitivamente'\}/);
  assert.match(dlg, /disabled=\{!podeConfirmar\}/);
  assert.match(dlg, /disabled=\{ocupado\}/, 'o campo também trava');
  // A regra em si: com uma operação no ar, o botão morre.
  assert.equal(podeConfirmarExclusao({ confirmacao: 'EXCLUIR', ocupado: true }), false);
  assert.equal(podeConfirmarExclusao({ confirmacao: 'EXCLUIR', verificando: true }), false);
  assert.equal(podeConfirmarExclusao({ confirmacao: 'EXCLUIR', bloqueado: true }), false);
  assert.equal(podeConfirmarExclusao({ confirmacao: 'EXCLUIR', erroVerificacao: 'falhou' }), false);
  assert.equal(podeConfirmarExclusao({ confirmacao: 'EXCLUIR' }), true);
});

// === 26: erro mantém o cadastro na lista ==================================
test('26 — se a escrita falhar, o cadastro continua e o erro aparece', async () => {
  const banco = criarBanco();
  banco.falhas.EmployeeDelete = new Error('Falha de rede ao excluir o colaborador.');
  await assert.rejects(deletar(banco), /Falha de rede/);
  assert.equal(banco.vagas(), 1, 'o Employee continua na base — nada de falso sucesso');
  assert.equal(banco.linhas.get('AuditLog').length, 0, 'não se audita exclusão que não aconteceu');
  const dlg = await dialogo();
  assert.match(dlg, /setErro\(e\?\.message \|\| 'Não foi possível excluir o colaborador\. Tente novamente\.'\)/);
  // E o Radix não fecha o diálogo no clique, senão o erro nunca apareceria.
  assert.match(dlg, /event\?\.preventDefault\?\.\(\);/);
  assert.match(dlg, /setOcupado\(false\);/, 'o botão é liberado para nova tentativa');
});

// === 28: rechecagem final (corrida) ========================================
test('28 — vínculo criado DEPOIS do pré-check bloqueia (a rechecagem final salva)', async () => {
  const banco = criarBanco();
  // O pré-check da tela: zero dependências, exclusão liberada na visão.
  const preCheck = await checkEmployeeDependencies('colab_1', banco.entities);
  assert.equal(preCheck.blocked, false, 'pré-check não viu nada');

  // Enquanto o usuário digita EXCLUIR, alguém registra um vale.
  banco.semear('Vale', [{ employee_id: 'colab_1', amount: 80 }]);

  // O serviço não confia no pré-check: relê antes de apagar.
  await assert.rejects(deletar(banco), (e) => e.code === EMPLOYEE_DELETE_BLOCK_CODE);
  assert.equal(banco.vagas(), 1, 'o Employee sobreviveu à corrida');
  assert.equal(banco.linhas.get('Vale').length, 1, 'e o vale também');
  assert.deepEqual(banco.destrucoes(), []);
});

test('28b — a rechecagem é o padrão do serviço, e vem antes do delete', async () => {
  const src = await servico();
  assert.match(src, /recheck = true/, 'a rechecagem é o padrão, não a exceção');
  const corpo = src.slice(src.indexOf('export async function deleteEmployeeIfUnused'));
  const iCheca = corpo.indexOf('await checkEmployeeDependencies');
  const iApaga = corpo.indexOf('await entities.Employee.delete(');
  assert.ok(iCheca > 0, 'a rechecagem existe na função de exclusão');
  assert.ok(iApaga > 0, 'a exclusão física existe na função de exclusão');
  assert.ok(iCheca < iApaga, 'o checamento vem ANTES do delete no código-fonte');
  // E a exclusão aparece uma única vez no arquivo inteiro: um segundo
  // Employee.delete seria uma segunda exclusão física sem rechecagem.
  assert.equal((src.match(/await entities\.Employee\.delete\(/g) || []).length, 1, 'um único delete no serviço');
});
// === 29: modo escuro =======================================================
test('29 — toda cor nova da exclusão tem variante escura (nada de hover branco)', async () => {
  const folha = (await folhaCss()).replace(/\/\*[\s\S]*?\*\//g, '');
  const variantes = /^(hover|focus|focus-visible|active|visited|selected|group-hover|group-focus|peer-focus|aria-selected):/;
  const classesDeCor = (fonte) => {
    const achadas = new Set();
    for (const m of fonte.matchAll(/\b((?:hover|focus|focus-visible|active|visited|selected|group-hover|group-focus|peer-focus|aria-selected):)?(?:bg|text|border)-[a-z]+-\d{2,3}(?:\/\d+)?\b/g)) {
      achadas.add(m[0]);
    }
    return [...achadas];
  };
  // A classe que o navegador vê é a classe INTEIRA, com o prefixo de variante:
  // `.dark .hover\:bg-red-700:hover`. O `:` e a `/` do nome precisam virar `\:`
  // e `\/` — sem o escape da BARRA INVERTIDA, o `:` viraria quantificador do
  // regex e a busca nunca casaria. Mesma técnica de `test-theme-inventario.mjs`.
  const coberto = (classe) => new RegExp(
    `\\.dark \\.${classe.replace(/\//g, '\\\\/').replace(/:/g, '\\\\:')}(?![\\w-])`,
  ).test(folha);

  for (const [nome, fonte] of [['EmployeeDeleteDialog.jsx', await dialogo()], ['Funcionarios.jsx', await tela()]]) {
    for (const classe of classesDeCor(fonte)) {
      if (!variantes.test(classe) && !/-(red|rose|amber|emerald|slate|sky|violet|orange|indigo|blue)-/.test(classe)) continue;
      assert.ok(coberto(classe), `${nome}: ${classe} escapa do remapeamento escuro`);
    }
  }
  // As cores destrutivas do novo fluxo, nominalmente.
  for (const classe of ['bg-red-50', 'text-red-700', 'border-red-200', 'bg-amber-50', 'text-amber-900', 'border-amber-200', 'bg-red-600', 'hover:bg-red-700', 'hover:bg-rose-100', 'text-red-600']) {
    assert.ok(coberto(classe), `${classe} sem variante escura`);
  }
  const dlg = await dialogo();
  // Comentários são removidos antes: o arquivo COMENTA por que não usa `bg-white`,
  // e uma busca ingenua acusaria o próprio comentário.
  const semComentarios = (fonte) => fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.equal(/bg-white/.test(semComentarios(dlg)), false, 'o diálogo não pinta branco');
  assert.equal(/backgroundColor\s*:/.test(semComentarios(dlg)), false, 'sem fundo inline');
  assert.equal(/background\s*:\s*['"]?white/.test(semComentarios(dlg)), false, 'sem branco no style');
});

// === Regressões de contrato ================================================
test('R1 — o desligamento continua funcionando (update, nada apagado)', async () => {
  const banco = criarBanco();
  await banco.entities.Employee.update('colab_1', { status: 'desligado' });
  assert.equal(banco.vagas(), 1, 'o cadastro continua na base');
  assert.equal((await banco.entities.Employee.get('colab_1')).status, 'desligado');
  assert.deepEqual(banco.destrucoes(), [], 'desligar nunca apaga');
});

test('R2 — exclusão não deixa nenhum vínculo órfão', async () => {
  const banco = criarBanco();
  await deletar(banco);
  const orfas = [];
  for (const [nome, linhas] of banco.linhas) {
    if (nome === 'Employee') continue;
    for (const l of linhas) {
      for (const campo of ['employee_id', 'beneficiary_id', 'substitute_id']) {
        if (l[campo] === 'colab_1') orfas.push(`${nome}.${campo}`);
      }
    }
  }
  assert.deepEqual(orfas, [], 'sobrou vínculo órfão apontando para o colaborador apagado');
});

test('R3 — entradas degeneradas não produzem sucesso falso', async () => {
  await assert.rejects(deleteEmployeeIfUnused({ entities: criarBanco().entities }), /não informado/);
  const semDelete = criarBanco();
  semDelete.entities.Employee.delete = undefined;
  await assert.rejects(deleteEmployeeIfUnused({ entities: semDelete.entities, employeeId: 'colab_1' }), /indisponível/);
  assert.equal(semDelete.vagas(), 1);
  // E um mapa sem as entities não vira "zero dependências" silencioso.
  const check = await checkEmployeeDependencies('colab_1', {});
  assert.equal(check.blocked, false);
  assert.equal(check.total, 0);
  assert.equal((await checkEmployeeDependencies('', criarBanco().entities)).total, 0);
});
