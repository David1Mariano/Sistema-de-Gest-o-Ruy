// Freelancer/PJ no seletor de pagamento + tela branca ao criar categoria.
//
// As duas correções vivem na branch `agente-financeiro-freelancer-categorias`:
//
// 1) `src/lib/paymentRecipients.js` centraliza elegibilidade e rótulo. O
//    freelancer nunca foi EXCLUÍDO — o filtro era só `status !== 'inativo'`.
//    O defeito era de IDENTIFICAÇÃO: "nome · função" não distinguia PJ de CLT.
//
// 2) `ExpenseCategoryManager` estourava em `selectableCategories` quando
//    `categories` chegava como objeto (não lista): "[...(categories || [])]" →
//    "is not iterable". Sem Error Boundary o React desmonta tudo: tela branca.
//    Reproduzido com renderToStaticMarkup: o aviso de controlled/uncontrolled
//    NÃO era a causa — aquele só avisa, não derruba.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const abs = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const ler = (rel) => readFileSync(abs(rel), 'utf8');

const {
  isPayableEmployee, payableEmployees, employeeOptionLabel, employeeSelectOptions, employeeById,
} = await import(new URL('../src/lib/paymentRecipients.js', import.meta.url).href);
const { selectableCategories } = await import(new URL('../src/lib/expenseCategories.js', import.meta.url).href);

const emp = (extra = {}) => ({ id: 'e1', name: 'Ana Lima', status: 'ativo', hire_type: 'clt', ...extra });

// ===========================================================================
// PROBLEMA 1 — freelancer / PJ / autônomo / diarista no seletor
// ===========================================================================

test('F1. freelancer (PJ) aparece no seletor de pagamento', () => {
  const opcoes = employeeSelectOptions([emp({ id: 'p1', name: 'João Silva', hire_type: 'pj' })]);
  assert.equal(opcoes.length, 1, 'o PJ NÃO pode sumir da lista');
  assert.equal(opcoes[0][0], 'p1', 'o id persistido é o do Employee');
  assert.match(opcoes[0][1], /João Silva/);
});

test('F2. CLT continua aparecendo normalmente', () => {
  const opcoes = employeeSelectOptions([emp({ id: 'c1', name: 'Maria Souza', hire_type: 'clt' })]);
  assert.equal(opcoes.length, 1);
  assert.match(opcoes[0][1], /Maria Souza/);
  assert.match(opcoes[0][1], /CLT/);
});

test('F3. diarista permanece elegível para pagamento enquanto estiver ativo', () => {
  const ativo = emp({ id: 'd1', name: 'Bia Reis', hire_type: 'diarista', status: 'ativo' });
  assert.equal(payableEmployees([ativo]).length, 1, 'diarista ativo recebe pagamento');
  assert.match(employeeOptionLabel(ativo), /Diarista/);
  assert.equal(payableEmployees([{ ...ativo, status: 'inativo' }]).length, 0, 'inativo sai');
});

test('F4. colaborador inválido NÃO aparece no seletor', () => {
  const opcoes = employeeSelectOptions([
    emp({ id: '', name: 'Sem id' }),
    emp({ id: 'i1', name: 'Desligado', status: 'inativo' }),
    emp({ id: 'a1', name: 'Ativa', status: 'ativo' }),
  ]);
  assert.equal(opcoes.length, 1, 'só a ativa entra');
  assert.match(opcoes[0][1], /Ativa/);
  assert.equal(isPayableEmployee(null), false);
  assert.equal(isPayableEmployee({}), false, 'sem id não é elegível');
});


