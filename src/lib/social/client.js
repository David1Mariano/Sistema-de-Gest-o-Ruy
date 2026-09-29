// Phase one: no remote transport and no cached production data. No pretend connection.
export const emptySocialSnapshot = () => ({ accounts: [], comments: [], replies: [], drafts: [], metrics: [], posts: [], aiConfigured: false });
export const socialClient = Object.freeze({
  async snapshot() { return emptySocialSnapshot(); },
  async draftReply() { throw new Error('IA não configurada'); },
  async approveAndReply() { throw new Error('Integração não configurada'); },
});
