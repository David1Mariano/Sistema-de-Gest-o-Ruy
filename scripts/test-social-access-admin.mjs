// Fase 7: gestão de contas sociais e acessos pela interface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAccountAdminService, ACCOUNT_AUDIT_ACTIONS } from '../server/social/accountAdmin.mjs';
import {
  normalizeAccountPermissions, describePermissionChange, accountLabel, redactExternalId,
  personLabel, isUserActive, ACCESS_NOT_CONFIGURED_MESSAGE, ACCOUNT_PERMISSION_FIELDS,
} from '../src/lib/social/accountAccess.js';
import { createSocialAccessClient } from '../src/lib/social/aiClient.js';

const admin = (id = 'op-1') => async () => ({ id, active: true, app_metadata: { system_role: 'admin' } });

// Store em memória com as mesmas garantias do banco: `unique` no vínculo e
// coerência de permissões. Se a tela pedir algo que o banco recusaria, aqui
// também recusa — é o que torna o teste útil.
function fakeStore({ accounts = [{ id: 'acc-1', provider: 'instagram', display_name: 'Ruy Caldo de Cana', status: 'connected', external_account_id: '17841400', access_count: 1 }], links = [], users = [{ auth_user_id: 'u1', full_name: 'Maria Souza', email: 'maria@ruy.com', status: 'ativo' }], audit = [], failOn = null } = {}) {
  return {
    audit,
    links: [...links],
    async listAccounts() { if (failOn === 'listAccounts') throw new Error('banco fora'); return accounts; },
    async listAccess(accountId) { if (failOn === 'listAccess') throw new Error('banco fora'); return this.links.filter((l) => l.account_id === accountId); },
    async findAccess(accountId, authUserId) { if (failOn === 'findAccess') throw new Error('banco fora'); return this.links.filter((l) => l.account_id === accountId && l.auth_user_id === authUserId); },
    async findUser(authUserId) { return users.filter((u) => u.auth_user_id === authUserId); },
    async listUsers() { if (failOn === 'listUsers') throw new Error('banco fora'); return users; },
    async upsertAccess(row) {
      const existente = this.links.find((l) => l.account_id === row.accountId && l.auth_user_id === row.authUserId);
      const gravado = { account_id: row.accountId, auth_user_id: row.authUserId, ...Object.fromEntries(ACCOUNT_PERMISSION_FIELDS.map((f) => [f, row[f] === true])), active: row.active === true };
      if (existente) Object.assign(existente, gravado);
      else {
        // Réplica do CHECK `active_no_permission`: vínculo inativo sem permissão.
        if (!gravado.active && ACCOUNT_PERMISSION_FIELDS.some((f) => gravado[f])) throw Object.assign(new Error('violaria check'), { code: 'CHECK_VIOLATION' });
        this.links.push(gravado);
      }
      return gravado;
    },
    async updateAccess(row) {
      const alvo = this.links.find((l) => l.account_id === row.accountId && l.auth_user_id === row.authUserId);
      if (!alvo) throw new Error('não encontrado');
      if (!row.active && ACCOUNT_PERMISSION_FIELDS.some((f) => row[f] === true)) throw Object.assign(new Error('violaria check'), { code: 'CHECK_VIOLATION' });
      Object.assign(alvo, Object.fromEntries(ACCOUNT_PERMISSION_FIELDS.map((f) => [f, row[f] === true])), { active: row.active === true });
      return alvo;
    },
    async appendAudit(entry) { this.audit.push(entry); return entry; },
  };
}

const service = (store, over = {}) => createAccountAdminService({ store, verifyIdentity: admin(), canAdminAnyAccount: async () => true, ...over });
const vinculo = (extra = {}) => ({ account_id: 'acc-1', auth_user_id: 'u1', active: true, can_view: true, can_reply: false, can_approve_ai: false, can_admin: false, ...extra });

