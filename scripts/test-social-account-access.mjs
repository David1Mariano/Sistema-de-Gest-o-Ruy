// Fase 6: autorização por conta social. Modelo, isAccountVisible e fail-closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createAccountAccessResolver, createAccountPermissionResolver,
  ACCOUNT_PERMISSIONS, authorizeSocialAction,
} from '../server/social/aiAuth.mjs';

const link = (extra = {}) => ({ active: true, can_view: true, can_reply: true, can_approve_ai: true, can_admin: false, ...extra });
const rows = (...list) => async () => list;
const visible = createAccountAccessResolver({ query: rows(link()) });

// 1-6. Fail-closed em todos os caminhos de ausência e erro.
test('1. usuário sem vínculo → false', async () => {
  assert.equal(await createAccountAccessResolver({ query: rows() })('u1', 'acc-1'), false);
});
test('2. usuário com acesso ativo → true', async () => {
  assert.equal(await visible('u1', 'acc-1'), true);
});
test('3. acesso inativo (revogado) → false', async () => {
  assert.equal(await createAccountAccessResolver({ query: rows(link({ active: false })) })('u1', 'acc-1'), false);
});
test('4. conta inexistente → false', async () => {
  assert.equal(await createAccountAccessResolver({ query: rows() })('u1', 'conta-que-nao-existe'), false);
});
test('5. accountId ou userId vazio → false, sem consultar o banco', async () => {
  let consultou = false;
  const spy = createAccountAccessResolver({ query: async () => { consultou = true; return [link()]; } });
  for (const [u, a] of [['', 'acc-1'], ['u1', ''], [null, 'acc-1'], ['u1', undefined], [undefined, undefined]]) {
    assert.equal(await spy(u, a), false, `deveria negar (${u}, ${a})`);
  }
  assert.equal(consultou, false, 'sem identificadores não há por que consultar');
});
test('6. erro no repository → false, nunca true', async () => {
  const quebrado = createAccountAccessResolver({ query: async () => { throw new Error('conexão perdida'); } });
  assert.equal(await quebrado('u1', 'acc-1'), false);
});
test('20. fail-closed permanece: linhas ambíguas ou malformadas são negadas', async () => {
  assert.equal(await createAccountAccessResolver({ query: rows(link(), link()) })('u1', 'acc-1'), false, 'vínculo duplicado é estado inconsistente');
  for (const ruim of [null, undefined, 'texto', 42, {}]) {
    assert.equal(await createAccountAccessResolver({ query: rows(ruim) })('u1', 'acc-1'), false, `linha ${JSON.stringify(ruim)} deve negar`);
  }
  assert.equal(await createAccountAccessResolver({ query: async () => 'não é array' })('u1', 'acc-1'), false);
  // can_view é o piso: um vínculo sem ver não opera, mesmo com can_reply.
  assert.equal(await createAccountAccessResolver({ query: rows(link({ can_view: false })) })('u1', 'acc-1'), false);
});

// 7-8. Isolamento entre contas.
test('7-8. usuário A não vê a conta de B, e vice-versa', async () => {
  const vinculos = { 'u-a:acc-1': link(), 'u-b:acc-2': link() };
  const consulta = async (userId, accountId) => (vinculos[`${userId}:${accountId}`] ? [vinculos[`${userId}:${accountId}`]] : []);
  const check = createAccountAccessResolver({ query: consulta });
  assert.equal(await check('u-a', 'acc-1'), true);
  assert.equal(await check('u-a', 'acc-2'), false, 'A não pode ver a conta de B');
  assert.equal(await check('u-b', 'acc-2'), true);
  assert.equal(await check('u-b', 'acc-1'), false, 'B não pode ver a conta de A');
});

// 9-12. Interseção entre permissão funcional e acesso à conta.
test('9-12. permissão funcional e acesso à conta são AS DUAS condições', async () => {
  const comAcesso = createAccountPermissionResolver({ query: rows(link()) });
  const semAcesso = createAccountPermissionResolver({ query: rows(link({ can_reply: false, can_view: true })) });
  // 9. reply funcional SEM acesso à conta → negado.
  assert.equal(await authorizeSocialAction({ functionalPermission: true, accountPermission: await semAcesso('u1', 'acc-1', 'can_reply') }), false);
  // 10. acesso à conta SEM reply funcional → negado.
  assert.equal(await authorizeSocialAction({ functionalPermission: false, accountPermission: await comAcesso('u1', 'acc-1', 'can_reply') }), false);
  // 11. ambos válidos → permitido.
  assert.equal(await authorizeSocialAction({ functionalPermission: true, accountPermission: await comAcesso('u1', 'acc-1', 'can_reply') }), true);
  // 12. approve_ai segue a mesma regra.
  assert.equal(await authorizeSocialAction({ functionalPermission: true, accountPermission: await comAcesso('u1', 'acc-1', 'can_approve_ai') }), true);
  assert.equal(await authorizeSocialAction({ functionalPermission: true, accountPermission: await comAcesso('u1', 'acc-1', 'can_admin') }), false, 'admin de conta exige can_admin no vínculo');
  assert.equal(await comAcesso('u1', 'acc-1', 'can_view'), true);
  assert.equal(await comAcesso('u1', 'acc-1', 'can_admin'), false, 'uma dimensão não arrasta a outra');
  await assert.rejects(comAcesso('u1', 'acc-1', 'poder_magico'), /desconhecida/);
  assert.equal(ACCOUNT_PERMISSIONS.length, 4);
});

