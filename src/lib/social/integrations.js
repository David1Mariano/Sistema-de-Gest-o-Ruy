export const SOCIAL_CHANNELS = Object.freeze({ instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok' });
export const originLabel = record => `${SOCIAL_CHANNELS[record.channel || record.provider] || 'Canal não informado'}${record.transport === 'manychat' ? ' · via ManyChat' : ''}`;
export const MANYCHAT_STATES = Object.freeze({ not_configured: 'Não configurado', configured: 'Configurado', authentication_error: 'Erro de autenticação', connected: 'Conectado', attention: 'Atenção' });
export function manyChatState(health) {
  if (!health?.configured) return 'not_configured';
  if (['AUTHENTICATION_FAILED', 'FORBIDDEN'].includes(health.error_code)) return 'authentication_error';
  if (health.error_code) return 'attention';
  return health.authenticated && health.reachable ? 'connected' : 'configured';
}
