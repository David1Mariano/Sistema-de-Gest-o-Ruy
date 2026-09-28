import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { CONTACT_ACTIONS, contactAction } from '../supabase/functions/_shared/delivery-contacts.mjs';
import { AIProvider } from '../supabase/functions/_shared/delivery-assistant.mjs';
import { DeliveryError, FOOD99_BLOCKED } from '../supabase/functions/_shared/delivery-domain.mjs';
import { PROVIDER_CAPABILITIES, providerAdapter } from '../supabase/functions/_shared/delivery-providers.mjs';
import { managementHandler } from '../supabase/functions/_shared/handlers.mjs';
import { repository } from '../supabase/functions/_shared/repository.mjs';
import { deliveryStatus } from '../src/lib/integrations/deliveryStatus.js';
import * as attendance from '../src/lib/delivery/attendance.js';

// Somente PostgreSQL em memória (PGlite), duplos de teste e tokens sintéticos.
// Nenhum banco real, migration remota, mensagem enviada, plataforma chamada ou
// modelo de IA é acessado; qualquer chamada de rede real falha o teste.
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls += 1; throw new Error('NETWORK_DISABLED_IN_ATTENDANCE_TESTS'); };
after(() => assert.equal(networkCalls, 0, 'nenhuma chamada de rede real durante os testes'));

const OPERATOR = '11111111-1111-4111-8111-111111111111';
const VIEWER = '33333333-3333-4333-8333-333333333333';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const CONVERSATION_B = '45454545-4545-4545-8545-454545454545';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';

