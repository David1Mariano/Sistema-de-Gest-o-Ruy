// Exclusão de item de estoque — regras da tela de Estoque.
//
// A distinção central deste arquivo:
//
//   EXCLUSÃO FÍSICA  item descartável: saldo zero, sem movimentação, sem
//                    vínculo. A linha some de vez.
//   DESATIVAÇÃO      item com histórico ou vínculo e saldo zero: a linha
//                    fica, o histórico fica, e o item sai das listas novas.
//   BLOQUEIO         saldo diferente de zero: nem um nem outro.
//
// As duas garantias que não podem quebrar: `StockMovement` nunca é apagado e
// nada é apagado em cascata. A exclusão física, porém, tem de existir: um item
// recém-criado e descartado não pode ficar preso na base só porque a tela só
// sabia desativar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const {
  DELETE_MODE, LIST_TABS, SALDO_MSG,
  itemDecision, itemDeletePatch, itemReactivatePatch, itemSaldo, itemVincSummary, itemsForTab,
} = await import(new URL('../src/lib/stockItemUtils.js', import.meta.url).href);

const tela = () => ler('src/pages/Estoque.jsx');
const servico = () => ler('src/lib/stockService.js');

const item = (extra = {}) => ({ id: 'i1', name: 'Farinha', unit: 'kg', current_stock: 0, status: 'ativo', ...extra });
const VINC = { movements: [], purchaseItems: [], recipeIngredient: [] };

// --- 1. Botão visível -------------------------------------------------------
test('1. botão Excluir fica visível na linha, junto do Ajustar', () => {
  const src = tela();
  assert.match(src, /<Trash2/);
  // Mesmo container (flex) do Ajustar => visível, não escondido em menu.
  assert.match(src, /flex items-center gap-1"><Button size="sm" variant="outline" onClick=\{\(\)=>setAdjusting\(x\)\}>Ajustar<\/Button>\{ehAtivo\(x\)\?acaoExcluir\(x\):acaoReativar\(x\)\}/);
  assert.match(src, /title=\{`Excluir item \$\{x\.name\}`\}/);
});

// --- 2. Confirmação forte na exclusão física --------------------------------
test('2. exclusão física exige a confirmação forte e avisa que é definitiva', () => {
  const src = tela();
  assert.match(src, /Tem certeza que deseja excluir definitivamente este item\? Esta ação não poderá ser desfeita\./);
  // O botão confirma por extenso, nada de "Excluir" genérico no caminho físico.
  assert.match(src, /const rotuloAcaoExclusao=decisao\?\.mode===DELETE_MODE\.DELETE\?'Excluir definitivamente':'Desativar item'/);
  // E o texto forte mora numa constante nomeada, fora do ternário do JSX.
  assert.match(src, /const CONFIRMACAO_FISICA='Tem certeza que deseja excluir definitivamente este item\? Esta ação não poderá ser desfeita\.'/);
  assert.match(src, /const tituloExclusao=decisao\?\.mode===DELETE_MODE\.DELETE\?'Excluir definitivamente\?'/);
});

// --- 3. Cancelar não altera nada -------------------------------------------
test('3. cancelar não escreve nada: a escrita só existe no confirmador', () => {
  const src = tela();
  // Cancelar é só fechar: o `onFechar` limpa o estado local e nada mais.
  assert.match(src, /const fecharExclusao=\(\)=>\{if\(removingBusy\)return;setRemoving\(null\);setRemoveError\(''\);setRemovingVinc\(null\)\}/);
  // O diálogo só chama `onFechar`, nunca grava no banco.
  assert.match(src, /function ExcluirItemDialog\(\{aberto,decisao,titulo,texto,carregando,busy,erro,rotuloAcao,onFechar,onConfirmar\}\)/);
  assert.match(src, /<AlertDialog open=\{aberto\} onOpenChange=\{o=>\{if\(!o\)onFechar\(\)\}\}>/);
  // Fora dos dois confirmadores não pode haver delete/update de item.
  const fora = src.replace(/confirmarExclusao=[\s\S]*?\};/, '').replace(/confirmarReativar=[\s\S]*?\};/, '');
  assert.equal(/InventoryItem\.(delete|update)/.test(fora), false, 'escrita fora dos confirmadores');
});

