import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { CONTACT_ACTIONS, CONVERSATION_MODES, PersistentConversationService, contactAction } from '../supabase/functions/_shared/delivery-contacts.mjs';
import { ToolRegistry } from '../supabase/functions/_shared/delivery-assistant.mjs';
import { managementHandler } from '../supabase/functions/_shared/handlers.mjs';
import { repository } from '../supabase/functions/_shared/repository.mjs';

// Esta suíte usa apenas PostgreSQL em memória (PGlite), duplos de teste e tokens
// sintéticos. Nenhum banco real, migration aplicada, mensagem enviada, pedido criado,
// plataforma chamada ou modelo de IA pago é acessado.
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_CONTACT_TESTS'); };

const OPERATOR = '11111111-1111-4111-8111-111111111111';
const OTHER_OPERATOR = '22222222-2222-4222-8222-222222222222';
const VIEWER = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';

let db = null;
async function open() {
  if (!db) {
    db = new PGlite();
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(await readFile(new URL('../supabase/migrations/20260929000100_delivery_conversations.sql', import.meta.url), 'utf8'));
    await db.exec('set role service_role');
  }
  return db;
}
after(async () => { if (db) await db.close(); });

// Ingestão confiável: mesmos parâmetros nomeados da RPC, sem inventar campo ausente.
const receive = (database, { provider = 'whatsapp', merchant = 'loja-a', customer = 'cli-1', conversation = 'conv-1',
  message = 'msg-1', body = 'Bom dia', occurredAt = '2020-01-01T12:00:00Z', name = null, phone = null } = {}) =>
  database.query('select delivery_receive_message($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9) as conversation',
    [provider, merchant, customer, conversation, message, body, occurredAt, name, phone]);
const handoff = (database, { actor = OPERATOR, provider = 'whatsapp', merchant = 'loja-a', conversation, version, mode = 'human' }) =>
  database.query('select delivery_set_handoff($1,$2,$3,$4,$5::integer,$6) as result', [actor, provider, merchant, conversation, version, mode]);
const saveDraft = (database, { provider = 'whatsapp', merchant = 'loja-a', customer, conversation, version, message, reply = 'rascunho' }) =>
  database.query('select delivery_save_ai_draft($1,$2,$3,$4,$5::integer,$6,$7) as saved', [provider, merchant, customer, conversation, version, message, reply]);
const grant = (database, { user = OPERATOR, provider = 'whatsapp', merchant = 'loja-a', manage = true }) =>
  database.query('insert into delivery_operator_scopes(user_id,provider,merchant_id,can_manage) values($1,$2,$3,$4)', [user, provider, merchant, manage]);
const conversation = async (database, id) => (await database.query('select * from delivery_conversations where id=$1', [id])).rows[0];
const history = async (database, id) => (await database.query('select * from delivery_messages where conversation_id=$1 order by occurred_at,id', [id])).rows;
const auditCount = async (database, id) => (await database.query('select count(*)::int as count from delivery_handoff_audit where conversation_id=$1', [id])).rows[0].count;
const firstConversation = rows => rows[0].conversation;
test('Atendimento: anon/authenticated não acessam tabelas nem RPCs; nenhuma policy é criada', async () => {
  const db = await open();
  const tables = ['delivery_operator_scopes', 'delivery_customers', 'delivery_conversations', 'delivery_messages', 'delivery_handoff_audit'];
  const list = tables.map(table => `'${table}'`).join(',');
  assert.equal((await db.query(`select count(*)::int as count from pg_policies where tablename in (${list})`)).rows[0].count, 0);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of tables) await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
    await assert.rejects(db.query("select delivery_receive_message('ifood','loja','cli','conv','msg','corpo','2020-01-01T00:00:00Z')"), /permission denied/);
    await assert.rejects(db.query('select delivery_set_handoff($1,$2,$3,$4,$5,$6)', [OPERATOR, 'ifood', 'loja', CONVERSATION, 0, 'human']), /permission denied/);
    await assert.rejects(db.query('select delivery_save_ai_draft($1,$2,$3,$4,$5,$6,$7)', ['ifood', 'loja', CUSTOMER, CONVERSATION, 1, 'msg', 'reply']), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal((await receive(db, { merchant: 'loja-rls', conversation: 'conv-rls', message: 'msg-rls' })).rows.length, 1);
});

