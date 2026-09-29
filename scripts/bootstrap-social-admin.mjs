// ===========================================================================
// BOOTSTRAP DO PRIMEIRO ADMINISTRADOR DE CONTAS SOCIAIS (Fase 8).
//
// â”€â”€ O PROBLEMA QUE ISTO RESOLVE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// A tela de ConfiguraÃ§Ãµes exige DUAS coisas para conceder acesso:
//   (a) `configure` no system_role, e
//   (b) `can_admin` na conta.
//
// Com a tabela de acesso recÃ©m-criada e vazia, NINGUÃ‰M tem (b). A sequÃªncia
// "aplicar schema â†’ abrir a tela â†’ conceder o primeiro can_admin pela prÃ³pria
// tela" Ã© IMPOSSÃVEL: a tela nÃ£o pode autorizar alguÃ©m que ainda nÃ£o tem
// autorizaÃ§Ã£o. Era esse o erro da sequÃªncia da Fase 7.
//
// â”€â”€ A RESPOSTA: UM CAMINHO SEPARADO, NÃƒO UM ATALHO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// A correÃ§Ã£o NÃƒO Ã© afrouxar `authorizeAdmin` (isso viraria "admin vÃª tudo", o
// atalho que a Fase 6 proibiu). A correÃ§Ã£o Ã© um SEGUNDO CAMINHO, com requisitos
// prÃ³prios, que existe apenas enquanto nÃ£o hÃ¡ nenhum administrador:
//
//   tela (fluxo normal)  -> exige configure + can_admin  [Fase 7]
//   bootstrap (one-shot)  -> exige conexÃ£o administrativa direta ao banco
//                            + nÃ£o existir nenhum admin ativo
//
// SÃ£o caminhos que nÃ£o se misturam: o bootstrap nÃ£o Ã© uma rota HTTP, nÃ£o tem
// parÃ¢metro que o frontend possa mandar, e nÃ£o Ã© alcanÃ§Ã¡vel pela tela.
//
// â”€â”€ QUEM PODE RECEBER O PRIMEIRO can_admin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
//  1. Uma pessoa REAL do inventÃ¡rio, resolvida por nome/e-mail. NÃ£o se digita
//     UUID: o operador pode escolher a pessoa errada sem perceber.
//  2. Cujo `auth.users.id` (o UUID do Auth) precisa estar preenchido no
//     inventÃ¡rio. Ã‰ esse id que `social_account_access.auth_user_id` referencia.
//     Sem ele, o vÃ­nculo nasceria apontando para nada.
//  3. A pessoa precisa estar ATIVA no inventÃ¡rio â€” mesma regra de
//     `authAdapter.me()`. Conceder a alguÃ©m que nÃ£o consegue entrar no sistema
//     nÃ£o ajuda ninguÃ©m.
//  4. A conta precisa existir E estar `connected`. Conceder admin de uma conta
//     desconectada nÃ£o dÃ¡ acesso a nada.
//
// NÃƒO existe atalho por `system_role === 'admin'`: o bootstrap exige conexÃ£o
// administrativa ao banco, que o navegador nÃ£o tem.
//
// â”€â”€ COMO IMPEDIMOS BOOTSTRAP POSTERIOR INDEVIDO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// A condiÃ§Ã£o Ã© verificada DENTRO da transaÃ§Ã£o, depois de um
// `pg_advisory_xact_lock`. Assim que existe um `active=true, can_admin=true`, o
// script se recusa â€” e recusa de novo nas execuÃ§Ãµes seguintes. Passar a
// gerenciar administradores Ã© o trabalho da tela, que registra quem autorizou
// quem.
// ===========================================================================
import { normalizeAccountPermissions, isUserActive } from '../src/lib/social/accountAccess.js';
import { SocialError } from '../server/social/providerBase.mjs';

const fail = (code, message) => new SocialError(code, message);
const NOT_READY = ['ACCESS_SCHEMA_NOT_READY', '42P01', 'PGRST205', '42883'];

/**
 * Resolve e valida conta e usuÃ¡rio. Separado de `bootstrapFirstSocialAdmin`
 * para que o dry-run faÃ§a EXATAMENTE as mesmas verificaÃ§Ãµes â€” se o dry-run
 * approve e o apply fizessem consultas diferentes, o dry-run nÃ£o valeria nada.
 */
