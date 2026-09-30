export class SocialError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export class SocialProvider {
  constructor(name, capabilities) { this.name = name; this.capabilities = Object.freeze(capabilities); }
  status() { return { provider: this.name, connected: false, capabilities: this.capabilities }; }
  unavailable(operation) {
    if (!this.capabilities[operation]) throw new SocialError('UNSUPPORTED', 'Funcionalidade ainda não disponível nesta integração');
    throw new SocialError('NOT_CONFIGURED', 'Integração não configurada');
  }
  async connect() { return this.unavailable('connect'); }
  async listComments() { return this.unavailable('listComments'); }
  async replyComment() { return this.unavailable('replyComment'); }
  async listPosts() { return this.unavailable('listPosts'); }
  async getInsights() { return this.unavailable('getInsights'); }
  async refresh() { return this.unavailable('refresh'); }
}
