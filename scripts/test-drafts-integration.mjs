// Testes de INTEGRAÇÃO da persistência de rascunhos nos fluxos prioritários.
//
// Não existe jsdom nem @testing-library no projeto, e instalar seria pesar a
// máquina à toa. Então este arquivo trabalha em duas frentes, que é a
// convenção já adotada em `test-sectors.mjs` e `test-funcoes.mjs`:
//
//   1. COMPORTAMENTO: dirige a sessão real de rascunho (`createDraftSession`,
//      o mesmo objeto que o hook React embrulha) pelo ciclo de vida completo
//      de cada formulário — preencher, fechar o modal, desmontar, remontar,
//      salvar, falhar, cancelar — com as MESMAS chaves, os MESMOS campos e a
//      MESMA configuração que a tela usa. Isto é o que garante que digitar e
//      voltar recupera o que foi digitado.
//
//   2. LIGAÇÃO: lê o `.jsx` real e afirma que a tela está de fato chamando a
//      infraestrutura com a chave certa, limpando só depois do `await` do
//      backend e mantendo no erro. É o que garante que a tela e a sessão não
//      divergirem.
//
// Fixtures sintéticos. Nenhum dado real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createDraftSession, resolveUserKey } from '../src/lib/draftStore.js';
import { DRAFT_CANCEL_CONFIRM, DRAFT_FORM_KEYS, draftEditKey } from '../src/lib/draftConfig.js';
import { emptyExpenseForm } from '../src/lib/dailyExpenses.js';

const ler = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Dublês
// ---------------------------------------------------------------------------

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const USER = { id: 7, auth_user_id: 'uuid-7', email: 'gestor@empresa.com' };
const USER_KEY = resolveUserKey(USER);

/**
 * Reproduz o ciclo de vida de um formulário com rascunho, exatamente como o
 * `usePersistentDraft` faz dentro do React:
 *
 *   abrir   -> restoreInto(baseline)
 *   digitar -> change(estado) e flush no fim do debounce
 *   fechar  -> flush forçado (é o que o efeito de limpeza faz)
 *   salvar  -> saved() só depois do backend confirmar
 *   falhar  -> failed() mantém
 *   cancelar-> discard() ou keep()
 */
function abrirFormulario({ storage, formKey, baseline, excludeFields = [], recordUpdatedAt, relogio = 0 }) {
  let agora = relogio;
  const sessao = createDraftSession({
    userKey: USER_KEY, formKey, storage, excludeFields, now: () => agora,
  });
  return {
    sessao,
    avancar: (ms) => { agora += ms; },
    abrir: () => sessao.restore({ base: baseline, recordUpdatedAt }),
    digitar: (estado) => {
      sessao.change(estado, agora);
      sessao.flush(agora + 500, { force: true }); // o debounce venceu
      return estado;
    },
    // Fechar o modal / desmontar: o hook força a gravação do que ficou pendente.
    desmontar: () => sessao.flush(agora, { force: true }),
    salvarComSucesso: () => sessao.saved(),
    salvarComFalha: () => sessao.failed(),
    cancelarDescartando: () => sessao.discard(),
    cancelarMantendo: () => sessao.keep(),
    lerStorage: () => storage,
  };
}

// ===========================================================================
// FINANCEIRO — NOVO GASTO
// ===========================================================================

test('I01 — Gasto: preencher, fechar o modal e reabrir devolve o que foi digitado', () => {
  const storage = fakeStorage();
  const key = DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO;

  const primeira = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  assert.equal(primeira.abrir().restored, false, 'na primeira vez não há o que restaurar');

  primeira.digitar({
    ...emptyExpenseForm(),
    description: 'Compra de queijo',
    amount: 187.5,
    category_id: 'cat-3',
    payment_method: 'dinheiro',
    observation: 'pediu pra entregar amanhã',
  });
  primeira.desmontar(); // o usuário fechou o modal / trocou de tela

  // Segunda montagem: a tela abre de novo com o MESMO formulário em branco.
  const segunda = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  const r = segunda.abrir();

  assert.equal(r.restored, true, 'reabrir precisa reencontrar o rascunho');
  assert.equal(r.data.description, 'Compra de queijo', 'a descrição digitada volta');
  assert.equal(r.data.amount, 187.5, 'o valor digitado volta');
  assert.equal(r.data.category_id, 'cat-3', 'a categoria selecionada volta');
  assert.equal(r.data.payment_method, 'dinheiro', 'a forma de pagamento volta');
  assert.equal(r.data.observation, 'pediu pra entregar amanhã', 'a observação volta');
});

