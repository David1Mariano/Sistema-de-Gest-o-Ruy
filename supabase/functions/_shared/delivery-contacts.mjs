import { DeliveryError, requiredString } from './delivery-domain.mjs';
import { PROVIDER_CAPABILITIES } from './delivery-providers.mjs';
import { AIProvider, ToolRegistry, TOOL_NAMES } from './delivery-assistant.mjs';
// Estados e papéis explícitos do atendimento; nenhuma string solta é comparada fora daqui.
export const CONVERSATION_STATES = Object.freeze({ ai: 'ai', human: 'human' });
export const CONVERSATION_MODES = Object.freeze(Object.values(CONVERSATION_STATES));
export const MESSAGE_DIRECTIONS = Object.freeze(['inbound', 'outbound']);
export const MESSAGE_AUTHORS = Object.freeze(['customer', 'ai', 'human', 'system']);
export const CONTACT_ACTIONS = Object.freeze(['contact_scopes', 'customers', 'conversations', 'messages', 'handoff']);
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
export async function contactAction(body, actor, repo) {
  if (body.action === 'contact_scopes') return { rows: await repo.contactScopes(actor) };
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
  let rows;
  if (body.action === 'customers') rows = await repo.customers(body.provider, merchant, offset);
  else if (body.action === 'conversations') rows = await repo.conversations(body.provider, merchant, offset);
  else {
    const id = uuid(body.conversationId);
    // A conversa precisa pertencer ao provider/loja autorizados antes de ler mensagens.
    const conversation = await repo.conversation(body.provider, merchant, id);
    if (!conversation) throw new DeliveryError('CONVERSATION_NOT_FOUND', 404);
    rows = await repo.messages(id, offset);
  }
  return { rows, nextOffset: rows.length === CONTACT_PAGE_SIZE ? offset + CONTACT_PAGE_SIZE : null, canManage: permission.can_manage };
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
