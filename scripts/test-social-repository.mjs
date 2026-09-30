// Repository transacional real — testes.
//
// O `withClient` recebe um executor SEMÂNTICO que modela o Postgres: unique
// constraints, `on conflict do nothing`, BEGIN/COMMIT/ROLLBACK e `for update`.
// Não é um Map ingênuo: o objetivo é provar que a SQL do repository produz
// atomicidade e idempotência sob concorrência.
//
// LIMITAÇÃO HONESTA: isto NÃO substitui um Postgres de verdade. Prova a lógica
// transacional e o desenho das constraints; falta provar em engine real, o que
// continua pré-requisito de deploy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createSocialRepository, UNIQUE_VIOLATION } from '../server/social/repository.mjs';
import { dispatchSocialOutbox, SOCIAL_AUTOMATION } from '../server/social/outbox.mjs';

const ACCOUNT = 'acct-1';
const CHANNEL = 'instagram';
const nowIso = () => '2026-09-29T12:00:00.000Z';

// Tabelas com as MESMAS chaves de unicidade da proposta SQL.
function fakeDb() {
  const tables = {
    social_ingress_receipts: { key: r => r.receipt_key, rows: [] },
    social_contacts: { key: r => [r.account_id, r.channel, r.transport, r.manychat_account_id, r.external_contact_id].join('|'), rows: [] },
    social_comments: { key: r => [r.provider, r.account_id, r.external_comment_id].join('|'), rows: [] },
    social_messages: { key: r => [r.account_id, r.channel, r.transport, r.external_message_id].join('|'), rows: [] },
    social_outbox: { key: r => r.idempotency_key, rows: [] },
    social_events: { key: r => r.id, rows: [] },
    social_ai_drafts: { key: r => r.id, rows: [] },
    social_accounts: { key: r => r.id, rows: [{ id: ACCOUNT, provider: CHANNEL, external_account_id: 'ext-1', display_name: 'Perfil' }] },
    social_integrations: { key: r => r.external_account_id, rows: [{ transport: 'manychat', external_account_id: 'ext-1', sync_status: 'connected', last_synced_at: null, last_event_at: null, last_error_code: null }] },
  };
  return { tables, log: [], seq: 0 };
}

// Atenção: o SQL usa `public.<tabela>`; o identificador vem DEPOIS do ponto.
const nameOf = sql => {
  const m = sql.match(/insert into (?:public\.)?(\w+)/i) || sql.match(/from (?:public\.)?(\w+)/i);
  return m ? m[1] : null;
};

let seq = 0;

function buildRow(db, table, params) {
  seq += 1;
  if (table === 'social_ingress_receipts') {
    const [receipt_key, payload_hash, account_id, transport] = params;
    return { receipt_key, payload_hash, account_id, transport };
  }
  if (table === 'social_contacts') {
    const [external_contact_id, account_id, manychat_account_id, channel, transport, name, first_name, last_name, status, language, timezone, inbox_url] = params;
    return { external_contact_id, account_id, manychat_account_id, channel, transport, name, first_name, last_name, status, language, timezone, inbox_url };
  }
  if (table === 'social_comments') {
    const [provider, account_id, external_comment_id, external_post_id, author_name, text, created_at, permalink, transport, external_contact_id] = params;
    return {
      id: `c-${external_comment_id}`, provider, account_id, external_comment_id, external_post_id,
      author_name, text, created_at, permalink, status: 'pending', transport, external_contact_id, version: 1,
    };
  }
  if (table === 'social_messages') {
    const [account_id, channel, transport, external_message_id, external_contact_id, text, created_at] = params;
    return { id: `m-${external_message_id}`, account_id, channel, transport, external_message_id, external_contact_id, text, created_at, status: 'pending', version: 1 };
  }
  if (table === 'social_outbox') {
    const [idempotency_key, fingerprint, account_id, channel, transport, comment_id, message_id, text, approved_by, approved_at, record_version, blocked_reason] = params;
    return { id: `o-${idempotency_key}`, idempotency_key, fingerprint, account_id, channel, transport, comment_id, message_id, text, approved_by, approved_at, record_version, status: 'pending', blocked_reason, attempts: 0 };
  }
  if (table === 'social_events') {
    const [provider, account_id, action, result, error_code, actor_id, transport, created_at] = params;
    return { id: `ev-${seq}`, provider, account_id, action, result, error_code, actor_id, transport, created_at: created_at || nowIso() };
  }
  if (table === 'social_ai_drafts') return { id: `dr-${seq}`, comment_id: params[0], text: params[1] };
  return { id: `x-${seq}` };
}