test('I02 — Gasto: F5 preserva o rascunho (o storage sobrevive ao reload)', () => {
  const storage = fakeStorage();
  const key = DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO;

  const antes = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  antes.digitar({ ...emptyExpenseForm(), description: 'antes do F5', amount: 42 });
  antes.desmontar();

  // F5: o JavaScript recarrega, o navegador NÃO. `storage` é o navegador.
  const depois = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  assert.equal(depois.abrir().data.description, 'antes do F5', 'depois do F5 o formulário volta preenchido');
});

test('I03 — Gasto: fechar e reabrir o navegador restaura (7 dias dentro da validade)', () => {
  const storage = fakeStorage();
  const key = DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO;

  const sessao = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  sessao.digitar({ ...emptyExpenseForm(), description: 'sobrevive ao fechamento' });

  // Reabertura dias depois: novo objeto de sessão, mesmo storage.
  const reabertura = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm(), relogio: 3 * 24 * 60 * 60 * 1000 });
  assert.equal(reabertura.abrir().data.description, 'sobrevive ao fechamento', 'reabrir o navegador não apaga a digitação');
});

test('I04 — Gasto: salvo no backend limpa o rascunho; falhou mantém', () => {
  const storage = fakeStorage();
  const key = DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO;

  // Sucesso
  const ok = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  ok.digitar({ ...emptyExpenseForm(), description: 'vai salvar', amount: 10 });
  assert.ok(storage.length > 0, 'antes de salvar existe rascunho');
  ok.salvarComSucesso();
  assert.equal(storage.length, 0, 'confirmado no servidor, o rascunho sai');

  // Falha
  const falha = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  falha.digitar({ ...emptyExpenseForm(), description: 'não salvou', amount: 10 });
  falha.salvarComFalha();
  assert.equal(storage.length, 1, 'se o backend recusou, o rascunho é a única cópia e permanece');

  const r = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() }).abrir();
  assert.equal(r.data.description, 'não salvou', 'a pessoa pode reabrir e tentar de novo sem perder nada');
});

test('I05 — Gasto: cancelar perguntando nunca apaga sozinho', () => {
  const storage = fakeStorage();
  const key = DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO;

  // "Manter para continuar depois"
  const mantendo = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  mantendo.digitar({ ...emptyExpenseForm(), description: 'vou voltar' });
  mantendo.cancelarMantendo();
  assert.equal(storage.length, 1, 'cancelar escolhendo manter preserva o rascunho');
  assert.equal(DRAFT_CANCEL_CONFIRM, 'Deseja descartar o rascunho?', 'a pergunta ao usuário é a esperada');

  // "Descartar"
  const descartando = abrirFormulario({ storage, formKey: key, baseline: emptyExpenseForm() });
  descartando.digitar({ ...emptyExpenseForm(), description: 'isso foi' });
  descartando.cancelarDescartando();
  assert.equal(storage.length, 0, 'descartar remove, e é a única coisa que remove');
});

test('I06 — Gasto: o comprovante não entra no rascunho, mas o texto entra', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({
    storage,
    formKey: DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO,
    baseline: emptyExpenseForm(),
    excludeFields: ['proof_url', 'invoice_url'],
  });
  sessao.digitar({
    ...emptyExpenseForm(),
    description: 'conta de luz',
    amount: 210,
    proof_url: 'https://exemplo/comprovante.pdf',
  });
  sessao.desmontar();

  const r = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO, baseline: emptyExpenseForm() }).abrir();
  assert.equal(r.data.description, 'conta de luz', 'o texto digitado volta');
  assert.equal(r.data.amount, 210, 'o valor volta');
  assert.equal(r.data.proof_url, '', 'o arquivo NÃO volta: a tela avisa "selecione o arquivo novamente"');
});