let db = null;
async function open() {
  if (!db) {
    db = new PGlite();
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    for (const file of ['202609290001_delivery_conversations.sql', '202609300001_delivery_attendance_ops.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await db.exec('set role service_role');
  }
  return db;
}
after(async () => { if (db) await db.close(); });

test('Central: lista de conversas sai enriquecida com cliente, última mensagem, escopo e não lidas', async () => {
  const calls = {};
  const rows = [rawRow(CONVERSATION), rawRow(CONVERSATION_B, { customer_id: OTHER, mode: 'ai', assigned_to: OTHER })];
  const repo = attendanceRepo({
    conversations: async (provider, merchant, offset) => { calls.conversations = [provider, merchant, offset]; return rows; },
    customersByIds: async (provider, merchant, ids) => { calls.customers = [provider, merchant, ids];
      return [{ id: CUSTOMER, external_id: 'cli-1', name: 'Ana Silva', phone: '+5511999990001' }]; },
    readMarks: async (actor, ids) => { calls.marks = [actor, ids];
      return [{ conversation_id: CONVERSATION, last_read_at: '2026-01-02T08:00:00Z' }]; },
    inboundSince: async ids => { calls.inbound = ids; return [
      { conversation_id: CONVERSATION, received_at: '2026-01-02T07:00:00Z' },   // antes do marcador: lida
      { conversation_id: CONVERSATION, received_at: '2026-01-02T09:00:00Z' },   // depois: não lida
      { conversation_id: CONVERSATION_B, received_at: '2026-01-02T09:30:00Z' }, // sem marcador: conta a janela
    ]; },
  });
  const result = await contactAction({ action: 'conversations', provider: 'whatsapp', merchantId: 'loja-a' }, OPERATOR, repo);
  assert.deepEqual(calls.conversations, ['whatsapp', 'loja-a', 0]);
  assert.deepEqual(calls.customers, ['whatsapp', 'loja-a', [CUSTOMER, OTHER]]);
  assert.deepEqual(calls.marks, [OPERATOR, [CONVERSATION, CONVERSATION_B]]);
  assert.equal(result.canManage, true);
  assert.equal(result.actorId, OPERATOR);
  assert.equal(result.nextOffset, null);
  const [first, second] = result.rows;
  assert.equal(first.customer.name, 'Ana Silva');
  assert.equal(first.provider, 'whatsapp'); // identidade anexada para as abas mesclarem lojas
  assert.equal(first.merchant_id, 'loja-a');
  assert.equal(first.last_message.body, 'Bom dia');
  assert.equal(first.unread_count, 1);
  assert.equal(second.unread_count, 1);
  assert.equal(second.customer, null);
});

test('Central: clientes ganham contagem de conversas e última interação sem inferir pedidos', async () => {
  const repo = attendanceRepo({
    customers: async () => [{ id: CUSTOMER, external_id: 'cli-1', name: 'Ana', phone: null, created_at: '2026-01-01T10:00:00Z' },
      { id: CONVERSATION_B, external_id: 'cli-2', name: 'Bia', phone: '+5511888887777', created_at: '2026-01-02T10:00:00Z' }],
    conversationStats: async () => [{ customer_id: CUSTOMER, updated_at: '2026-01-05T12:00:00Z' },
      { customer_id: CUSTOMER, updated_at: '2026-01-06T12:00:00Z' }, { customer_id: CONVERSATION_B, updated_at: '2026-01-03T12:00:00Z' }],
  });
  const result = await contactAction({ action: 'customers', provider: 'whatsapp', merchantId: 'loja-a' }, OPERATOR, repo);
  assert.equal(result.rows[0].conversation_count, 2);
  assert.equal(result.rows[0].last_interaction_at, '2026-01-06T12:00:00Z');
  assert.equal(result.rows[1].conversation_count, 1);
  assert.equal(result.rows[0].provider, 'whatsapp');
  const view = attendance.customerView(result.rows[0]);
  assert.equal(view.conversationCount, 2);
  assert.equal(attendance.filterCustomers(result.rows, { search: 'bia' }).length, 1);
  assert.equal(attendance.filterCustomers(result.rows, { search: '+5511888887777' }).length, 1);
});

test('Central: marcar como lido persiste marcador do operador e respeita escopo', async () => {
  let marked;
  const repo = attendanceRepo({ markRead: async body => { marked = body; return null; } });
  const viewer = await contactAction({ action: 'mark_read', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION }, VIEWER, repo);
  assert.deepEqual(viewer, { tracked: true, canManage: false });
  assert.equal(marked.user_id, VIEWER); // marcador por operador, não estado local
  assert.equal(marked.conversation_id, CONVERSATION);
  assert.equal(marked.provider, 'whatsapp');
  assert.equal(marked.merchant_id, 'loja-a');
  assert.equal(marked.last_read_version, 4);
  // Escopo da loja é concedido, mas a conversa não pertence a ela: 404 antes de gravar.
  await assert.rejects(contactAction({ action: 'mark_read', provider: 'whatsapp', merchantId: 'loja-b', conversationId: CONVERSATION }, OPERATOR,
    attendanceRepo({ contactScope: async () => ({ can_manage: false }) })),
    error => error.code === 'CONVERSATION_NOT_FOUND' && error.status === 404);
  await assert.rejects(contactAction({ action: 'mark_read', provider: 'invented', merchantId: 'loja-a', conversationId: CONVERSATION }, OPERATOR, repo),
    /UNKNOWN_PROVIDER/);
  await assert.rejects(contactAction({ action: 'mark_read', provider: 'whatsapp', merchantId: 'loja-a', conversationId: 'nao-uuid' }, OPERATOR, repo),
    /INVALID_IDENTIFIER/);
});

test('Central: auditoria de handoff lida apenas de conversa existente no escopo', async () => {
  const repo = attendanceRepo({
    handoffAudit: async id => (id === CONVERSATION ? [{ id: 'audit-1', conversation_id: id, actor_id: OPERATOR, mode: 'human', version: 5, created_at: '2026-01-03T10:00:00Z' }] : []),
    attendanceEvents: async () => [],
  });
  const result = await contactAction({ action: 'audit', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION }, OPERATOR, repo);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].mode, 'human');
  assert.deepEqual(result.events, []);
  assert.equal(result.canManage, true);
  await assert.rejects(contactAction({ action: 'audit', provider: 'ifood', merchantId: 'loja-a', conversationId: CONVERSATION }, OPERATOR, repo),
    error => error.code === 'CONVERSATION_NOT_FOUND' && error.status === 404);
  await assert.rejects(contactAction({ action: 'audit', provider: 'invented', merchantId: 'loja-a', conversationId: CONVERSATION }, OPERATOR, repo),
    /UNKNOWN_PROVIDER/);
});

