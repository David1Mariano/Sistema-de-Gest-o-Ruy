// Teste isolado do Delivery — so dados sinteticos, sem Supabase/producao.
// Roda com: node scripts/test-delivery.mjs
import { toCents, fromCents, brl, pctCents } from '../src/lib/delivery/money.js';
import { totalsOf, validateOrder, canTransition, suggestedPrice, maskPhone, DeliveryError } from '../src/lib/delivery/deliveryRules.js';
import { parseChannelCsv, dedupImport } from '../src/lib/delivery/channelConnectors.js';
import { createOrder, transitionOrder, findOrderByToken } from '../src/lib/delivery/deliveryService.js';

let falhas = 0;
function check(nome, cond, extra = '') { console.log(`${cond ? 'ok' : 'FALHOU'} - ${nome}${extra ? ` (${extra})` : ''}`); if (!cond) falhas++; }

// 1. centavos: 0.1+0.2 nao quebra
check('centavos 0.1+0.2', toCents('0,10') + toCents('0,20') === 30);
check('centavos 25,50', toCents('25,50') === 2550);
check('brl formata', brl(2550).includes('25,50'), brl(2550));
check('pct 27% de 10000', pctCents(10000, 27) === 2700);

// 2. totais: bruto - desconto + entrega - taxas
const t = totalsOf({ items: [{ qty: 2, unit_price_cents: 1000 }], discount_cents: 100, delivery_fee_cents: 500, channel: 'ifood' });
check('bruto 2000', t.gross_cents === 2000);
check('taxa ifood 540', t.platform_fee_cents === 540, String(t.platform_fee_cents));
check('liquido 2000-100+500-540=1860', t.net_cents === 1860, String(t.net_cents));

// 3. validacao rejeita pedido vazio
let e1 = null; try { validateOrder({ customer_name: '', items: [], channel: 'ifood', fulfillment: 'entrega' }); } catch (e) { e1 = e; }
check('pedido sem cliente rejeitado', e1 instanceof DeliveryError);

// 4. maquina de estados
check('novo->preparo ok', canTransition('novo', 'preparo'));
check('novo->entregue bloqueado', !canTransition('novo', 'entregue'));
check('entregue->recebido ok', canTransition('entregue', 'recebido'));

// 5. preco sugerido cobre taxa
check('sugerido ifood > base', suggestedPrice(1000, 'ifood') >= 1370, String(suggestedPrice(1000, 'ifood')));
check('sugerido balcao = base', suggestedPrice(1000, 'balcao') === 1000);

// 6. LGPD mascara telefone
check('telefone mascarado', maskPhone('11999990001') === '(11) ••••-0001', maskPhone('11999990001'));

// 7. CSV com conferencia + dedup
const csv = 'external_id;data;cliente;telefone;canal;item;qtd;preco;taxa_entrega;desconto;pagamento\nIF-1;2026-10-15;Ana;119;ifood;Caldo;2;8,00;5,00;0;pix\nRUIM;2026-10-15;;;ifood;;x;0;0;0;pix';
const p = parseChannelCsv(csv);
check('csv: 1 linha valida', p.rows.length === 1, JSON.stringify(p.rows.length));
check('csv: erro apontado', p.errors.length >= 1);
const d = dedupImport([{ external_id: 'IF-1' }, { external_id: 'IF-1' }, { external_id: 'IF-2' }], []);
check('dedup: 2 novos 1 duplicado', d.fresh.length === 2 && d.skipped.length === 1);

// 8. servico idempotente (banco fake em memoria)
function fakeDb() {
  const store = { DeliveryOrder: [], DeliveryOrderItem: [], DeliveryAuditEvent: [] };
  const mk = (n) => ({
    async create(r) { const rec = { ...r, id: `id${store[n].length + 1}` }; store[n].push(rec); return rec; },
    async filter(q) { return store[n].filter((r) => Object.entries(q || {}).every(([k, v]) => r[k] === v)); },
    async get(id) { return store[n].find((r) => r.id === id) || null; },
    async transact(id, fn) { const i = store[n].findIndex((r) => r.id === id); const patch = await fn({ ...store[n][i] }); store[n][i] = { ...store[n][i], ...patch }; return store[n][i]; },
    async bulkCreate(items) { const out = items.map((r, k) => ({ ...r, id: `it${store[n].length + k}` })); store[n].push(...out); return out; },
  });
  return { entities: { DeliveryOrder: mk('DeliveryOrder'), DeliveryOrderItem: mk('DeliveryOrderItem'), DeliveryPayment: mk('DeliveryOrder'), DeliveryFee: mk('DeliveryOrder'), DeliveryDriverAssignment: mk('DeliveryOrder'), DeliveryAuditEvent: mk('DeliveryAuditEvent') } };
}
const db = fakeDb();
const input = { client_token: 'tok1', customer_name: 'Teste', channel: 'whatsapp', fulfillment: 'entrega', items: [{ product_name: 'Caldo', qty: 1, unit_price_cents: 800 }] };
const r1 = await createOrder(db, input, { user: 'agente1' });
const r2 = await createOrder(db, input, { user: 'agente1' });
check('idempotencia: 2o envio duplicado', r2.duplicated === true && r1.order.id === r2.order.id);
const mov = await transitionOrder(db, r1.order.id, 'preparo', { user: 'agente1' });
check('transicao novo->preparo', mov.status === 'preparo');
let e2 = null; try { await transitionOrder(db, r1.order.id, 'entregue', { user: 'a' }); } catch (e) { e2 = e; }
check('transicao invalida rejeitada', e2 instanceof DeliveryError);
let e3 = null; try { await transitionOrder(db, r1.order.id, 'cancelado', { user: 'a' }); } catch (e) { e3 = e; }
check('cancelar sem motivo rejeitado', e3 instanceof DeliveryError);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo OK — delivery isolado e testado.');
process.exit(falhas ? 1 : 0);
