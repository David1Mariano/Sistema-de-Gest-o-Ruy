// Fase 8: bootstrap one-shot do primeiro administrador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapFirstSocialAdmin, formatBootstrapReport } from '../scripts/bootstrap-social-admin.mjs';
import { STORE_NOT_READY } from '../server/social/accountAccessStore.mjs';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// TRAVA DA ORDEM DA CLI (Fase 9).
//
// O bug corrigido aqui NAO estava em `bootstrapFirstSocialAdmin`, e sim no bloco
// de linha de comando: ele passava `apply: args.apply` na PRIMEIRA chamada, de
// modo que `--apply` gravava ANTES do prompt `APLICAR` — e, sem TTY, o script
// escrevia e so depois recusava. A funcao pura estava correta e por isso os
// testes existentes nunca pegaram o problema.
//
// Este teste e estrutural: ele le o fonte da CLI e trava a ordem exigida.
// Falha se voltar a existir qualquer escrita antes da confirmacao.
// ─────────────────────────────────────────────────────────────────────────────
test('CLI: dry-run vem antes de qualquer escrita, sempre', () => {
  const fonte = readFileSync(new URL('./bootstrap-social-admin.mjs', import.meta.url), 'utf8');
  // Corta no bloco de CLI: e a partir do guarda de execucao que ele roda.
  const inicio = fonte.indexOf('if (process.argv[1]');
  assert.ok(inicio > 0, 'nao encontrei o bloco de execucao da CLI');
  const cli = fonte.slice(inicio);

  const chamadas = [...cli.matchAll(/bootstrapFirstSocialAdmin\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  assert.ok(chamadas.length >= 1, 'a CLI deve chamar o bootstrap');

  // 1. A PRIMEIRA chamada e sempre dry-run. `args.apply` nessa posicao e o bug.
  assert.match(
    chamadas[0],
    /apply:\s*false/,
    'a primeira chamada da CLI precisa ser dry-run (apply: false); usar args.apply aqui grava antes de confirmar',
  );

  // 2. A confirmacao digitada acontece ANTES de qualquer chamada com apply=true.
  const iConfirmacao = cli.indexOf("'APLICAR'");
  assert.ok(iConfirmacao > 0, 'a CLI precisa pedir a confirmacao APLICAR');
  const chamadasComApply = chamadas.map((c, i) => ({ i, corpo: c })).filter((c) => /apply:\s*true/.test(c.corpo));
  assert.ok(chamadasComApply.length >= 1, 'a CLI precisa ter uma chamada com apply: true (apos confirmar)');
  for (const c of chamadasComApply) {
    const pos = cli.indexOf(`bootstrapFirstSocialAdmin({${c.corpo}}`);
    assert.ok(
      pos > iConfirmacao,
      `a chamada com apply: true (indice ${c.i}) acontece antes do prompt APLICAR: isso grava sem consentimento`,
    );
  }

  // 3. Sem TTY a CLI nao escreve: o guard existe e antecede qualquer apply.
  assert.match(cli, /!process\.stdin\.isTTY/, 'sem TTY a CLI precisa recusar antes de gravar');
});


const USUARIOS = [{ auth_user_id: 'auth-1', full_name: 'Maria Souza', email: 'maria@ruy.com', status: 'ativo' }];
const CONTAS = [{ id: 'acc-1', provider: 'instagram', display_name: 'Ruy Caldo de Cana', status: 'connected' }];
const PERMISSOES = { can_view: true, can_reply: true, can_approve_ai: true, can_admin: true };

/**
 * Store em memória que IMPLEMENTA as garantias do Postgres: unique, transação
 * com rollback. Sem isso, um teste de "concessão atômica" passaria mesmo com o
 * código errado.
 */
function fakeStore({ usuarios = USUARIOS, contas = CONTAS, existentes = [], auditoria = [], falharAuditoria = false, semSchema = false } = {}) {
  const estado = { acessos: [...existentes], auditoria, escritas: 0 };
  let fila = Promise.resolve();
  const tx = {
    async lockBootstrap() { this.locked = true; },
    async countActiveAdmins() { return estado.acessos.filter((a) => a.active && a.can_admin).length; },
    async findUsersByTerm(t) { return usuarios.filter((u) => u.full_name === t || u.email === t || u.auth_user_id === t); },
    async findAccountsByTerm(t) { return contas.filter((c) => c.display_name === t || c.id === t); },
    async findAccess(accountId, authUserId) { return estado.acessos.find((a) => a.account_id === accountId && a.auth_user_id === authUserId) || null; },
    async insertAccess(d) {
      if (estado.acessos.some((a) => a.account_id === d.accountId && a.auth_user_id === d.authUserId)) {
        throw Object.assign(new Error('dup'), { code: 'ALREADY_EXISTS' });
      }
      const row = { account_id: d.accountId, auth_user_id: d.authUserId, ...d.permissions, active: d.active };
      estado.acessos.push(row); estado.escritas += 1;
      return row;
    },
    async updateAccess(d) {
      const alvo = estado.acessos.find((a) => a.account_id === d.accountId && a.auth_user_id === d.authUserId);
      if (!alvo) throw Object.assign(new Error('não achou'), { code: 'NOT_FOUND' });
      Object.assign(alvo, d.permissions, { active: d.active }); estado.escritas += 1;
      return alvo;
    },
    async appendAudit(e) {
      // Auditoria que falha precisa derrubar a concessão: é o que garante que
      // não exista acesso sem rastro.
      if (falharAuditoria) throw Object.assign(new Error('audit caiu'), { code: 'UNAVAILABLE' });
      auditoria.push(e); return e;
    },
  };
  return {
    estado,
    // Fila que reproduz o `pg_advisory_xact_lock`: uma transação por vez. Sem
    // isto, dois bootstraps "concorrentes" rodariam em paralelo aqui e o teste
    // passaria por acidente, sem provar nada sobre o lock.
    async transaction(work) {
      if (semSchema) throw Object.assign(new Error('sem tabela'), { code: STORE_NOT_READY });
      const anterior = fila;
      let liberar;
      fila = new Promise((r) => { liberar = r; });
      await anterior;
      try {
        const antes = { acessos: JSON.parse(JSON.stringify(estado.acessos)), auditoria: [...auditoria] };
        try {
          return await work(tx);
        } catch (error) {
          // Rollback de verdade: um store de teste que não volta atrás deixaria
          // "atomicidade" sem prova.
          estado.acessos.length = 0; estado.acessos.push(...antes.acessos);
          auditoria.length = 0; auditoria.push(...antes.auditoria);
          throw error;
        }
      } finally { liberar(); }
    },
  };
}

const rodar = (store, over = {}) => bootstrapFirstSocialAdmin({ store, userTerm: 'maria@ruy.com', accountTerm: 'acc-1', ...over });

// 1. Dry-run não escreve nada.
test('1. dry-run não escreve: zero acesso, zero auditoria', async () => {
  const store = fakeStore();
  const r = await rodar(store);
  assert.equal(r.applied, false);
  assert.equal(r.dryRun, true);
  assert.equal(store.estado.acessos.length, 0, 'dry-run não pode gravar');
  assert.equal(store.estado.auditoria.length, 0);
  assert.equal(store.estado.escritas, 0);
  // E mesmo valida: mostra exatamente o que faria.
  assert.equal(r.usuario.auth_user_id, 'auth-1');
  assert.equal(r.conta.id, 'acc-1');
  assert.deepEqual(r.permissoes, PERMISSOES);
});

// 2-5. Alvos inválidos e ambíguos param o comando.
test('2. usuário inexistente → erro, nada gravado', async () => {
  const store = fakeStore();
  await assert.rejects(bootstrapFirstSocialAdmin({ store, userTerm: 'nao-existe@ruy.com', accountTerm: 'acc-1' }), { code: 'USER_NOT_FOUND' });
  assert.equal(store.estado.escritas, 0);

// 6-7. Primeiro permitido, segundo bloqueado.
test('6. primeiro administrador é criado com can_admin completo e auditado', async () => {
  const store = fakeStore();
  const r = await rodar(store, { apply: true });
  assert.equal(r.applied, true);
  assert.equal(r.refused, false);
  assert.equal(store.estado.acessos.length, 1);
  assert.deepEqual(store.estado.acessos[0], { account_id: 'acc-1', auth_user_id: 'auth-1', ...PERMISSOES, active: true });
  assert.equal(store.estado.auditoria.length, 1);
  assert.equal(store.estado.auditoria[0].action, 'access_granted');
  assert.equal(store.estado.auditoria[0].origin, 'bootstrap');
  assert.equal(store.estado.auditoria[0].targetUserId, 'auth-1');
  assert.equal(store.estado.auditoria[0].accountId, 'acc-1');
});
test('7. segundo bootstrap é recusado depois que existe admin ativo', async () => {
  const primeiro = fakeStore();
  await rodar(primeiro, { apply: true });
  const segundo = fakeStore({ existentes: primeiro.estado.acessos });
  const r = await rodar(segundo, { apply: true });
  assert.equal(r.refused, true);
  assert.equal(r.reason, 'BOOTSTRAP_ALREADY_DONE');
  assert.equal(r.administradoresAtivos, 1);
  assert.equal(segundo.estado.acessos.length, 1, 'não pode criar um segundo admin');
  assert.equal(segundo.estado.auditoria.length, 0);
});
test('7b. admin revogado NÃO reabre o bootstrap', async () => {
  // O critério é `active AND can_admin`. Um revogado não é administrador.
  const store = fakeStore({ existentes: [{ account_id: 'acc-9', auth_user_id: 'auth-9', ...PERMISSOES, active: false }] });
  const r = await rodar(store, { apply: true });
  assert.equal(r.applied, true, 'sem admin ativo, o bootstrap ainda vale');
});

// 8-10. Concorrência, atomicidade e schema ausente.
test('8. dois bootstraps concorrentes → somente um cria o admin', async () => {
  const store = fakeStore();
  // O advisory lock serializa; aqui simulamos a sequência que o banco impõe:
  // o primeiro commit acontece antes do segundo ler a contagem.
  const [a, b] = await Promise.all([rodar(store, { apply: true }), rodar(store, { apply: true })]);
  assert.equal([a, b].filter((r) => r.applied === true).length, 1, 'apenas um pode ser o primeiro');
  assert.equal(store.estado.acessos.length, 1);
  assert.equal(store.estado.auditoria.length, 1, 'um admin, uma auditoria');
});
test('9. falha da auditoria faz rollback da concessão', async () => {
  const store = fakeStore({ falharAuditoria: true });
  await assert.rejects(rodar(store, { apply: true }), { code: 'UNAVAILABLE' });
  // A linha some: é isso que o ROLLBACK do banco garante. O contador `escritas`
  // conta TENTATIVAS e não é desfeito — exigir 0 ali testaria "a escrita nunca
  // chegou a ser tentada", que não é a propriedade que importa.
  assert.equal(store.estado.acessos.length, 0, 'concessão não pode sobrar sem auditoria');
  assert.equal(store.estado.auditoria.length, 0, 'sem auditoria, sem registro');
});
test('10. schema ausente → ACCESS_SCHEMA_NOT_READY, nada gravado', async () => {
  const store = fakeStore({ semSchema: true });
  await assert.rejects(rodar(store, { apply: true }), { code: 'ACCESS_SCHEMA_NOT_READY' });
});

// 11-12. Usuário inativo e conta não conectada.
test('11. usuário inativo é bloqueado no bootstrap', async () => {
  const store = fakeStore({ usuarios: [{ auth_user_id: 'auth-1', full_name: 'Maria', email: 'maria@ruy.com', status: 'inativo' }] });
  await assert.rejects(rodar(store, { apply: true }), { code: 'USER_INACTIVE' });
  assert.equal(store.estado.escritas, 0);
});
test('12. usuário sem auth_user_id é bloqueado: o vínculo não pode nascer órfão', async () => {
  const store = fakeStore({ usuarios: [{ auth_user_id: null, full_name: 'Maria', email: 'maria@ruy.com', status: 'ativo' }] });
  await assert.rejects(rodar(store, { apply: true }), { code: 'USER_WITHOUT_AUTH_ID' });
  assert.equal(store.estado.escritas, 0);
});
test('12b. conta desconectada é bloqueada: admin de conta morta não dá acesso', async () => {
  const store = fakeStore({ contas: [{ id: 'acc-1', provider: 'instagram', display_name: 'Ruy', status: 'disconnected' }] });
  await assert.rejects(rodar(store, { apply: true }), { code: 'ACCOUNT_NOT_CONNECTED' });
  assert.equal(store.estado.escritas, 0);
});

// 13. Nenhum segredo sai no relatório.
test('13. relatório mostra o vínculo e nenhum segredo', async () => {
  const relatorio = formatBootstrapReport(await rodar(fakeStore()));
  assert.ok(relatorio.includes('Maria Souza'));
  assert.ok(relatorio.includes('auth-1'), 'o id do Auth precisa aparecer: é o que o operador confere');
  assert.ok(relatorio.includes('DRY-RUN'));
  for (const segredo of ['password', 'senha', 'token', 'service_role', 'SUPABASE_DB_URL', 'sb_secret']) {
    assert.ok(!relatorio.toLowerCase().includes(segredo.toLowerCase()), `relatório vazou ${segredo}`);
  }
});
test('13b. relatório de recusa diz que já existe admin', async () => {
  const primeiro = fakeStore();
  await rodar(primeiro, { apply: true });
  const r = await rodar(fakeStore({ existentes: primeiro.estado.acessos }), { apply: true });
  const relatorio = formatBootstrapReport(r);
  assert.ok(relatorio.includes('RECUSADO'));
});
test('o bootstrap não é alcançável por HTTP: não há rota para ele', async () => {
  const { readFile } = await import('node:fs/promises');
  const codigo = (t) => t.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const handler = await readFile(new URL('../server/social/adminHandler.mjs', import.meta.url), 'utf8');
  // Nenhuma rota de bootstrap pode existir: um endpoint que criasse o primeiro
  // can_admin por sessão refaria o deadlock — e o tornaria alcançável.
  assert.ok(!/bootstrap/i.test(codigo(handler)), 'handler não pode mencionar bootstrap');
  const host = await readFile(new URL('../server/social/aiHost.mjs', import.meta.url), 'utf8');
  assert.ok(!/bootstrap/i.test(codigo(host)), 'host não pode ter rota de bootstrap');
});

});
test('3. conta inexistente → erro, nada gravado', async () => {
  const store = fakeStore();
  await assert.rejects(bootstrapFirstSocialAdmin({ store, userTerm: 'maria@ruy.com', accountTerm: 'conta-fantasma' }), { code: 'ACCOUNT_NOT_FOUND' });
  assert.equal(store.estado.escritas, 0);
});
test('4. usuário ambíguo → PARA e lista candidatos; não escolhe sozinho', async () => {
  const store = fakeStore({ usuarios: [{ auth_user_id: 'a', full_name: 'Maria Souza', email: 'maria@ruy.com', status: 'ativo' }, { auth_user_id: 'b', full_name: 'Maria Souza', email: 'maria.s@ruy.com', status: 'ativo' }] });
  await assert.rejects(bootstrapFirstSocialAdmin({ store, userTerm: 'Maria Souza', accountTerm: 'acc-1' }), (e) => {
    assert.equal(e.code, 'AMBIGUOUS_USER');
    assert.equal(e.candidates.length, 2, 'precisa mostrar quem são');
    return true;
  });
  assert.equal(store.estado.escritas, 0);
});
test('5. conta ambígua → PARA e lista candidatos', async () => {
  const store = fakeStore({ contas: [{ id: 'acc-1', provider: 'instagram', display_name: 'Ruy', status: 'connected' }, { id: 'acc-2', provider: 'facebook', display_name: 'Ruy', status: 'connected' }] });
  await assert.rejects(bootstrapFirstSocialAdmin({ store, userTerm: 'maria@ruy.com', accountTerm: 'Ruy' }), (e) => {
    assert.equal(e.code, 'AMBIGUOUS_ACCOUNT');
    assert.equal(e.candidates.length, 2);
    return true;
  });
  assert.equal(store.estado.escritas, 0);
});
