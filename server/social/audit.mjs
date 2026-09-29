const actions = new Set(['comment_received', 'draft_generated', 'human_approved', 'reply_sent', 'reply_failed']);
// Allowlisted fields only; never store raw provider errors, tokens or payloads.
export function socialEvent({ action, commentId, accountId, provider, actorId = null, result, errorCode = null }, now = new Date()) {
  if (!actions.has(action) || !['instagram', 'facebook', 'tiktok'].includes(provider) || !accountId || !commentId || !['ok', 'error'].includes(result)) throw new Error('Evento inválido');
  if (['human_approved', 'reply_sent'].includes(action) && !actorId) throw new Error('Responsável obrigatório');
  const allowedErrors = ['NOT_CONFIGURED', 'AI_NOT_CONFIGURED', 'UNSUPPORTED', 'FORBIDDEN', 'PROVIDER_FAILURE', 'CONFLICT'];
  return Object.freeze({ action, comment_id: commentId, account_id: accountId, provider, actor_id: actorId, result, error_code: errorCode ? (allowedErrors.includes(errorCode) ? errorCode : 'PROVIDER_FAILURE') : null, created_at: now.toISOString() });
}