test('Central: viewer lê sem assumir; admin assume/devolve com a versão lida', async () => {
  const row = rawRow(CONVERSATION);
  // Viewer: leitura liberada, handoff negado no servidor e na reflexão da interface.
  const view = await contactAction({ action: 'conversations', provider: 'whatsapp', merchantId: 'loja-a' }, VIEWER, attendanceRepo());
  assert.equal(view.canManage, false);
  await assert.rejects(contactAction({ action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 4, mode: 'human' }, VIEWER,
    attendanceRepo()), /CONTACT_ACCESS_DENIED/);
  const denied = attendance.handoffAvailability(attendance.conversationView(row, VIEWER), view.canManage);
  assert.deepEqual(denied, { allowed: false, reason: 'SEM_PERMISSAO_NA_LOJA' });
  // Admin: reflete permissão e envia a versão exata lida (controle de concorrência).
  assert.deepEqual(attendance.handoffAvailability(attendance.conversationView(row, OPERATOR), true), { allowed: true, reason: null });
  let sent;
  const managed = await contactAction({ action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 4, mode: 'ai' },
    OPERATOR, attendanceRepo({ rpc: async (name, body) => { sent = [name, body]; return { mode: 'ai', version: 5, idempotent: false }; } }));
  assert.deepEqual(sent, ['delivery_set_handoff', { p_actor: OPERATOR, p_provider: 'whatsapp', p_merchant: 'loja-a', p_conversation: CONVERSATION, p_expected: 4, p_mode: 'ai' }]);
  assert.deepEqual(managed, { mode: 'ai', version: 5, idempotent: false });
  // Devolver para IA usa a mesma trilha auditada.
  let returned;
  await contactAction({ action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 5, mode: 'ai' },
    OPERATOR, attendanceRepo({ rpc: async (name, body) => { returned = body; return { mode: 'ai', version: 6, idempotent: true }; } }));
  assert.equal(returned.p_mode, 'ai');
  // Repetição idempotente do servidor não duplica nem corrompe a linha local.
  let state = attendance.attendanceReducer(attendance.initialAttendance, { type: 'loaded', rows: [row] });
  state = attendance.attendanceReducer(state, { type: 'select', id: row.id });
  state = attendance.attendanceReducer(state, { type: 'patch', id: row.id, changes: { mode: 'ai', version: 6 } });
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].mode, 'ai');
  assert.equal(state.rows[0].version, 6);
  assert.equal(state.selectedId, row.id);
});

test('Central: falha de concorrência mantém dados e seleção, e o código chega ao cliente', async () => {
  const row = rawRow(CONVERSATION);
  // Servidor: versão antiga/conflito respondem com código e status explícitos.
  for (const [code, status] of [['CONVERSATION_CHANGED', 409], ['INVALID_HANDOFF_VERSION', 400]]) {
    const handler = handlerFor({ ...attendanceRepo(), rpc: async () => { throw new DeliveryError(code, status); } });
    const response = await post(handler, { action: 'handoff', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION, version: 4, mode: 'human' });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, code);
  }
  // Interface: o erro vira aviso sem apagar lista, conversa aberta ou seleção.
  let state = attendance.attendanceReducer(attendance.initialAttendance, { type: 'loaded', rows: [row] });
  state = attendance.attendanceReducer(state, { type: 'select', id: row.id });
  const before = state;
  state = attendance.attendanceReducer(state, { type: 'failed', error: 'A conversa mudou. Atualize a leitura antes de assumir ou devolver o atendimento.' });
  assert.equal(state.rows, before.rows);
  assert.equal(state.selectedId, before.selectedId);
  assert.ok(state.error.length > 0);
});

test('Central: atualização preserva seleção, não desmonta a lista e não perde filtros de dados', async () => {
  const rows = [rawRow(CONVERSATION)];
  let state = attendance.attendanceReducer(attendance.initialAttendance, { type: 'loaded', rows });
  state = attendance.attendanceReducer(state, { type: 'select', id: CONVERSATION });
  const refreshing = attendance.attendanceReducer(state, { type: 'loading' });
  assert.equal(refreshing.rows, state.rows); // linhas continuam na tela durante o reload
  assert.equal(refreshing.selectedId, CONVERSATION);
  const refreshed = attendance.attendanceReducer(refreshing, { type: 'loaded', rows: [rawRow(CONVERSATION_B)] });
  assert.equal(refreshed.selectedId, CONVERSATION); // seleção sobrevive ao refresh
  assert.equal(refreshed.rows.length, 1);
  assert.equal(refreshed.error, '');
});