// Executa o subconjunto de SQL usado pelo repository, com semântica de unique.
// `begin` tira um snapshot e `rollback` RESTAURA: é isso que modela a
// atomicidade — sem desfazer, um rollback falso "passaria" o teste.
function makeClient(db, { failOn = null, onQuery = null } = {}) {
  const state = { inTx: false, released: 0, snapshot: null };
  const snapshot = () => structuredClone(Object.fromEntries(
    Object.entries(db.tables).map(([name, t]) => [name, [...t.rows]]),
  ));
  const restore = (snap) => {
    for (const [name, rows] of Object.entries(snap)) db.tables[name].rows = rows;
  };
  return {
    state,
    async query(sql, params = []) {
      const text = String(sql).trim().toLowerCase();
      db.log.push(text);
      if (text === 'begin') { state.inTx = true; state.snapshot = snapshot(); return { rows: [] }; }
      if (text === 'commit') { state.inTx = false; state.snapshot = null; return { rows: [] }; }
      if (text === 'rollback') {
        if (state.snapshot) restore(state.snapshot);
        state.inTx = false; state.snapshot = null;
        return { rows: [] };
      }
      if (failOn && text.includes(failOn)) {
        const error = new Error('falha simulada');
        error.code = 'XX000';
        throw error;
      }
      if (onQuery) { const injected = await onQuery(text, params); if (injected) return injected; }
      const table = nameOf(text);
      const store = table && db.tables[table];
      if (!store) return { rows: [] };
      if (/^insert into/.test(text)) {
        const isNothing = /on conflict .*do nothing/.test(text);
        const row = buildRow(db, table, params);
        const existing = store.rows.find((r) => store.key(r) === store.key(row));
        if (existing) {
          if (isNothing) return { rows: [] };
          // "do update": preserva status/versão exatamente como a SQL declara.
          Object.assign(existing, row, { status: existing.status ?? row.status, version: existing.version ?? row.version ?? 1 });
          return { rows: [existing] };
        }
        store.rows.push(row);
        return { rows: [row] };
      }
      if (/^select/.test(text)) {
        // JOIN: projeta a linha combinada. O repository usa o binding
        // (integraçãoManyChat ⨝ contaSocial) numa única consulta.
        if (/\bjoin\b/.test(text)) {
          const integracoes = db.tables.social_integrations.rows;
          const contas = db.tables.social_accounts.rows;
          // O WHERE referencia `i.external_account_id = $1`.
          const wanted = /external_account_id = \$\d+/.test(text) ? String(params[0]) : null;
          const joined = [];
          for (const i of integracoes) {
            if (wanted && i.external_account_id !== wanted) continue;
            for (const a of contas) {
              if (a.external_account_id !== i.external_account_id) continue;
              joined.push({
                manychat_account_id: i.external_account_id,
                sync_status: i.sync_status,
                account_id: a.id,
                channel: a.provider,
                external_social_account_id: a.external_account_id,
              });
            }
          }
          return { rows: /limit 1/.test(text) ? joined.slice(0, 1) : joined };
        }
        const where = text.match(/where ([\w.]+) = \$\d+/);
        const column = where ? where[1].split('.').pop() : null;
        const rows = column ? store.rows.filter((r) => String(r[column]) === String(params[0])) : [...store.rows];
        return { rows: /limit 1/.test(text) ? rows.slice(0, 1) : rows };
      }
      return { rows: [] };
    },
    release() { state.released += 1; },
  };
}

