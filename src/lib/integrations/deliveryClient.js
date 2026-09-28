import { createClient } from '@supabase/supabase-js';
import { cloudConfig } from '@/lib/cloudDb';

// Sessão exclusiva do operador verificado; nenhum token de iFood/99Food sai do backend.
// Não reutiliza localAuth/records e não persiste sessão no browser.
const auth = createClient(cloudConfig.url, cloudConfig.key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'delivery-memory-only' },
});
let session = null;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());
export const subscribeDeliverySession = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const getDeliverySession = () => session;
export async function requestDeliveryOtp(email) {
  const { error } = await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw new Error('Não foi possível enviar o código. Verifique o cadastro autorizado e aguarde antes de tentar novamente.');
}
export async function verifyDeliveryOtp(email, token) {
  const { data, error } = await auth.auth.verifyOtp({ email, token, type: 'email' });
  if (error || !data.session) throw new Error('Código inválido ou expirado.');
  session = { accessToken: data.session.access_token, expiresAt: data.session.expires_at * 1000 };
  emit();
}
export async function closeDeliverySession() {
  session = null; emit();
  await auth.auth.signOut({ scope: 'local' });
}
const messages = {
  CONTACT_ACCESS_DENIED: 'Você não tem acesso a este canal/loja ou à alteração do atendimento.',
  CONVERSATION_CHANGED: 'A conversa mudou. Atualize a leitura antes de assumir ou devolver o atendimento.',
  CONVERSATION_NOT_FOUND: 'Conversa não encontrada neste canal/loja.',
  INVALID_HANDOFF_VERSION: 'Versão do atendimento inválida para esta operação. Atualize a leitura da conversa.',
  MESSAGE_NOT_FOUND: 'Mensagem de origem do atendimento não encontrada nesta conversa.',
  MESSAGE_ID_CONFLICT: 'Mensagem já registrada com conteúdo diferente. Requer conferência manual.',
  CUSTOMER_SCOPE_MISMATCH: 'Esta conversa pertence a outro cliente neste canal/loja.',
  UNKNOWN_PROVIDER: 'Canal não reconhecido para atendimento.',
  INVALID_IDENTIFIER: 'Identificador inválido para esta operação de atendimento.',
  IFOOD_NOT_CONFIGURED: 'iFood aguarda configuração segura e homologação no servidor.',
  FOOD99_NOT_AVAILABLE: 'AGUARDANDO HOMOLOGAÇÃO/CREDENCIAIS 99FOOD',
  DELIVERY_ACCESS_DENIED: 'Sua conta não está autorizada para esta operação de delivery.',
  ADMIN_VERIFICATION_REQUIRED: 'Verifique seu acesso às integrações por e-mail.',
  ADMIN_SESSION_EXPIRED: 'A verificação expirou. Solicite um novo código.',
  AUTHORIZATION_EXPIRED: 'A autorização iFood expirou. Inicie uma nova conexão.',
  RECONNECT_REQUIRED: 'Reconecte a conta no portal oficial.',
  PROVIDER_UNAUTHORIZED: 'Autorização da plataforma expirada ou revogada. Reconecte.',
  PROVIDER_FORBIDDEN: 'A plataforma não autorizou este recurso/estabelecimento.',
  PROVIDER_RATE_LIMIT: 'Limite da plataforma atingido. Aguarde antes de sincronizar.',
  INTEGRATION_BUSY: 'Outra operação está em andamento. Aguarde.',
  IFOOD_NOT_CONNECTED: 'Conecte e autorize o estabelecimento primeiro.',
  NO_AUTHORIZED_MERCHANTS: 'Nenhum estabelecimento autorizado foi encontrado.',
  RECONCILIATION_MISMATCH: 'O lançamento deve ser do mesmo canal e dia do pedido.',
  PERSISTENCE_UNAVAILABLE: 'Persistência indisponível. Não considere os totais atualizados.',
  PARTIAL_SYNC: 'Sincronização parcial; há eventos pendentes de reprocessamento.',
  SYNC_PENDING: 'Ainda há eventos aguardando processamento.',
  POLLING_NOT_ENABLED: 'Configuração necessária: habilite a consulta de eventos no servidor após homologação.',
  UNSUPPORTED_EVENT_TYPE: 'Evento não suportado registrado; confira a operação na plataforma.',
  ORDER_RETRY_EXHAUSTED: 'Consulta de pedido interrompida após tentativas limitadas. Requer conferência manual.',
};
export const deliveryMessage = code => messages[code] || 'Integração indisponível. Consulte o responsável pela configuração.';
export async function deliveryCall(action, payload = {}) {
  if (!session || session.expiresAt <= Date.now()) { session = null; emit(); throw new Error(messages.ADMIN_VERIFICATION_REQUIRED); }
  let response;
  try {
    response = await fetch(`${cloudConfig.url}/functions/v1/delivery-api`, {
      method: 'POST', headers: { apikey: cloudConfig.key, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, action }), signal: AbortSignal.timeout(90000),
    });
  } catch { throw new Error('Backend de delivery indisponível ou não implantado. Nenhum resultado foi presumido.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('Resposta inválida do backend de delivery.'); }
  if (!response.ok) {
    if (data.error === 'ADMIN_SESSION_EXPIRED') { session = null; emit(); }
    throw new Error(deliveryMessage(data.error));
  }
  return data;
}
