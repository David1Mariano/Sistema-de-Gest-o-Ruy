import { socialPermissions } from '../../src/lib/social/domain.js';
import { SocialError } from './providers.mjs';
import { moderationCheck } from './ai.mjs';
import { prepareManyChatAction } from './outbox.mjs';

// verifyIdentity MUST validate Supabase bearer token with Auth getUser and the active
// legacy profile. Never accept role, approver, account access or claims from request JSON.
export function createSocialService({ verifyIdentity, repository, ai, providers }) {
  async function authorize(token, permission, accountId) {
    const identity = await verifyIdentity(token);
    if (!identity?.id || identity.active !== true || !socialPermissions(identity.app_metadata?.system_role)[permission]) {
      throw new SocialError('FORBIDDEN', 'Sem permissão para esta ação');
    }
    if (accountId && !await repository.canAccessAccount(identity.id, accountId)) throw new SocialError('FORBIDDEN', 'Conta não autorizada');
    return identity;
  }
  return Object.freeze({
    async prepareManyChatAction(token, request) {
      const actor = await authorize(token, 'reply');
      // Applies to all preparations, including AI-edited text. No caller-supplied approver.
      await authorize(token, 'approve_ai');
      return prepareManyChatAction({ repository, actor, request });
    },
    async read(token, report = false) {
      const actor = await authorize(token, report ? 'report' : 'view');
      return repository.snapshotFor(actor.id);
    },
    async suggest(token, commentId) {
      const actor = await authorize(token, 'approve_ai');
      const comment = await repository.commentFor(actor.id, commentId);
      if (!comment) throw new SocialError('NOT_FOUND', 'Comentário não encontrado');
      await authorize(token, 'approve_ai', comment.account_id);
      const safety = moderationCheck(comment.text, comment.category);
      if (safety.requiresAttention) throw new SocialError('HUMAN_ONLY', 'Requer atenção: escrever resposta manualmente');
      // appendDraftAndEvent is a transaction, never an update of a previous draft.
      const draft = await ai.draftReply(comment);
      return repository.appendDraftAndEvent({ comment, draft, actorId: actor.id, safety });
    },
    async approveAndReply(token, { commentId, text, draftId, confirmHuman, expectedVersion }) {
      const actor = await authorize(token, 'reply');
      if (confirmHuman !== true || !text?.trim() || text.length > 2000 || !Number.isInteger(expectedVersion)) throw new SocialError('REVIEW_REQUIRED', 'Revisão humana obrigatória');
      if (draftId) await authorize(token, 'approve_ai');
      const comment = await repository.commentFor(actor.id, commentId);
      if (!comment) throw new SocialError('NOT_FOUND', 'Comentário não encontrado');
      await authorize(token, 'reply', comment.account_id);
      const provider = providers[comment.provider];
      if (!provider?.capabilities.replyComment) throw new SocialError('UNSUPPORTED', 'Funcionalidade ainda não disponível nesta integração');
      // Hard phase-one gate. There is deliberately NO send call, queue or automation switch.
      throw new SocialError('NOT_CONFIGURED', 'Integração não configurada');
    },
  });
}
