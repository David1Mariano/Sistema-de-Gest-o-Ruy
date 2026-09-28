// Server-only contracts. No model SDK, credentials, message sender or SQL executor.
export class AIProvider {
  async plan() { throw Error('AI_NOT_CONFIGURED'); }
}
const specs = Object.freeze({
  consultarCardapio: [], consultarHorario: [], consultarProduto: ['productId'],
  criarRascunhoPedido: [], adicionarItem: ['draftId', 'productId', 'quantity'],
  removerItem: ['draftId', 'itemId'], consultarPedido: ['orderId'], transferirParaHumano: [],
});
function scope(context) {
  if (!context?.verified || !context.subjectId || !context.merchantId || !context.provider) throw Error('UNVERIFIED_CONVERSATION_SCOPE');
}
export class ToolRegistry {
  constructor(handlers = {}) {
    for (const key of Object.keys(handlers)) if (!Object.hasOwn(specs, key) || key === 'transferirParaHumano') throw Error('TOOL_NOT_ALLOWED');
    this.handlers = Object.freeze({ ...handlers });
  }
  async execute(name, args, context) {
    scope(context);
    if (!Object.hasOwn(specs, name) || !Object.hasOwn(this.handlers, name)) throw Error('TOOL_NOT_AVAILABLE');
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !specs[name].includes(key))) throw Error('INVALID_TOOL_ARGUMENTS');
    for (const key of specs[name]) {
      if (key === 'quantity') { if (!Number.isInteger(args[key]) || args[key] < 1 || args[key] > 50) throw Error('INVALID_QUANTITY'); }
      else if (typeof args[key] !== 'string' || !args[key].trim() || args[key].length > 200) throw Error('INVALID_IDENTIFIER');
    }
    // Handlers must bind all reads/writes to this server-verified scope and transaction.
    // Product price, draft ownership and availability must be revalidated by the handler.
    return this.handlers[name](Object.freeze({ ...args }), context);
  }
}
export class ConversationService {
  constructor({ store, ai = new AIProvider(), tools = new ToolRegistry() }) {
    this.store = store; this.ai = ai; this.tools = tools;
  }
  async handoff(id, context, mode) {
    scope(context);
    if (!context.operator || !['human', 'ai'].includes(mode)) throw Error('HANDOFF_FORBIDDEN');
    return this.store.withConversation(id, context, async conversation => {
      conversation.mode = mode; conversation.version++; conversation.pendingReply = null;
      return { mode, version: conversation.version };
    });
  }
  async draftReply(id, context, messageId, text) {
    scope(context);
    if (typeof messageId !== 'string' || !messageId || messageId.length > 200 || typeof text !== 'string' || text.length > 4000) throw Error('INVALID_MESSAGE');
    const snapshot = await this.store.withConversation(id, context, async conversation => ({ mode: conversation.mode, version: conversation.version, duplicate: conversation.processedIds.includes(messageId) }));
    if (snapshot.mode !== 'ai' || snapshot.duplicate) return { suppressed: true };
    // Treat user content as untrusted. Only request a plan, never execute model code.
    const plan = await this.ai.plan({ text, capabilities: Object.keys(specs) });
    return this.store.withConversation(id, context, async conversation => {
      if (conversation.mode !== 'ai' || conversation.version !== snapshot.version || conversation.processedIds.includes(messageId)) return { suppressed: true };
      if (!plan || typeof plan.reply !== 'string' || plan.reply.length > 4000 || !Array.isArray(plan.calls) || plan.calls.length > 1) throw Error('INVALID_AI_PLAN');
      for (const call of plan.calls) {
        if (call.name === 'transferirParaHumano') { conversation.mode = 'human'; conversation.version++; conversation.pendingReply = null; conversation.processedIds.push(messageId); return { suppressed: true, handoff: true }; }
        await this.tools.execute(call.name, call.args, context);
      }
      conversation.processedIds.push(messageId);
      conversation.version++;
      conversation.pendingReply = { messageId, text: plan.reply, version: conversation.version };
      // Draft only. No WhatsApp send; future outbox must recheck mode/version atomically.
      return { draft: true, version: conversation.version };
    });
  }
}