test('Central: interface ordena por última mensagem, filtra e busca sem inventar estado', async () => {
  const old = rawRow(CONVERSATION, { last_message: { ...rawRow(CONVERSATION).last_message, received_at: '2026-01-01T08:00:00Z' } });
  const recent = rawRow(CONVERSATION_B, { updated_at: '2026-01-03T10:00:00Z',
    last_message: { ...rawRow(CONVERSATION_B).last_message, received_at: '2026-01-03T09:00:00Z' } });
  const sorted = attendance.sortConversations([old, recent]);
  assert.deepEqual(sorted.map(row => row.id), [CONVERSATION_B, CONVERSATION]);
  // Sem última mensagem, usa a última atualização da conversa.
  const bare = rawRow(CONVERSATION, { last_message: null });
  assert.equal(attendance.activityAt(bare), Date.parse('2026-01-02T10:00:00Z'));
  const rows = [
    rawRow(CONVERSATION, { provider: 'whatsapp', merchant_id: 'loja-a', mode: 'human', assigned_to: OPERATOR, unread_count: 2,
      customer: { external_id: 'cli-1', name: 'Ana Silva', phone: '+5511999990001' } }),
    rawRow(CONVERSATION_B, { provider: 'whatsapp', merchant_id: 'loja-b', mode: 'ai', assigned_to: null, unread_count: 0,
      customer: { external_id: 'cli-2', name: 'Bruno', phone: null } }),
  ];
  assert.equal(attendance.filterConversations(rows, { channel: '99food' }).length, 0);
  assert.equal(attendance.filterConversations(rows, { channel: 'whatsapp' }).length, 2);
  assert.equal(attendance.filterConversations(rows, { merchant: 'loja-b' }).length, 1);
  assert.equal(attendance.filterConversations(rows, { mode: 'ai' }).length, 1);
  assert.equal(attendance.filterConversations(rows, { owner: 'none' }).length, 1);
  assert.equal(attendance.filterConversations(rows, { owner: 'mine', actorId: OPERATOR }).length, 1);
  assert.equal(attendance.filterConversations(rows, { unreadOnly: true }).length, 1);
  assert.equal(attendance.filterConversations(rows, { search: 'ana' }).length, 1);          // nome
  assert.equal(attendance.filterConversations(rows, { search: '999990001' }).length, 1);    // telefone
  assert.equal(attendance.filterConversations(rows, { search: 'cli-2' }).length, 1);        // ID externo
  assert.equal(attendance.filterConversations(rows, { search: 'bom dia' }).length, 2);      // conteúdo recente
  // Não existe estado "finalizada": nenhum filtro desse tipo é produzido pela função.
  assert.equal(attendance.filterConversations(rows, { status: 'closed' }).length, 2);
  assert.equal(attendance.unreadBadge(150), '99+');
});

test('Central: abrir conversa seleciona sem alterar lista; mensagens saem em ordem cronológica', async () => {
  const rows = [rawRow(CONVERSATION), rawRow(CONVERSATION_B)];
  let state = attendance.attendanceReducer(attendance.initialAttendance, { type: 'loaded', rows });
  state = attendance.attendanceReducer(state, { type: 'select', id: CONVERSATION_B });
  assert.equal(state.selectedId, CONVERSATION_B);
  assert.equal(state.rows, rows); // lista não é remontada ao abrir a conversa
  // Servidor pagina em ordem decrescente; o painel reordena cronologicamente.
  const fetched = [
    { id: 'm3', occurred_at: '2026-01-01T12:00:00Z', received_at: '2026-01-01T12:00:01Z' },
    { id: 'm1', occurred_at: '2026-01-01T10:00:00Z', received_at: '2026-01-01T10:00:01Z' },
    { id: 'm2', occurred_at: '2026-01-01T11:00:00Z', received_at: '2026-01-01T11:00:01Z' },
  ];
  assert.deepEqual(attendance.orderMessages(fetched).map(row => row.id), ['m1', 'm2', 'm3']);
  // A leitura de mensagens exige conversa no escopo autorizado.
  await assert.rejects(contactAction({ action: 'messages', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION }, OPERATOR,
    attendanceRepo({ conversation: async () => undefined })), error => error.code === 'CONVERSATION_NOT_FOUND' && error.status === 404);
  await assert.rejects(contactAction({ action: 'messages', provider: 'ifood', merchantId: 'loja-a', conversationId: CONVERSATION }, OPERATOR,
    attendanceRepo()), error => error.code === 'CONVERSATION_NOT_FOUND' && error.status === 404);
  const loaded = await contactAction({ action: 'messages', provider: 'whatsapp', merchantId: 'loja-a', conversationId: CONVERSATION }, OPERATOR,
    attendanceRepo({ messages: async (id, offset) => { assert.equal(id, CONVERSATION); assert.equal(offset, 0);
      return [{ id: 'm1', direction: 'inbound', author: 'customer', status: 'received', body: 'oi', occurred_at: '2026-01-01T10:00:00Z', received_at: '2026-01-01T10:00:01Z', invalidated: false, conversation_version: 1 }]; } }));
  assert.equal(loaded.rows.length, 1);
  assert.equal(loaded.canManage, true);
});