// --- 4. Saldo zero + sem histórico + sem vínculos => exclusão física -------
test('4. item zerado, sem movimento e sem vínculo PODE ser excluído fisicamente', () => {
  const d = itemDecision(item(), VINC);
  assert.equal(d.mode, DELETE_MODE.DELETE);
  assert.equal(d.podeApagar, true);
  assert.equal(d.blocker, null);
});

// --- 5. Com movimento => exclusão física bloqueada -------------------------
test('5. item com movimentação NÃO pode ser excluído fisicamente', () => {
  const d = itemDecision(item(), { ...VINC, movements: [{ id: 'm1' }] });
  assert.equal(d.podeApagar, false);
  assert.notEqual(d.mode, DELETE_MODE.DELETE);
  assert.match(d.detalhe, /movimentação/);
});

// --- 6. Com movimento + saldo zero => desativação permitida ---------------
test('6. item com movimento e saldo zero PODE ser desativado (preserva histórico)', () => {
  const d = itemDecision(item(), { ...VINC, movements: [{ id: 'm1' }] });
  assert.equal(d.mode, DELETE_MODE.DEACTIVATE);
  assert.match(d.blocker, /histórico de movimentações e não pode ser apagado definitivamente/);
  assert.match(d.blocker, /Você pode desativá-lo para preservar o histórico/);
});

// --- 7 e 8. Saldo != 0 bloqueia os dois caminhos ----------------------------
test('7. item com saldo bloqueia a exclusão física', () => {
  const d = itemDecision(item({ current_stock: 7 }), VINC);
  assert.equal(d.mode, DELETE_MODE.BLOCKED);
  assert.equal(d.podeApagar, false);
  assert.equal(d.blocker, SALDO_MSG);
  assert.match(d.blocker, /Faça um ajuste para 0/);
});

test('8. item com saldo bloqueia TAMBÉM a desativação (não pode sumir da operação)', () => {
  const d = itemDecision(item({ current_stock: 7 }), { ...VINC, movements: [{ id: 'm1' }] });
  assert.equal(d.mode, DELETE_MODE.BLOCKED);
  assert.equal(d.blocker, SALDO_MSG);
});

test('8b. saldo negativo e fracionário bloqueiam (não arredondam para zero)', () => {
  assert.equal(itemDecision(item({ current_stock: 0.01 }), VINC).mode, DELETE_MODE.BLOCKED);
  assert.equal(itemDecision(item({ current_stock: -3 }), VINC).mode, DELETE_MODE.BLOCKED);
});

// --- 9 e 10. Vínculos -------------------------------------------------------
test('9. vínculo de compra impede exclusão física e oferece desativação', () => {
  const d = itemDecision(item(), { ...VINC, purchaseItems: [{ id: 'p1' }] });
  assert.equal(d.podeApagar, false);
  assert.equal(d.mode, DELETE_MODE.DEACTIVATE);
  assert.match(d.detalhe, /compras/);
});

test('10. vínculo de ficha técnica impede exclusão física e oferece desativação', () => {
  const d = itemDecision(item(), { ...VINC, recipeIngredient: [{ id: 'r1' }] });
  assert.equal(d.podeApagar, false);
  assert.equal(d.mode, DELETE_MODE.DEACTIVATE);
  assert.match(d.detalhe, /ficha técnica/);
});

test('10b. vários vínculos são explicados juntos, e o saldo vem primeiro', () => {
  const d = itemDecision(item({ current_stock: 4 }), {
    movements: [{ id: 'm1' }], purchaseItems: [{ id: 'p1' }], recipeIngredient: [],
  });
  // Saldo manda: é a única coisa que bloqueia de vez.
  assert.equal(d.mode, DELETE_MODE.BLOCKED);
  assert.equal(d.blocker, SALDO_MSG);

  const z = itemDecision(item(), {
    movements: [{ id: 'm1' }], purchaseItems: [{ id: 'p1' }], recipeIngredient: [{ id: 'r1' }],
  });
  assert.match(z.detalhe, /movimentação/);
  assert.match(z.detalhe, /compras/);
  assert.match(z.detalhe, /ficha técnica/);
});

