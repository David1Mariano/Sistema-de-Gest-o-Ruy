// ===========================================================================
// VERIFICAÃ‡ÃƒO DO SCHEMA DE ACESSO SOCIAL â€” SOMENTE LEITURA.
//
// NÃƒO APLICA NADA. Este script existe para ser rodado DEPOIS que o
// administrador decidir aplicar `scripts/proposed-social-account-access.sql`,
// e responde a uma pergunta: o banco estÃ¡ no estado que a tela e o backend
// assumem? NÃ£o executa migration, nÃ£o cria tabela, nÃ£o insere vÃ­nculo e nÃ£o
// altera RLS â€” apenas consulta e relata.
//
// USAR (quando houver uma connection string de leitura, com service role):
//   node scripts/check-social-access-schema.mjs "$SUPABASE_DB_URL"
//
// Sem argumento, imprime o SQL de inspeÃ§Ã£o para colar no SQL Editor e sai sem
// tocar em nada. Adivinhar credencial ou inventar um banco para "testar" seria
// pior do que nÃ£o verificar.
// ===========================================================================

// O que precisa existir, e por quÃª. Cada item volta como OK ou FALHA.
export const CHECKS = Object.freeze([
  { id: 'tabela', sql: `select to_regclass('public.social_account_access') is not null as ok`, expect: true, why: 'tabela de vÃ­nculos' },
  { id: 'tabela_auditoria', sql: `select to_regclass('public.social_account_access_audit') is not null as ok`, expect: true, why: 'tabela de auditoria' },
  { id: 'rls_habilitada', sql: `select relrowsecurity as ok from pg_class where oid = 'public.social_account_access'::regclass`, expect: true, why: 'RLS habilitada' },
  { id: 'rls_forcada', sql: `select relforcerowsecurity as ok from pg_class where oid = 'public.social_account_access'::regclass`, expect: true, why: 'RLS forÃ§ada' },
  { id: 'rls_auditoria', sql: `select relrowsecurity and relforcerowsecurity as ok from pg_class where oid = 'public.social_account_access_audit'::regclass`, expect: true, why: 'RLS da auditoria' },
  { id: 'constraint_unique', sql: `select count(*) as n from pg_constraint where conrelid = 'public.social_account_access'::regclass and contype = 'u' and pg_get_constraintdef(oid) like '%account_id%auth_user_id%'`, expectMin: 1, why: 'vÃ­nculo Ãºnico por conta e usuÃ¡rio' },
  { id: 'constraint_inativo', sql: `select count(*) as n from pg_constraint where conname = 'social_account_access_active_no_permission'`, expectMin: 1, why: 'vÃ­nculo inativo nÃ£o carrega permissÃ£o' },
  { id: 'constraint_implica_view', sql: `select count(*) as n from pg_constraint where conname = 'social_account_access_implies_view'`, expectMin: 1, why: 'responder exige visualizar' },
  { id: 'constraint_admin_reply', sql: `select count(*) as n from pg_constraint where conname = 'social_account_access_admin_implies_reply'`, expectMin: 1, why: 'administrar exige responder' },
  { id: 'indice_ativo', sql: `select count(*) as n from pg_indexes where indexname = 'social_account_access_active_lookup'`, expectMin: 1, why: 'Ã­ndice do caminho quente' },
  { id: 'indice_auditoria', sql: `select count(*) as n from pg_indexes where indexname = 'social_account_access_audit_recent'`, expectMin: 1, why: 'Ã­ndice da auditoria' },
  // Nenhum privilege para anon/authenticated: se existir, a tabela estÃ¡ aberta
  // para qualquer pessoa logada â€” o oposto de escopo por conta.
  { id: 'sem_privilegio_publico', sql: `select count(*) as n from information_schema.role_table_grants where table_name = 'social_account_access' and grantee in ('anon','authenticated','PUBLIC')`, expectMax: 0, why: 'nenhum grant pÃºblico indevido' },
  { id: 'sem_policies', sql: `select count(*) as n from pg_policies where tablename in ('social_account_access','social_account_access_audit')`, expectMax: 0, why: 'acesso decidido pelo backend' },
  // Duplicata Ã© impossÃ­vel se o unique existir; a consulta Ã© a prova de que o
  // dado tambÃ©m estÃ¡ coerente hoje.
  { id: 'sem_duplicidade', sql: `select count(*) as n from (select account_id, auth_user_id from public.social_account_access group by 1,2 having count(*) > 1) d`, expectMax: 0, why: 'nenhum vÃ­nculo duplicado' },
  { id: 'inativos_sem_permissao', sql: `select count(*) as n from public.social_account_access where not active and (can_view or can_reply or can_approve_ai or can_admin)`, expectMax: 0, why: 'revogado sem permissÃ£o sobrando' },
]);

/** Avalia as respostas e monta o relatÃ³rio. Separado da I/O para poder testar. */
export function evaluate(results) {
  const linhas = [];
  for (const check of CHECKS) {
    const r = results[check.id];
    if (r === undefined || r === null) { linhas.push({ id: check.id, why: check.why, ok: false, detail: 'sem resposta' }); continue; }
    let ok = r === true || r === 1;
    if (check.expect !== undefined) ok = r === check.expect;
    if (check.expectMin !== undefined) ok = Number(r) >= check.expectMin;
    if (check.expectMax !== undefined) ok = Number(r) <= check.expectMax;
    linhas.push({ id: check.id, why: check.why, ok, detail: String(r) });
  }
  return { linhas, ok: linhas.every((l) => l.ok), falhas: linhas.filter((l) => !l.ok) };
}

export function printReport({ linhas, ok, falhas }) {
  for (const l of linhas) console.log(`${l.ok ? 'OK  ' : 'FALHA'} ${l.id.padEnd(22)} ${l.why} (${l.detail})`);
  console.log(ok ? 'SOCIAL_ACCESS_SCHEMA_OK' : `FALHAS: ${falhas.map((f) => f.id).join(', ')}`);
  return ok;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  const connectionString = process.argv[2] || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    // Sem conexÃ£o: entrega o SQL e SAI. NÃ£o abre socket, nÃ£o inventa banco.
    console.log('VerificaÃ§Ã£o do schema de acesso social. NADA foi aplicado.\n');
    console.log('Rode com uma connection string de leitura, ou cole este SQL no SQL Editor:\n');
    console.log(CHECKS.map((c) => `-- ${c.why}\n${c.sql};`).join('\n\n'));
    console.log('\nA tabela de acesso nasce VAZIA: o primeiro vÃ­nculo Ã© concedido pela tela de');
    console.log('ConfiguraÃ§Ãµes â†’ Redes Sociais, nÃ£o por SQL.');
  } else {
    let pg;
    try { pg = (await import('pg')).default; }
    catch {
      console.error('Pacote "pg" nÃ£o estÃ¡ instalado. Use o SQL Editor acima, ou instale "pg" como dependÃªncia de desenvolvimento.');
      process.exitCode = 1;
    }
    if (pg) {
      const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
      await client.connect();
      try {
        const results = {};
        for (const check of CHECKS) {
          // Somente SELECT: este script nÃ£o escreve nada no banco.
          const res = await client.query(check.sql);
          const row = res.rows[0] || {};
          results[check.id] = row.ok ?? row.n ?? Object.values(row)[0];
        }
        if (!printReport(evaluate(results))) process.exitCode = 1;
      } finally { await client.end(); }
    }
  }
}
