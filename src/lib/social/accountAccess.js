// ===========================================================================
// GESTÃO DE CONTAS SOCIAIS E ACESSOS (Fase 7).
//
// Este módulo é a ÚNICA fonte de verdade das regras de permissão de conta. A UI
// (`SocialAccessAdmin`) e o backend (`createAccountAdminService`) consomem as
// mesmas funções: se a tela permite uma combinação, o banco a aceita; se o
// banco rejeita, a tela nem oferece.
//
// As regras NÃO são um idioma de UI: são as mesmas constraints de
// `scripts/proposed-social-account-access.sql` (MIGRATION PROPOSTA, NÃO APLICADA).
// Duplicá-las aqui e divergir do SQL seria a forma mais rápida de gravar um
// vínculo que o banco recusa — ou pior, aceitar um que o banco deveria negar.
// ===========================================================================

// As quatro dimensões, na ordem em que aparecem para o operador. `can_view` é
// o piso e por isso vem primeiro: desligar as outras é normal, mas elas não
// funcionam sem ele.
export const ACCOUNT_PERMISSION_FIELDS = Object.freeze(['can_view', 'can_reply', 'can_approve_ai', 'can_admin']);

export const ACCOUNT_PERMISSION_LABEL = Object.freeze({
  can_view: 'Visualizar',
  can_reply: 'Responder',
  can_approve_ai: 'Aprovar IA',
  can_admin: 'Administrar integração',
});

export const ACCOUNT_PERMISSION_HINT = Object.freeze({
  can_view: 'Ver comentários, mensagens e métricas da conta.',
  can_reply: 'Preparar e aprovar respostas. Exige Visualizar.',
  can_approve_ai: 'Aprovar sugestões da IA. Exige Visualizar.',
  can_admin: 'Configurar a integração da conta. Exige Responder.',
});

/**
 * Normaliza um conjunto de permissões para o que o banco realmente aceita.
 *
 * Reproduz as três constraints da migration:
 *   - `..._implies_view`         -> responder/aprovar/admin exige can_view
 *   - `..._admin_implies_reply`  -> can_admin exige can_reply
 *   - `..._active_no_permission` -> vínculo inativo não carrega permissão
 *
 * Normalizar em vez de recusar é deliberado: o usuário ligou "Responder" e
 * também precisa de "Visualizar" — negar o conjunto inteiro obrigaria a
 * adivinhar qual das duas ele queria. Já a REVISÃO da UI apenas avisa.
 *
 * @param {object} input  flags soltos
 * @param {boolean} active vínculo ativo?
 * @returns {{permissions: object, adjusted: string[], invalid: string[]}}
 */
export function normalizeAccountPermissions(input = {}, active = true) {
  const wanted = {};
  const invalid = [];
  for (const field of ACCOUNT_PERMISSION_FIELDS) {
    const value = input?.[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'boolean') { invalid.push(field); continue; }
    wanted[field] = value;
  }
  const permissions = { can_view: false, can_reply: false, can_approve_ai: false, can_admin: false };
  for (const field of ACCOUNT_PERMISSION_FIELDS) if (wanted[field] === true) permissions[field] = true;
  const adjusted = [];
  // A ordem importa: can_admin implica can_reply, que por sua vez implica
  // can_view. Aplicar na ordem das constraints garante que ligar só `can_admin`
  // resulte em {view, reply, admin}, e não em algo que o banco reprovaria.
  if (permissions.can_admin && !permissions.can_reply) { permissions.can_reply = true; adjusted.push('can_admin→can_reply'); }
  if ((permissions.can_reply || permissions.can_approve_ai || permissions.can_admin) && !permissions.can_view) {
    permissions.can_view = true; adjusted.push('→can_view');
  }
  // Vínculo inativo carrega ZERO permissões. Reativar é ação explícita, nunca
  // efeito colateral de editar outra coisa.
  if (!active) {
    for (const field of ACCOUNT_PERMISSION_FIELDS) {
      if (permissions[field]) { permissions[field] = false; adjusted.push(`${field}→false (inativo)`); }
    }
  }
  return { permissions, adjusted, invalid };
}

// Status da conta: só `connected` sustenta operação normal (ver
// `createAccountAccessResolver`). A UI sinaliza o resto, em vez de esconder.
export const ACCOUNT_STATUS_LABEL = Object.freeze({
  connected: 'Conectada',
  disconnected: 'Desconectada',
  expired: 'Expirada',
  error: 'Com erro',
});

export const ACCOUNT_STATUS_BADGE = Object.freeze({
  connected: 'default',
  disconnected: 'secondary',
  expired: 'destructive',
  error: 'destructive',
});

export const SOCIAL_PROVIDER_LABEL = Object.freeze({
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
});

// Status do usuário no inventário legado (`records`, entidade AuthUser). O mesmo
// vocabulário de `authAdapter.me()`, para a tela não inventar um segundo
// critério de "ativo".
export const USER_INACTIVE_STATUS = Object.freeze(['inactive', 'inativo', 'disabled', 'bloqueado', 'desativado']);
export const isUserActive = (status) => !USER_INACTIVE_STATUS.includes(String(status || '').toLowerCase().trim());

/** Rótulo legível da conta: canal + nome, sem exigir que o UUID apareça. */
export function accountLabel(account) {
  if (!account) return 'Conta';
  const provider = SOCIAL_PROVIDER_LABEL[account.provider] || account.provider || 'Canal';
  return account.display_name ? `${provider} — ${account.display_name}` : provider;
}

/**
 * Identificador externo redigido. O ID externo é um identificador de conta na
 * plataforma: ajuda o operador a confirmar qual conta é, mas não precisa ser
 * exibido por inteiro numa tela de gestão de acessos.
 */
export function redactExternalId(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'não informado';
  if (text.length <= 4) return '•'.repeat(text.length);
  return `${text.slice(0, 2)}${'•'.repeat(Math.min(8, text.length - 4))}${text.slice(-2)}`;
}

// Rótulo da pessoa, sem UUID cru como elemento principal. O UUID continua
// existindo internamente (é o que o vínculo referencia), mas o operador escolhe
// por nome.
export function personLabel(person) {
  if (!person) return 'Usuário';
  return person.full_name || person.email || person.name || 'Usuário sem nome';
}

// Estado mostrado quando o schema de acesso ainda não existe. Uma lista vazia
// seria enganosa: pareceria "nenhuma conta tem acesso" quando a verdade é
// "ninguém foi configurado porque a tabela não existe".
export const ACCESS_NOT_CONFIGURED_MESSAGE = 'Configuração de acesso social ainda não foi ativada.';

/** Revisão legível das mudanças, usada na confirmação antes de gravar. */
export function describePermissionChange(before = {}, after = {}) {
  const changes = [];
  for (const field of ACCOUNT_PERMISSION_FIELDS) {
    const de = before?.[field] === true;
    const para = after?.[field] === true;
    if (de !== para) changes.push({ field, label: ACCOUNT_PERMISSION_LABEL[field], from: de, to: para });
  }
  return changes;
}

