const reauth = new Set(['PROVIDER_UNAUTHORIZED', 'PROVIDER_FORBIDDEN', 'RECONNECT_REQUIRED', 'AUTHORIZATION_EXPIRED', 'REFRESH_TOKEN_MISSING']);
export function deliveryStatus(platform, snapshot) {
  if (platform === '99food') return 'Configuração necessária';
  if (!snapshot) return 'Conexão não verificada';
  if (!snapshot.ifoodConfigured) return 'Não configurado';
  const record = snapshot.integrations?.find(row => row.platform === platform);
  if (reauth.has(record?.last_error)) return 'Reautenticação necessária';
  return { disconnected: 'Não conectado', connecting: 'Conectando', connected: 'Conectado', attention: 'Requer atenção', error: 'Erro' }[record?.status] || 'Não conectado';
}
export function deliverySyncStatus(platform, snapshot) {
  if (platform === '99food') return 'Configuração pendente';
  if (!snapshot?.pollingEnabled) return 'Configuração pendente';
  const record = snapshot.integrations?.find(row => row.platform === platform);
  if (!record?.last_sync_at) return 'Sem sincronização';
  return 'Última sincronização registrada';
}