test('Central: responsável exibido sem inventar nomes; rótulos de mensagem são honestos', async () => {
  const base = rawRow(CONVERSATION, { assigned_to: null });
  assert.equal(attendance.conversationView(base, OPERATOR).ownerLabel, 'Sem responsável');
  assert.equal(attendance.conversationView({ ...base, assigned_to: OPERATOR }, OPERATOR).ownerLabel, 'Você');
  const other = attendance.conversationView({ ...base, assigned_to: OTHER }, OPERATOR);
  assert.equal(other.ownerLabel, 'Outro operador');
  assert.equal(other.ownerShort, OTHER.slice(0, 8));
  assert.equal(attendance.messageLabel({ direction: 'inbound', author: 'customer', status: 'received' }), 'Mensagem recebida');
  assert.equal(attendance.messageLabel({ direction: 'outbound', author: 'ai', status: 'draft' }), 'Rascunho da IA (não enviado)');
  assert.equal(attendance.messageLabel({ direction: 'outbound', author: 'human', status: 'draft' }), 'Rascunho humano (não enviado)');
  assert.equal(attendance.messageLabel({ direction: 'outbound', author: 'ai', status: 'invalidated', invalidated: true }), 'Rascunho invalidado');
  // O escopo devolve o próprio operador para a tela diferenciar "Você".
  const scopes = await contactAction({ action: 'contact_scopes' }, VIEWER, attendanceRepo());
  assert.equal(scopes.actorId, VIEWER);
});