// 1-3. Listagem de contas e de vínculos.
test('1. lista contas com canal, nome, status e contagem de acessos', async () => {
  const contas = await service(fakeStore()).listAccounts('token');
  assert.equal(contas.length, 1);
  assert.deepEqual(contas[0], { id: 'acc-1', provider: 'instagram', display_name: 'Ruy Caldo de Cana', status: 'connected', access_count: 1 });
});
test('2. conta sem vínculos devolve lista vazia, não erro', async () => {
  const s = fakeStore({ accounts: [{ id: 'acc-9', provider: 'whatsapp', display_name: 'Número da empresa', status: 'disconnected', access_count: 0 }] });
  assert.deepEqual(await service(s).listAccountAccess('token', 'acc-9'), []);
});
test('3. lista usuários vinculados com permissões e situação', async () => {
  const s = fakeStore({ links: [vinculo({ can_reply: true })] });
  const rows = await service(s).listAccountAccess('token', 'acc-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].auth_user_id, 'u1');
  assert.equal(rows[0].can_reply, true);
});

// 4-6. Conceder acesso, duplicidade e reativação de vínculo inativo.
test('4. adicionar usuário cria o vínculo com as permissões pedidas', async () => {
  const s = fakeStore();
  const r = await service(s).grantAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true, can_reply: true } });
  assert.equal(r.reactivated, false);
  assert.equal(s.links.length, 1);
  assert.equal(s.links[0].can_reply, true);
});
test('5. duplicidade é bloqueada e não cria segunda linha', async () => {
  const s = fakeStore({ links: [vinculo()] });
  await assert.rejects(service(s).grantAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true } }), { code: 'ALREADY_EXISTS' });
  assert.equal(s.links.length, 1, 'não pode existir vínculo duplicado');
});
test('6. vínculo inativo é reativado, não duplicado', async () => {
  const s = fakeStore({ links: [vinculo({ active: false })] });
  const r = await service(s).grantAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true, can_reply: true } });
  assert.equal(r.reactivated, true);
  assert.equal(s.links.length, 1, 'reativar reusa a linha existente');
  assert.equal(s.links[0].active, true);
});

// 7-12. Edição de cada permissão e bloqueio de combinações inválidas.
test('7-10. cada dimensão pode ser editada isoladamente', async () => {
  for (const campo of ['can_view', 'can_reply', 'can_approve_ai', 'can_admin']) {
    const s = fakeStore({ links: [vinculo()] });
    const r = await service(s).updateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true, [campo]: true } });
    assert.equal(r[campo], true, `não conseguiu ligar ${campo}`);
  }
});
test('11. responder sem visualizar é bloqueado e corrigido pelo normalizador', async () => {
  const s = fakeStore({ links: [vinculo()] });
  const r = await service(s).updateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: false, can_reply: true } });
  assert.equal(r.can_view, true, 'Responder implica Visualizar');
  assert.equal(r.can_reply, true);
  assert.ok(r.adjusted.length > 0, 'a correção precisa ser visível para o operador');
});
test('12. admin inconsistente é bloqueado: can_admin implica can_reply', async () => {
  const s = fakeStore({ links: [vinculo({ can_view: true })] });
  const r = await service(s).updateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true, can_admin: true } });
  assert.equal(r.can_admin, true);
  assert.equal(r.can_reply, true, 'Administrar exige Responder');
  const direto = normalizeAccountPermissions({ can_admin: true }, true);
  assert.deepEqual(direto.permissions, { can_view: true, can_reply: true, can_approve_ai: false, can_admin: true });
});
test('permissão inválida é recusada, não convertida', async () => {
  const s = fakeStore({ links: [vinculo()] });
  await assert.rejects(service(s).updateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: 'sim' } }), { code: 'INVALID_PERMISSION' });
});
test('vínculo inativo não pode carregar permissão, nem ao editar', async () => {
  const s = fakeStore({ links: [vinculo({ active: false })] });
  const r = await service(s).updateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true, can_reply: true } });
  assert.equal(r.active, false, 'editar não reativa');
  for (const f of ACCOUNT_PERMISSION_FIELDS) assert.equal(r[f], false, `${f} não pode sobrar em vínculo inativo`);
});

