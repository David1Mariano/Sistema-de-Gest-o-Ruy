import { Pool } from 'pg';

// Conecta ao banco 'postgres' para dropar/recriar o banco de teste
const adminPool = new Pool({
  host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres',
  database: 'postgres',
});

async function main() {
  const admin = await adminPool.connect();
  try {
    await admin.query(`drop database if exists ruy_security_test`);
    await admin.query(`create database ruy_security_test`);
    console.log('Banco de teste ruy_security_test recriado.');
  } finally {
    admin.release();
    await adminPool.end();
  }

  // Conecta ao banco de teste
  const pool = new Pool({
    host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres',
    database: 'ruy_security_test',
  });
  const c = await pool.connect();
  try {
    // === 1. Cria tabela records (modelo Supabase) ===
    await c.query(`drop table if exists public.records cascade`);
    await c.query(`
      create table public.records (
        id text primary key,
        entity text not null,
        data jsonb not null,
        created_date timestamptz default now(),
        updated_date timestamptz default now()
      )
    `);
    await c.query(`create index if not exists records_entity_idx on public.records (entity)`);

    // === 2. Habilita RLS ===
    await c.query(`alter table public.records enable row level security`);
    await c.query(`alter table public.records force row level security`);

    // === 3. Papéis Supabase ===
    await c.query(`drop role if exists anon;`);
    await c.query(`create role anon;`);
    await c.query(`grant select on public.records to anon;`);

    await c.query(`drop role if exists authenticated;`);
    await c.query(`create role authenticated;`);
    await c.query(`grant select, insert, update, delete on public.records to authenticated;`);

    // === 4. Políticas base ===
    // SELECT: authenticated vê apenas registros do seu owner_id (ou próprio AuthUser)
    await c.query(`
      create policy "ruy_records_select_owner"
      on public.records for select
      to authenticated
      using (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id' <> ''
        and (
          (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
          or (entity = 'AuthUser' and data->>'id' = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id')
        )
      )
    `);
    // SELECT: admin vê tudo
    await c.query(`
      create policy "ruy_records_select_admin"
      on public.records for select
      to authenticated
      using (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
      )
    `);
    // WRITE: admin pode escrever tudo (using + with_check)
    await c.query(`
      create policy "ruy_records_write_admin"
      on public.records for all
      to authenticated
      using (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
      )
      with check (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
      )
    `);
    // WRITE: owner pode escrever apenas seus próprios registros
    await c.query(`
      create policy "ruy_records_write_owner"
      on public.records for all
      to authenticated
      using (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id' <> ''
        and (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
      )
      with check (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id' <> ''
        and (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
      )
    `);

    // === 5. Dados sintéticos ===
    await c.query(`insert into public.records (id, entity, data, created_date, updated_date) values
      ($1, 'AuthUser', $2, now(), now()),
      ($3, 'AuthUser', $4, now(), now()),
      ($5, 'AuthUser', $6, now(), now()),
      ($7, 'Employee', $8, now(), now()),
      ($9, 'Employee', $10, now(), now()),
      ($11, 'FinancialExpense', $12, now(), now()),
      ($13, 'FinancialExpense', $14, now(), now())
    `, [
      'au_1', JSON.stringify({ id: 'au_1', email: 'admin@ruy.test', full_name: 'Admin Ruy', role: 'admin', status: 'ativo', owner_id: 'au_1' }),
      'au_2', JSON.stringify({ id: 'au_2', email: 'func@ruy.test', full_name: 'Funcionario', role: 'user', status: 'ativo', owner_id: 'au_2' }),
      'au_3', JSON.stringify({ id: 'au_3', email: 'bloqueado@ruy.test', full_name: 'Bloqueado', role: 'user', status: 'inativo', owner_id: 'au_3' }),
      'emp_1', JSON.stringify({ id: 'emp_1', name: 'Joao Silva', status: 'ativo', hire_type: 'clt', owner_id: 'au_1' }),
      'emp_2', JSON.stringify({ id: 'emp_2', name: 'Maria Souza', status: 'ativo', hire_type: 'clt', owner_id: 'au_2' }),
      'fe_1', JSON.stringify({ id: 'fe_1', description: 'Despesa sigilosa', amount: 5000, status: 'pago', owner_id: 'au_1' }),
      'fe_2', JSON.stringify({ id: 'fe_2', description: 'Despesa do funcionario', amount: 200, status: 'pendente', owner_id: 'au_2' }),
    ]);

    console.log('=== Ambiente de teste criado ===');

    const results = [];
    const check = (name, expected, got) => {
      const pass = expected === got;
      results.push({ test: name, expected, got, pass });
      console.log(`${pass ? 'PASS' : 'FAIL'}: ${name} (esperado=${expected}, obtido=${got})`);
    };

    const resetAll = () => c.query(`reset role; set request.jwt.claims to '{}';`);
    const setClaims = (claims) => c.query(`set request.jwt.claims to '${JSON.stringify(claims)}';`);

    // Teste 1: anon (sem JWT) não lê
    await c.query(`set role anon;`);
    const t1 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('Anonimo nao le Employee', 0, Number(t1.rows[0].n));
    const t2 = await c.query(`select count(*) as n from public.records where entity = 'FinancialExpense'`);
    check('Anonimo nao le FinancialExpense', 0, Number(t2.rows[0].n));
    try {
      await c.query(`insert into public.records (id, entity, data) values ($1, 'Employee', $2)`, ['x', JSON.stringify({})]);
      check('Anonimo nao insere', 'bloqueado', 'inseriu');
    } catch { check('Anonimo nao insere', 'bloqueado', 'bloqueado'); }
    await resetAll();

    // Teste 2: authenticated sem claims
    await c.query(`set role authenticated;`);
    const t3 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('Autenticado sem claims nao le Employee', 0, Number(t3.rows[0].n));
    await resetAll();

    // Teste 3: admin lê tudo
    await c.query(`set role authenticated;`);
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_1', system_role: 'admin' } });
    const t4 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('Autenticado admin le Employee', 2, Number(t4.rows[0].n));
    const t5 = await c.query(`select count(*) as n from public.records where entity = 'FinancialExpense'`);
    check('Autenticado admin le FinancialExpense', 2, Number(t5.rows[0].n));
    await resetAll();

    // Teste 4: user comum vê somente seu owner
    await c.query(`set role authenticated;`);
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_2', system_role: 'user' } });
    const t6 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('User comum le somente proprio Employee', 1, Number(t6.rows[0].n));
    const t7 = await c.query(`select count(*) as n from public.records where entity = 'FinancialExpense'`);
    check('User comum le somente proprio FinancialExpense', 1, Number(t7.rows[0].n));
    await resetAll();

    // Teste 5: user inativo vê somente seu owner
    await c.query(`set role authenticated;`);
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_3', system_role: 'user' } });
    const t8 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('User inativo le somente proprio Employee', 0, Number(t8.rows[0].n));
    await resetAll();

    // Teste 6: user comum não atualiza Employee de outro
    await c.query(`set role authenticated;`);
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_2', system_role: 'user' } });
    const debugSelect = await c.query(`select id, data->>'owner_id' as owner from public.records where entity = 'Employee'`);
    console.log(`  DEBUG teste6: claims=au_2, linhas visíveis=${debugSelect.rowCount}`, debugSelect.rows.map(r => `${r.id}:${r.owner}`));
    const upd = await c.query(`update public.records set data = data || $1 where entity = 'Employee' and id = 'emp_1' returning id`, [JSON.stringify({ status: 'alterado' })]);
      check('User comum nao atualiza Employee de outro', 0, upd.rowCount);
    await resetAll();

    // Teste 7: user comum não deleta Employee de outro
    await c.query(`set role authenticated;`);
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_2', system_role: 'user' } });
    const debugSelect7 = await c.query(`select id, data->>'owner_id' as owner from public.records where entity = 'Employee'`);
    console.log(`  DEBUG teste7: claims=au_2, linhas visíveis=${debugSelect7.rowCount}`, debugSelect7.rows.map(r => `${r.id}:${r.owner}`));
    const del = await c.query(`delete from public.records where entity = 'Employee' and id = 'emp_1' returning id`);
    console.log(`  DEBUG teste7: DELETE afetou ${del.rowCount} linha(s)`);
    check('User comum nao deleta Employee de outro', 0, del.rowCount);
    await resetAll();

    // Teste 8: admin atualiza qualquer registro
    await c.query(`set role authenticated;`);
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_1', system_role: 'admin' } });
    const upd8 = await c.query(`update public.records set data = data || $1 where entity = 'Employee' and id = 'emp_2' returning id`, [JSON.stringify({ observacao: 'auditado' })]);
    check('Admin atualiza qualquer Employee', 1, upd8.rowCount);
    await resetAll();

    // === Resultado ===
    console.log(`\n=== RESULTADO: ${results.filter(r => r.pass).length}/${results.length} testes aprovados ===\n`);
    if (results.every(r => r.pass)) {
      console.log('MODELO DE RLS VALIDADO COM SUCESSO.');
    } else {
      console.log('ALGUNS TESTES FALHARAM - revisar policies.');
      process.exit(1);
    }
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