test('Central: status informa IA não configurada e 99Food bloqueada sem hardcode na tela', async () => {
  const handler = handlerFor({ ...attendanceRepo(), status: async () => [], allMerchants: async () => [] });
  const response = await post(handler, { action: 'status' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.aiConfigured, false); // derivado do módulo, não presumido
  assert.equal(payload.food99Blocker, FOOD99_BLOCKED);
  await assert.rejects(new AIProvider().plan(), /AI_NOT_CONFIGURED/);
  assert.equal(deliveryStatus('99food', payload), 'Configuração necessária');
  assert.equal(deliveryStatus('99food', null), 'Configuração necessária');
  // A nota da interface muda conforme o modo e a configuração reportada.
  assert.match(attendance.replyState({ mode: 'human', aiConfigured: false }).note, /nenhuma resposta automática/);
  assert.match(attendance.replyState({ mode: 'ai', aiConfigured: false }).note, /IA não configurada/);
  assert.match(attendance.replyState({ mode: 'ai', aiConfigured: true }).note, /nenhuma mensagem é enviada/);
});

test('Central: WhatsApp é só canal arquitetural e nenhuma ação de envio existe', async () => {
  assert.equal(PROVIDER_CAPABILITIES.whatsapp.commands, false);
  assert.equal(PROVIDER_CAPABILITIES.whatsapp.connection, null);
  assert.throws(() => providerAdapter('whatsapp').connect(), /CONFIGURATION_REQUIRED/);
  assert.ok(!CONTACT_ACTIONS.includes('send'));
  // O handler rejeita qualquer ação de envio antes de tocar em dados.
  const handler = handlerFor(attendanceRepo());
  const response = await post(handler, { action: 'send', provider: 'whatsapp', merchantId: 'loja-a', body: 'oi' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_ACTION');
});

test('Central: caixa de resposta grava apenas rascunho local, sem nenhuma chamada de rede', async () => {
  const store = new Map();
  const fakeStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  const key = attendance.draftKey('whatsapp', 'loja-a', CONVERSATION);
  assert.equal(key, `central-delivery:draft:whatsapp:loja-a:${CONVERSATION}`);
  attendance.saveDraft(fakeStorage, key, 'Resposta do atendente');
  assert.equal(attendance.readDraft(fakeStorage, key), 'Resposta do atendente');
  // Chaves por conversa não vazam uma na outra.
  assert.equal(attendance.readDraft(fakeStorage, attendance.draftKey('whatsapp', 'loja-a', CONVERSATION_B)), '');
  attendance.clearDraft(fakeStorage, key);
  assert.equal(attendance.readDraft(fakeStorage, key), '');
  // Disponibilidade da resposta: envio segue desabilitado nesta fase.
  const reply = attendance.replyState({ mode: 'human' });
  assert.equal(reply.sendEnabled, false);
  assert.equal(reply.sendReason, 'SEND_NOT_ENABLED');
  assert.equal(networkCalls, 0); // nada aqui toca a rede
});

test('Central: repositório monta consultas escopadas para lista, marcador e auditoria', async () => {
  const calls = [];
  const repo = repository(CONF, async (url, init) => { calls.push([url, init]); return Response.json([]); });
  await repo.conversations('whatsapp', 'loja-a', 0);
  await repo.customersByIds('whatsapp', 'loja-a', [CUSTOMER]);
  await repo.readMarks(OPERATOR, [CONVERSATION]);
  await repo.inboundSince([CONVERSATION], '1970-01-01T00:00:00.000Z');
  await repo.handoffAudit(CONVERSATION);
  await repo.attendanceEvents(CONVERSATION);
  await repo.conversationStats('whatsapp', 'loja-a', [CUSTOMER]);
  await repo.markRead({ user_id: OPERATOR, conversation_id: CONVERSATION });
  assert.ok(calls[0][0].includes('provider=eq.whatsapp') && calls[0][0].includes('merchant_id=eq.loja-a'));
  assert.ok(calls[0][0].includes('last_message:delivery_messages(') && calls[0][0].includes('limit=1)&order=updated_at.desc'));
  assert.ok(calls[1][0].includes(`id=in.(${CUSTOMER})`));
  assert.ok(calls[2][0].includes(`user_id=eq.${OPERATOR}`) && calls[2][0].includes(`conversation_id=in.(${CONVERSATION})`));
  assert.ok(calls[3][0].includes('direction=eq.inbound') && calls[3][0].includes('invalidated=eq.false'));
  assert.ok(calls[4][0].includes(`delivery_handoff_audit?conversation_id=eq.${CONVERSATION}`));
  assert.ok(calls[5][0].includes(`delivery_attendance_events?conversation_id=eq.${CONVERSATION}`));
  assert.ok(calls[6][0].includes(`customer_id=in.(${CUSTOMER})`));
  // markRead é um POST idempotente de upsert; o navegador nunca vira autoridade.
  assert.ok(calls[7][0].includes('delivery_conversation_reads?on_conflict=user_id,conversation_id'));
  assert.equal(calls[7][1].method, 'POST');
  assert.ok(calls.every(([found]) => !found.includes('sealed_credentials') && !found.includes('service_role')));
});

test('Migration nova: tabelas de operação negam anon/authenticated e aplicam constraints', async () => {
  const database = await open();
  const tables = ['delivery_conversation_reads', 'delivery_attendance_events', 'delivery_outbox'];
  const list = tables.map(table => `'${table}'`).join(',');
  assert.equal((await database.query(`select count(*)::int as count from pg_policies where tablename in (${list})`)).rows[0].count, 0);
  for (const role of ['anon', 'authenticated']) {
    await database.exec(`set role ${role}`);
    for (const table of tables) await assert.rejects(database.query(`select * from ${table}`), /permission denied/);
    await database.exec('reset role');
  }
  await database.exec('set role service_role');
  // Conversa real necessária para as estrangeiras compostas.
  const conversation = (await database.query("select delivery_receive_message('whatsapp','loja-ops','cli-ops','conv-ops','msg-ops','oi','2020-01-01T12:00:00Z') as id")).rows[0].id;
  // Marcador de leitura: upsert idempotente por usuário+conversa.
  const readInsert = 'insert into delivery_conversation_reads(user_id,conversation_id,provider,merchant_id,last_read_at,last_read_version) values($1,$2,$3,$4,$5,$6)';
  await database.query(`${readInsert} on conflict(user_id,conversation_id) do update set last_read_at=excluded.last_read_at,last_read_version=excluded.last_read_version`,
    [OPERATOR, conversation, 'whatsapp', 'loja-ops', '2026-01-01T10:00:00Z', 1]);
  await database.query(`${readInsert} on conflict(user_id,conversation_id) do update set last_read_at=excluded.last_read_at,last_read_version=excluded.last_read_version`,
    [OPERATOR, conversation, 'whatsapp', 'loja-ops', '2026-01-02T10:00:00Z', 2]);
  const reads = await database.query('select user_id,last_read_version from delivery_conversation_reads');
  assert.equal(reads.rows.length, 1);
  assert.equal(reads.rows[0].last_read_version, 2);
  // Eventos: tipo fora do contrato é rejeitado; corpo de mensagem nunca entra aqui.
  await assert.rejects(database.query("insert into delivery_attendance_events(conversation_id,provider,merchant_id,event_type,message_external_id) values($1,'whatsapp','loja-ops','invented','m-1')", [conversation]), /check constraint/);
  await database.query("insert into delivery_attendance_events(conversation_id,provider,merchant_id,event_type,message_external_id) values($1,'whatsapp','loja-ops','draft_created','msg-ops')", [conversation]);
  // Outbox: status inválido, sent incompleto e chave duplicada são rejeitados.
  const outbox = status => `insert into delivery_outbox(provider,merchant_id,conversation_id,idempotency_key,body,conversation_version,conversation_mode,status) values('whatsapp','loja-ops','${conversation}','chave-1','oi',1,'human','${status}')`;
  await assert.rejects(database.query(outbox('sending')), /check constraint/);
  await assert.rejects(database.query(outbox('sent')), /check constraint/);
  await database.query(outbox('pending'));
  await assert.rejects(database.query(outbox('pending')), /duplicate key/);
  // Lease exige prazo: corrida de envio fica explícita no contrato.
  await assert.rejects(database.query("update delivery_outbox set status='leased'"), /check constraint/);
  await database.query("update delivery_outbox set status='leased',lease_until=now()+interval '30 seconds'");
  // service_role continua sendo o único papel de acesso.
  for (const table of tables) {
    assert.equal((await database.query(`select has_table_privilege('anon',$1,'select') as ok`, [table])).rows[0].ok, false);
    assert.equal((await database.query(`select has_table_privilege('service_role',$1,'select') as ok`, [table])).rows[0].ok, true);
  }
});


const rawRow = (id, extra = {}) => ({
  id, external_id: `conv-${id.slice(0, 4)}`, customer_id: CUSTOMER, mode: 'human', version: 2,
  assigned_to: null, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-02T10:00:00Z',
  last_message: { external_id: 'm-1', direction: 'inbound', author: 'customer', status: 'received',
    body: 'Bom dia', occurred_at: '2026-01-02T09:59:00Z', received_at: '2026-01-02T09:59:05Z' },
  ...extra,
});

// Duplo do repositório para a API de atendimento: sem rede, sem credenciais.
function attendanceRepo(overrides = {}) {
  return {
    contactScopes: async actor => [{ provider: 'whatsapp', merchant_id: 'loja-a', can_manage: actor === OPERATOR }],
    contactScope: async (actor, provider, merchant) => (merchant === 'loja-a' ? { can_manage: actor === OPERATOR } : undefined),
    conversations: async () => [], customers: async () => [], conversationStats: async () => [],
    customersByIds: async () => [], readMarks: async () => [], inboundSince: async () => [],
    messages: async () => [], markRead: async () => null, handoffAudit: async () => [], attendanceEvents: async () => [],
    conversation: async (provider, merchant, id) => (provider === 'whatsapp' && merchant === 'loja-a' && id === CONVERSATION
      ? { id: CONVERSATION, customer_id: CUSTOMER, mode: 'human', version: 4 } : undefined),
    rpc: async () => ({ mode: 'human', version: 5, idempotent: false }),
    ...overrides,
  };
}

const CONF = { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'anon-test-key', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  DELIVERY_ADMIN_USER_IDS: OPERATOR, DELIVERY_VIEWER_USER_IDS: VIEWER, DELIVERY_ALLOWED_ORIGINS: 'https://app.invalid' };
const handlerFor = (repo, userId = OPERATOR) => managementHandler(CONF, { repo, fetcher: async () => Response.json({ id: userId }) });
const post = (handler, body, headers = { authorization: 'Bearer verified-session' }) =>
  handler(new Request('https://example.invalid', { method: 'POST', headers, body: JSON.stringify(body) }));