// 13-14. Revogar e reativar.
test('13. revogar zera permissões e marca revogado, sem apagar a linha', async () => {
  const s = fakeStore({ links: [vinculo({ can_reply: true })] });
  const r = await service(s).revokeAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1' });
  assert.equal(r.active, false);
  assert.equal(s.links.length, 1, 'revogar preserva o histórico');
  for (const f of ACCOUNT_PERMISSION_FIELDS) assert.equal(s.links[0][f], false, 'vínculo inativo não carrega permissão');
});
test('14. reativar é explícito e devolve acesso', async () => {
  const s = fakeStore({ links: [vinculo({ active: false })] });
  const r = await service(s).reactivateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true, can_reply: true } });
  assert.equal(r.active, true);
  assert.equal(s.links[0].can_reply, true);
  const s2 = fakeStore({ links: [vinculo({ active: false })] });
  const editado = await service(s2).updateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true } });
  assert.equal(editado.active, false, 'editar jamais reativa por efeito colateral');
});

// 15-19. Autorização da tela, entradas inválidas e fail-closed.
test('15-16. usuário A não administra conta B; sem can_admin → 403', async () => {
  const soContaA = async (_user, accountId) => accountId === 'acc-1';
  const svc = service(fakeStore(), { canAdminAnyAccount: soContaA });
  await assert.rejects(svc.listAccountAccess('token', 'acc-2'), { code: 'FORBIDDEN' }, 'A não administra a conta de B');
  assert.deepEqual((await svc.listAccountAccess('token', 'acc-1')).length, 0, 'A administra a própria conta');
  // `configure` no system_role é obrigatório: mesmo com can_admin na conta, um
  // papel que não administra o sistema não mexe na tela.
  const semConfigure = service(fakeStore(), { verifyIdentity: async () => ({ id: 'u9', active: true, app_metadata: { system_role: 'viewer' } }) });
  await assert.rejects(semConfigure.listAccountAccess('token', 'acc-1'), { code: 'FORBIDDEN' });
  const inativo = service(fakeStore(), { verifyIdentity: async () => ({ id: 'u9', active: false, app_metadata: { system_role: 'admin' } }) });
  await assert.rejects(inativo.listAccountAccess('token', 'acc-1'), { code: 'UNAUTHORIZED' });
});
test('17-18. conta e usuário inexistentes são recusados', async () => {
  const s = fakeStore();
  const svc = service(s);
  await assert.rejects(svc.listAccountAccess('token', ''), { code: 'INVALID_ACCOUNT' });
  await assert.rejects(svc.updateAccountAccess('token', { accountId: 'acc-1', authUserId: 'inexistente', permissions: { can_view: true } }), { code: 'NOT_FOUND' });
  await assert.rejects(svc.grantAccountAccess('token', { accountId: 'acc-1', authUserId: 'nao-cadastrado', permissions: { can_view: true } }), { code: 'INVALID_USER' });
  // Não pode ser `canAdminAnyAccount` dizendo sim que salva: a conta precisa
  // EXISTIR no banco antes de qualquer concessão.
  const semConta = service(fakeStore({ accounts: [] }), { canAdminAnyAccount: async () => true });
  await assert.rejects(semConta.listAccountAccess('token', 'conta-fantasma'), { code: 'NOT_FOUND' });
  await assert.rejects(semConta.grantAccountAccess('token', { accountId: 'conta-fantasma', authUserId: 'u1', permissions: { can_view: true } }), { code: 'NOT_FOUND' });
});
test('19. falha de banco falha fechado, nunca vira lista vazia', async () => {
  await assert.rejects(service(fakeStore({ failOn: 'listAccounts' })).listAccounts('token'), { code: 'UNAVAILABLE' });
  await assert.rejects(service(fakeStore({ failOn: 'listAccess' })).listAccountAccess('token', 'acc-1'), { code: 'UNAVAILABLE' });
  const duplicado = service(fakeStore({ links: [vinculo(), vinculo()] }));
  await assert.rejects(duplicado.revokeAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1' }), { code: 'DUPLICATE_ACCESS' }, 'vínculo duplicado é estado inconsistente');
  // Resposta fora do formato é FALHA, não "vínculo inexistente": senão uma
  // concessão seguinte recriaria a linha que existe.
  const storeQuebrado = fakeStore();
  storeQuebrado.findAccess = async () => 'não sou array';
  await assert.rejects(service(storeQuebrado).revokeAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1' }), { code: 'UNAVAILABLE' });
});
test('usuário inativo no Auth não recebe nem recupera acesso', async () => {
  const s = fakeStore({ users: [{ auth_user_id: 'u2', full_name: 'João Inativo', status: 'inativo' }] });
  await assert.rejects(service(s).grantAccountAccess('token', { accountId: 'acc-1', authUserId: 'u2', permissions: { can_view: true } }), { code: 'USER_INACTIVE' });
  const s2 = fakeStore({ users: [{ auth_user_id: 'u2', status: 'bloqueado' }], links: [vinculo({ auth_user_id: 'u2', active: false })] });
  await assert.rejects(service(s2).reactivateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u2', permissions: { can_view: true } }), { code: 'USER_INACTIVE' });
  // Paridade com `authAdapter.me()`: quem não tem status marcado como inativo
  // é tratado como ATIVO. Status vazio não pode bloquear acesso, senão um
  // cadastro sem `status` ficaria preso fora de toda conta.
  assert.equal(isUserActive('ativo'), true);
  assert.equal(isUserActive(undefined), true, 'paridade com o autenticador real');
  for (const ruim of ['inativo', 'INATIVO', 'bloqueado', 'disabled', 'desativado', ' Inativo ']) {
    assert.equal(isUserActive(ruim), false, `"${ruim}" deveria ser inativo`);
  }
});

// 20-22. Auditoria.
test('20-22. concessão, alteração e revogação são auditadas com alvo e operador', async () => {
  const s = fakeStore();
  const svc = service(s);
  await svc.grantAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true, can_reply: true } });
  await svc.updateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true, can_reply: false, can_approve_ai: true } });
  await svc.revokeAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1' });
  const acoes = s.audit.map((a) => a.action);
  assert.deepEqual(acoes, ['access_granted', 'access_updated', 'access_revoked']);
  for (const entrada of s.audit) {
    assert.equal(entrada.account_id, 'acc-1', 'auditoria precisa dizer a conta');
    assert.equal(entrada.target_user_id, 'u1', 'auditoria precisa dizer o usuário alvo');
    assert.equal(entrada.operator_user_id, 'op-1', 'auditoria precisa dizer quem operou');
    assert.ok(entrada.created_at, 'auditoria precisa ter instante');
  }
  for (const proibido of ['token', 'password', 'secret', 'authorization']) {
    assert.ok(!JSON.stringify(s.audit).toLowerCase().includes(proibido), `auditoria vazou ${proibido}`);
  }
  assert.ok(ACCOUNT_AUDIT_ACTIONS.includes('access_reactivated'));
});
test('reativação é auditada como reativação, não como concessão', async () => {
  const s = fakeStore({ links: [vinculo({ active: false })] });
  await service(s).reactivateAccountAccess('token', { accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true } });
  assert.equal(s.audit[0].action, 'access_reactivated');
});

