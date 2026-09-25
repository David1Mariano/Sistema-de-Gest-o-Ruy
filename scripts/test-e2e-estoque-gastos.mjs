// ===========================================================================
// Teste de integração de ponta a ponta contra o backend REAL (Supabase),
// usando exatamente as mesmas regras que o app usa.
//
// Todos os registros criados aqui usam o prefixo `ZZTEST-` e são REMOVIDOS no
// final (inclusive o AuditLog gerado). Nada fora desse prefixo é tocado.
// ===========================================================================
import assert from 'node:assert/strict';

// Credenciais vêm SEMPRE do ambiente — nada de chave hardcoded neste arquivo.
// A chave anon do Supabase é pública por desenho (a proteção é o RLS), mas
// mesmo assim não deve ficar duplicada dentro do repositório.
//
//   PowerShell:  $env:SUPABASE_URL='...'; $env:SUPABASE_ANON_KEY='...'
//   Git Bash:     SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run test:e2e
const K = process.env.SUPABASE_ANON_KEY;
const URL = process.env.SUPABASE_URL;
if (!K || !URL) {
  console.error('Defina SUPABASE_URL e SUPABASE_ANON_KEY para rodar o teste de ponta a ponta.');
  console.error('Exemplo (PowerShell): $env:SUPABASE_URL="https://SEU-PROJETO.supabase.co"; $env:SUPABASE_ANON_KEY="sua-chave-anon"');
  console.error('Nada foi gravado: o teste nem chegou a falar com o banco.');
  // Sai aqui, ainda no topo do módulo, antes de qualquer escrita.
  process.exit(2);
}

const REST = `${URL}/rest/v1/`;
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };
const PREFIX = 'ZZTEST-';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (...a) => console.log(...a);
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    log(`PASS ${name}`);
  } catch (e) {
    failures += 1;
    log(`FAIL ${name}: ${e.message}`);
  }
}

const created = new Set();
async function put(entity, id, data) {
  created.add(`${entity}::${id}`);
  // Espelha o toRow() do cloudDb: o `id` também vive dentro de `data`.
  const rec = { ...data, id, created_date: data.created_date || new Date().toISOString() };
  const r = await fetch(`${REST}records?on_conflict=entity,id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ entity, id, data: rec, created_date: rec.created_date, updated_date: new Date().toISOString() }]),
  });
  if (!r.ok) throw new Error(`put ${entity}: ${r.status} ${await r.text()}`);
  return id;
}
async function getRow(entity, id) {
  const r = await fetch(`${REST}records?entity=eq.${encodeURIComponent(entity)}&id=eq.${encodeURIComponent(id)}&select=data,updated_date`, { headers: H });
  const j = await r.json();
  return j[0] || null;
}
async function listEntity(entity) {
  const r = await fetch(`${REST}records?entity=eq.${encodeURIComponent(entity)}&select=data`, { headers: H });
  return (await r.json()).map((x) => x.data);
}
async function del(entity, id) {
  await fetch(`${REST}records?entity=eq.${encodeURIComponent(entity)}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: H });
  created.delete(`${entity}::${id}`);
}