test('Atendimento: cliente criado por ingestão confiável; replay não duplica nem inventa dados ausentes', async () => {
  const db = await open();
  const values = { merchant: 'loja-novo', customer: 'cli-novo', conversation: 'conv-novo', message: 'msg-novo', body: 'Olá' };
  const id = firstConversation((await receive(db, values)).rows);
  assert.equal(firstConversation((await receive(db, values)).rows), id);
  const customers = await db.query("select * from delivery_customers where provider='whatsapp' and merchant_id='loja-novo'");
  assert.equal(customers.rows.length, 1);
  assert.equal(customers.rows[0].name, null);
  assert.equal(customers.rows[0].phone, null);
  const current = await conversation(db, id);
  assert.equal(current.mode, 'human'); // nenhuma resposta automática é habilitada implicitamente
  assert.equal(current.version, 1);    // replay não altera a versão
  assert.equal(current.assigned_to, null);
  const messages = await history(db, id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].direction, 'inbound');
  assert.equal(messages[0].author, 'customer');
  assert.equal(messages[0].status, 'received');
  assert.equal(messages[0].invalidated, false);
  assert.equal(messages[0].conversation_version, 1);
  // Horário do provedor e horário de recebimento são preservados separadamente.
  assert.ok(new Date(messages[0].received_at) >= new Date(messages[0].occurred_at));
});
test('Atendimento: telefone nunca identifica nem associa clientes', async () => {
  const db = await open();
  const phone = '+5511999990000';
  await receive(db, { merchant: 'loja-tel', customer: 'cli-a', conversation: 'conv-tel-a', message: 'msg-tel-a', name: 'Cliente A', phone });
  await receive(db, { merchant: 'loja-tel', customer: 'cli-b', conversation: 'conv-tel-b', message: 'msg-tel-b', phone });
  const rows = await db.query("select external_id,phone from delivery_customers where merchant_id='loja-tel' order by external_id");
  assert.deepEqual(rows.rows.map(row => row.external_id), ['cli-a', 'cli-b']);
  assert.equal(rows.rows[0].phone, rows.rows[1].phone); // mesmo telefone, clientes distintos
  // Dado novo preenche apenas lacuna e nunca sobrescreve identidade já registrada.
  await receive(db, { merchant: 'loja-tel', customer: 'cli-a', conversation: 'conv-tel-a', message: 'msg-tel-a2', name: 'Outro Nome', phone: '+5511988887777' });
  const filled = (await db.query("select name,phone from delivery_customers where merchant_id='loja-tel' and external_id='cli-a'")).rows[0];
  assert.equal(filled.name, 'Cliente A');
  assert.equal(filled.phone, phone);
  await receive(db, { merchant: 'loja-tel', customer: 'cli-b', conversation: 'conv-tel-b', message: 'msg-tel-b2', name: 'Cliente B' });
  assert.equal((await db.query("select name from delivery_customers where merchant_id='loja-tel' and external_id='cli-b'")).rows[0].name, 'Cliente B');
});

test('Atendimento: mesmo identificador externo em lojas/provedores distintos não colide', async () => {
  const db = await open();
  const cases = [['ifood', 'loja-multi-1'], ['ifood', 'loja-multi-2'], ['whatsapp', 'loja-multi-1']];
  const conversations = [];
  for (const [provider, merchant] of cases) {
    conversations.push(firstConversation((await receive(db, { provider, merchant, customer: 'cli-x', conversation: 'conv-x',
      message: 'msg-x', body: 'mesmo identificador', occurredAt: '2020-02-01T10:00:00Z' })).rows));
  }
  assert.equal(new Set(conversations).size, 3);
  assert.equal((await db.query("select count(*)::int as count from delivery_customers where external_id='cli-x'")).rows[0].count, 3);
  assert.equal((await db.query("select count(*)::int as count from delivery_conversations where external_id='conv-x'")).rows[0].count, 3);
  assert.equal((await db.query("select count(*)::int as count from delivery_messages where external_id='msg-x'")).rows[0].count, 3);
  // Replay do mesmo provedor/loja continua sendo a mesma conversa daquele escopo.
  const replay = await receive(db, { provider: 'ifood', merchant: 'loja-multi-1', customer: 'cli-x', conversation: 'conv-x',
    message: 'msg-x', body: 'mesmo identificador', occurredAt: '2020-02-01T10:00:00Z' });
  assert.equal(firstConversation(replay.rows), conversations[0]);
});
test('Atendimento: conversa deduplica por provider/loja, versiona e não colide entre lojas', async () => {
  const db = await open();
  const first = firstConversation((await receive(db, { merchant: 'loja-conv', conversation: 'conv-dedup', message: 'msg-1' })).rows);
  await receive(db, { merchant: 'loja-conv', conversation: 'conv-dedup', message: 'msg-2', occurredAt: '2020-01-01T13:00:00Z' });
  assert.equal((await db.query("select count(*)::int as count from delivery_conversations where merchant_id='loja-conv'")).rows[0].count, 1);
  const current = await conversation(db, first);
  assert.equal(current.version, 2); // uma versão por mensagem aceita
  assert.equal((await history(db, first)).length, 2);
  await receive(db, { merchant: 'loja-conv-2', conversation: 'conv-dedup', message: 'msg-1' });
  assert.equal((await db.query("select count(*)::int as count from delivery_conversations where external_id='conv-dedup'")).rows[0].count, 2);
  await assert.rejects(receive(db, { merchant: 'loja-conv', conversation: 'conv-dedup', message: 'msg-2', occurredAt: '2020-01-01T14:00:00Z' }), /MESSAGE_ID_CONFLICT/);
  await assert.rejects(receive(db, { merchant: 'loja-conv', conversation: 'conv-dedup', message: 'msg-2', body: 'outro corpo', occurredAt: '2020-01-01T13:00:00Z' }), /MESSAGE_ID_CONFLICT/);
});

test('Atendimento: mensagem exige identificador, corpo e horário do provedor', async () => {
  const db = await open();
  await assert.rejects(receive(db, { merchant: 'loja-val', conversation: 'conv-val', message: 'msg-val', occurredAt: null }), /INVALID_MESSAGE_DATE/);
  await assert.rejects(receive(db, { merchant: 'loja-val', conversation: 'conv-val', message: 'msg-val', body: '' }), /INVALID_MESSAGE/);
  await assert.rejects(receive(db, { merchant: 'loja-val', conversation: 'conv-val', message: null }), /INVALID_MESSAGE_ID/);
  await assert.rejects(receive(db, { provider: 'invented', merchant: 'loja-val', conversation: 'conv-val', message: 'msg-val' }), /UNKNOWN_PROVIDER/);
  assert.equal((await db.query("select count(*)::int as count from delivery_conversations where merchant_id='loja-val'")).rows[0].count, 0);
});