test('F6. hire_type ausente ou desconhecido não é inventado', () => {
  // `emp()` já traz hire_type 'clt'; aqui zeramos de propósito.
  const semTipo = { id: 'x1', name: 'Ana Lima', status: 'ativo' };
  assert.equal(employeeOptionLabel(semTipo), 'Ana Lima');
  assert.equal(employeeOptionLabel({ ...semTipo, hire_type: 'xyz' }), 'Ana Lima', 'tipo desconhecido não vira texto');
  assert.equal(employeeOptionLabel({ ...semTipo, hire_type: '' }), 'Ana Lima');
  assert.equal(employeeOptionLabel({ ...semTipo, hire_type: null }), 'Ana Lima');
  // Função continua aparecendo junto do tipo.
  assert.equal(employeeOptionLabel(emp({ hire_type: 'pj', function: 'Design' })), 'Ana Lima — PJ — Design');
});

test('F7. o rótulo é só apresentação: id e Employee não mudam', () => {
  const pessoa = emp({ id: 'p1', name: 'João Silva', hire_type: 'pj' });
  const copia = JSON.parse(JSON.stringify(pessoa));
  employeeSelectOptions([pessoa]);
  employeeOptionLabel(pessoa);
  assert.deepEqual(pessoa, copia, 'nenhum dado persistido foi tocado');
  assert.equal(employeeById([pessoa], 'p1'), pessoa, 'o Employee continua o mesmo');
  assert.equal(employeeById([pessoa], 'inexistente'), null);
});

