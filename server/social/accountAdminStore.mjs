// ===========================================================================
// ADAPTADOR: store PostgreSQL -> contrato de `createAccountAdminService` (Fase 9).
//
// POR QUE ISTO EXISTE: a Fase 8 deixou dois formatos incompatíveis.
//  - `createSocialAccessStore` expõe TRANSAÇÕES: `store.read(tx => ...)` com um
//    `tx` que tem todas as operações. É o formato certo — é o que garante
//    `BEGIN/COMMIT/ROLLBACK` e um único commit para alteração + auditoria.
//  - `createAccountAdminService` espera um objeto de métodos NOMEADOS
//    (`listAccounts`, `upsertAccess`, ...), cada um abrindo sua própria conexão.
//
// Este arquivo é a costura. Ele NÃO reintroduz o formato solto: cada método
// nomeado abre uma transação própria e a fecha antes de devolver, então quem
// chama continua responsável por agrupar leitura+escrita+auditoria dentro
// de UM `store.transaction(...)` quando a operação precisa ser atômica.
//
// Regra que o adaptador mantém: `upsertAccess` decide entre inserir e atualizar
// DENTRO da mesma transação, com `FOR UPDATE` no vínculo quando ele existe.
// Assim dois concessões simultâneas para a mesma conta não correm entre o
// `SELECT` e o `INSERT`.
// ===========================================================================
import { createSocialAccessStore } from './accountAccessStore.mjs';

/**
 * @param {object} o
 * @param {Function} o.withClient  devolve um client do pool (ex.: `pool.connect`)
 * @param {Function} o.now        relógio injetável nos testes
 */
export function createAccountAdminStoreAdapter({ withClient, now } = {}) {
  if (typeof withClient !== 'function') throw new Error('createAccountAdminStoreAdapter exige withClient');
  const store = createSocialAccessStore({ withClient, ...(now ? { now } : {}) });

  return Object.freeze({
    /** acesso ao store transacional, para quem precisar agrupar operações */
    store,

    /**
     * TRANSAÇÃO COMPARTILHADA. É isto que torna escrita + auditoria atômicas.
     *
     * Sem isto, o serviço chamaria `upsertAccess` e `appendAudit` como duas
     * operações: cada uma abriria a SUA transação, e a concessão poderia
     * commitar com a auditoria depois já ter falhado — exatamente o estado que
     * a regra proíbe ("a alteração e o registro precisam ser o mesmo commit").
     *
     * Uso: `store.transaction(tx => { tx.upsertAccess(...); tx.appendAudit(...) })`.
     */
    transaction: (work) => store.read(work),

    listAccounts: () => store.read((tx) => tx.listAccounts()),
    findAccount: (accountId) => store.read((tx) => tx.findAccount(accountId)),
    listAccess: (accountId) => store.read((tx) => tx.listAccess(accountId)),
    // O serviço trata `findAccess` como LISTA (conta duplicatas, que violam o
    // `unique`). O store devolve a linha única; devolvemos o array de 0 ou 1
    // elementos para preservar essa distinção.
    findAccess: (accountId, authUserId) => store.read(async (tx) => {
      const linha = await tx.findAccess(accountId, authUserId);
      return linha ? [linha] : [];
    }),
    listUsers: () => store.read((tx) => tx.listUsers()),
    // O serviço confere `Array.isArray(rows) && rows.length === 1` para
    // distinguir "uma pessoa" de "nenhuma" e de "duas homônimos". O store
    // devolve o OBJETO (ou null), então sem embrulhar aqui a busca nunca
    // encontrava ninguém e toda concessão caia em INVALID_USER.
    findUser: (authUserId) => store.read(async (tx) => {
      const pessoa = await tx.findUser(authUserId);
      return pessoa ? [pessoa] : [];
    }),
    findUsersByTerm: (term) => store.read((tx) => tx.findUsersByTerm(term)),
    findAccountsByTerm: (term) => store.read((tx) => tx.findAccountsByTerm(term)),

    /**
     * Concede ou atualiza. INSERT quando não há vínculo, UPDATE quando há.
     * A decisão e a escrita são o MESMO `work`, então é o mesmo commit.
     *
     * O segundo argumento é o `tx` de uma transação em curso. Presente, a
     * operação entra NAQUELE commit em vez de abrir o próprio.
     */
    upsertAccess: (data, tx) => (tx ? upsert(tx, data) : store.read((t) => upsert(t, data))),
    updateAccess: (data, tx) => (tx ? toupdate(tx, data) : store.read((t) => toupdate(t, data))),
    appendAudit: (data, tx) => (tx ? tx.appendAudit(normalizaAuditoria(data)) : store.read((t) => t.appendAudit(normalizaAuditoria(data)))),
  });
}

// O servico fala em campos PLANOS (`can_view`, `can_admin`, ...); o store
// espera `permissions` aninhado, mais `provider` e `revokedAt` em camelCase.
//
// Sem esta traducao, `permissions.can_view` era lido de `undefined` dentro do
// store e a escrita quebrava com TypeError — que o handler reportava como 503
// "indisponivel", escondendo um erro de programacao atras de uma falha de
// infraestrutura.
async function upsert(tx, data) {
  const existente = await tx.findAccess(data.accountId, data.authUserId);
  return existente
    ? tx.updateAccess(paraStoreSync(data))
    : tx.insertAccess(await paraStoreComConta(tx, data));
}

function toupdate(tx, data) {
  return tx.updateAccess(paraStoreSync(data));
}

// `provider` e NOT NULL na tabela e o servico nao o conhece: ele vem da conta.
async function paraStoreComConta(tx, data) {
  const conta = await tx.findAccount(data.accountId);
  return paraStoreSync({ ...data, provider: conta?.provider ?? null });
}

function paraStoreSync(data) {
  return {
    accountId: data.accountId,
    authUserId: data.authUserId,
    provider: data.provider ?? null,
    permissions: {
      scope_role: data.scope_role ?? 'operator',
      can_view: data.can_view === true,
      can_reply: data.can_reply === true,
      can_approve_ai: data.can_approve_ai === true,
      can_admin: data.can_admin === true,
    },
    active: data.active !== false,
    revokedAt: data.revoked_at ?? null,
  };
}

// O serviço fala em `account_id`/`target_user_id` (nomes da tabela de
// auditoria); o store fala em `accountId`/`targetUserId` (nomes do SQL). A
// traducao mora AQUI, num lugar so, em vez de espalhada pelos dois lados.
function normalizaAuditoria(data) {
  return { ...data, account_id: data.account_id, target_user_id: data.target_user_id, operator_user_id: data.operator_user_id };
}