test('Atendimento: mensagens fora de ordem preservam horário do provedor e do recebimento', async () => {
  const db = await open();
  const id = firstConversation((await receive(db, { merchant: 'loja-ordem', conversation: 'conv-ordem', message: 'msg-12', occurredAt: '2020-01-01T12:00:00Z' })).rows);
  await receive(db, { merchant: 'loja-ordem', conversation: 'conv-ordem', message: 'msg-13', occurredAt: '2020-01-01T13:00:00Z' });
  await receive(db, { merchant: 'loja-ordem', conversation: 'conv-ordem', message: 'msg-11', occurredAt: '2020-01-01T11:00:00Z' });
  const messages = await history(db, id);
  // A ordem da conversa segue o provedor, não a ordem de chegada.
  assert.deepEqual(messages.map(row => row.external_id), ['msg-11', 'msg-12', 'msg-13']);
  assert.deepEqual(messages.map(row => row.conversation_version), [3, 1, 2]);
  assert.equal(new Date(messages[2].occurred_at).toISOString(), '2020-01-01T13:00:00.000Z');
  assert.ok(new Date(messages[0].received_at) > new Date(messages[2].occurred_at)); // recebida por último, ocorrida primeiro
  const current = await conversation(db, id);
  assert.equal(current.version, 3);        // versão sempre monotônica
  assert.equal(current.mode, 'human');     // mensagem atrasada não altera modo nem responsável
  assert.equal(current.assigned_to, null);
});

test('Atendimento: leitura por loja não alcança dados de outra loja ou provedor', async () => {
  const db = await open();
  await receive(db, { merchant: 'loja-iso-a', customer: 'cli-iso-a', conversation: 'conv-iso-a', message: 'msg-iso-a' });
  await receive(db, { merchant: 'loja-iso-b', customer: 'cli-iso-b', conversation: 'conv-iso-b', message: 'msg-iso-b' });
  await receive(db, { provider: 'ifood', merchant: 'loja-iso-a', customer: 'cli-iso-c', conversation: 'conv-iso-c', message: 'msg-iso-c' });
  const a = await db.query('select id from delivery_conversations where provider=$1 and merchant_id=$2', ['whatsapp', 'loja-iso-a']);
  const b = await db.query('select id from delivery_conversations where provider=$1 and merchant_id=$2', ['whatsapp', 'loja-iso-b']);
  assert.equal(a.rows.length, 1);
  assert.equal(b.rows.length, 1);
  assert.notEqual(a.rows[0].id, b.rows[0].id);
  assert.deepEqual((await db.query('select external_id from delivery_messages where conversation_id=$1', [a.rows[0].id])).rows.map(row => row.external_id), ['msg-iso-a']);
  // Mesmo cliente externo em provedor diferente permanece registro distinto.
  assert.equal((await db.query('select count(*)::int as count from delivery_customers where merchant_id=$1', ['loja-iso-a'])).rows[0].count, 2);
});

test('Atendimento: cliente divergente na mesma conversa é rejeitado', async () => {
  const db = await open();
  const id = firstConversation((await receive(db, { merchant: 'loja-mismatch', customer: 'cli-dono', conversation: 'conv-mismatch', message: 'msg-dono' })).rows);
  await assert.rejects(receive(db, { merchant: 'loja-mismatch', customer: 'cli-outro', conversation: 'conv-mismatch', message: 'msg-outro' }), /CUSTOMER_SCOPE_MISMATCH/);
  // A operação conflitante não deixa cliente órfão nem mensagem parcial: a conversa
  // continua pertencendo ao cliente originalmente vinculado.
  assert.equal((await db.query("select count(*)::int as count from delivery_customers where merchant_id='loja-mismatch'")).rows[0].count, 1);
  assert.equal((await conversation(db, id)).customer_id, (await db.query("select id from delivery_customers where external_id='cli-dono'")).rows[0].id);
  assert.equal((await history(db, id)).length, 1);
});
test('Handoff: operador autorizado assume, versão muda e a auditoria registra um evento', async () => {
  const db = await open();
  await grant(db, { merchant: 'loja-hand' });
  const id = firstConversation((await receive(db, { merchant: 'loja-hand', conversation: 'conv-hand', message: 'msg-hand' })).rows);
  const result = await handoff(db, { merchant: 'loja-hand', conversation: id, version: 1, mode: 'human' });
  assert.deepEqual(result.rows[0].result, { mode: 'human', version: 2, idempotent: false });
  const current = await conversation(db, id);
  assert.equal(current.mode, 'human');
  assert.equal(current.assigned_to, OPERATOR);
  assert.equal(current.version, 2);
  assert.equal(await auditCount(db, id), 1);
  const audit = (await db.query('select actor_id,mode,version from delivery_handoff_audit where conversation_id=$1', [id])).rows[0];
  assert.equal(audit.actor_id, OPERATOR);
  assert.equal(audit.mode, 'human');
  assert.equal(audit.version, 2);
  // Nenhuma mensagem, pedido ou valor financeiro é criado pelo handoff.
  assert.equal((await history(db, id)).length, 1);
});

