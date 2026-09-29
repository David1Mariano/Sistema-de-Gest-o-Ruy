export const SOCIAL_CHANNELS = Object.freeze({ instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok' });
export const originLabel = record => `${SOCIAL_CHANNELS[record.channel || record.provider] || 'Canal não informado'}${record.transport === 'manychat' ? ' · via ManyChat' : ''}`;

// ManyChat é INTEGRAÇÃO OPCIONAL. Aparece na tela, mas nunca como requisito:
// os canais diretos (Instagram/Facebook/WhatsApp) funcionam sem ele.
export const MANYCHAT_ROLE = 'optional';
export const MANYCHAT_ROLE_LABEL = 'Integração opcional';
export const MANYCHAT_STATES = Object.freeze({ not_configured: 'Não configurado', configured: 'Configurado', authentication_error: 'Erro de autenticação', connected: 'Conectado', attention: 'Atenção' });
export function manyChatState(health) {
  if (!health?.configured) return 'not_configured';
  if (['AUTHENTICATION_FAILED', 'FORBIDDEN'].includes(health.error_code)) return 'authentication_error';
  if (health.error_code) return 'attention';
  return health.authenticated && health.reachable ? 'connected' : 'configured';
}

// Estados da IA local, derivados de três eixos independentes. A UI precisa
// distinguir "não configurado" de "offline" porque a ação é diferente: um é
// configurar, o outro é ligar o Ollama na máquina.
export const AI_STATES = Object.freeze({
  not_configured: 'IA não configurada',
  offline: 'IA local offline',
  ready: 'IA pronta',
  model_unavailable: 'Modelo indisponível',
  error: 'Erro',
});
export const AI_ERROR_LABELS = Object.freeze({
  AI_NOT_CONFIGURED: 'IA não configurada',
  AI_UNREACHABLE: 'IA local offline',
  AI_TIMEOUT: 'IA local demorou demais para responder',
  AI_MODEL_UNAVAILABLE: 'Modelo indisponível',
  AI_INVALID_RESPONSE: 'Resposta inválida da IA local',
  AI_UNSAFE_OUTPUT: 'Resposta da IA reprovada na validação',
  AI_DISABLED: 'Provedor de IA desativado',
});
export function aiLabel(health) {
  if (!health) return AI_STATES.not_configured;
  if (health.state && AI_STATES[health.state]) return AI_STATES[health.state];
  if (health.error_code && AI_ERROR_LABELS[health.error_code]) return AI_ERROR_LABELS[health.error_code];
  return AI_STATES.error;
}
/** Só quando a IA está realmente utilizável a Central pode oferecer sugestão. */
export const aiReady = health => health?.configured === true && health?.reachable === true && health?.modelAvailable === true;
// A Central nunca quebra por causa da IA: fora do ar, o operador escreve na mão.
export const MANUAL_FALLBACK_LABEL = 'IA temporariamente indisponível. Responder manualmente.';