const repoFor = (db, options = {}) => createSocialRepository({
  withClient: async () => makeClient(db, options),
  isAccountVisible: async (_user, accountId) => accountId === ACCOUNT,
  now: nowIso,
});

const commentRecord = (over = {}) => ({
  provider: CHANNEL, account_id: ACCOUNT, external_comment_id: 'native-1', external_post_id: 'post-1',
  author_name: 'Pessoa', text: 'Olá', created_at: nowIso(), transport: 'manychat', external_contact_id: '123', ...over,
});
const messageRecord = (over = {}) => ({
  account_id: ACCOUNT, channel: CHANNEL, transport: 'manychat', external_message_id: 'msg-1',
  external_contact_id: '123', text: 'Olá', created_at: nowIso(), ...over,
});
const contact = (over = {}) => ({
  external_contact_id: '123', account_id: ACCOUNT, manychat_account_id: 'ext-1',
  channel: CHANNEL, transport: 'manychat', name: 'Pessoa', ...over,
});


// 1) repository inicia e expõe o contrato
test('repository starts and exposes the service contract', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  assert.equal(repo.version, 1);
  for (const m of ['transaction', 'recordFailure', 'commentFor', 'snapshotFor', 'appendDraftAndEvent', 'resolveBinding', 'integrationStatus']) {
    assert.equal(typeof repo[m], 'function', `falta ${m}`);
  }
  // Falha de configuração é SÍNCRONA, então `assert.throws`, não `rejects`.
  assert.throws(() => createSocialRepository({}), /withClient/, 'exige executor');
});

// 2/3) account binding
test('valid binding resolves; missing binding is refused', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  const binding = await repo.resolveBinding({ manychatAccountId: 'ext-1', channel: CHANNEL });
  assert.equal(binding.account_id, ACCOUNT);
  assert.equal(binding.channel, CHANNEL, 'canal preservado');
  assert.equal(binding.transport, 'manychat');
  assert.equal(binding.native_ids_verified, true, 'só conta conectada valida ID nativo');
  await assert.rejects(repo.resolveBinding({ manychatAccountId: 'nao-existe', channel: CHANNEL }), { code: 'BINDING_NOT_FOUND' });
  await assert.rejects(repo.resolveBinding({}), { code: 'INVALID_PAYLOAD' });
});

// 4) comentário persistido, com channel e transport
test('comment persists preserving channel and transport', async () => {
  const db = fakeDb();
  await repoFor(db).transaction(tx => tx.upsertRecord('comment', commentRecord()));
  const [row] = db.tables.social_comments.rows;
  assert.equal(row.provider, CHANNEL, 'provider é o canal real');
  assert.equal(row.transport, 'manychat');
  assert.equal(row.external_comment_id, 'native-1');
  assert.equal(row.status, 'pending');
});

// 5) mensagem persistida, domínio separado
test('private message persists in its own table', async () => {
  const db = fakeDb();
  await repoFor(db).transaction(tx => tx.upsertRecord('message', messageRecord()));
  assert.equal(db.tables.social_messages.rows.length, 1);
  assert.equal(db.tables.social_comments.rows.length, 0, 'mensagem nunca vira comentário');
  assert.equal(db.tables.social_messages.rows[0].external_message_id, 'msg-1');
});

// 6) comentário sem ID nativo é bloqueado
test('comment without native ID is refused', async () => {
  const db = fakeDb();
  await assert.rejects(
    repoFor(db).transaction(tx => tx.upsertRecord('comment', commentRecord({ external_comment_id: undefined }))),
    { code: 'INVALID_PAYLOAD' },
  );
  assert.equal(db.tables.social_comments.rows.length, 0, 'nada persistido');
  await assert.rejects(
    repoFor(db).transaction(tx => tx.upsertRecord('message', messageRecord({ external_message_id: undefined }))),
    { code: 'INVALID_PAYLOAD' },
  );
});