test('Handoff: operador sem autorização na loja é rejeitado sem efeito colateral', async () => {
  const db = await open();
  await grant(db, { merchant: 'loja-outra' });                       // OPERATOR autorizado só em outra loja
  await grant(db, { merchant: 'loja-negado', user: VIEWER, manage: false });
  const id = firstConversation((await receive(db, { merchant: 'loja-negado', conversation: 'conv-negado', message: 'msg-negado' })).rows);
  await assert.rejects(handoff(db, { merchant: 'loja-negado', conversation: id, version: 1, mode: 'human' }), /CONTACT_ACCESS_DENIED/);
  await assert.rejects(handoff(db, { actor: VIEWER, merchant: 'loja-negado', conversation: id, version: 1, mode: 'human' }), /CONTACT_ACCESS_DENIED/);
  const current = await conversation(db, id);
  assert.equal(current.version, 1);
  assert.equal(current.mode, 'human');
  assert.equal(current.assigned_to, null);
  assert.equal(await auditCount(db, id), 0);
});

test('Handoff: repetição é idempotente; troca de responsável e versão antiga são controladas', async () => {
  const db = await open();
  await grant(db, { merchant: 'loja-idem' });
  await grant(db, { merchant: 'loja-idem', user: OTHER_OPERATOR });
  const id = firstConversation((await receive(db, { merchant: 'loja-idem', conversation: 'conv-idem', message: 'msg-idem' })).rows);
  assert.deepEqual((await handoff(db, { merchant: 'loja-idem', conversation: id, version: 1, mode: 'human' })).rows[0].result, { mode: 'human', version: 2, idempotent: false });
  // Mesmo clique novamente: nada é duplicado e a versão não é corrompida.
  assert.deepEqual((await handoff(db, { merchant: 'loja-idem', conversation: id, version: 1, mode: 'human' })).rows[0].result, { mode: 'human', version: 2, idempotent: true });
  assert.equal((await conversation(db, id)).version, 2);
  assert.equal(await auditCount(db, id), 1);
  // Outro operador autorizado assume o atendimento: nova versão e novo evento.
  assert.deepEqual((await handoff(db, { actor: OTHER_OPERATOR, merchant: 'loja-idem', conversation: id, version: 2, mode: 'human' })).rows[0].result, { mode: 'human', version: 3, idempotent: false });
  assert.equal((await conversation(db, id)).assigned_to, OTHER_OPERATOR);
  assert.equal(await auditCount(db, id), 2);
  // Versão antiga de outra situação não sobrescreve estado mais novo.
  await assert.rejects(handoff(db, { merchant: 'loja-idem', conversation: id, version: 1, mode: 'ai' }), /CONVERSATION_CHANGED/);
  await assert.rejects(handoff(db, { merchant: 'loja-idem', conversation: id, version: 9, mode: 'ai' }), /CONVERSATION_CHANGED/);
  await assert.rejects(handoff(db, { merchant: 'loja-idem', conversation: id, version: 3, mode: 'auto' }), /INVALID_HANDOFF_MODE/);
  await assert.rejects(handoff(db, { merchant: 'loja-idem', conversation: id, version: -1, mode: 'human' }), /INVALID_HANDOFF_VERSION/);
  const current = await conversation(db, id);
  assert.equal(current.version, 3);
  assert.equal(current.mode, 'human');
  assert.equal(await auditCount(db, id), 2);
});
test('IA: rascunho persiste quando a versão não mudou e modo humano bloqueia resposta automática', async () => {
  const db = await open();
  await grant(db, { merchant: 'loja-ia' });
  const id = firstConversation((await receive(db, { merchant: 'loja-ia', conversation: 'conv-ia', message: 'msg-ia', body: 'Tem cardápio?' })).rows);
  const customer = (await conversation(db, id)).customer_id;
  // Conversa nasce em modo humano: nenhuma resposta automática é gravada.
  assert.equal((await saveDraft(db, { merchant: 'loja-ia', customer, conversation: id, version: 1, message: 'msg-ia' })).rows[0].saved, false);
  assert.deepEqual((await handoff(db, { merchant: 'loja-ia', conversation: id, version: 1, mode: 'ai' })).rows[0].result, { mode: 'ai', version: 2, idempotent: false });
  // Mensagem de origem precisa existir nesta conversa.
  await assert.rejects(saveDraft(db, { merchant: 'loja-ia', customer, conversation: id, version: 2, message: 'msg-inexistente' }), /MESSAGE_NOT_FOUND/);
  // Escopo errado nunca alcança a conversa.
  await assert.rejects(saveDraft(db, { merchant: 'loja-fora', customer, conversation: id, version: 2, message: 'msg-ia' }), /CONVERSATION_NOT_FOUND/);
  await assert.rejects(saveDraft(db, { merchant: 'loja-ia', customer: OTHER_OPERATOR, conversation: id, version: 2, message: 'msg-ia' }), /CONVERSATION_NOT_FOUND/);
  // Versão inalterada: rascunho persistido, uma única vez.
  assert.equal((await saveDraft(db, { merchant: 'loja-ia', customer, conversation: id, version: 2, message: 'msg-ia', reply: 'Cardápio disponível.' })).rows[0].saved, true);
  const draft = (await history(db, id)).find(row => row.direction === 'outbound');
  assert.equal(draft.author, 'ai');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.invalidated, false);
  assert.equal(draft.conversation_version, 3);
  assert.equal((await conversation(db, id)).version, 3);
  assert.equal((await conversation(db, id)).mode, 'ai');
  // Replay do mesmo rascunho não duplica mensagem.
  assert.equal((await saveDraft(db, { merchant: 'loja-ia', customer, conversation: id, version: 3, message: 'msg-ia' })).rows[0].saved, false);
  assert.equal((await history(db, id)).filter(row => row.direction === 'outbound').length, 1);
  // Handoff humano invalida rascunho pendente e impede novas respostas automáticas.
  await handoff(db, { merchant: 'loja-ia', conversation: id, version: 3, mode: 'human' });
  assert.equal((await saveDraft(db, { merchant: 'loja-ia', customer, conversation: id, version: 4, message: 'msg-ia' })).rows[0].saved, false);
  const invalidated = (await history(db, id)).find(row => row.direction === 'outbound');
  assert.equal(invalidated.status, 'invalidated');
  assert.equal(invalidated.invalidated, true);
  assert.equal((await db.query("select count(*)::int as count from delivery_messages where (status='invalidated') <> invalidated")).rows[0].count, 0);
});