// --- 11 e 12. Nada é apagado em cascata ------------------------------------
test('11. NENHUM StockMovement é apagado, em nenhum caminho', () => {
  for (const src of [tela(), servico()]) {
    assert.equal(/StockMovement\s*\.\s*delete\s*\(/.test(src), false, 'não pode apagar movimentação');
    assert.equal(/StockMovement\s*\.\s*deleteMany\s*\(/.test(src), false, 'não pode apagar movimentação em lote');
  }
});

test('12. não há cascata: nenhum deleteMany, e delete só do próprio item', () => {
  for (const src of [tela(), servico()]) {
    assert.equal(/deleteMany\s*\(/.test(src), false, 'não pode apagar em cascata');
  }
  // A tela não apaga nada diretamente: quem apaga é o serviço.
  assert.equal(/InventoryItem\.delete\s*\(/.test(tela()), false, 'a exclusão física fica no stockService');
  const deletes = servico().match(/InventoryItem\s*\.\s*delete\s*\(/g) || [];
  assert.equal(deletes.length, 1, 'exatamente um delete, no caminho de exclusão física');
});

test('12b. a desativação grava apenas o status (nada mais no item)', () => {
  assert.deepEqual(itemDeletePatch(item()), { status: 'inativo' });
  assert.equal('deleted' in itemDeletePatch(item()), false);
  assert.equal('current_stock' in itemDeletePatch(item()), false, 'desativar não mexe no saldo');
});

test('12c. reativar grava apenas o status de volta', () => {
  assert.deepEqual(itemReactivatePatch(), { status: 'ativo' });
  assert.equal('current_stock' in itemReactivatePatch(), false);
});

// --- 13 e 14. Abas e visibilidade ------------------------------------------
test('13. item desativado sai das opções operacionais (não aparece em Ativos)', () => {
  const lista = [item({ id: 'a', status: 'ativo' }), item({ id: 'b', status: 'inativo' })];
  assert.deepEqual(itemsForTab(lista, 'ativo').map((x) => x.id), ['a']);
  // Item sem `status` conta como ativo — é o que a tela já fazia.
  assert.deepEqual(itemsForTab([item({ id: 'c' })], 'ativo').map((x) => x.id), ['c']);
  // Compras/Produção já filtram por `status === 'ativo'`.
  assert.equal(lista.filter((x) => x.status === 'ativo').length, 1);
});

test('14. item inativo continua localizável pela aba Inativos/Todos', () => {
  const lista = [item({ id: 'a', status: 'ativo' }), item({ id: 'b', status: 'inativo' })];
  assert.deepEqual(itemsForTab(lista, 'inativo').map((x) => x.id), ['b']);
  assert.equal(itemsForTab(lista, 'todos').length, 2);
  assert.deepEqual(LIST_TABS.map((t) => t.key), ['ativo', 'inativo', 'todos']);
  // A tela precisa renderizar as três abas com contagem.
  assert.match(tela(), /LIST_TABS\.map\(/);
  assert.match(tela(), /itemsForTab\(items,t\.key\)\.length/);
});

// --- 15. Reativar -----------------------------------------------------------
test('15. reativar existe, é o botão do item inativo e mexe no MESMO registro', () => {
  const src = tela();
  assert.match(src, /<RotateCcw/);
  assert.match(src, /ehAtivo\(x\)\?acaoExcluir\(x\):acaoReativar\(x\)/);
  assert.match(src, /Reativar item\?/);
  // Reativar não cria item novo: é update de status no id existente.
  assert.equal(/(InventoryItem|StockMovement)\.create\s*\(/.test(src), false, 'reativar não cria registro');
  assert.match(servico(), /export async function reativarItem/);
  assert.match(servico(), /InventoryItem\.update\(atual\.id, \{ status: 'ativo' \}\)/);
});

// --- 16, 17 e 18. Auditoria -------------------------------------------------
test('16. exclusão física é auditada', () => {
  assert.match(tela(), /action:'exclusao'/);
  assert.match(tela(), /excluído definitivamente/);
});

test('17. desativação é auditada como `exclusao_logica` (diferente da física)', () => {
  assert.match(tela(), /action:'exclusao_logica'/);
  assert.match(tela(), /new_value:`status=\$\{r\.status\}`/);
});

test('18. reativação é auditada', () => {
  assert.match(tela(), /action:'reativacao'/);
  assert.match(tela(), /old_value:`status=\$\{reacting\.status\|\|'inativo'\}`/);
});

// --- 19. Consultas no banco completo ----------------------------------------
test('19. vínculos vêm do BANCO pelo id do item, não dos 1000 últimos movimentos', () => {
  const src = servico();
  // A tela carrega `moves` com teto; usar essa lista liberaria item com
  // histórico antigo que caísse fora dos 1000 mais recentes.
  assert.match(src, /StockMovement\.filter\(\{ inventory_item_id: itemId \}\)/);
  assert.match(src, /PurchaseItem\.filter\(\{ inventory_item_id: itemId \}\)/);
  assert.match(src, /RecipeIngredient\.filter\(\{ inventory_item_id: itemId \}\)/);
  assert.equal(tela().includes('inventory_item_id'), false, 'a tela não filtra vínculo por conta própria');
  assert.match(tela(), /buscarVinculosDoItem\(x\.id\)/);
});

test('19b. falha ao consultar vínculos ABORTA: nunca vira "sem vínculos"', () => {
  // Um `.catch(() => [])` converteria erro de rede em "item descartável".
  // No serviço não pode existir nenhum.
  assert.equal(/\.catch\(\s*\(\)\s*=>\s*\[\]\s*\)/.test(servico()), false, 'serviço engole falha de vínculo');
  // A tela guarda a mensagem e o botão fica travado: sem `removingVinc` a
  // decisão é desconhecida, e o serviço revalida antes de gravar.
  assert.match(tela(), /catch\(e\)\{setRemoveError\(e\?\.message\|\|'Não foi possível verificar os vínculos deste item\.'\)\}/);
  assert.match(tela(), /const carregandoVinc=Boolean\(removing\)&&removingVinc===null/);
  // O botão de confirmar só existe quando a decisão JÁ é conhecida: carregando
  // ou bloqueado, ele nem é renderizado.
  assert.match(tela(), /const podeConfirmar=Boolean\(decisao\)&&!carregando&&!bloqueado/);
  assert.match(tela(), /\{podeConfirmar&&<AlertDialogAction onClick=\{onConfirmar\}/);
});

// --- Guardas do serviço: a tela não é fonte de autoridade -------------------
test('o serviço revalida no banco antes de gravar e aborta se o modo não bater', () => {
  const src = servico();
  assert.match(src, /export async function excluirOuDesativarItem/);
  assert.match(src, /const atual = await relerItem\(item\)/);
  assert.match(src, /const vinculos = await buscarVinculosDoItem\(atual\.id\)/);
  assert.match(src, /const esperado = itemDecision\(atual, vinculos\)/);
  assert.match(src, /esperado\.mode === DELETE_MODE\.BLOCKED \|\| esperado\.mode !== mode/);
  assert.match(src, /'exclusao_bloqueada'/);
});

test('saldo é lido com tolerância a texto/ausência', () => {
  assert.equal(itemSaldo(item({ current_stock: 12.5 })), 12.5);
  assert.equal(itemSaldo(item({ current_stock: '3' })), 3);
  assert.equal(itemSaldo(item({ current_stock: null })), 0);
  assert.equal(itemSaldo(undefined), 0);
});

test('item inexistente é bloqueado com mensagem clara', () => {
  assert.match(itemDecision(null, VINC).blocker, /não encontrado/);
  assert.match(itemDecision({}, VINC).blocker, /não encontrado/);
});

test('resumo de vínculos lista as três fontes', () => {
  const s = itemVincSummary({ movements: [1, 2], purchaseItems: [1], recipeIngredient: [] });
  assert.match(s, /2 movimentação\(ões\)/);
  assert.match(s, /1 item\(ns\) de compra/);
  assert.equal(itemVincSummary(VINC), '');
});
