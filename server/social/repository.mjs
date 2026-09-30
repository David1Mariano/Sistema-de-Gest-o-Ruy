// Repository transacional para o domínio social / ManyChat.
//
// Substitui o double em memória por implementação real sobre Postgres. Não
// inventa arquitetura: implementa o contrato que `manychatIngress`, `outbox` e
// `service` já consomem.
//
// PERSISTÊNCIA (request #24): a base social já é SQL dedicado
// (`proposed-social-schema.sql` + `proposed-social-manychat.sql`), com
// constraints e RLS. Portanto este repository fala SQL direto com Supabase e
// NÃO usa o `records` genérico, que não oferece unicidade nem transação.
//
// CONCORRÊNCIA (request #7/#8): a idempotência NUNCA depende de `SELECT`
// seguido de `INSERT` — isso perde sob concorrência. Todo claim usa
// `insert ... on conflict do nothing returning`, que é atômico: se duas
// requisições disputam a mesma chave, o banco serializa e só uma recebe linha.
//
// SEGURANÇA (request #15/#16): as tabelas têm RLS forçado e grants revogados
// de anon/authenticated. Este módulo só roda com service role NO BACKEND e
// ainda assim confere autorização por conta. Nunca é importado pelo frontend.
import { SocialError } from './providerBase.mjs';

const TABLES = {
  accounts: 'public.social_accounts',
  comments: 'public.social_comments',
  contacts: 'public.social_contacts',
  messages: 'public.social_messages',
  receipts: 'public.social_ingress_receipts',
  outbox: 'public.social_outbox',
  events: 'public.social_events',
  drafts: 'public.social_ai_drafts',
  integrations: 'public.social_integrations',
};

const CONTACT_COLUMNS = ['external_contact_id', 'account_id', 'manychat_account_id', 'channel', 'transport', 'name', 'first_name', 'last_name', 'status', 'language', 'timezone', 'inbox_url'];

const fail = (code, message) => new SocialError(code, message);

// Códigos do Postgres relevantes para retry e idempotência.
export const UNIQUE_VIOLATION = '23505';
export const SERIALIZATION_FAILURE = '40001';
export const DEADLOCK_DETECTED = '40P01';

const isUniqueViolation = error => error?.code === UNIQUE_VIOLATION;

// Autorização por conta. Sem função configurada, NÃO seguimos: é preferível
// falhar a rechazar acesso a inventar permissão.
async function assertAccountAccess(isAccountVisible, userId, accountId) {
  if (typeof isAccountVisible !== 'function') throw fail('FORBIDDEN', 'Autorização de conta não configurada');
  const visible = await isAccountVisible(userId, accountId);
  if (!visible) throw fail('FORBIDDEN', 'Conta não autorizada');
  return true;
}