// 7/8/9) idempotência por chave nativa, não por SELECT-then-INSERT
test('idempotency uses on-conflict atomic claim, never select-then-insert', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  assert.equal(await repo.transaction(tx => tx.claimReceipt('k1', 'h1', { accountId: ACCOUNT })), 'new');
  assert.equal(await repo.transaction(tx => tx.claimReceipt('k1', 'h1', { accountId: ACCOUNT })), 'duplicate');
  assert.equal(await repo.transaction(tx => tx.claimReceipt('k1', 'h2', { accountId: ACCOUNT })), 'conflict');
  assert.equal(db.tables.social_ingress_receipts.rows.length, 1, 'um único recibo');
  const inserts = db.log.filter((l) => l.startsWith('insert into social_ingress_receipts'));
  assert.ok(inserts.every((l) => /on conflict .*do nothing/.test(l)), 'claim é atômico');
});

test('comment and message idempotency by native key', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  await repo.transaction(tx => tx.upsertRecord('comment', commentRecord()));
  await repo.transaction(tx => tx.upsertRecord('comment', commentRecord({ text: 'editado' })));
  assert.equal(db.tables.social_comments.rows.length, 1, 'mesmo ID nativo = 1 registro');
  assert.equal(db.tables.social_comments.rows[0].text, 'editado', 'texto atualizado');
  await repo.transaction(tx => tx.upsertRecord('message', messageRecord()));
  await repo.transaction(tx => tx.upsertRecord('message', messageRecord({ text: 'editado' })));
  assert.equal(db.tables.social_messages.rows.length, 1);
});

// 10/11) concorrência: dois eventos iguais ao mesmo tempo
test('concurrent identical claims produce one receipt and one record', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  // Duas transações concorrentes no MESMO key.
  const [a, b] = await Promise.all([
    repo.transaction(tx => tx.claimReceipt('same', 'hash', { accountId: ACCOUNT })),
    repo.transaction(tx => tx.claimReceipt('same', 'hash', { accountId: ACCOUNT })),
  ]);
  assert.deepEqual([a, b].sort(), ['duplicate', 'new'], 'exatamente um cria');
  assert.equal(db.tables.social_ingress_receipts.rows.length, 1, 'nenhuma duplicação');
  // E o mesmo para o domínio: dois upsert concorrentes do mesmo comentário.
  await Promise.all([
    repo.transaction(tx => tx.upsertRecord('comment', commentRecord())),
    repo.transaction(tx => tx.upsertRecord('comment', commentRecord())),
  ]);
  assert.equal(db.tables.social_comments.rows.length, 1, 'nenhum registro duplicado nem corrompido');
  assert.equal(db.tables.social_comments.rows[0].external_comment_id, 'native-1');
});

test('re-delivery never resets workflow status', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  await repo.transaction(tx => tx.upsertRecord('comment', commentRecord()));
  db.tables.social_comments.rows[0].status = 'replied';
  await repo.transaction(tx => tx.upsertRecord('comment', commentRecord({ text: 'reentrega' })));
  assert.equal(db.tables.social_comments.rows[0].status, 'replied', 'comentário respondido não volta a pending');
});


// 12) rollback: falha crítica não deixa metade gravada
test('failure inside transaction rolls back everything', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  await assert.rejects(repo.transaction(async tx => {
    await tx.claimReceipt('r1', 'h1', { accountId: ACCOUNT });
    await tx.upsertContact(contact());
    throw new Error('falha depois de gravar');
  }));
  assert.ok(db.log.includes('rollback'), 'ROLLBACK executado');
  assert.ok(!db.log.includes('commit'), 'nunca chegou a COMMIT');
  const failing = repoFor(db, { failOn: 'insert into public.social_contacts' });
  await assert.rejects(failing.transaction(async tx => {
    await tx.claimReceipt('r2', 'h2', { accountId: ACCOUNT });
    await tx.upsertContact(contact({ external_contact_id: '999' }));
  }));
  assert.equal(db.tables.social_contacts.rows.length, 0, 'nada gravado pela transação que falhou');
});

