import { DeliveryError, requiredString } from './delivery-domain.mjs';
import { PROVIDER_CAPABILITIES } from './delivery-providers.mjs';
import { AIProvider, ToolRegistry, TOOL_NAMES } from './delivery-assistant.mjs';
// Estados e papéis explícitos do atendimento; nenhuma string solta é comparada fora daqui.
export const CONVERSATION_STATES = Object.freeze({ ai: 'ai', human: 'human' });
export const CONVERSATION_MODES = Object.freeze(Object.values(CONVERSATION_STATES));
export const MESSAGE_DIRECTIONS = Object.freeze(['inbound', 'outbound']);
export const MESSAGE_AUTHORS = Object.freeze(['customer', 'ai', 'human', 'system']);
export const CONTACT_ACTIONS = Object.freeze(['contact_scopes', 'customers', 'conversations', 'messages', 'handoff', 'audit', 'mark_read']);
export const CONTACT_PAGE_SIZE = 100;
const uuid = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new DeliveryError('INVALID_IDENTIFIER');
  return value;
};
// Reaproveita o registro oficial de provedores: nenhum provedor novo é inventado aqui.
export const isKnownProvider = provider => typeof provider === 'string' && Object.hasOwn(PROVIDER_CAPABILITIES, provider);
export function conversationScope({ provider, merchantId, customerId }) {
  if (!isKnownProvider(provider) || typeof merchantId !== 'string' || !merchantId.trim()
    || typeof customerId !== 'string' || !customerId.trim()) throw new DeliveryError('INVALID_CONVERSATION_IDENTITY');
  return Object.freeze({ verified: true, subjectId: customerId, merchantId, provider });
}
// Não lidas derivadas no servidor, por operador: inbound não invalidado recebido após o
// marcador de leitura persistido. Sem marcador, conta a janela recente consultada (limite
// documentado em docs/central-delivery.md); o estado nunca vive só no navegador.
function unreadCounts(inbound, marks) {
  const marker = new Map(marks.map(row => [row.conversation_id, Date.parse(row.last_read_at)]));
  const counts = new Map();
  for (const row of inbound) {
    const readAt = marker.get(row.conversation_id);
    if (readAt !== undefined && !(Date.parse(row.received_at) > readAt)) continue;
    counts.set(row.conversation_id, (counts.get(row.conversation_id) || 0) + 1);
  }
  return counts;
}
export async function contactAction(body, actor, repo) {
  // actorId identifica o próprio operador para a tela exibir "Você"; não expõe nomes.
  if (body.action === 'contact_scopes') return { rows: await repo.contactScopes(actor), actorId: actor };
  // Mesmo registro de provedores dos adaptadores: nenhum provedor inventado é aceito.
  if (!isKnownProvider(body.provider)) throw new DeliveryError('UNKNOWN_PROVIDER');
  const merchant = requiredString(body.merchantId);
  // Autorização server-side por loja: o navegador não informa nem prova o próprio escopo.
  const permission = await repo.contactScope(actor, body.provider, merchant);
  if (!permission || (body.action === 'handoff' && !permission.can_manage)) throw new DeliveryError('CONTACT_ACCESS_DENIED', 403);
  const offset = body.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) throw new DeliveryError('INVALID_PERIOD');
  if (body.action === 'handoff') {
    if (!CONVERSATION_MODES.includes(body.mode) || !Number.isInteger(body.version) || body.version < 0) throw new DeliveryError('INVALID_HANDOFF_MODE');
    return repo.rpc('delivery_set_handoff', { p_actor: actor, p_provider: body.provider, p_merchant: merchant,
      p_conversation: uuid(body.conversationId), p_expected: body.version, p_mode: body.mode });
  }
  // Marcar como lido é leitura de estado pessoal: qualquer operador da loja pode, sem can_manage.
  if (body.action === 'mark_read') {
    const id = uuid(body.conversationId);
    const conversation = await repo.conversation(body.provider, merchant, id);
    if (!conversation) throw new DeliveryError('CONVERSATION_NOT_FOUND', 404);
    const now = new Date().toISOString();
    await repo.markRead({ user_id: actor, conversation_id: id, provider: body.provider, merchant_id: merchant,
      last_read_at: now, last_read_version: conversation.version, updated_at: now });
    return { tracked: true, canManage: permission.can_manage };
  }
  if (body.action === 'audit') {
    const id = uuid(body.conversationId);
    // A conversa precisa pertencer ao provider/loja autorizados antes de ler a trilha.
    const conversation = await repo.conversation(body.provider, merchant, id);
    if (!conversation) throw new DeliveryError('CONVERSATION_NOT_FOUND', 404);
    const rows = await repo.handoffAudit(id);
    const events = await repo.attendanceEvents(id);
    return { rows, events, canManage: permission.can_manage };
  }
  let rows;
  if (body.action === 'customers') {
    rows = await repo.customers(body.provider, merchant, offset);
    // Última interação = última atualização de conversa do cliente nesta loja; nada é inferido de pedidos.
    const stats = rows.length ? await repo.conversationStats(body.provider, merchant, rows.map(row => row.id)) : [];
    const totals = new Map();
    for (const row of stats) {
      const entry = totals.get(row.customer_id) || { count: 0, last: '' };
      entry.count += 1;
      if (row.updated_at > entry.last) entry.last = row.updated_at;
      totals.set(row.customer_id, entry);
    }
    rows = rows.map(row => ({ ...row, provider: body.provider, merchant_id: merchant,
      conversation_count: totals.get(row.id)?.count ?? 0, last_interaction_at: totals.get(row.id)?.last || null }));
  } else if (body.action === 'conversations') {
    rows = await repo.conversations(body.provider, merchant, offset);
    if (rows.length) {
      const ids = rows.map(row => row.id);
      const customers = await repo.customersByIds(body.provider, merchant, [...new Set(rows.map(row => row.customer_id))]);
      const marks = await repo.readMarks(actor, ids);
      const inbound = await repo.inboundSince(ids, '1970-01-01T00:00:00.000Z');
      const byCustomer = new Map(customers.map(row => [row.id, row]));
      const unread = unreadCounts(inbound, marks);
      rows = rows.map(row => ({ ...row, provider: body.provider, merchant_id: merchant,
        customer: byCustomer.get(row.customer_id) || null, unread_count: unread.get(row.id) || 0 }));
    }
  } else {
    const id = uuid(body.conversationId);
    // A conversa precisa pertencer ao provider/loja autorizados antes de ler mensagens.
    const conversation = await repo.conversation(body.provider, merchant, id);
    if (!conversation) throw new DeliveryError('CONVERSATION_NOT_FOUND', 404);
    rows = await repo.messages(id, offset);
  }
  return { rows, nextOffset: rows.length === CONTACT_PAGE_SIZE ? offset + CONTACT_PAGE_SIZE : null, canManage: permission.can_manage, actorId: actor };
}

