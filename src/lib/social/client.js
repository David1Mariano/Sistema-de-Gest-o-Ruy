// Phase one: no remote transport and no cached production data. No pretend connection.
export const emptySocialSnapshot = () => ({ accounts: [], comments: [], messages: [], replies: [], drafts: [], metrics: [], posts: [], aiConfigured: false, manychat: { configured: false, reachable: false, authenticated: false, error_code: 'NOT_CONFIGURED', channels: [] } });
export const socialClient = Object.freeze({
  async snapshot() { return emptySocialSnapshot(); },
  async draftReply() { throw new Error('IA não configurada'); },
  async approveAndReply(request) { throw new Error(request?.transport === 'manychat' ? 'Envio por ManyChat não disponível para este canal.' : 'Integração não configurada'); },
});