// 13) auditoria atômica, e auditoria de falha em transaction separada
test('audit is written inside the transaction', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  await repo.transaction(async tx => {
    await tx.upsertRecord('comment', commentRecord());
    await tx.appendEvent({ action: 'event_received', account_id: ACCOUNT, channel: CHANNEL, transport: 'manychat' });
  });
  assert.equal(db.tables.social_events.rows.length, 1);
  assert.equal(db.tables.social_events.rows[0].result, 'ok');
  await repo.recordFailure({ action: 'failure', account_id: ACCOUNT, channel: CHANNEL, error_code: 'INTERNAL_ERROR' });
  assert.equal(db.tables.social_events.rows.at(-1).result, 'error', 'falha registrada como erro');
});

// 14) outbox sempre nasce pending e bloqueada
test('outbox entry is created pending and blocked', async () => {
  const db = fakeDb();
  const created = await repoFor(db).transaction(tx => tx.insertOutboxOnce({
    idempotency_key: '00000000-0000-4000-8000-000000000001', fingerprint: 'fp', account_id: ACCOUNT,
    channel: CHANNEL, transport: 'manychat', kind: 'message', record_id: 'm-msg-1',
    text: 'Resposta revisada', approved_by: 'user-1', record_version: 1,
  }));
  assert.equal(created.created, true);
  assert.equal(created.entry.status, 'pending', 'nunca sent nesta fase');
  assert.equal(created.entry.blocked_reason, 'SEND_DISABLED');
  assert.equal(db.tables.social_outbox.rows[0].transport, 'manychat');
});

// 15) aprovação humana: duplicada é idempotente, texto diferente é conflito
test('human approval is idempotent and conflicts on different text', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  const entry = {
    idempotency_key: '00000000-0000-4000-8000-000000000002', fingerprint: 'fp-a', account_id: ACCOUNT,
    channel: CHANNEL, transport: 'manychat', kind: 'message', record_id: 'm-1',
    text: 'A', approved_by: 'user-1', record_version: 1,
  };
  const first = await repo.transaction(tx => tx.insertOutboxOnce(entry));
  const again = await repo.transaction(tx => tx.insertOutboxOnce({ ...entry }));
  assert.equal(first.created, true);
  assert.equal(again.created, false, 'mesma aprovação não duplica');
  assert.equal(db.tables.social_outbox.rows.length, 1);
  await assert.rejects(
    repo.transaction(tx => tx.insertOutboxOnce({ ...entry, fingerprint: 'fp-b' })),
    { code: 'CONFLICT' },
  );
});

// 16) recordForUpdate usa lock real e confere acesso à conta
test('recordForUpdate locks the row and enforces account access', async () => {
  const db = fakeDb();
  await repoFor(db).transaction(tx => tx.upsertRecord('comment', commentRecord()));
  const record = await repoFor(db).transaction(tx => tx.recordForUpdate('user-1', 'comment', 'c-native-1'));
  assert.equal(record.account_id, ACCOUNT);
  assert.ok(db.log.some((l) => /for update/.test(l)), 'usa SELECT ... FOR UPDATE');
  // Usuário SEM acesso à conta é recusado antes de qualquer escrita.
  const restrito = createSocialRepository({
    withClient: async () => makeClient(db),
    isAccountVisible: async (user, accountId) => user === 'user-1' && accountId === ACCOUNT,
    now: nowIso,
  });
  await assert.rejects(
    restrito.transaction(tx => tx.recordForUpdate('user-2', 'comment', 'c-native-1')),
    { code: 'FORBIDDEN' },
  );
  assert.equal(await restrito.transaction(tx => tx.recordForUpdate('user-1', 'comment', 'inexistente')), null);
});