test('IA: resposta atrasada é descartada depois do handoff e nenhuma mensagem outbound é criada', async () => {
  const db = await open();
  await grant(db, { merchant: 'loja-versao' });
  let id;
  for (let index = 1; index <= 9; index += 1) {
    id = firstConversation((await receive(db, { merchant: 'loja-versao', conversation: 'conv-versao', message: `msg-${index}`,
      body: `mensagem ${index}`, occurredAt: `2020-03-01T0${index}:00:00Z` })).rows);
  }
  const customer = (await conversation(db, id)).customer_id;
  assert.equal((await conversation(db, id)).version, 9);
  // IA habilitada explicitamente pelo operador autorizado: conversa na versão 10.
  assert.deepEqual((await handoff(db, { merchant: 'loja-versao', conversation: id, version: 9, mode: 'ai' })).rows[0].result, { mode: 'ai', version: 10, idempotent: false });
  const aiVersion = (await conversation(db, id)).version;
  assert.equal(aiVersion, 10);
  // Humano assume durante o processamento: versão 11 e modo humano.
  assert.deepEqual((await handoff(db, { merchant: 'loja-versao', conversation: id, version: aiVersion, mode: 'human' })).rows[0].result, { mode: 'human', version: 11, idempotent: false });
  // IA termina e tenta persistir a resposta antiga com a versão 10: descartada.
  assert.equal((await saveDraft(db, { merchant: 'loja-versao', customer, conversation: id, version: aiVersion, message: 'msg-9', reply: 'Resposta atrasada da IA.' })).rows[0].saved, false);
  const current = await conversation(db, id);
  assert.equal(current.version, 11);
  assert.equal(current.mode, 'human');
  assert.equal(current.assigned_to, OPERATOR);
  assert.equal((await history(db, id)).filter(row => row.direction === 'outbound').length, 0);
  assert.equal((await history(db, id)).length, 9);
  assert.equal(await auditCount(db, id), 2);
});
// Duplo de teste do repositório: nenhuma rede, nenhuma credencial e nenhum provedor.
function contactRepo(overrides = {}) {
  return {
    contactScopes: async actor => [{ provider: 'whatsapp', merchant_id: 'loja-a', can_manage: actor === OPERATOR }],
    contactScope: async actor => ({ can_manage: actor === OPERATOR }),
    customers: async () => [], conversations: async () => [], messages: async () => [],
    conversation: async () => ({ id: CONVERSATION, customer_id: CUSTOMER, mode: 'ai', version: 4 }),
    rpc: async () => ({ mode: 'human', version: 5, idempotent: false }),
    ...overrides,
  };
}

test('Ações de atendimento: autorização por loja, provedor conhecido e entradas validadas', async () => {
  // Escopos vêm do token verificado; o navegador nunca informa o próprio escopo.
  const scopes = await contactAction({ action: 'contact_scopes' }, VIEWER, contactRepo());
  assert.deepEqual(CONTACT_ACTIONS, ['contact_scopes', 'customers', 'conversations', 'messages', 'handoff', 'audit', 'mark_read']);
  assert.deepEqual(CONVERSATION_MODES, ['ai', 'human']);
  assert.equal(scopes.rows[0].can_manage, false);
  // Provedor desconhecido é rejeitado antes de qualquer consulta.
  await assert.rejects(contactAction({ action: 'customers', provider: 'invented', merchantId: 'loja-a' }, OPERATOR, contactRepo()), /UNKNOWN_PROVIDER/);
  // Operador sem escopo na loja não lê dados dela.
  await assert.rejects(contactAction({ action: 'customers', provider: 'whatsapp', merchantId: 'loja-b' }, OTHER_OPERATOR,
    contactRepo({ contactScope: async () => undefined })), error => error.code === 'CONTACT_ACCESS_DENIED' && error.status === 403);
  // Viewer autorizado lê a própria loja, mas não assume nem devolve o atendimento.
  const view = await contactAction({ action: 'conversations', provider: 'whatsapp', merchantId: 'loja-a' }, VIEWER, contactRepo());
  assert.equal(view.canManage, false);
  await assert.rejects(contactAction({ action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 4, mode: 'human' }, VIEWER, contactRepo()), /CONTACT_ACCESS_DENIED/);
  // Operador autorizado assume enviando a versão lida (controle de concorrência).
  let sent;
  const managed = await contactAction({ action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 4, mode: 'human' },
    OPERATOR, contactRepo({ rpc: async (name, body) => { sent = [name, body]; return { mode: 'human', version: 5, idempotent: false }; } }));
  assert.deepEqual(sent, ['delivery_set_handoff', { p_actor: OPERATOR, p_provider: 'whatsapp', p_merchant: 'loja-a', p_conversation: CONVERSATION, p_expected: 4, p_mode: 'human' }]);
  assert.deepEqual(managed, { mode: 'human', version: 5, idempotent: false });
  // Mensagens só são lidas de conversa existente no escopo autorizado.
  await assert.rejects(contactAction({ action: 'messages', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION }, OPERATOR,
    contactRepo({ conversation: async () => undefined })), error => error.code === 'CONVERSATION_NOT_FOUND' && error.status === 404);
  // Entradas inválidas nunca chegam ao banco nem ao provedor.
  for (const invalid of [{ version: 4, mode: 'auto' }, { version: -1, mode: 'human' }, { version: 4.5, mode: 'human' }, { version: 4 }]) {
    await assert.rejects(contactAction({ action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, ...invalid }, OPERATOR, contactRepo()), /INVALID_HANDOFF_MODE/);
  }
  await assert.rejects(contactAction({ action: 'messages', provider: 'whatsapp', merchantId: 'loja-a', conversationId: 'nao-uuid' }, OPERATOR, contactRepo()), /INVALID_IDENTIFIER/);
  await assert.rejects(contactAction({ action: 'customers', provider: 'whatsapp', merchantId: 'loja-a', offset: 1.5 }, OPERATOR, contactRepo()), /INVALID_PERIOD/);
});
const CONF = { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'anon-test-key', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  DELIVERY_ADMIN_USER_IDS: OPERATOR, DELIVERY_VIEWER_USER_IDS: VIEWER, DELIVERY_ALLOWED_ORIGINS: 'https://app.invalid' };