// Comandos de escrita de cada domínio. O status de workflow NUNCA é
// sobrescrito por reentrega: um comentário já respondido não volta para
// 'pending', e a mesma regra vale para a mensagem.
function writesFor(client) {
  return {
    // ── idempotência de transporte: ATÔMICA, sem SELECT-then-INSERT ───────
    async claimReceipt(receiptKey, payloadHash, { accountId, transport = 'manychat' } = {}) {
      if (!receiptKey || !payloadHash) throw fail('INVALID_PAYLOAD', 'Recibo incompleto');
      const inserted = await client.query(
        `insert into ${TABLES.receipts} (receipt_key, payload_hash, account_id, transport)
           values ($1,$2,$3,$4)
         on conflict (receipt_key) do nothing
           returning receipt_key`,
        [receiptKey, payloadHash, accountId || null, transport],
      );
      if (inserted.rows.length) return 'new';
      const existing = await client.query(
        `select payload_hash from ${TABLES.receipts} where receipt_key = $1`, [receiptKey],
      );
      const previous = existing.rows[0]?.payload_hash;
      if (!previous) return 'new';
      return previous === payloadHash ? 'duplicate' : 'conflict';
    },

    // ── contato: upsert que não apaga campo ausente ──────────────────────
    async upsertContact(contact) {
      if (!contact?.external_contact_id || !contact?.account_id) throw fail('INVALID_PAYLOAD', 'Contato incompleto');
      const row = await client.query(
        `insert into ${TABLES.contacts} (${CONTACT_COLUMNS.join(',')})
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (account_id, channel, transport, manychat_account_id, external_contact_id) do update set
           name      = coalesce(excluded.name, ${TABLES.contacts}.name),
           first_name= coalesce(excluded.first_name, ${TABLES.contacts}.first_name),
           last_name = coalesce(excluded.last_name, ${TABLES.contacts}.last_name),
           status    = coalesce(excluded.status, ${TABLES.contacts}.status),
           language  = coalesce(excluded.language, ${TABLES.contacts}.language),
           timezone  = coalesce(excluded.timezone, ${TABLES.contacts}.timezone),
           inbox_url = coalesce(excluded.inbox_url, ${TABLES.contacts}.inbox_url)
         returning *`,
        CONTACT_COLUMNS.map((c) => contact[c] ?? null),
      );
      return row.rows[0];
    },

    // ── comentários públicos: exigem ID nativo, nunca dedup por texto ────
    async upsertComment(record) {
      if (!record?.external_comment_id) throw fail('INVALID_PAYLOAD', 'Comentário sem ID nativo');
      if (!record?.account_id) throw fail('INVALID_PAYLOAD', 'Comentário sem conta');
      // A chave `unique (provider, account_id, external_comment_id)` é o que
      // reconcilia ManyChat com o caminho direto da Meta.
      const row = await client.query(
        `insert into ${TABLES.comments}
           (provider, account_id, external_comment_id, external_post_id, author_name, text,
            created_at, permalink, status, transport, external_contact_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)
       on conflict (provider, account_id, external_comment_id) do update set
         text             = excluded.text,
         external_post_id = coalesce(excluded.external_post_id, ${TABLES.comments}.external_post_id),
         permalink        = coalesce(excluded.permalink, ${TABLES.comments}.permalink),
         status           = ${TABLES.comments}.status,
         version          = ${TABLES.comments}.version
         returning *`,
        [record.provider, record.account_id, record.external_comment_id, record.external_post_id || null,
          record.author_name || null, record.text, record.created_at, record.permalink || null,
          record.transport || 'manychat', record.external_contact_id || null],
      );
      return row.rows[0];
    },

    // ── mensagens privadas: domínio e chave próprios ─────────────────────
    async upsertMessage(record) {
      if (!record?.external_message_id) throw fail('INVALID_PAYLOAD', 'Mensagem sem ID nativo');
      if (!record?.account_id) throw fail('INVALID_PAYLOAD', 'Mensagem sem conta');
      const row = await client.query(
        `insert into ${TABLES.messages}
           (account_id, channel, transport, external_message_id, external_contact_id, text, created_at, status)
         values ($1,$2,$3,$4,$5,$6,$7,'pending')
       on conflict (account_id, channel, transport, external_message_id) do update set
         text    = excluded.text,
         status  = ${TABLES.messages}.status,
         version = ${TABLES.messages}.version
         returning *`,
        [record.account_id, record.channel, record.transport || 'manychat', record.external_message_id,
          record.external_contact_id, record.text, record.created_at],
      );
      return row.rows[0];
    },

    async appendEvent(event) {
      if (!event?.action) throw fail('INVALID_PAYLOAD', 'Evento sem ação');
      const row = await client.query(
        `insert into ${TABLES.events} (provider, account_id, action, result, error_code, actor_id, transport, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,coalesce($8, now())) returning id`,
        [event.channel || event.provider || null, event.account_id || null, event.action, event.result || 'ok',
          event.error_code || null, event.actor_id || null, event.transport || null, event.created_at || null],
      );
      return row.rows[0];
    },
  };
}