export async function resolveBootstrapTargets(tx, { userTerm, accountTerm }) {
  if (!userTerm || !accountTerm) throw fail('INVALID_ARGUMENT', 'Informe usuÃ¡rio e conta');

  const usuarios = await tx.findUsersByTerm(userTerm);
  if (usuarios.length === 0) throw fail('USER_NOT_FOUND', `Nenhum usuÃ¡rio encontrado para "${userTerm}"`);
  // Ambiguidade PARA. Escolher a primeira pessoa de uma lista de trÃªs Ã© como se
  // concede acesso Ã  pessoa errada sem ninguÃ©m perceber.
  if (usuarios.length > 1) {
    throw Object.assign(
      fail('AMBIGUOUS_USER', `("${userTerm}") encontra ${usuarios.length} pessoas. Informe mais: email ou id.`),
      { candidates: usuarios.map((u) => ({ full_name: u.full_name, email: u.email })) },
    );
  }
  const usuario = usuarios[0];
  // O vÃ­nculo referencia `auth.users.id`. Sem ele gravado no inventÃ¡rio, a
  // linha nasceria Ã³rfÃ£ de verdade.
  if (!usuario.auth_user_id) throw fail('USER_WITHOUT_AUTH_ID', `"${usuario.full_name}" nÃ£o tem auth_user_id vinculado no inventÃ¡rio`);
  if (!isUserActive(usuario.status)) throw fail('USER_INACTIVE', `"${usuario.full_name}" estÃ¡ inativo (${usuario.status})`);

  const contas = await tx.findAccountsByTerm(accountTerm);
  if (contas.length === 0) throw fail('ACCOUNT_NOT_FOUND', `Nenhuma conta encontrada para "${accountTerm}"`);
  if (contas.length > 1) {
    throw Object.assign(
      fail('AMBIGUOUS_ACCOUNT', `("${accountTerm}") encontra ${contas.length} contas. Informe o id exato.`),
      { candidates: contas.map((c) => ({ display_name: c.display_name, provider: c.provider })) },
    );
  }
  const conta = contas[0];
  if (conta.status !== 'connected') throw fail('ACCOUNT_NOT_CONNECTED', `"${conta.display_name}" estÃ¡ ${conta.status}`);

  return { usuario, conta };
}

// O que o operador vÃª antes de confirmar. Sem segredo: sÃ³ o que identifica a
// pessoa, a conta e as permissÃµes que serÃ£o gravadas.
export function describeBootstrap({ usuario, conta, permissions, existingAdmins }) {
  return {
    origem: 'bootstrap (one-shot, console administrativa)',
    conta: { nome: conta.display_name, provider: conta.provider, status: conta.status, id: conta.id },
    usuario: { nome: usuario.full_name, email: usuario.email, status: usuario.status, auth_user_id: usuario.auth_user_id },
    permissoes: permissions,
    administradoresAtivos: existingAdmins,
    aviso: existingAdmins > 0
      ? 'JÃ EXISTE administrador ativo. Este comando serÃ¡ recusado.'
      : 'Este serÃ¡ o PRIMEIRO administrador de contas sociais. Depois, use a tela.',
  };
}

/**
 * Cria o primeiro vÃ­nculo `can_admin`.
 *
 * @param {object} o
 * @param {object} o.store   `createSocialAccessStore`
 * @param {boolean} o.apply  false = dry-run: NADA Ã© escrito
 * @returns {Promise<object>} o que foi feito, ou o que seria feito
 */