test('Repository: consultas de atendimento filtram provider/loja e erros conhecidos são explícitos', async () => {
  const calls = [];
  const repo = repository(CONF, async (url, init) => { calls.push([url, init]); return Response.json([]); });
  await repo.contactScopes(OPERATOR);
  await repo.contactScope(OPERATOR, 'whatsapp', 'loja-a');
  await repo.customers('whatsapp', 'loja-a', 0);
  await repo.conversations('whatsapp', 'loja-a', 100);
  await repo.messages(CONVERSATION, 0);
  assert.ok(calls[0][0].startsWith('https://example.invalid/rest/v1/delivery_operator_scopes?user_id=eq.'));
  assert.ok(calls[1][0].includes('user_id=eq.') && calls[1][0].includes('provider=eq.whatsapp') && calls[1][0].includes('merchant_id=eq.loja-a'));
  assert.ok(calls[2][0].includes('provider=eq.whatsapp') && calls[2][0].includes('merchant_id=eq.loja-a'));
  assert.ok(calls[3][0].includes('provider=eq.whatsapp') && calls[3][0].includes('merchant_id=eq.loja-a') && calls[3][0].includes('offset=100'));
  assert.ok(calls[4][0].includes(`conversation_id=eq.${CONVERSATION}`));
  assert.ok(calls[4][0].includes('direction') && calls[4][0].includes('author') && calls[4][0].includes('status'));
  assert.ok(calls.every(([url]) => !url.includes('sealed_credentials') && !url.includes('service_role')));
  // RPC de handoff é POST autenticado no servidor e devolve o JSON do banco.
  let posted;
  const rpc = repository(CONF, async (url, init) => { posted = [url, init]; return Response.json({ mode: 'human', version: 5, idempotent: false }); });
  assert.deepEqual(await rpc.rpc('delivery_set_handoff', { p_actor: OPERATOR }), { mode: 'human', version: 5, idempotent: false });
  assert.equal(posted[1].method, 'POST');
  assert.ok(posted[0].endsWith('/rest/v1/rpc/delivery_set_handoff'));
  assert.ok(posted[1].headers.Authorization.startsWith('Bearer '));
  // Erros das RPCs de atendimento são traduzidos explicitamente.
  const failing = (message, status) => repository(CONF, async () => Response.json({ message }, { status }));
  for (const [code, status] of [['CONTACT_ACCESS_DENIED', 403], ['CONVERSATION_CHANGED', 409], ['CONVERSATION_NOT_FOUND', 404],
    ['INVALID_HANDOFF_MODE', 400], ['INVALID_HANDOFF_VERSION', 400], ['MESSAGE_ID_CONFLICT', 409], ['CUSTOMER_SCOPE_MISMATCH', 409],
    ['MESSAGE_NOT_FOUND', 404], ['UNKNOWN_PROVIDER', 400]]) {
    await assert.rejects(failing(code, status).rpc('delivery_set_handoff', {}), error => error.code === code && error.status === status);
  }
  // Erro desconhecido não vaza detalhe do banco.
  await assert.rejects(failing('relation "delivery_messages" does not exist', 500).rpc('delivery_set_handoff', {}),
    error => error.code === 'PERSISTENCE_UNAVAILABLE' && !error.message.includes('relation'));
});