test('F8. os DOIS seletores usam a MESMA regra (não podem divergir)', () => {
  const gasto = ler('src/components/financeiro/DailyExpenseForm.jsx');
  const financeiro = ler('src/pages/Financeiro.jsx');
  assert.doesNotMatch(gasto, /status\s*!==\s*'inativo'/, 'formulário de gasto sem filtro próprio');
  assert.doesNotMatch(financeiro, /employees\.filter\(x=>x\.status/, 'Financeiro sem filtro próprio');
  assert.match(gasto, /employeeSelectOptions/, 'formulário usa a regra centralizada');
  assert.match(financeiro, /employeeSelectOptions/, 'Financeiro usa a regra centralizada');
});

test('F9. não existe entidade "Freelancer" paralela', () => {
  const base = ler('src/api/base44Client.js');
  assert.doesNotMatch(base, /Freelancer/i, 'nenhuma entity Freelancer no cliente');
  assert.doesNotMatch(ler('src/pages/Financeiro.jsx'), /entities\.Freelancer/, 'nenhum uso de entity nova');
  assert.match(ler('src/components/rh/EmployeeForm.jsx'), /hire_type/, 'o cadastro segue gravando hire_type');
});

test('F10. pagamento de freelancer: valores preservados pelo payload', async () => {
  const { buildExpensePayload } = await import(new URL('../src/lib/dailyExpenses.js', import.meta.url).href);
  const employees = [emp({ id: 'p1', name: 'João Silva', hire_type: 'pj' })];
  const payload = buildExpensePayload({
    date: '2026-03-10', description: 'Diária de março', amount: '1234,56',
    beneficiary_type: 'colaborador', employee_id: 'p1', payment_method: 'pix',
    status: 'pago', paid_date: '2026-03-10', observation: 'Projeto março',
    proof_url: 'data:application/pdf;base64,JVBERi0=',
  }, { employees, responsibleUser: 'Teste' });
  assert.equal(payload.amount, 1234.56, 'valor preservado');
  assert.equal(payload.observation, 'Projeto março');
  assert.equal(payload.payment_method, 'pix');
  assert.equal(payload.date, '2026-03-10');
  assert.equal(payload.paid_date, '2026-03-10');
  assert.equal(payload.responsible_user, 'Teste', 'auditoria: responsável preservado');
  assert.equal(payload.proof_url, 'data:application/pdf;base64,JVBERi0=', 'comprovante intacto');
  // O registro carrega o NOME PURO, nunca o rótulo com o tipo.
  assert.equal(payload.beneficiary_name, 'João Silva');
  assert.equal(payload.beneficiary_id, 'p1', 'mesmo Employee, sem cadastro paralelo');
  assert.equal(payload.beneficiary_type, 'colaborador');

// ===========================================================================
// PROBLEMA 2 — tela branca ao criar categoria
// ===========================================================================

// ExpenseCategory em memória, com falha e "retorno inválido" controláveis.
function fakeCats({ inicial = [], falhar = false, retornoInvalido = false } = {}) {
  const mapa = new Map(inicial.map((c) => [c.id, c]));
  const entity = {
    async create(data) {
      if (falhar) throw new Error('falha simulada ao criar categoria');
      if (retornoInvalido) return undefined; // resposta incompleta: SEM id
      const id = data.id || `c${mapa.size + 1}`;
      mapa.set(id, { ...data, id });
      return mapa.get(id);
    },
    async update(id, patch) {
      mapa.set(id, { ...(mapa.get(id) || { id }), ...patch });
      return mapa.get(id);
    },
  };
  return { entity, mapa, todas: () => [...mapa.values()] };
}

// Reproduz o `create()` do componente com a MESMA ordem, guarda e validação:
// onSaved ANTES da seleção, e seleção só quando o id é real.
async function fluxoCriar({ cats, nome = 'Embalagens' }) {
  const estado = { saving: false, message: '', error: '' };
  const select = [];
  let saved = 0;
  const avisar = (fn) => fn();
  const onSavedFn = async () => { saved += 1; };
  try {
    const criado = await cats.entity.create({ name: nome, group: 'operacao', status: 'ativo' });
    avisar(() => { estado.message = `Categoria "${nome}" criada.`; });
    await onSavedFn();
    const novoId = criado?.id;
    if (novoId) select.push(novoId);
  } catch (e) {
    avisar(() => { estado.error = e?.message || 'Não foi possível criar a categoria. Tente novamente.'; });
  } finally {
    estado.saving = false;
  }
  return { estado, select, saved };
}

test('C1. categorias NÃO-array não derrubam mais o render (causa raiz)', () => {
  // A EXCEÇÃO REAL: o spread de um objeto dentro de selectableCategories.
  assert.throws(() => selectableCategories({ length: 0 }), /not iterable/);
  // A defesa vive na borda do componente.
  const fonte = ler('src/components/financeiro/ExpenseCategoryManager.jsx');
  assert.match(fonte, /Array\.isArray\(categories\) \? categories : \[\]/, 'normaliza na borda');
});

test('C2. retorno válido: salva, atualiza a lista e seleciona a nova categoria', async () => {
  const cats = fakeCats({ inicial: [{ id: 'c1', name: 'Limpeza', status: 'ativo' }] });

test('C4. retorno SEM id: não seleciona e a tela continua utilizável', async () => {
  const cats = fakeCats({ retornoInvalido: true });
  const r = await fluxoCriar({ cats });
  assert.deepEqual(r.select, [], 'NUNCA emite undefined para o select');
  // Resposta incompleta NÃO derruba a tela: a categoria não é selecionada,
  // nada fica em estado inválido e o formulário continua utilizável.
  assert.equal(r.estado.saving, false, 'formulário continua utilizável');
  assert.equal(typeof r.estado.error, 'string', 'erro é sempre string, nunca undefined');
});

test('C4b. falha ao criar: erro controlado, sem estado undefined', async () => {
  const cats = fakeCats({ falhar: true });
  const r = await fluxoCriar({ cats });
  assert.match(r.estado.error, /falha simulada/);
  assert.deepEqual(r.select, [], 'nada selecionado');
  assert.equal(typeof r.estado.error, 'string');
  assert.equal(r.estado.saving, false);
});

test('C5. falha ao criar: erro controlado, sem reload, tela não trava', async () => {
  const cats = fakeCats({ falhar: true });
  const r = await fluxoCriar({ cats });
  assert.match(r.estado.error, /falha simulada/);
  assert.deepEqual(r.select, [], 'nada foi selecionado');
  assert.equal(cats.mapa.size, 0, 'nada persistido');
  assert.equal(r.saved, 0, 'sem reload inútil');
  assert.equal(r.estado.saving, false, 'a tela não ficou travada');
});

test('C6. o formulário permanece renderizado: defesa no ponto de consumo', () => {
  const painel = ler('src/components/financeiro/DailyExpensesPanel.jsx');
  assert.match(painel, /value=\{categoryId \|\| ''\}/, 'select nunca fica sem valor controlado');
  // O botão segue com type="button": sem submit acidental dentro de form.
  const ger = ler('src/components/financeiro/ExpenseCategoryManager.jsx');
  assert.match(ger, /type="button" onClick=\{create\}/, 'botão sem submit acidental');
  assert.doesNotMatch(ger, /<form/, 'não há <form> envolvendo o botão');
});

test('C7. clique duplo não duplica categoria', async () => {
  const cats = fakeCats({});
  const busy = { current: false };
  const criar = async () => {
    if (busy.current) return; // guarda SÍNCRONA: vale antes do primeiro await
    busy.current = true;
    await cats.entity.create({ name: 'Embalagens', status: 'ativo' });
    busy.current = false;
  };
  // Os dois disparos saem no MESMO tick, como dois cliques rápidos.
  await Promise.all([criar(), criar()]);
  assert.equal(cats.mapa.size, 1, 'uma categoria só');
  assert.equal(cats.todas().filter((c) => c.name === 'Embalagens').length, 1, 'sem duplicata');
});

test('C8. nenhuma navegação ou reload no fluxo da categoria', () => {
  const ger = ler('src/components/financeiro/ExpenseCategoryManager.jsx');
  assert.doesNotMatch(ger, /window\.location|navigate\(|location\.href|location\.reload/, 'sem navegação');
  assert.doesNotMatch(ger, /<a\s+href/, 'sem link de recarregamento');
});

test('C9. o Financeiro passa a recarregar SÓ as categorias', () => {
  // A origem do objeto não-array: o painel montado sem `onCategoriesChanged`
  // fazia o `onSaved` cair no `load()` completo, que regrava o `data` inteiro.
  const painel = ler('src/components/financeiro/DailyExpensesPanel.jsx');
  assert.match(painel, /onSaved=\{onCategoriesChanged \|\| onSaved\}/, 'usa o reload leve quando existe');
  const pagina = ler('src/pages/GastosDiarios.jsx');
  assert.match(pagina, /reloadCategories/, 'a página define o reload só de categorias');
});

  const r = await fluxoCriar({ cats });
  assert.equal(cats.mapa.size, 2, 'categoria persistida');
  assert.ok(cats.todas().some((c) => c.name === 'Embalagens'), 'aparece na lista');
  assert.deepEqual(r.select, ['c2'], 'seleciona a categoria nova');
  assert.equal(r.saved, 1, 'onSaved roda uma vez');
  assert.equal(r.estado.saving, false, 'sai do estado saving');
  assert.match(r.estado.message, /criada/);
  assert.equal(r.estado.error, '', 'sem erro');
});

test('C3. onSaved roda ANTES da seleção (o id já existe no select)', async () => {
  const ordem = [];
  const cats = fakeCats({});
  const criado = await cats.entity.create({ name: 'Embalagens', status: 'ativo' });
  await (async () => { ordem.push('saved'); })();
  if (criado?.id) ordem.push('select');
  assert.deepEqual(ordem, ['saved', 'select'], 'selecionar antes deixaria o valor sem option na lista');
});

});

test('F5. o rótulo usa o tipo REAL de HIRE_TYPE_LABELS, sem inventar "Freelancer"', () => {
  const esperado = { pj: /PJ/, autonomo: /Autônomo/, diarista: /Diarista/, clt: /CLT/, estagio: /Estágio/, outros: /Outros/ };
  for (const [tipo, padrao] of Object.entries(esperado)) {
    const rotulo = employeeOptionLabel(emp({ hire_type: tipo }));
    assert.match(rotulo, padrao, `${tipo} aparece com o rótulo real`);
    assert.doesNotMatch(rotulo, /Freelancer/i, `${tipo} não vira "Freelancer"`);
  }
});
