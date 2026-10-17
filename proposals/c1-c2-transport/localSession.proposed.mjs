// Isolated proposal: not imported by the application.
export function createLocalSession({ request = globalThis.fetch, timeoutMs = 8000, onUnauthorized = () => {} } = {}) {
  let csrf;
  const intentions = new Map();
  async function call(path, body) {
    const write = body !== undefined;
    const operationId = body?.operationId;
    let sent = false, response;
    const controller = new AbortController();
    const failure = (message, code, outcome, status) => Object.assign(new Error(message), { code, outcome, status, operationId });
    let serialized;
    try { serialized = write ? JSON.stringify(body) : undefined; }
    catch { throw failure('Conteúdo local inválido.', 'INVALID_REQUEST', 'not_sent'); }
    if (operationId !== undefined) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operationId)) throw failure('UUID de operação inválido.', 'INVALID_OPERATION_ID', 'not_sent');
      const intention = JSON.stringify([path, serialized]);
      if (intentions.has(operationId) && intentions.get(operationId) !== intention) throw failure('UUID reutilizado com intenção diferente.', 'IDEMPOTENCY_REUSE', 'not_sent');
      intentions.set(operationId, intention);
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw failure('Prazo local esgotado antes do envio.', 'TIMEOUT', 'not_sent');
    const timer = setTimeout(()=>controller.abort(), timeoutMs);
    const outcome = () => write ? (sent ? 'unknown' : 'not_sent') : 'not_applicable';
    async function abortable(task) {
      let listener;
      const interrupted = new Promise((_, reject) => {
        listener = () => reject(failure('Servidor local não respondeu no prazo.', 'TIMEOUT', outcome(), response?.status));
        controller.signal.addEventListener('abort', listener, { once:true });
        if (controller.signal.aborted) listener();
      });
      try { return await Promise.race([task, interrupted]); }
      finally { controller.signal.removeEventListener('abort', listener); }
    }
    try {
      sent = true;
      response = await abortable(request(`/api/local/${path}`, {
        method:write ? 'POST' : 'GET', credentials:'same-origin', signal:controller.signal,
        headers:write ? { 'Content-Type':'application/json', ...(csrf ? {'x-csrf-token':csrf} : {}) } : {},
        body:serialized,
      }));
      if (response.status === 401) { csrf=undefined; onUnauthorized(); }
      let value;
      try { value = JSON.parse(await abortable(response.text())); }
      catch (error) {
        if (error.code === 'TIMEOUT') throw error;
        // A malformed error response still preserves its HTTP status.
        throw failure('Resposta JSON local inválida ou interrompida.', error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'RESPONSE_INTERRUPTED',
          !response.ok && response.status < 500 ? 'rejected' : outcome(), response.status);
      }
      if (!value || typeof value !== 'object' || Array.isArray(value) && path !== 'pending' && !path.endsWith('/audit')) throw failure('Envelope local inválido.', 'INVALID_RESPONSE', outcome(), response.status);
      if (!response.ok) throw Object.assign(failure(value.error || `API local HTTP ${response.status}`, value.code || `HTTP_${response.status}`,
        write && response.status >= 500 ? 'unknown' : 'rejected', response.status),
        { dependencies:value.dependencies, total:value.total, resumo:value.resumo });
      return value;
    } catch (error) {
      if (error.outcome) throw error;
      throw failure('Falha de conexão com a API local.', 'CONNECTION_ERROR', outcome(), response?.status);
    } finally { clearTimeout(timer); }
  }
  function profile(value) {
    if (!value.user?.id || !['admin','operator','viewer'].includes(value.user.role) || typeof value.csrf !== 'string' || !value.csrf) throw Object.assign(Error('Resposta de sessão local inválida.'), {code:'INVALID_RESPONSE', outcome:'unknown'});
    csrf=value.csrf;
    return {...value.user,full_name:value.user.email,identity_source:'local',employee_payment_access:false};
  }
  return {
    async request(path,body) {
      if(body !== undefined && !csrf) {
        try { await this.me(); }
        catch(error) { throw Object.assign(new Error(error.message), {status:error.status, code:error.code, outcome:'not_sent', operationId:body?.operationId}); }
      }
      return call(path,body);
    },
    async loginViaEmailPassword(email,password) { return profile(await call('login',{email,password})); },
    async me() { return profile(await call('me')); },
    async logout() { if (!csrf) await this.me(); await call('logout',{}); csrf=undefined; },
  };
}
export const localSession = createLocalSession();