// 23-24. A tela não pede UUID e distingue "schema pendente" de "sem contas".
test('23. nenhum UUID precisa ser digitado: a escolha é por nome', async () => {
  const painel = await readFile(new URL('../src/components/social/SocialAccessAdmin.jsx', import.meta.url), 'utf8');
  // O id viaja no value do Select, mas não existe campo de texto para ele.
  assert.ok(!/type="text"[^>]*uuid|placeholder="[^"]*UUID/i.test(painel), 'não pode haver campo para digitar UUID');
  assert.ok(painel.includes('Selecione por nome'), 'a escolha precisa ser por nome');
  assert.ok(painel.includes('personLabel'), 'o rótulo da pessoa vem do nome');
  // Rótulos: a conta aparece como "Instagram — Ruy Caldo de Cana".
  assert.equal(accountLabel({ provider: 'instagram', display_name: 'Ruy Caldo de Cana' }), 'Instagram — Ruy Caldo de Cana');
  assert.equal(accountLabel({ provider: 'whatsapp' }), 'WhatsApp');
  assert.equal(personLabel({ full_name: 'Maria Souza' }), 'Maria Souza');
  assert.equal(personLabel({ email: 'm@ruy.com' }), 'm@ruy.com');
  // O identificador externo aparece redigido, não inteiro.
  assert.equal(redactExternalId('17841400987654321'), '17••••••••21');
  assert.equal(redactExternalId(''), 'não informado');
  assert.equal(redactExternalId('1234'), '••••');
});
test('24. schema ausente gera estado de configuração pendente, não lista vazia', async () => {
  const painel = await readFile(new URL('../src/components/social/SocialAccessAdmin.jsx', import.meta.url), 'utf8');
  assert.ok(painel.includes('ACCESS_SCHEMA_NOT_READY'), 'a tela precisa tratar o schema não aplicado');
  assert.ok(painel.includes('Configuração pendente'), 'precisa de um estado próprio');
  assert.ok(painel.includes('ACCESS_NOT_CONFIGURED_MESSAGE'), 'usa a mensagem centralizada em vez de reescrevê-la');
  assert.ok(!painel.includes('Configuração de acesso social ainda não foi ativada.'), 'o texto literal fica em um lugar só');
  assert.ok(painel.includes('Nenhuma conta cadastrada'), 'e um estado diferente para "zero contas"');
  // Cliente HTTP: o código de erro precisa chegar intacto para a tela decidir.
  const { createSocialAccessClient: criar } = { createSocialAccessClient };
  const client = criar({ endpoint: 'https://api.invalid', fetchImpl: async () => new Response(JSON.stringify({ error: 'ACCESS_SCHEMA_NOT_READY' }), { status: 503, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(client.listAccounts(), (e) => e.code === 'ACCESS_SCHEMA_NOT_READY');
  // Sem endpoint, falha fechado em vez de devolver lista vazia.
  const semEndpoint = criar({});
  await assert.rejects(semEndpoint.listAccounts(), (e) => e.code === 'not_configured');
});
test('a tela revalida permissões no backend, não só escondendo botão', async () => {
  const src = await readFile(new URL('../server/social/accountAdmin.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('socialPermissions'), 'a permissão funcional é conferida no backend');
  assert.ok(src.includes('can_admin'), 'o vínculo de conta é conferido no backend');
  const painel = await readFile(new URL('../src/components/social/SocialAccessAdmin.jsx', import.meta.url), 'utf8');
  assert.ok(painel.includes('canConfigure'), 'o botão some sem permissão — mas isso é só UX');
});
test('o cliente HTTP fala só com o backend, nunca com o provider', async () => {
  const src = await readFile(new URL('../src/lib/social/aiClient.js', import.meta.url), 'utf8');
  const urls = [];
  const client = createSocialAccessClient({ endpoint: 'https://api.invalid', getToken: async () => 't', fetchImpl: async (url) => { urls.push(url); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); } });
  await client.listAccounts();
  await client.grant({ accountId: 'acc-1', authUserId: 'u1', permissions: { can_view: true } });
  assert.equal(urls[0], 'https://api.invalid/social-accounts');
  assert.equal(urls[1], 'https://api.invalid/social-accounts/access');
  assert.ok(!urls.some((u) => /ollama|11434|gemini|groq/i.test(u)));
  assert.ok(!/11434/.test(src), 'nenhuma porta do Ollama no cliente');
});