export function createSocialRepository({ withClient, isAccountVisible = null, now = () => new Date().toISOString() } = {}) {
  if (typeof withClient !== 'function') throw new Error('createSocialRepository requer withClient()');
  const access = (userId, accountId) => assertAccountAccess(isAccountVisible, userId, accountId);

  // Objeto transacional entregue ao ingress, à outbox e ao service.
  function txFor(client) {
    const writes = writesFor(client);
    return {
      ...writes,
      async upsertRecord(kind, record) {
        if (kind === 'comment') return writes.upsertComment(record);
        if (kind === 'message') return writes.upsertMessage(record);
        throw fail('INVALID_PAYLOAD', `Domínio desconhecido: ${kind}`);
      },
      // Lock real de linha: versão e autorização são conferidas dentro da
      // MESMA transação, então não há TOCTOU.
      async recordForUpdate(userId, kind, recordId) {
        const table = kind === 'comment' ? TABLES.comments : kind === 'message' ? TABLES.messages : null;
        if (!table) throw fail('INVALID_PAYLOAD', `Domínio desconhecido: ${kind}`);
        const row = await client.query(
          `select id, account_id, provider, transport, version, text, category, status
             from ${table} where id = $1 for update`,
          [recordId],
        );
        const record = row.rows[0];
        if (!record) return null;
        await access(userId, record.account_id);
        return record;
      },
      async canAccessAccount(userId, accountId) { return access(userId, accountId); },
      // Outbox: `unique(idempotency_key)` resolve a corrida. Mesmo key com
      // texto diferente é CONFLITO, nunca sobrescrita.
      async insertOutboxOnce(entry) {
        const inserted = await client.query(
          `insert into ${TABLES.outbox}
             (idempotency_key, fingerprint, account_id, channel, transport, comment_id, message_id,
              text, approved_by, approved_at, record_version, status, blocked_reason, attempts)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,0)
           on conflict (idempotency_key) do nothing
             returning *`,
          [entry.idempotency_key, entry.fingerprint, entry.account_id, entry.channel, entry.transport,
            entry.kind === 'comment' ? entry.record_id : null, entry.kind === 'message' ? entry.record_id : null,
            entry.text, entry.approved_by, entry.approved_at || now(), entry.record_version,
            entry.blocked_reason || 'SEND_DISABLED'],
        );
        if (inserted.rows.length) return { created: true, entry: inserted.rows[0] };
        const existing = await client.query(`select * from ${TABLES.outbox} where idempotency_key = $1`, [entry.idempotency_key]);
        const previous = existing.rows[0];
        if (!previous) throw fail('CONFLICT', 'Registro de saída em estado inconsistente');
        if (previous.fingerprint !== entry.fingerprint) throw fail('CONFLICT', 'Aprovação idempotente com texto diferente');
        return { created: false, entry: previous };
      },
      raw: client,
    };
  }

  async function withReadClient() {
    const client = await withClient();
    if (!client?.query) throw new Error('withClient() precisa devolver um client com query()');
    return client;
  }

  const api = {
    version: 1,
    isUniqueViolation,
    // BEGIN/COMMIT no MESMO client. Qualquer erro faz ROLLBACK, então nunca
    // sobra metade gravada; `release()` devolve o pool no caminho do erro.
    async transaction(work) {
      const client = await withReadClient();
      let open = false;
      try {
        await client.query('begin');
        open = true;
        const result = await work(txFor(client));
        await client.query('commit');
        open = false;
        return result;
      } catch (error) {
        if (open) { try { await client.query('rollback'); } catch { /* conexão perdida */ } }
        throw error;
      } finally {
        try { client.release?.(); } catch { /* pool fechado */ }
      }
    },

    async read(text, params = []) {
      const client = await withReadClient();
      try { const r = await client.query(text, params); return r.rows[0] ?? null; }
      finally { try { client.release?.(); } catch { /* noop */ } }
    },

    async readMany(text, params = []) {
      const client = await withReadClient();
      try { const r = await client.query(text, params); return r.rows; }
      finally { try { client.release?.(); } catch { /* noop */ } }
    },
  };

  // Métodos de leitura/autorização fora da transaction.
  Object.assign(api, {
    async commentFor(userId, commentId) {
      const row = await api.read(`select * from ${TABLES.comments} where id = $1`, [commentId]);
      if (!row) return null;
      await access(userId, row.account_id);
      return row;
    },

    // Estado da integração para o card. A tabela `social_integrations` não tem
    // coluna de segredo por desenho, então nada sensível pode vazar aqui.
    async integrationStatus(transport = 'manychat') {
      const row = await api.read(
        `select transport, sync_status, last_synced_at, last_event_at, last_error_code
           from ${TABLES.integrations} where transport = $1`, [transport]);
      return row || { transport, sync_status: 'not_configured', last_synced_at: null, last_event_at: null, last_error_code: null };
    },

    async snapshotFor(userId) {
      const comments = await api.readMany(`select * from ${TABLES.comments} order by created_at desc limit 200`, []);
      await Promise.all(comments.map((c) => access(userId, c.account_id)));
      const messages = await api.readMany(`select * from ${TABLES.messages} order by created_at desc limit 200`, []);
      await Promise.all(messages.map((m) => access(userId, m.account_id)));
      return {
        accounts: await api.readMany(`select * from ${TABLES.accounts} order by display_name`, []),
        comments, messages, replies: [], drafts: [], metrics: [], posts: [],
        aiConfigured: false,
        manychat: await api.integrationStatus('manychat'),
      };
    },

    // Rascunho + evento na MESMA transação (append-only; nunca update do anterior).
    async appendDraftAndEvent({ comment, draft, actorId, safety }) {
      return api.transaction(async tx => {
        await access(actorId, comment.account_id);
        const inserted = await tx.raw.query(
          `insert into ${TABLES.drafts} (comment_id, text, category, sentiment, policy_version, generated_by)
           values ($1,$2,$3,$4,$5,$6) returning *`,
          [comment.id, draft.text, draft.category ?? null, draft.sentiment ?? null, draft.policyVersion ?? 1, actorId],
        );
        await tx.appendEvent({
          action: 'draft_generated', account_id: comment.account_id,
          channel: comment.provider, transport: comment.transport, actor_id: actorId,
        });
        return { draft: inserted.rows[0], requiresAttention: Boolean(safety?.requiresAttention) };
      });
    },

    // Auditoria de FALHA em transaction própria: nunca contamina a transação
    // que já está em rollback.
    async recordFailure(event) {
      return api.transaction(tx => tx.appendEvent({ ...event, result: 'error' }));
    },

    // Account binding EXPLÍCITO. Comentário sem binding válido é recusado;
    // a conta nunca é inferida pelo nome.
    async resolveBinding({ manychatAccountId, channel, environment = 'default' } = {}) {
      if (!manychatAccountId || !channel) throw fail('INVALID_PAYLOAD', 'Binding incompleto');
      const row = await api.read(
        `select i.external_account_id as manychat_account_id, i.sync_status,
                a.id as account_id, a.provider as channel,
                a.external_account_id as external_social_account_id
           from ${TABLES.integrations} i
           join ${TABLES.accounts} a
             on a.provider = $2 and a.external_account_id = i.external_account_id
          where i.transport = 'manychat' and i.external_account_id = $1
          limit 1`,
        [manychatAccountId, channel],
      );
      if (!row) throw fail('BINDING_NOT_FOUND', 'Conta ManyChat sem vínculo de conta social');
      return { ...row, transport: 'manychat', environment, native_ids_verified: row.sync_status === 'connected' };
    },
  });

  return Object.freeze(api);
}