// 13-14. Herança da conta e texto do body.
test('13. o comentário herda o account_id do registro persistido', async () => {
  const contaDoComentario = { id: 'c1', account_id: 'acc-7', text: 'texto do banco' };
  const consultadas = [];
  const check = createAccountAccessResolver({ query: rows(link()) });
  await check('u1', contaDoComentario.account_id);
  consultadas.push(contaDoComentario.account_id);
  assert.deepEqual(consultadas, ['acc-7'], 'a conta vem do comentário, não da requisição');
  assert.equal(contaDoComentario.text, 'texto do banco');
});
test('14. o texto enviado no body não substitui o persistido', async () => {
  const { createSocialAIHandler } = await import('../server/social/aiHandler.mjs');
  const vistos = [];
  const handler = createSocialAIHandler({
    service: {
      classifyComment: async (c) => { vistos.push(c.text); return { category: 'elogio', confidence: 0.5 }; },
      draftReply: async (c) => { vistos.push(c.text); return { reply: 'ok', category: 'elogio', confidence: 0.5 }; },
      health: async () => ({ provider: 'ollama', state: 'ready' }),
    },
    verifyIdentity: async () => ({ id: 'u1', active: true, app_metadata: { system_role: 'admin' } }),
    loadComment: async (id) => (id === 'c1' ? { id: 'c1', account_id: 'acc-1', text: 'PERSISTIDO' } : null),
  });
  const resposta = await handler(new Request('http://h/social-ai/draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commentId: 'c1', text: 'FORJADO' }) }));
  assert.equal(resposta.status, 200);
  assert.deepEqual([...new Set(vistos)], ['PERSISTIDO']);
});

// 16-18. Revogação e status da conta.
test('16. acesso revogado entra em vigor imediatamente', async () => {
  let ativo = true;
  const check = createAccountAccessResolver({ query: async () => [link({ active: ativo })] });
  assert.equal(await check('u1', 'acc-1'), true);
  ativo = false;
  assert.equal(await check('u1', 'acc-1'), false, 'revogação não pode ficar em cache');
});
test('17-18. conta inativa bloqueia; conta ativa permite', async () => {
  let status = 'connected';
  const check = createAccountAccessResolver({ query: rows(link()), accountStatuses: async () => status });
  assert.equal(await check('u1', 'acc-1'), true, 'conta ativa permite');
  for (const ruim of ['disconnected', 'expired', 'error', null, undefined, '']) {
    status = ruim;
    assert.equal(await check('u1', 'acc-1'), false, `conta ${ruim} não pode sustentar operação`);
  }
  const semStatus = createAccountAccessResolver({ query: rows(link()), accountStatuses: async () => { throw new Error('banco fora'); } });
  assert.equal(await semStatus('u1', 'acc-1'), false, 'erro ao ler status nega');
});

test('15. vínculo duplicado é bloqueado pela migration e negado no código', async () => {
  const sql = await readFile(new URL('../scripts/proposed-social-account-access.sql', import.meta.url), 'utf8');
  assert.match(sql, /unique \(account_id, auth_user_id\)/, 'a migration precisa impedir vínculo duplicado');
  assert.equal(await createAccountAccessResolver({ query: rows(link(), link()) })('u1', 'acc-1'), false);
});

// 19-20. A migration não abre acesso e continua não aplicada.
test('19. a migration não concede acesso público indevido', async () => {
  const sql = await readFile(new URL('../scripts/proposed-social-account-access.sql', import.meta.url), 'utf8');
  const semComentario = sql.replace(/--.*$/gm, '');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(semComentario, /revoke all on public\.social_account_access from public, anon, authenticated/);
  assert.ok(!/create policy/i.test(semComentario), 'nenhuma policy: o acesso é decidido pelo backend');
  assert.ok(!/insert into/i.test(semComentario), 'a migration não pode criar vínculos em massa');
  // `.trim()` antes do fim: sem isso, o `\r\n` final do arquivo faz o `$` falhar
  // e o teste passaria a exigir um arquivo sem quebra de linha.
  assert.match(semComentario.trim(), /rollback;$/i, 'a proposta termina em ROLLBACK: nada é aplicado');
  assert.ok(!/\bcommit\b/i.test(semComentario), 'nada é commitado');
});
test('20b. constraints e índices de integridade presentes', async () => {
  const sql = await readFile(new URL('../scripts/proposed-social-account-access.sql', import.meta.url), 'utf8');
  assert.match(sql, /references public\.social_accounts\(id, provider\)/, 'conta precisa existir');
  assert.match(sql, /auth_user_id uuid not null references auth\.users\(id\)/, 'usuário precisa existir no Auth');
  assert.match(sql, /social_account_access_active_no_permission/, 'vínculo inativo não carrega permissão');
  assert.match(sql, /social_account_access_implies_view/, 'responder exige ver');
  assert.match(sql, /social_account_access_admin_implies_reply/, 'administrar exige responder');
  assert.match(sql, /scope_role in \('viewer','operator','manager','admin'\)/, 'papel restrito a valores válidos');
  assert.match(sql, /create index social_account_access_active_lookup[\s\S]*where active/, 'índice do caminho quente');
  assert.match(sql, /revoke all on function public\.social_touch_updated_at\(\)/, 'a função de trigger também é revogada');
});
test('a autorização por conta não tem atalho de admin', async () => {
  const src = await readFile(new URL('../server/social/aiAuth.mjs', import.meta.url), 'utf8');
  const codigo = src.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/system_role\s*===\s*'admin'/.test(codigo), 'não pode haver atalho "admin vê tudo"');
  assert.ok(!/super_admin/.test(codigo), 'nem de super_admin');
});

