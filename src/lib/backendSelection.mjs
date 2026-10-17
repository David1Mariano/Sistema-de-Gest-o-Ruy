// Temporary safety boundary; C1 mode selection must replace this when available.
export function resolveBackend(mode, { local, cloud, cloudConfigured }) {
  if (mode === 'local-api') return local;
  if (mode === 'supabase') {
    if (!cloudConfigured) throw Object.assign(new Error('Modo NUVEM não configurado.'), { code: 'CLOUD_NOT_CONFIGURED' });
    return cloud;
  }
  throw Object.assign(new Error('Escolha explicitamente LOCAL ou NUVEM. Integração do seletor C1 pendente.'), { code: 'MODE_REQUIRED' });
}

export function localContractUnavailable() {
  throw Object.assign(new Error('Modo LOCAL bloqueado: contratos da API B e autenticação C1 indisponíveis neste worktree.'), { code: 'LOCAL_CONTRACT_UNAVAILABLE', status: 501, outcome: 'not_sent' });
}