export async function bootstrapFirstSocialAdmin({ store, userTerm, accountTerm, apply = false, operatorLabel = null } = {}) {
  if (!store?.transaction) throw new Error('bootstrapFirstSocialAdmin requer store com transaction()');
  return store.transaction(async (tx) => {
    // O lock vem ANTES da contagem: sem ele, dois processos leem "zero admins"
    // ao mesmo tempo e ambos criam o seu.
    await tx.lockBootstrap();

    // Resolve e valida ANTES de decidir se escreve. Um dry-run que nÃ£o
    // validasse nada seria inÃºtil.
    const { usuario, conta } = await resolveBootstrapTargets(tx, { userTerm, accountTerm });
    const existingAdmins = await tx.countActiveAdmins();
    // PermissÃµes do bootstrap sÃ£o fixas e COMPLETAS: quem administra a conta
    // precisa ver, responder e aprovar, senÃ£o as constraints `admin_implies_reply`
    // e `implies_view` do banco recusariam a linha.
    const permissions = normalizeAccountPermissions({ can_view: true, can_reply: true, can_approve_ai: true, can_admin: true }, true).permissions;
    const resumo = describeBootstrap({ usuario, conta, permissions, existingAdmins });

    if (existingAdmins > 0) {
      // One-shot: depois do primeiro, este caminho fecha. NÃ£o existe "adicionar
      // mais um pelo script" â€” isso Ã© trabalho da tela, auditado.
      return { applied: false, refused: true, reason: 'BOOTSTRAP_ALREADY_DONE', ...resumo };
    }
    // VÃ­nculo existente para o MESMO par conta/usuÃ¡rio nÃ£o Ã© o problema: o que
    // impede Ã© existir algum admin. Reativar o prÃ³prio par Ã© legÃ­timo.
    const jaVinculado = await tx.findAccess(conta.id, usuario.auth_user_id);
    if (!apply) return { applied: false, refused: false, dryRun: true, alreadyLinked: Boolean(jaVinculado), ...resumo };

    const gravado = jaVinculado
      ? await tx.updateAccess({ accountId: conta.id, authUserId: usuario.auth_user_id, permissions, active: true, revokedAt: null })
      : await tx.insertAccess({ accountId: conta.id, provider: conta.provider, authUserId: usuario.auth_user_id, permissions, active: true });

    // Auditoria NA MESMA transaÃ§Ã£o: sem ela, o primeiro admin do sistema nÃ£o
    // teria rastro de origem â€” exatamente o registro que mais importa.
    await tx.appendAudit({
      action: 'access_granted',
      accountId: conta.id,
      provider: conta.provider,
      targetUserId: usuario.auth_user_id,
      // NÃ£o hÃ¡ "operador" autenticado: quem roda Ã© o operador do banco. O campo
      // Ã© NOT NULL, entÃ£o usamos o prÃ³prio alvo e marcamos a origem, em vez de
      // inventar um id de sistema que ninguÃ©m conseguiria auditar.
      operatorUserId: usuario.auth_user_id,
      origin: 'bootstrap',
      details: { operatorLabel, reactivated: Boolean(jaVinculado), permissions },
    });

    return { applied: true, refused: false, ...resumo, vinculo: gravado };
  }).catch((error) => {
    if (NOT_READY.includes(error?.code)) throw fail('ACCESS_SCHEMA_NOT_READY', 'Schema de acesso social nÃ£o aplicado');
    throw error;
  });
}


// â”€â”€ CLI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// MODO PADRÃƒO Ã‰ DRY-RUN. Sem `--apply`, este script NÃƒO ABRE TRANSAÃ‡ÃƒO DE
// ESCRITA: ele consulta, mostra o que faria e sai. `--apply` Ã© a Ãºnica forma de
// gravar, e ainda exige que a resposta a um prompt digitado seja `APLICAR`.
//
//   node scripts/bootstrap-social-admin.mjs --user "maria@ruy.com" --account "Instagram"
//   node scripts/bootstrap-social-admin.mjs --user "maria@ruy.com" --account "acc-uuid" --apply
//
// A conexÃ£o vem de `SUPABASE_DB_URL` (service role, ambiente administrativo).
// NUNCA de variÃ¡vel `VITE_*`, e nunca do navegador: o bootstrap nÃ£o existe como
// rota HTTP.
const USAGE = `Bootstrap do PRIMEIRO administrador de contas sociais (one-shot).

  node scripts/bootstrap-social-admin.mjs --user <nome|email|id> --account <nome|id> [--apply]

  --user    pessoa do inventÃ¡rio (resolve por nome, email ou auth_user_id)
  --account  conta social (resolve por nome ou id)
  --apply   grava de verdade. Sem esta flag, NADA Ã© escrito (dry-run).

Variaveis de ambiente:
  SUPABASE_DB_URL   conexao administrativa (obrigatoria)

Depois do primeiro administrador, este comando se recusa. Os demais sao
gerenciados em Configuracoes -> Redes Sociais.`;

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--user') args.userTerm = argv[++i];
    else if (arg === '--account') args.accountTerm = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw fail('INVALID_ARGUMENT', `Argumento desconhecido: ${arg}`);
  }
  return args;
}