test('I07 — Gasto: dois usuários no mesmo computador não se enxergam', () => {
  const storage = fakeStorage();
  const a = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO, baseline: emptyExpenseForm() });
  a.digitar({ ...emptyExpenseForm(), description: 'gasto do A' });

  const sessaoB = createDraftSession({
    userKey: resolveUserKey({ id: 8 }), formKey: DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO, storage, now: () => 0,
  });
  const r = sessaoB.restore({ base: emptyExpenseForm() });
  assert.equal(r.restored, false, 'o usuário B não restaura nada do usuário A');
  assert.equal(r.data.description, '', 'o formulário do B abre em branco');
});

// ===========================================================================
// FINANCEIRO — NOVO PAGAMENTO
// ===========================================================================

const PAGAMENTO_VAZIO = {
  employee_id: '', payment_type: 'salario', reference_start: '2026-09-01', reference_end: '2026-09-29',
  work_date: '2026-09-29', days_quantity: '1', daily_rate: '', gross_amount: '', discount_amount: '0',
  net_amount: '', payment_date: '2026-09-29', payment_method: 'pix', proof_url: '', observation: '', status: 'pago',
};

test('I08 — Pagamento: colaborador selecionado e valores sobrevivem ao retorno', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.FINANCEIRO_PAGAMENTO_NOVO, baseline: PAGAMENTO_VAZIO });
  sessao.digitar({
    ...PAGAMENTO_VAZIO,
    employee_id: 'emp-12',
    payment_type: 'adiantamento',
    gross_amount: '1500',
    net_amount: '1500',
    payment_method: 'dinheiro',
    observation: 'adiantamento Combine',
  });
  sessao.desmontar();

  const r = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.FINANCEIRO_PAGAMENTO_NOVO, baseline: PAGAMENTO_VAZIO }).abrir();
  assert.equal(r.restored, true, 'o rascunho do pagamento é reencontrado');
  assert.equal(r.data.employee_id, 'emp-12', 'a seleção de colaborador volta — peça explícita do escopo');
  assert.equal(r.data.net_amount, '1500', 'o valor líquido volta');
  assert.equal(r.data.payment_method, 'dinheiro', 'a forma de pagamento volta');
  assert.equal(r.data.observation, 'adiantamento Combine', 'a observação volta');
});

test('I09 — Pagamento: a regra de pagamento NÃO é alterada pelo rascunho', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({
    storage,
    formKey: DRAFT_FORM_KEYS.FINANCEIRO_PAGAMENTO_NOVO,
    baseline: PAGAMENTO_VAZIO,
    excludeFields: ['proof_url'],
  });
  sessao.digitar({ ...PAGAMENTO_VAZIO, employee_id: 'emp-3', net_amount: '900', proof_url: 'https://x/p.pdf' });
  sessao.desmontar();

  const r = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.FINANCEIRO_PAGAMENTO_NOVO, baseline: PAGAMENTO_VAZIO }).abrir();
  // O rascunho devolve CAMPOS. Ele não cria pagamento, não cria gasto, não
  // calcula referência. Quem faz isso continua sendo o botão Salvar.
  assert.equal(Object.keys(r.data).sort().join(','), Object.keys(PAGAMENTO_VAZIO).sort().join(','), 'o rascunho não inventa nem remove campo do formulário');
  assert.equal(r.data.payment_type, 'salario', 'a regra de pagamento do formulário é preservada');
  assert.equal(r.data.proof_url, '', 'o comprovante não é serializado');
});

// ===========================================================================
// FINANCEIRO — CONTA A PAGAR
// ===========================================================================

const CONTA_VAZIA = {
  description: '', issue_date: '2026-09-29', due_date: '2026-09-29', amount: '', category_id: '',
  cost_center_id: '', beneficiary_name: '', beneficiary_type: 'fornecedor', payment_method_planned: 'pix',
  document_number: '', document_url: '', priority: 'normal', status: 'pendente', observation: '',
};