// 17/18) channel e transport preservados nos dois domínios
test('channel and transport survive persistence in both domains', async () => {
  const db = fakeDb();
  await repoFor(db).transaction(async tx => {
    await tx.upsertRecord('comment', commentRecord({ provider: 'facebook' }));
    await tx.upsertRecord('message', messageRecord({ channel: 'whatsapp' }));
  });
  const c = db.tables.social_comments.rows[0];
  const m = db.tables.social_messages.rows[0];
  assert.equal(c.provider, 'facebook', 'canal real, não manychat');
  assert.equal(m.channel, 'whatsapp');
  assert.equal(c.transport, 'manychat');
  assert.equal(m.transport, 'manychat');
});

// 19) segredo não chega ao frontend e não é criado pelo repository
test('repository never carries a credential and is not in the frontend', async () => {
  const db = fakeDb();
  const status = await repoFor(db).integrationStatus('manychat');
  assert.ok(!JSON.stringify(status).toLowerCase().includes('api_key'), 'sem chave na resposta');
  assert.ok(!('secret' in status) && !('api_key' in status), 'health sem segredo');
  const repoFonte = await readFile(new URL('../server/social/repository.mjs', import.meta.url), 'utf8');
  assert.ok(!/VITE_\w*SUPABASE/.test(repoFonte), 'nenhum VITE_ de service role');
  const vazamentos = [];
  for (const dir of ['../src', '../server']) {
    for (const name of await readdir(new URL(dir, import.meta.url), { recursive: true })) {
      if (!/\.(js|jsx|mjs)$/.test(name)) continue;
      const text = await readFile(new URL(`${dir}/${name}`, import.meta.url), 'utf8');
      if (/VITE_\w*(SERVICE_ROLE|SECRET|API_KEY)/.test(text)) vazamentos.push(`${dir}/${name}`);
    }
  }
  assert.deepEqual(vazamentos, [], 'nenhum segredo de ambiente no bundle');
  assert.equal(UNIQUE_VIOLATION, '23505');
});

// 20) nenhuma operação envia mensagem; dispatch continua bloqueado
test('no repository operation sends a message', async () => {
  const db = fakeDb();
  const repo = repoFor(db);
  await repo.transaction(async tx => {
    await tx.upsertRecord('message', messageRecord());
    await tx.insertOutboxOnce({
      idempotency_key: '00000000-0000-4000-8000-000000000003', fingerprint: 'f', account_id: ACCOUNT,
      channel: CHANNEL, transport: 'manychat', kind: 'message', record_id: 'm-msg-1',
      text: 'T', approved_by: 'u', record_version: 1,
    });
  });
  const surface = Object.keys(repo);
  assert.ok(!surface.some((m) => /send|dispatch|deliver|publish/i.test(m)), 'nenhum método de envio');
  assert.ok(!db.log.some((l) => /^(post|patch|put|delete) /.test(l)), 'nada de escrita em API externa');
  assert.equal(SOCIAL_AUTOMATION.enabled, false, 'automação OFF');
  await assert.rejects(dispatchSocialOutbox(), { code: 'SEND_DISABLED' });
  assert.equal(db.tables.social_outbox.rows[0].status, 'pending', 'continua pending');
});

// 21) roteiro completo de uma transação de ingress
test('full ingress transaction: receipt, contact, domain, audit, commit', async () => {
  const db = fakeDb();
  const result = await repoFor(db).transaction(async tx => {
    const claim = await tx.claimReceipt('rcpt-1', 'hash-1', { accountId: ACCOUNT });
    if (claim !== 'new') return claim;
    await tx.upsertContact(contact());
    await tx.upsertRecord('comment', commentRecord());
    await tx.appendEvent({ action: 'event_received', account_id: ACCOUNT, channel: CHANNEL, transport: 'manychat' });
    return 'accepted';
  });
  assert.equal(result, 'accepted');
  assert.equal(db.tables.social_contacts.rows.length, 1);
  assert.equal(db.tables.social_comments.rows.length, 1);
  assert.equal(db.tables.social_events.rows.length, 1);
  assert.ok(db.log.indexOf('begin') < db.log.indexOf('commit'), 'BEGIN antes de COMMIT');
});