export function formatBootstrapReport(result) {
  const linhas = [
    '',
    '=== BOOTSTRAP DE ADMINISTRADOR DE CONTAS SOCIAIS ===',
    `Origem:        ${result.origem}`,
    `Conta:         ${result.conta.nome} (${result.conta.provider}, ${result.conta.status})`,
    `Conta id:      ${result.conta.id}`,
    `Pessoa:        ${result.usuario.nome}`,
    `E-mail:        ${result.usuario.email ?? '-'}`,
    `Status:        ${result.usuario.status ?? '-'}`,
    `Auth user id:  ${result.usuario.auth_user_id}`,
    `Permissoes:    ${Object.entries(result.permissoes).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nenhuma'}`,
    `Admins ativos: ${result.administradoresAtivos}`,
    `Aviso:         ${result.aviso}`,
    '',
  ];
  if (result.refused) linhas.push('>> RECUSADO: o bootstrap ja foi feito. Use a tela de Configuracoes.', '');
  else if (result.dryRun) linhas.push('>> DRY-RUN: nada foi escrito. Revise acima e rode com --apply se estiver correto.', '');
  else if (result.applied) linhas.push('>> APLICADO. O primeiro administrador foi criado e auditado.', '');
  return linhas.join('\n');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`${error.message}\n\n${USAGE}`); process.exit(1); }
  if (args.help || !args.userTerm || !args.accountTerm) { console.log(USAGE); process.exit(args.help ? 0 : 1); }

  // A conexÃ£o vem do ambiente e NUNCA Ã© impressa. Mensagem de erro do driver
  // costuma trazer a connection string inteira; por isso o log mostra sÃ³ o
  // cÃ³digo de negÃ³cio.
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('SUPABASE_DB_URL nao esta definida. Defina no ambiente administrativo e rode de novo. Nada foi escrito.');
    process.exit(1);
  }

  let pg;
  try { pg = (await import('pg')).default; }
  catch {
    console.error('Pacote "pg" nao esta instalado. Nada foi escrito.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: false } });
  const { createSocialAccessStore } = await import('../server/social/accountAccessStore.mjs');
  const store = createSocialAccessStore({ withClient: () => pool.connect() });

  try {
    const result = await bootstrapFirstSocialAdmin({
      store, userTerm: args.userTerm, accountTerm: args.accountTerm, apply: args.apply,
      operatorLabel: process.env.SOCIAL_BOOTSTRAP_OPERATOR || null,
    });
    console.log(formatBootstrapReport(result));
    if (result.refused) process.exit(2);
    if (!result.applied) process.exit(0);

    // ConfirmaÃ§Ã£o digitada: o relatÃ³rio jÃ¡ foi mostrado, e o operador precisa
    // confirmar. Sem terminal interativo, o padrÃ£o Ã© NÃƒO gravar.
    if (!process.stdin.isTTY) {
      console.error('Sem terminal interativo: confirmacao impossivel. Nada foi aplicado.');
      process.exit(1);
    }
    process.stdout.write('\nDigite APLICAR para confirmar: ');
    const resposta = await new Promise((resolve) => {
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', (d) => resolve(String(d).trim()));
    });
    if (resposta !== 'APLICAR') { console.error('Confirmacao nao confere. Nada foi gravado.'); process.exit(1); }

    // Reexecuta com apply depois da confirmaÃ§Ã£o. A checagem de "jÃ¡ existe admin"
    // roda de novo dentro da transaÃ§Ã£o, entÃ£o um bootstrap concorrente iniciado
    // entre o relatÃ³rio e a confirmaÃ§Ã£o Ã© barrado aqui.
    const aplicado = await bootstrapFirstSocialAdmin({
      store, userTerm: args.userTerm, accountTerm: args.accountTerm, apply: true,
      operatorLabel: process.env.SOCIAL_BOOTSTRAP_OPERATOR || null,
    });
    console.log(aplicado.refused ? '>> RECUSADO na aplicacao: ja existe administrador ativo.' : '>> Aplicado com sucesso.');
    if (aplicado.refused) process.exit(2);
  } catch (error) {
    // SÃ³ o cÃ³digo e a mensagem de negÃ³cio; a do driver pode conter a conexÃ£o.
    console.error(`Bootstrap falhou (${error?.code || 'erro'}): ${error?.message || 'erro desconhecido'}`);
    if (error?.candidates?.length) console.error('Candidatos:', error.candidates);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