test('Handler: atendimento exige sessão verificada, respeita leitura/escrita e ignora escopo do navegador', async () => {
  const handlerFor = (repo, userId) => managementHandler(CONF, { repo, fetcher: async () => Response.json({ id: userId }) });
  const post = (handler, body, headers = { authorization: 'Bearer verified-session' }) =>
    handler(new Request('https://example.invalid', { method: 'POST', headers, body: JSON.stringify(body) }));
  const admin = handlerFor(contactRepo(), OPERATOR);
  assert.equal((await post(admin, { action: 'contact_scopes' })).status, 200);
  assert.equal((await post(admin, { action: 'customers', provider: 'whatsapp', merchantId: 'loja-a' })).status, 200);
  assert.equal((await post(admin, { action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 4, mode: 'human' })).status, 200);
  assert.equal((await post(admin, { action: 'customers', provider: 'invented', merchantId: 'loja-a' })).status, 400);
  // Escopo enviado pelo navegador não concede acesso: vale o escopo autorizado no servidor.
  const crossStore = await post(handlerFor(contactRepo({ contactScope: async () => undefined }), OPERATOR),
    { action: 'conversations', provider: 'whatsapp', merchantId: 'loja-b' });
  assert.equal(crossStore.status, 403);
  assert.equal((await crossStore.json()).error, 'CONTACT_ACCESS_DENIED');
  // Viewer lê, mas não assume nem devolve o atendimento.
  const viewer = handlerFor(contactRepo({ contactScope: async () => ({ can_manage: false }) }), VIEWER);
  assert.equal((await post(viewer, { action: 'conversations', provider: 'whatsapp', merchantId: 'loja-a' })).status, 200);
  const denied = await post(viewer, { action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 4, mode: 'human' });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'DELIVERY_ACCESS_DENIED');
  // Sem sessão verificada não há leitura de atendimento; segredo do worker não abre contatos.
  assert.equal((await post(admin, { action: 'customers', provider: 'whatsapp', merchantId: 'loja-a' }, {})).status, 401);
  assert.equal((await post(admin, { action: 'customers', provider: 'whatsapp', merchantId: 'loja-a' }, { authorization: 'Bearer ' })).status, 401);
  assert.equal((await post(admin, { action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 4, mode: 'human' },
    { 'x-delivery-worker-secret': 'a'.repeat(64) })).status, 401);
});
// Adaptador de teste: liga o serviço interno persistente ao mesmo PostgreSQL em memória.
function persistedRepo(database) {
  return {
    conversation: async (provider, merchant, id) => (await database.query(
      'select id,customer_id,mode,version from delivery_conversations where provider=$1 and merchant_id=$2 and id=$3',
      [provider, merchant, id])).rows[0],
    rpc: async (name, body) => {
      if (name !== 'delivery_save_ai_draft') throw Error(`UNEXPECTED_RPC:${name}`);
      const result = await database.query('select delivery_save_ai_draft($1,$2,$3,$4,$5::integer,$6,$7) as saved',
        [body.p_provider, body.p_merchant, body.p_customer, body.p_conversation, body.p_expected, body.p_message, body.p_reply]);
      return result.rows[0].saved;
    },
  };
}

test('Atendimento persistido: IA conclui rascunho quando a versão não mudou', async () => {
  const db = await open(), merchant = 'loja-e2e-ok';
  const id = firstConversation((await receive(db, { merchant, conversation: 'conv-e2e-ok', message: 'msg-e2e-ok', body: 'Qual o horário?' })).rows);
  const customer = (await conversation(db, id)).customer_id;
  await grant(db, { merchant });
  assert.deepEqual((await handoff(db, { merchant, conversation: id, version: 1, mode: 'ai' })).rows[0].result, { mode: 'ai', version: 2, idempotent: false });
  let capabilities;
  const service = new PersistentConversationService(persistedRepo(db), { ai: { plan: async request => {
    capabilities = request.capabilities;
    return { reply: 'Abrimos às 18h.', calls: [] };
  } } });
  assert.deepEqual(await service.draft({ provider: 'whatsapp', merchantId: merchant, conversationId: id, customerId: customer,
    messageId: 'msg-e2e-ok', text: 'Qual o horário?' }), { draft: true });
  assert.ok(capabilities.includes('consultarHorario') && capabilities.includes('transferirParaHumano'));
  assert.ok(!capabilities.includes('executeSql'));
  const current = await conversation(db, id);
  assert.equal(current.version, 3);
  assert.equal(current.mode, 'ai');
  const outbound = (await history(db, id)).filter(row => row.direction === 'outbound');
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].body, 'Abrimos às 18h.');
  assert.equal(outbound[0].status, 'draft');
  // Provedor desconhecido, escopo errado e mensagem inválida nunca alcançam o modelo.
  await assert.rejects(service.draft({ provider: 'invented', merchantId: merchant, conversationId: id, customerId: customer, messageId: 'msg-e2e-ok', text: 'oi' }), /UNKNOWN_PROVIDER/);
  await assert.rejects(service.draft({ provider: 'whatsapp', merchantId: 'loja-e2e-outra', conversationId: id, customerId: customer, messageId: 'msg-e2e-ok', text: 'oi' }), /CONTACT_ACCESS_DENIED/);
  await assert.rejects(service.draft({ provider: 'whatsapp', merchantId: merchant, conversationId: id, customerId: OTHER_OPERATOR, messageId: 'msg-e2e-ok', text: 'oi' }), /CONTACT_ACCESS_DENIED/);
  await assert.rejects(service.draft({ provider: 'whatsapp', merchantId: merchant, conversationId: id, customerId: customer, messageId: 'msg-e2e-ok', text: ' ' }), /INVALID_MESSAGE/);
  assert.equal((await history(db, id)).filter(row => row.direction === 'outbound').length, 1);
});

