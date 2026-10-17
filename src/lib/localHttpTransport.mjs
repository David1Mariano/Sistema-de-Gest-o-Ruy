// Protocol-neutral transport. No endpoint/authentication contract is assumed here.
export function createLocalHttpTransport({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const intentions = new Map();
  return async function request(url, { method = 'GET', body, csrf, operationId } = {}) {
    const write = !['GET', 'HEAD'].includes(method.toUpperCase());
    const error = (message, code, status, outcome = 'not_sent') => Object.assign(new Error(message), { code, status, outcome, operationId });
    let serialized;
    try { serialized = body === undefined ? undefined : JSON.stringify(body); } catch {
      throw error('Conteúdo da operação inválido.', 'INVALID_REQUEST');
    }
    const fingerprint = JSON.stringify([url, method, serialized]);
    if (write && !csrf) throw error('Token CSRF ausente. Consulte a sessão local.', 'CSRF_REQUIRED');
    if (operationId) {
      if (intentions.has(operationId) && intentions.get(operationId) !== fingerprint) {
        throw error('Identificador de operação reutilizado com conteúdo diferente.', 'IDEMPOTENCY_REUSE');
      }
      intentions.set(operationId, fingerprint);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let sent = false;
    let response;
    try {
      sent = true;
      response = await fetchImpl(url, {
        method, credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: serialized,
      });
      const raw = await response.text();
      let data;
      try { data = raw ? JSON.parse(raw) : null; } catch {
        if (response.ok) throw error('Resposta inválida do servidor.', 'INVALID_RESPONSE', response.status, write ? 'unknown' : 'not_applicable');
      }
      if (!response.ok) {
        const messages = {
          401: 'Sessão local expirada. Entre novamente no modo LOCAL.',
          403: 'Sem permissão para esta operação.',
          409: 'Conflito. Confira o estado no servidor antes de nova alteração.',
          402: 'Serviço recusou a operação (HTTP 402).',
        };
        throw error(messages[response.status] || 'Servidor indisponível. Tente consultar o estado antes de gravar novamente.',
          data?.code || `HTTP_${response.status}`, response.status,
          write && response.status >= 500 ? 'unknown' : 'rejected');
      }
      if (!raw && response.status !== 204) throw error('Resposta sem confirmação válida.', 'INVALID_RESPONSE', response.status, write ? 'unknown' : 'not_applicable');
      return data;
    } catch (err) {
      if (err.outcome) throw err;
      throw error(controller.signal.aborted ? 'Tempo de espera esgotado.' : 'Falha de conexão com a API local.',
        controller.signal.aborted ? 'TIMEOUT' : 'CONNECTION_ERROR', response?.status,
        write && sent ? 'unknown' : 'not_applicable');
    } finally { clearTimeout(timer); }
  };
}