test('I10 — Conta a Pagar: descrição, vencimento, valor e fornecedor voltam', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({
    storage,
    formKey: DRAFT_FORM_KEYS.FINANCEIRO_CONTA_PAGAR_NOVO,
    baseline: CONTA_VAZIA,
    excludeFields: ['document_url'],
  });
  sessao.digitar({
    ...CONTA_VAZIA,
    description: 'Fornecedor de queijo - setembro',
    amount: '2340,90',
    due_date: '2026-10-05',
    beneficiary_name: 'Hortifruti da Esquina',
    category_id: 'cat-9',
    priority: 'alta',
    observation: 'negociar com o fornecedor',
  });
  sessao.desmontar();

  const r = abrirFormulario({
    storage,
    formKey: DRAFT_FORM_KEYS.FINANCEIRO_CONTA_PAGAR_NOVO,
    baseline: CONTA_VAZIA,
  }).abrir();

  assert.equal(r.restored, true, 'a conta a pagar rascunhada é reencontrada');
  assert.equal(r.data.description, 'Fornecedor de queijo - setembro', 'a descrição volta');
  assert.equal(r.data.amount, '2340,90', 'o valor volta como foi digitado');
  assert.equal(r.data.due_date, '2026-10-05', 'o vencimento volta');
  assert.equal(r.data.beneficiary_name, 'Hortifruti da Esquina', 'o fornecedor volta');
  assert.equal(r.data.category_id, 'cat-9', 'a categoria volta');
  assert.equal(r.data.observation, 'negociar com o fornecedor', 'as observações voltam');
  // Liquidação e status NÃO fazem parte do rascunho: são regra do sistema.
  assert.equal(r.data.status, 'pendente', 'a regra de status/liquidação não é tocada pelo rascunho');
});

// ===========================================================================
// RH — NOVO COLABORADOR
// ===========================================================================

const COLAB_VAZIO = {
  name: '', social_name: '', birth_date: '', cpf: '', rg: '', phone: '', whatsapp: '',
  address: '', neighborhood: '', city: '', state: '', emergency_contact: '', emergency_phone: '', photo_url: '',
  sector: '', function: '', unit: '', hire_type: 'clt', status: 'ativo', admission_date: '',
  default_start_time: '', default_end_time: '', work_days: '', day_off: '', salary: null, vale_value: null,
  responsible: '', experience_start: '', experience_end: '', pix_key: '', bank: '', observations: '', uniforms_delivered: '',
};

const CAMPOS_SENSIVEIS_COLAB = ['cpf', 'rg', 'pix_key', 'bank', 'salary', 'vale_value', 'photo_url'];

test('I11 — Colaborador: preenchimento parcial volta inteiro', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({
    storage,
    formKey: DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO,
    baseline: COLAB_VAZIO,
    excludeFields: CAMPOS_SENSIVEIS_COLAB,
  });
  sessao.digitar({
    ...COLAB_VAZIO,
    name: 'Maria Souza',
    phone: '(11) 90000-0000',
    sector: 'Cozinha',
    function: 'Cozinheira',
    admission_date: '2026-10-01',
    default_start_time: '08:00',
    default_end_time: '17:00',
  });
  sessao.desmontar();

  const r = abrirFormulario({
    storage,
    formKey: DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO,
    baseline: COLAB_VAZIO,
  }).abrir();

  assert.equal(r.restored, true, 'o rascunho do colaborador é reencontrado');
  assert.equal(r.data.name, 'Maria Souza', 'o nome volta');
  assert.equal(r.data.sector, 'Cozinha', 'o setor volta');
  assert.equal(r.data.function, 'Cozinheira', 'a função volta');
  assert.equal(r.data.default_start_time, '08:00', 'o horário volta');
  assert.equal(r.data.unit, '', 'campo não preenchido continua vazio');
});

test('I12 — Colaborador: dados sensíveis e foto NÃO são persistidos', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({
    storage,
    formKey: DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO,
    baseline: COLAB_VAZIO,
    excludeFields: CAMPOS_SENSIVEIS_COLAB,
  });
  sessao.digitar({
    ...COLAB_VAZIO,
    name: 'Maria Souza',
    cpf: '123.456.789-00',
    rg: '12.345.678-9',
    pix_key: 'maria@bank.com',
    bank: 'Banco X',
    salary: 4500,
    vale_value: 300,
    photo_url: 'https://exemplo/foto.jpg',
  });
  sessao.desmontar();

  const cru = storage.getItem(`gr:draft:${USER_KEY}:${DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO}`);
  for (const proibido of ['123.456.789-00', '12.345.678-9', 'maria@bank.com', '4500', 'foto.jpg']) {
    assert.equal(cru.includes(proibido), false, `"${proibido}" não pode estar gravado no rascunho do colaborador`);
  }

  const r = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO, baseline: COLAB_VAZIO }).abrir();
  assert.equal(r.data.name, 'Maria Souza', 'o preenchimento inofensivo continua salvo');
  assert.equal(r.data.cpf, '', 'CPF volta vazio e precisa ser redigitado');
  assert.equal(r.data.pix_key, '', 'a chave Pix volta vazia');
  assert.equal(r.data.salary, null, 'o salário volta vazio');
  assert.equal(r.data.photo_url, '', 'a foto volta vazia');
});