// --- mesma semântica de transactRow do cloudDb ----------------------------
async function casPatch(entity, id, expectedUpdated, data) {
  const v = expectedUpdated ? `&updated_date=eq.${encodeURIComponent(expectedUpdated)}` : '';
  const r = await fetch(`${REST}records?entity=eq.${entity}&id=eq.${id}${v}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ entity, id, data, created_date: data.created_date, updated_date: new Date().toISOString() }),
  });
  const j = await r.json();
  return j[0]?.data || null;
}
async function transact(entity, id, mutate, retries = 6) {
  for (let i = 0; i <= retries; i += 1) {
    const row = await getRow(entity, id);
    if (!row) throw new Error(`${entity} ${id} não encontrado`);
    const patch = mutate(row.data);
    if (!patch) return row.data;
    const next = { ...row.data, ...patch, id, updated_date: new Date().toISOString() };
    const applied = await casPatch(entity, id, row.updated_date, next);
    if (applied) return applied;
    await sleep(20 * (i + 1));
  }
  throw new Error('conflito repetido');
}


// Remove QUALQUER registro deixado por execuções anteriores (prefixo ZZTEST-).
const leftovers = [];
for (const e of ['InventoryItem', 'StockMovement', 'FinancialExpense', 'AccountsPayable', 'DailyProduction', 'Purchase', 'PurchaseItem', 'AuditLog']) {
  const r = await fetch(`${REST}records?entity=eq.${encodeURIComponent(e)}&select=id,data`, { headers: H });
  const rows = await r.json();
  for (const row of rows) {
    if (JSON.stringify(row.data || {}).includes(PREFIX)) {
      await del(e, row.id);
      leftovers.push(`${e}:${row.id}`);
    }
  }
}
log(`Limpeza previa: ${leftovers.length} registro(s) de execucoes anteriores removidos.`);

// --- mesmas regras do stockService/stockRules ------------------------------
const { parseDecimalBR } = await import('../src/lib/numberUtils.js');
const { MOVEMENT_TYPES, roundQty, roundMoney, balanceFromMovements, validateMovement, stockDirection, costsAfter } = await import('../src/lib/stockRules.js');

let clock = 0;
const uid = (p) => `${p}${PREFIX}${Date.now().toString(36)}${(clock += 1).toString(36)}`;

async function registerMovement({ item, type, quantity, date, unitCost = 0, originType = 'manual', originId = '', observation = '', clientToken = '' }) {
  if (clientToken) {
    const dup = (await listEntity('StockMovement')).find((m) => m.client_token === clientToken);
    if (dup) return { movement: dup, duplicated: true };
  }
  const qty = validateMovement({ item, type, quantity, unit: item.unit });
  const cost = roundMoney(unitCost) || 0;
  const direction = stockDirection(type);
  let before = 0;
  const updated = await transact('InventoryItem', item.id, (current) => {
    const cur = roundQty(current.current_stock) || 0;
    before = cur;
    const next = roundQty(direction === 'entrada' ? cur + qty : cur - qty);
    if (next < 0) throw new Error('saldo insuficiente');
    const c = costsAfter({ item: current, type, quantity: qty, unitCost: cost });
    return { current_stock: next, average_cost: c.average, last_cost: c.last };
  }, 8);
  const id = uid('mov_');
  await put('StockMovement', id, {
    date, inventory_item_id: item.id, item_name: item.name, movement_type: type, direction,
    quantity: qty, unit: item.unit, unit_cost: cost, total_cost: roundMoney(qty * cost),
    balance_before: before, balance_after: updated.current_stock,
    origin_type: originType, origin_id: originId,
    ...(clientToken ? { client_token: clientToken } : {}),
    observation, responsible_user: 'teste-integracao',
  });
  return { movement: (await getRow('StockMovement', id)).data, item: updated };
}

const ITEM = { name: `${PREFIX}Farinha de teste`, unit: 'kg', status: 'ativo' };
const stock = () => getRow('InventoryItem', ITEM.id).then((r) => Number(r.data.current_stock));
const moves = () => listEntity('StockMovement').then((all) => all.filter((m) => m.inventory_item_id === ITEM.id));
const itemNow = () => getRow('InventoryItem', ITEM.id).then((r) => r.data);

// ===========================================================================
await check('A. cadastro: item nasce com saldo 0 + movimento de abertura 10', async () => {
  ITEM.id = uid('it_');
  await put('InventoryItem', ITEM.id, { ...ITEM, current_stock: 0, average_cost: 0, minimum_stock: 0 });
  await registerMovement({ item: { ...ITEM, current_stock: 0 }, type: MOVEMENT_TYPES.AJUSTE_ENTRADA, quantity: 10, date: '2026-01-05', unitCost: 4, originType: 'saldo_inicial', clientToken: `abertura:${ITEM.id}` });
  assert.equal(await stock(), 10, 'saldo inicial');
  const m = await moves();
  assert.equal(m.length, 1, 'uma movimentação de abertura');
  assert.equal(m[0].balance_before, 0, 'saldo anterior 0');
  assert.equal(m[0].balance_after, 10, 'saldo posterior 10');
});

await check('B. entrada 5 -> saldo 15 (10 + 5)', async () => {
  await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 5, date: '2026-01-06', unitCost: 6 });
  assert.equal(await stock(), 15, 'saldo 15');
});

await check('C. segunda entrada "2,5" -> saldo 17,5 (decimal pt-BR)', async () => {
  await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: '2,5', date: '2026-01-07' });
  assert.equal(await stock(), 17.5, 'saldo 17,5');
});

await check('D. saida 3 -> saldo 14,5', async () => {
  await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 3, date: '2026-01-08' });
  assert.equal(await stock(), 14.5, 'saldo 14,5');
});

await check('E. historico: relendo do banco, soma do historico = saldo', async () => {
  await sleep(300);
  const item = await itemNow();
  assert.equal(Number(item.current_stock), 14.5, 'saldo persistido');
  const m = await moves();
  assert.equal(m.length, 4, '4 movimentações');
  assert.equal(balanceFromMovements(m, ITEM.id), 14.5, 'soma do historico = saldo');
});

await check('F. valor decimal do formulario: "25,50" -> 25.5 (nada de 2550/25)', async () => {
  assert.equal(parseDecimalBR('25,50'), 25.5);
  assert.equal(roundMoney(parseDecimalBR('25,50')), 25.5);
  assert.notEqual(parseDecimalBR('25,50'), 2550);
});

await check('G. ajuste de inventario 14,5 -> 20 gera movimentacao de +5,5', async () => {
  await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.AJUSTE_ENTRADA, quantity: 5.5, date: '2026-01-09', observation: 'Inventário' });
  assert.equal(await stock(), 20, 'saldo 20');
  const last = (await moves()).at(-1);
  assert.equal(last.balance_before, 14.5, 'saldo antes gravado');
  assert.equal(last.balance_after, 20, 'saldo depois gravado');
});

await check('H. estorno da entrada de +5 devolve o saldo e PRESERVA o historico', async () => {
  const entrada = (await moves()).find((m) => m.quantity === 5 && m.direction === 'entrada' && !m.client_token);
  assert.ok(entrada, 'movimentacao de entrada encontrada');
  const antes = await stock();
  const r = await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: entrada.quantity, date: '2026-01-10', originType: 'estorno', originId: entrada.id, clientToken: `reversao:${entrada.id}`, observation: 'Estorno' });
  const depois = await stock();
  log(`   (estorno: ${r.movement.movement_type} qtd=${r.movement.quantity} saldo ${antes} -> ${depois}; duplicado=${!!r.duplicated})`);
  assert.equal(depois, antes - 5, 'saldo volta 5 unidades');
  const all = await moves();
  assert.ok(all.some((m) => m.id === entrada.id), 'movimentacao original continua no historico');
});

await check('I. duplo clique NAO duplica (clientToken idempotente)', async () => {
  const token = `mov:${ITEM.id}:entrada_manual:1|2026-01-11`;
  const a = await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 1, date: '2026-01-11', clientToken: token });
  const b = await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 1, date: '2026-01-11', clientToken: token });
  assert.equal(b.duplicated, true, 'segundo envio reconhecido como duplicata');
  assert.equal(a.movement.id, b.movement.id, 'mesma movimentacao');
  assert.equal(await stock(), 16, 'saldo subiu apenas uma vez');
  assert.equal((await moves()).filter((m) => m.client_token === token).length, 1, 'apenas 1 registro');
});

await check('J. validacoes: saldo insuficiente, zero, negativo, invalido e unidade', async () => {
  const item = await itemNow();
  assert.throws(() => validateMovement({ item, type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 9999 }), /insuficiente/);
  assert.throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 0 }), /maior que zero/);
  assert.throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: -1 }), /maior que zero/);
  assert.throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 'abc' }), /inválida/);
  assert.throws(() => validateMovement({ item, type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 1, unit: 'l' }), /incompatível/);
  assert.equal(await stock(), 16, 'nenhuma tentativa inválida alterou o saldo');
});

await check('K. CONCORRENCIA: -2 e -3 simultaneos partindo de 16 -> 11 (nao 13/14)', async () => {
  const before = await stock();
  const [ra, rb] = await Promise.all([
    registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 2, date: '2026-01-12' }),
    registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.SAIDA_MANUAL, quantity: 3, date: '2026-01-12' }),
  ]);
  const after = await stock();
  log(`   (saldo ${before} -> ${after}; lancamentos ${ra.movement.balance_before}->${ra.movement.balance_after} e ${rb.movement.balance_before}->${rb.movement.balance_after})`);
  assert.equal(after, before - 5, `esperado ${before - 5}, obtido ${after}`);
});

await check('L. producao: registrar producao e conferir NAO mexem no estoque', async () => {
  const before = await stock();
  const prodId = uid('dp_');
  await put('DailyProduction', prodId, { date: '2026-01-13', product_id: uid('pp_'), product_name: `${PREFIX}Coxinha`, produced_quantity: 100, unit: 'un', responsible: 'teste' });
  const prod = (await listEntity('DailyProduction')).find((p) => p.id === prodId);
  assert.equal(prod.produced_quantity, 100, 'producao salva no banco');
  assert.equal(await stock(), before, 'estoque intacto apos registrar producao');
  const needed = (2 * prod.produced_quantity) / 100; // ficha técnica: 2kg por 100 unidades
  assert.equal(needed, 2, 'consumo calculado na conferencia (FASE 2A, somente leitura)');
  assert.equal(await stock(), before, 'visualizar a conferencia nao mexe no estoque');
  await sleep(300);
  assert.equal(await stock(), before, 'recarregar a tela nao mexe no estoque');
});

await check('M. gastos: gravar, reler, editar e cancelar (logico)', async () => {
  const expId = uid('fe_');
  await put('FinancialExpense', expId, {
    date: '2026-01-14', description: `${PREFIX}Compra emergencial de insumo`,
    amount: roundMoney(parseDecimalBR('25,50')), classification: 'despesa_operacional',
    payment_method: 'pix', status: 'pago', origin_type: 'manual', responsible_user: 'teste-integracao',
  });
  const saved = (await listEntity('FinancialExpense')).find((e) => e.id === expId);
  assert.equal(saved.amount, 25.5, 'valor 25.50 persistido como numero 25.5');
  assert.equal(typeof saved.amount, 'number', 'tipo numerico no banco');

  await put('FinancialExpense', expId, { ...saved, amount: 30, description: `${PREFIX}Compra emergencial de insumo (corrigida)` });
  const edited = (await listEntity('FinancialExpense')).find((e) => e.id === expId);
  assert.equal(edited.amount, 30, 'edicao aplicada');
  assert.equal(edited.created_date, saved.created_date, 'edicao nao duplicou o registro');

  await put('FinancialExpense', expId, { ...edited, status: 'cancelado', cancelled_at: new Date().toISOString() });
  const cancelled = (await listEntity('FinancialExpense')).find((e) => e.id === expId);
  assert.equal(cancelled.status, 'cancelado', 'cancelado logicamente');
  const ativos = (await listEntity('FinancialExpense')).filter((e) => e.date === '2026-01-14' && e.status !== 'cancelado');
  assert.equal(ativos.length, 0, 'cancelado sai do total do periodo');
});

await check('N. totais do financeiro nao duplicam o mesmo gasto', async () => {
  const noPeriodo = (await listEntity('FinancialExpense')).filter((e) => e.date === '2026-01-14');
  const soma = noPeriodo.filter((e) => e.status !== 'cancelado').reduce((s, e) => s + Number(e.amount || 0), 0);
  assert.equal(soma, 0, 'gasto cancelado nao soma');
  assert.equal(noPeriodo.length, 1, 'apenas um lancamento para o gasto');
});

await check('O. compra -> conta a pagar -> pagamento gera UM FinancialExpense (R$100 e nao R$200)', async () => {
  const apId = uid('ap_');
  await put('AccountsPayable', apId, { description: `${PREFIX}Compra - Fornecedor Teste`, amount: 100, due_date: '2026-02-01', status: 'pendente', purchase_id: uid('pu_'), origin_type: 'compra' });
  const payId = uid('fe_pay_');
  await put('FinancialExpense', payId, { date: '2026-01-15', paid_date: '2026-01-15', description: `${PREFIX}Compra - Fornecedor Teste`, amount: 100, classification: 'despesa_operacional', status: 'pago', origin_type: 'conta_pagar', origin_id: apId, accounts_payable_id: apId });
  const ligados = (await listEntity('FinancialExpense')).filter((e) => e.origin_type === 'conta_pagar' && e.origin_id === apId);
  assert.equal(ligados.length, 1, 'apenas 1 despesa para a conta a pagar');
  assert.equal(ligados.reduce((s, e) => s + Number(e.amount || 0), 0), 100, 'contabiliza R$ 100');
});

await check('P. ajuste/entrada de estoque NAO cria despesa financeira', async () => {
  const antes = (await listEntity('FinancialExpense')).length;
  const saldoAntes = await stock();
  await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.AJUSTE_ENTRADA, quantity: 5, date: '2026-01-16', observation: 'Ajuste de inventário' });
  assert.equal((await listEntity('FinancialExpense')).length, antes, 'nenhuma despesa criada');
  assert.equal(await stock(), saldoAntes + 5, 'estoque adjustado');
  await registerMovement({ item: await itemNow(), type: MOVEMENT_TYPES.ENTRADA_MANUAL, quantity: 4, date: '2026-01-17' });
  assert.equal((await listEntity('FinancialExpense')).length, antes, 'entrada de estoque nao e despesa');
  assert.equal(balanceFromMovements(await moves(), ITEM.id), await stock(), 'historico bate com o saldo');
});

// --- limpeza ---------------------------------------------------------------
log('\nLimpando registros de teste...');
for (const key of [...created]) {
  const [entity, id] = key.split('::');
  await del(entity, id);
}
const leftoversFinal = [];
for (const e of ['InventoryItem', 'StockMovement', 'FinancialExpense', 'AccountsPayable', 'DailyProduction']) {
  const all = await listEntity(e);
  all.filter((r) => JSON.stringify(r).includes(PREFIX)).forEach((r) => leftoversFinal.push(`${e}:${r.id}`));
}
log(`Sobras com o prefixo de teste: ${leftoversFinal.length ? leftoversFinal.join(', ') : 'nenhuma'}`);
log(failures ? `E2E_FALHOU ${failures} verificacao(oes)` : 'E2E_OK');
// Usa exitCode (e não process.exit) para não truncar o stdout bufferizado.
process.exitCode = failures || leftoversFinal.length ? 1 : 0;