// Serviço interno server-side: não é ação do navegador, não é webhook e nunca envia
// mensagem. Verifica a conversa persistida e revalida a versão antes de gravar rascunho.
export class PersistentConversationService {
  constructor(repo, { ai = new AIProvider(), tools = new ToolRegistry() } = {}) {
    this.repo = repo; this.ai = ai; this.tools = tools;
  }
  async draft({ provider, merchantId, conversationId, customerId, messageId, text }) {
    if (!isKnownProvider(provider)) throw new DeliveryError('UNKNOWN_PROVIDER');
    const merchant = requiredString(merchantId), id = uuid(conversationId), customer = uuid(customerId), source = requiredString(messageId);
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new DeliveryError('INVALID_MESSAGE');
    const conversation = await this.repo.conversation(provider, merchant, id);
    if (!conversation || conversation.customer_id !== customer) throw new DeliveryError('CONTACT_ACCESS_DENIED', 403);
    // Atendimento humano (ou IA não habilitada) nunca gera resposta automática.
    if (conversation.mode !== CONVERSATION_STATES.ai) return { suppressed: true };
    // Conteúdo do cliente é não confiável: pede plano restrito, sem executar nada dele.
    const plan = await this.ai.plan({ text, capabilities: [...TOOL_NAMES] });
    if (!plan || typeof plan.reply !== 'string' || !plan.reply.trim() || plan.reply.length > 4000
      || !Array.isArray(plan.calls) || plan.calls.length > 3) throw new DeliveryError('INVALID_AI_PLAN');
    const scope = conversationScope({ provider, merchantId: merchant, customerId: customer });
    for (const call of plan.calls) {
      // Transferência é apenas solicitação: o modo só muda por handoff auditado do operador.
      if (call?.name === 'transferirParaHumano') return { suppressed: true, transferRequested: true };
      await this.tools.execute(call?.name, call?.args, scope);
    }
    // Revalidação imediata antes de persistir: handoff humano, novo inbound ou qualquer
    // outra mudança de versão fazem o banco descartar esta resposta antiga.
    const saved = await this.repo.rpc('delivery_save_ai_draft', { p_provider: provider, p_merchant: merchant,
      p_customer: customer, p_conversation: id, p_expected: conversation.version, p_message: source, p_reply: plan.reply });
    return saved ? { draft: true } : { suppressed: true }; // Não existe operação de envio.
  }
}