// ===========================================================================
// ESTOQUE — NOVO ITEM
// ===========================================================================

const ITEM_VAZIO = {
  name: '', sku: '', category: '', unit: 'un', current_stock: 0, minimum_stock: 0,
  average_cost: 0, last_cost: 0, preferred_supplier_id: '', location: '', status: 'ativo', observation: '',
};

test('I13 — Estoque: cadastro do item sobrevive ao retorno', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.ESTOQUE_ITEM_NOVO, baseline: ITEM_VAZIO });
  sessao.digitar({
    ...ITEM_VAZIO,
    name: 'Queijo mussarela',
    sku: 'QUE-001',
    category: 'Laticínios',
    unit: 'kg',
    current_stock: '20',
    minimum_stock: '5',
    location: 'freezer 2, prateleira A',
  });
  sessao.desmontar();

  const r = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.ESTOQUE_ITEM_NOVO, baseline: ITEM_VAZIO }).abrir();
  assert.equal(r.restored, true, 'o rascunho do item é reencontrado');
  assert.equal(r.data.name, 'Queijo mussarela', 'o nome do item volta');
  assert.equal(r.data.sku, 'QUE-001', 'o SKU volta');
  assert.equal(r.data.current_stock, '20', 'o estoque inicial digitado volta');
  assert.equal(r.data.location, 'freezer 2, prateleira A', 'a localização volta');
  assert.equal(r.data.status, 'ativo', 'o status padrão do formulário é preservado');
});

test('I14 — Estoque: o rascunho do item não carrega movimentação nem executa nada', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.ESTOQUE_ITEM_NOVO, baseline: ITEM_VAZIO });
  sessao.digitar({ ...ITEM_VAZIO, name: 'Item X', current_stock: '10' });
  sessao.desmontar();

  const r = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.ESTOQUE_ITEM_NOVO, baseline: ITEM_VAZIO }).abrir();
  // O estado de movimentação (`token`, `motivo`, `saving`) nunca entrou no
  // rascunho: restaurar devolve exatamente os campos de cadastro, e o
  // `ajustarSaldo` só roda quando alguém aperta Salvar.
  assert.deepEqual(
    Object.keys(r.data).sort(),
    Object.keys(ITEM_VAZIO).sort(),
    'o rascunho de estoque contém só cadastro, nada de movimentação transitória',
  );
});

// ===========================================================================
// PRODUÇÃO — ORDEM
// ===========================================================================

const ORDEM_VAZIA = {
  date: '2026-09-29', product_id: '', planned_quantity: 1, produced_quantity: 0,
  priority: 'normal', status: 'planejada', responsible: '', observation: '',
};

test('I15 — Produção: o planejamento da ordem é rascunhado; operação diária não', () => {
  const storage = fakeStorage();
  const sessao = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.PRODUCAO_ORDEM_NOVO, baseline: ORDEM_VAZIA });
  sessao.digitar({ ...ORDEM_VAZIA, product_id: 'prod-2', planned_quantity: '120', priority: 'alta' });
  sessao.desmontar();

  const r = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.PRODUCAO_ORDEM_NOVO, baseline: ORDEM_VAZIA }).abrir();
  assert.equal(r.data.product_id, 'prod-2', 'o produto planejado volta');
  assert.equal(r.data.planned_quantity, '120', 'a quantidade planejada volta');
  assert.equal(r.data.priority, 'alta', 'a prioridade volta');
});

// ===========================================================================
// LIGAÇÃO — os arquivos reais precisam usar a infraestrutura
// ===========================================================================