test('Atendimento persistido: humano assume durante a inferência e a resposta antiga é descartada', async () => {
  const db = await open(), merchant = 'loja-e2e-handoff';
  const id = firstConversation((await receive(db, { merchant, conversation: 'conv-e2e-handoff', message: 'msg-e2e-handoff', body: 'Tem entrega?' })).rows);
  const customer = (await conversation(db, id)).customer_id;
  await grant(db, { merchant });
  await handoff(db, { merchant, conversation: id, version: 1, mode: 'ai' });
  let finishPlan, planStarted;
  const started = new Promise(resolve => { planStarted = resolve; });
  const service = new PersistentConversationService(persistedRepo(db), { ai: { plan: async () => {
    planStarted();
    return new Promise(resolve => { finishPlan = resolve; });
  } } });
  const pending = service.draft({ provider: 'whatsapp', merchantId: merchant, conversationId: id, customerId: customer,
    messageId: 'msg-e2e-handoff', text: 'Tem entrega?' });
  await started; // IA começou a gerar com a versão 2
  assert.deepEqual((await handoff(db, { merchant, conversation: id, version: 2, mode: 'human' })).rows[0].result, { mode: 'human', version: 3, idempotent: false });
  finishPlan({ reply: 'Resposta antiga da IA.', calls: [] });
  assert.deepEqual(await pending, { suppressed: true });
  const current = await conversation(db, id);
  assert.equal(current.version, 3);
  assert.equal(current.mode, 'human');
  assert.equal(current.assigned_to, OPERATOR);
  // Nenhuma mensagem outbound é criada e a resposta antiga não sobrevive ao handoff.
  const messages = await history(db, id);
  assert.equal(messages.filter(row => row.direction === 'outbound').length, 0);
  assert.equal(messages.length, 1);
  assert.equal(await auditCount(db, id), 2); // habilitar IA + assumir atendimento
});
test('Atendimento persistido: modo humano não consulta IA e ferramentas são allowlist', async () => {
  const db = await open(), merchant = 'loja-e2e-ferramenta';
  const id = firstConversation((await receive(db, { merchant, conversation: 'conv-e2e-ferramenta', message: 'msg-e2e-ferramenta', body: 'oi' })).rows);
  const customer = (await conversation(db, id)).customer_id;
  // Conversa nasce em modo humano: o provedor de IA não é consultado.
  const untouched = new PersistentConversationService(persistedRepo(db), { ai: { plan: async () => assert.fail('IA não deve ser consultada em modo humano') } });
  assert.deepEqual(await untouched.draft({ provider: 'whatsapp', merchantId: merchant, conversationId: id, customerId: customer,
    messageId: 'msg-e2e-ferramenta', text: 'oi' }), { suppressed: true });
  await grant(db, { merchant });
  await handoff(db, { merchant, conversation: id, version: 1, mode: 'ai' });
  const calls = [];
  const tools = new ToolRegistry({
    consultarHorario: async (args, context) => { calls.push(['consultarHorario', args, context]); },
    consultarProduto: async () => { calls.push(['consultarProduto']); },
  });
  const withPlan = plan => new PersistentConversationService(persistedRepo(db), { tools, ai: { plan: async () => plan } });
  const draft = { provider: 'whatsapp', merchantId: merchant, conversationId: id, customerId: customer, messageId: 'msg-e2e-ferramenta', text: 'oi' };
  // Ferramenta não registrada (ex.: SQL) é rejeitada e nada é gravado.
  await assert.rejects(withPlan({ reply: 'ok', calls: [{ name: 'executeSql', args: { query: 'select 1' } }] }).draft(draft), /TOOL_NOT_AVAILABLE/);
  // Argumentos fora do contrato da ferramenta também são rejeitados.
  await assert.rejects(withPlan({ reply: 'ok', calls: [{ name: 'consultarProduto', args: {} }] }).draft(draft), /INVALID_IDENTIFIER/);
  // Plano fora do contrato (resposta enorme ou chamadas excessivas) é rejeitado.
  await assert.rejects(withPlan({ reply: 'x'.repeat(4001), calls: [] }).draft(draft), /INVALID_AI_PLAN/);
  await assert.rejects(withPlan({ reply: 'ok', calls: [{ name: 'consultarHorario', args: {} }, { name: 'consultarHorario', args: {} }, { name: 'consultarHorario', args: {} }, { name: 'consultarHorario', args: {} }] }).draft(draft), /INVALID_AI_PLAN/);
  assert.equal((await conversation(db, id)).version, 2);
  assert.equal((await history(db, id)).filter(row => row.direction === 'outbound').length, 0);
  // Pedido de transferência é apenas solicitação: quem muda o modo é o operador autorizado.
  assert.deepEqual(await withPlan({ reply: 'Vou transferir.', calls: [{ name: 'transferirParaHumano', args: {} }] }).draft(draft),
    { suppressed: true, transferRequested: true });
  assert.equal((await conversation(db, id)).mode, 'ai');
  assert.equal((await conversation(db, id)).version, 2);
  // Ferramenta permitida executa com escopo verificado e o rascunho é persistido.
  assert.deepEqual(await withPlan({ reply: 'Estamos abertos.', calls: [{ name: 'consultarHorario', args: {} }] }).draft(draft), { draft: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], 'consultarHorario');
  assert.deepEqual(calls[0][1], {});
  assert.deepEqual(calls[0][2], { verified: true, subjectId: customer, merchantId: merchant, provider: 'whatsapp' });
  assert.equal((await conversation(db, id)).version, 3);
  assert.equal((await history(db, id)).filter(row => row.direction === 'outbound').length, 1);
});