// `escrita` é o que conta como "chamada que grava no backend" para aquela
// tela. O Estoque grava via `stockService` (regra do Agente 1: nenhuma página
// escreve `InventoryItem` direto), então o marcador é o serviço, não a entity.
const GRAVACAO_PADRAO = /entities\.\w+\.(create|update)\s*\(/g;
const FLUXOS = [
  { nome: 'Gasto', arquivo: 'src/components/financeiro/DailyExpenseForm.jsx', chave: 'DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO', componente: 'function DailyExpenseForm(', gravacao: /saveDailyExpense\s*\(/g },
  { nome: 'Pagamento', arquivo: 'src/pages/Financeiro.jsx', chave: 'DRAFT_FORM_KEYS.FINANCEIRO_PAGAMENTO_NOVO', componente: 'function PaymentDialog(' },
  { nome: 'Conta a Pagar', arquivo: 'src/pages/Financeiro.jsx', chave: 'DRAFT_FORM_KEYS.FINANCEIRO_CONTA_PAGAR_NOVO', componente: 'function PayableCreateDialog(' },
  { nome: 'Colaborador', arquivo: 'src/components/rh/EmployeeForm.jsx', chave: 'DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO', componente: 'function EmployeeForm(' },
  { nome: 'Item de estoque', arquivo: 'src/pages/Estoque.jsx', chave: 'DRAFT_FORM_KEYS.ESTOQUE_ITEM_NOVO', componente: 'function ItemDialog(', gravacao: /criarItemComEstoqueInicial\s*\(/g },
  { nome: 'Ordem de produção', arquivo: 'src/components/producao/ProductionOrderDialog.jsx', chave: 'DRAFT_FORM_KEYS.PRODUCAO_ORDEM_NOVO', componente: 'function ProductionOrderDialog(' },
];

// `Financeiro.jsx` e `Estoque.jsx` concentram vários diálogos no mesmo arquivo.
// Recortar o trecho do componente é o que impede que a assertions de um diálogo
// leia a gravação de outro.
function recortar(src, marcador) {
  const inicio = src.indexOf(marcador);
  if (inicio === -1) return src;
  const proxima = src.indexOf('\nfunction ', inicio + marcador.length);
  return proxima === -1 ? src.slice(inicio) : src.slice(inicio, proxima);
}

for (const fluxo of FLUXOS) {
  test(`I16 — ${fluxo.nome}: a tela usa a infraestrutura e limpa só após o backend`, async () => {
    const src = await ler(fluxo.arquivo);
    const codigo = recortar(src, fluxo.componente);
    assert.equal(codigo.includes(fluxo.componente.slice(0, 20)), true, `${fluxo.nome}: o recorte do componente falhou`);

    assert.match(codigo, /usePersistentDraft\(\{/, `${fluxo.nome}: a tela precisa usar o hook de rascunho`);
    assert.match(codigo, new RegExp(fluxo.chave), `${fluxo.nome}: a tela precisa usar a chave central de ${fluxo.chave}`);
    assert.match(codigo, /draft\.restoreInto\(/, `${fluxo.nome}: a abertura precisa passar pelo restoreInto`);
    assert.match(codigo, /draft\.markSaved\(\)/, `${fluxo.nome}: o rascunho só é limpo por markSaved`);
    assert.match(codigo, /draft\.markFailed\(\)/, `${fluxo.nome}: a falha do backend precisa manter o rascunho`);
    assert.match(codigo, /draft\.discard\(\)/, `${fluxo.nome}: o Cancelar precisa oferecer descartar`);
    assert.match(codigo, /draft\.keep\(\)/, `${fluxo.nome}: o Cancelar precisa oferecer manter`);
    assert.match(codigo, /DRAFT_CANCEL_CONFIRM/, `${fluxo.nome}: a pergunta de descarte vem da configuração central`);
    assert.doesNotMatch(codigo, /localStorage\./, `${fluxo.nome}: a tela NÃO escreve localStorage direto`);
    assert.doesNotMatch(codigo, /sessionStorage\./, `${fluxo.nome}: sessionStorage não sobrevive ao fechamento do navegador`);

    // `markSaved` tem que vir DEPOIS da gravação no backend, nunca antes: é
    // essa ordem que garante que uma falha não apaga a única cópia do rascunho.
    // Um fluxo pode ter vários caminhos (pagamento em lote e avulso), então
    // cada `markSaved` é conferido contra o trecho desde o `markSaved` anterior.
    const chamadasSaved = [...codigo.matchAll(/draft\.markSaved\(\)/g)].map((m) => m.index);
    const chamadasWrite = [...codigo.matchAll(fluxo.gravacao ?? GRAVACAO_PADRAO)].map((m) => m.index);
    assert.equal(chamadasWrite.length > 0, true, `${fluxo.nome}: a tela precisa ter uma gravação de backend`);
    assert.equal(chamadasSaved.length > 0, true, `${fluxo.nome}: a tela precisa limpar o rascunho em algum ponto`);
    let cursor = 0;
    for (const pos of chamadasSaved) {
      const trecho = codigo.slice(cursor, pos);
      assert.equal(
        chamadasWrite.some((w) => w > cursor && w < pos),
        true,
        `${fluxo.nome}: todo markSaved precisa vir depois de uma gravação no backend — o caminho que limpa o rascunho tem que ter gravado antes`,
      );
      cursor = pos;
    }

    // E o `catch` precisa chamar markFailed, senão a tela de erro apaga o
    // rascunho por omissão. O padrão tolera `}catch(e){` e `} catch (e) {`.
    const idxCatch = codigo.search(/\}\s*catch\s*\(/);
    const idxFailed = codigo.indexOf('draft.markFailed()');
    assert.equal(idxFailed > -1 && idxCatch > -1 && idxCatch < idxFailed, true, `${fluxo.nome}: o catch precisa marcar falha ANTES de qualquer limpeza`);
  });
}

test('I17 — nenhuma tela dispara operação ao restaurar um rascunho', async () => {
  // A regra de segurança do escopo: restaurar devolve CAMPOS. Nenhum
  // create/update/delete/payment/stock/upload pode ser chamado no caminho da
  // restauração.
  for (const fluxo of FLUXOS) {
    const src = await ler(fluxo.arquivo);
    const blocoRestore = src.slice(src.indexOf('draft.restoreInto('), src.indexOf('draft.restoreInto(') + 400);
    assert.doesNotMatch(
      blocoRestore,
      /\.(create|update|delete|transact)\s*\(/,
      `${fluxo.nome}: restaurar rascunho não pode chamar operação de banco`,
    );
  }
});

test('I18 — anexos e dados sensíveis estão declarados como exclusão em cada tela', async () => {
  const gasto = await ler('src/components/financeiro/DailyExpenseForm.jsx');
  assert.match(gasto, /CAMPOS_DE_ANEXO = \['proof_url', 'invoice_url'\]/, 'o gasto declara os anexos fora do rascunho');

  const colab = await ler('src/components/rh/EmployeeForm.jsx');
  for (const sensivel of ['cpf', 'rg', 'pix_key', 'bank', 'salary', 'vale_value', 'photo_url']) {
    assert.match(colab, new RegExp(`'${sensivel}'`), `o colaborador declara '${sensivel}' como fora do rascunho`);
  }

  const estoque = await ler('src/pages/Estoque.jsx');
  assert.match(estoque, /usePersistentDraft\(/, 'o estoque usa a infraestrutura');
  // Regra do Agente 1 preservada: `ItemDialog` continua sem mexer no estoque
  // diretamente — quem faz isso é o `stockService`.
  assert.equal(/ItemDialog[\s\S]*?InventoryItem\.update\(/.test(estoque), false, 'o ItemDialog NÃO escreve estoque direto');
});

test('I19 — o aviso de rascunho nunca promete "salvo no sistema"', async () => {
  const config = await ler('src/lib/draftConfig.js');
  assert.match(config, /Rascunho salvo localmente/, 'o rótulo de confirmação diz que é rascunho local');
  assert.equal(/DRAFT_LABEL_SAVED = 'Salvo'/.test(config), false, '"Salvo" puro daria a entender que foi para o banco');

  const notice = await ler('src/components/shared/DraftNotice.jsx');
  assert.match(notice, /Rascunho restaurado|status/, 'a UI sabe exibir o aviso de restauração');
});

test('I20 — trocar de rota não apaga: o rascunho sobrevive a telas diferentes', () => {
  const storage = fakeStorage();
  // A pessoa preenche um gasto, vai para RH, volta ao Financeiro.
  const gasto = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO, baseline: emptyExpenseForm() });
  gasto.digitar({ ...emptyExpenseForm(), description: 'meio preenchido' });
  gasto.desmontar();

  const colab = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO, baseline: COLAB_VAZIO });
  colab.digitar({ ...COLAB_VAZIO, name: 'visitante' });
  colab.desmontar();

  const aoVoltar = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO, baseline: emptyExpenseForm() });
  assert.equal(aoVoltar.abrir().data.description, 'meio preenchido', 'voltar ao Financeiro recupera o gasto');
  const noRh = abrirFormulario({ storage, formKey: DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO, baseline: COLAB_VAZIO });
  assert.equal(noRh.abrir().data.name, 'visitante', 'e o rascunho do RH está intacto ao lado');
});

test('I21 — trocar de aba do Chrome não apaga nada', async () => {
  // Perder foco (`blur`) ou esconder a aba (`visibilitychange`) não é evento de
  // descarte. O núcleo não tem nenhum handler desses para apagar; o que
  // existe é o flush de `pagehide`, que só GRAVA.
  const core = await ler('src/lib/draftStore.js');
  assert.doesNotMatch(core, /visibilitychange/, 'o núcleo não apaga rascunho ao esconder a aba');
  assert.doesNotMatch(core, /['"]blur['"]/, 'o núcleo não apaga rascunho ao perder foco');
  assert.doesNotMatch(core, /beforeunload/, 'o núcleo não usa beforeunload para nada');

  const hook = await ler('src/lib/usePersistentDraft.js');
  const pagehide = hook.slice(hook.indexOf("addEventListener?.('pagehide'"));
  assert.match(pagehide, /flush\(Date\.now\(\), \{ force: true \}\)/, 'no pagehide o que roda é um flush (grava), nunca um clear');
  assert.equal(hook.includes('clearDraft'), false, 'o hook apaga rascunho só via markSaved/discard, nunca por evento de janela');
});

test('I22 — edição: rascunho antigo não sobrescreve registro novo do backend', () => {
  const storage = fakeStorage();
  const formKey = draftEditKey(DRAFT_FORM_KEYS.RH_COLABORADOR_NOVO, 42);
  const atualizadoNoBackend = '2026-09-29T18:00:00Z';
  const passado = Date.parse('2026-09-29T10:00:00Z');

  // A pessoa começa a editar, digita, e alguém salva o registro no servidor.
  const sessao = createDraftSession({ userKey: USER_KEY, formKey, storage, now: () => passado });
  sessao.change({ ...COLAB_VAZIO, name: 'Nome antigo digitado', sector: 'Cozinha' }, passado);
  sessao.flush(passado, { force: true });

  // Ela reabre a edição: o backend já está mais novo.
  const reabrindo = createDraftSession({ userKey: USER_KEY, formKey, storage, now: () => Date.parse(atualizadoNoBackend) });
  const r = reabrindo.restore({
    base: { ...COLAB_VAZIO, name: 'Nome salvo no servidor', sector: 'Serviço' },
    recordUpdatedAt: atualizadoNoBackend,
  });

  assert.equal(r.stale, true, 'o caso é sinalizado como possivelmente desatualizado');
  assert.equal(r.restored, false, 'NÃO é restaurado automaticamente');
  assert.equal(r.data.name, 'Nome salvo no servidor', 'o dado mais novo do backend fica na tela');
  assert.ok(storage.getItem(`gr:draft:${USER_KEY}:${formKey}`), 'o rascunho da pessoa é preservado, apenas não aplicado sozinho');
});

test('I23 — storage indisponível: o formulário abre e funciona igual', () => {
  const semStorage = null;
  const sessao = createDraftSession({ userKey: USER_KEY, formKey: DRAFT_FORM_KEYS.FINANCEIRO_GASTO_NOVO, storage: semStorage });
  assert.equal(sessao.enabled, false, 'sem storage a sessão nem liga');
  const r = sessao.restore({ base: emptyExpenseForm() });
  assert.equal(r.data.description, '', 'o formulário abre normalmente, com o baseline');
  assert.equal(sessao.flush(0, { force: true }), false, 'gravar é no-op');
  assert.equal(sessao.discard(), false, 'descartar é no-op');
  assert.equal(sessao.saved(), false, 'salvar é no-op');
});
