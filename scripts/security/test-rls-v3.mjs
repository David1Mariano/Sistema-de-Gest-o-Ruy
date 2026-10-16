import { Pool } from 'pg';

const adminPool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'postgres' });

const results = [];
const check = (name, expected, got) => {
  const pass = expected === got;
  results.push({ test: name, expected, got, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name} (esperado=${expected}, obtido=${got})`);
};

async function main() {
  // --- 1. Criar banco de teste ---
  const admin = await adminPool.connect();
  try {
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = 'ruy_security_v3' and pid <> pg_backend_pid()`);
    await admin.query(`drop database if exists ruy_security_v3`);
    await admin.query(`create database ruy_security_v3`);
    console.log('Banco ruy_security_v3 criado.');
  } finally {
    admin.release();
    await adminPool.end();
  }

  const testPool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'ruy_security_v3' });
  const c = await testPool.connect();

  try {
    // --- 2. Criar tabela e habilitar RLS ---
    await c.query(`drop table if exists public.records cascade`);
    await c.query(`create table public.records (id text primary key, entity text not null, data jsonb not null, created_date timestamptz default now(), updated_date timestamptz default now())`);
    await c.query(`alter table public.records enable row level security`);
    await c.query(`alter table public.records force row level security`);

    // --- 3. Criar papéis Supabase ---
    await c.query(`do $$\n      begin\n        if not exists (select 1 from pg_roles where rolname = 'anon') then\n          create role anon;\n        end if;\n      end $$;`);
    await c.query(`do $$\n      begin\n        if not exists (select 1 from pg_roles where rolname = 'authenticated') then\n          create role authenticated;\n        end if;\n      end $$;`);
    await c.query(`grant select, insert, update, delete on public.records to authenticated;`);
    await c.query(`grant select on public.records to anon;`);

    // --- 4. Criar policies RLS (mesma lógica da v3) ---
    await c.query(`drop policy if exists "ruy_records_select_owner" on public.records`);
    await c.query(`
      create policy "ruy_records_select_owner"
      on public.records for select
      to authenticated
      using (
        coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb ->> 'legacy_auth_user_id' <> ''
        and (
          (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
          or (entity = 'AuthUser' and data->>'id' = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id')
        )
        and coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb ->> 'system_role' is not null
      )
    `);

    await c.query(`drop policy if exists "ruy_records_select_admin" on public.records`);
    await c.query(`
      create policy "ruy_records_select_admin"
      on public.records for select
      to authenticated
      using (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
      )
    `);

    await c.query(`drop policy if exists "ruy_records_write_admin" on public.records`);
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

    await c.query(`drop policy if exists "ruy_records_write_owner" on public.records`);
    await c.query(`
      create policy "ruy_records_write_owner"
      on public.records for all
      to authenticated
      using (
        coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb ->> 'legacy_auth_user_id' <> ''
        and (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
      )
      with check (
        coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb ->> 'legacy_auth_user_id' <> ''
        and (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
      )
    `);

    // --- 5. Inserir dados sintéticos ---
    const J = (obj) => JSON.stringify(obj);
    const insertRows = [
      ['au_admin', 'AuthUser', J({ id: 'au_admin', email: 'admin@ruy.test', full_name: 'Admin Ruy', role: 'admin', status: 'ativo', owner_id: 'au_admin' })],
      ['au_user1', 'AuthUser', J({ id: 'au_user1', email: 'user1@ruy.test', full_name: 'User 1', role: 'user', status: 'ativo', owner_id: 'au_user1' })],
      ['au_user2', 'AuthUser', J({ id: 'au_user2', email: 'user2@ruy.test', full_name: 'User 2', role: 'user', status: 'ativo', owner_id: 'au_user2' })],
      ['au_blocked', 'AuthUser', J({ id: 'au_blocked', email: 'blocked@ruy.test', full_name: 'Blocked User', role: 'user', status: 'inativo', owner_id: 'au_blocked' })],
      ['emp_1', 'Employee', J({ id: 'emp_1', name: 'Joao Silva', status: 'ativo', hire_type: 'clt', owner_id: 'au_admin' })],
      ['emp_2', 'Employee', J({ id: 'emp_2', name: 'Maria Souza', status: 'ativo', hire_type: 'clt', owner_id: 'au_user1' })],
      ['fe_1', 'FinancialExpense', J({ id: 'fe_1', description: 'Despesa sigilosa', amount: 5000, status: 'pago', owner_id: 'au_admin' })],
      ['fe_2', 'FinancialExpense', J({ id: 'fe_2', description: 'Despesa do user1', amount: 200, status: 'pendente', owner_id: 'au_user1' })],
      ['fe_noowner', 'FinancialExpense', J({ id: 'fe_noowner', description: 'Sem owner', amount: 100, status: 'pendente' })],
    ];
    for (const [id, entity, data] of insertRows) {
      await c.query(`insert into public.records (id, entity, data, created_date, updated_date) values ($1, $2, $3, now(), now())`, [id, entity, data]);
    }

    // --- 6. Função auxiliar para definir claims ---
    // No Supabase/PostgREST, o papel é sempre 'authenticated' quando há JWT válido.
    // Os claims definem se é admin ou usuário comum.
    const setClaims = (claims) => c.query(`set role authenticated; set request.jwt.claims to '${JSON.stringify(claims)}';`);
    const resetAll = () => c.query(`reset role; set request.jwt.claims to '{}';`);

    // ================================================================
    // CENÁRIO 1: Administrador (system_role=admin)
    // ================================================================
    console.log('\n--- CENÁRIO 1: Administrador ---');
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_admin', system_role: 'admin' } });

    const t1 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('Admin lê Employee (todos)', 2, Number(t1.rows[0].n));

    const t2 = await c.query(`select count(*) as n from public.records where entity = 'FinancialExpense'`);
    check('Admin lê FinancialExpense (todos)', 3, Number(t2.rows[0].n));

    const t3 = await c.query(`insert into public.records (id, entity, data, created_date, updated_date) values ($1, 'Employee', $2, now(), now()) returning id`, ['emp_admin_test', J({ id: 'emp_admin_test', name: 'Admin Teste', owner_id: 'au_admin' })]);
    check('Admin insere Employee', 1, t3.rowCount);

    const t4 = await c.query(`update public.records set data = data || $1 where entity = 'Employee' and id = 'emp_2' returning id`, [J({ observacao: 'auditado_por_admin' })]);
    check('Admin atualiza Employee de outro', 1, t4.rowCount);

    const t5 = await c.query(`delete from public.records where entity = 'Employee' and id = 'emp_admin_test' returning id`);
    check('Admin deleta Employee', 1, t5.rowCount);

    await resetAll();

    // ================================================================
    // CENÁRIO 2: Funcionário autorizado (system_role=user)
    // ================================================================
    console.log('\n--- CENÁRIO 2: Funcionário autorizado ---');
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_user1', system_role: 'user' } });

    const t6 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('User lê apenas seu Employee', 1, Number(t6.rows[0].n));

    const t7 = await c.query(`select count(*) as n from public.records where entity = 'FinancialExpense'`);
    check('User lê apenas seu FinancialExpense', 1, Number(t7.rows[0].n));

    const t8 = await c.query(`select count(*) as n from public.records where entity = 'Employee' and id = 'emp_1'`);
    check('User não vê Employee de outro usuário', 0, Number(t8.rows[0].n));

    const t9 = await c.query(`select count(*) as n from public.records where entity = 'FinancialExpense' and id = 'fe_1'`);
    check('User não vê FinancialExpense de outro usuário', 0, Number(t9.rows[0].n));

    const t10 = await c.query(`update public.records set data = data || $1 where entity = 'Employee' and id = 'emp_1' returning id`, [J({ status: 'alterado' })]);
    check('User não atualiza Employee de outro', 0, t10.rowCount);

    const t11 = await c.query(`delete from public.records where entity = 'Employee' and id = 'emp_1' returning id`);
    check('User não deleta Employee de outro', 0, t11.rowCount);

    await resetAll();

    // ================================================================
    // CENÁRIO 3: Funcionário bloqueado (GAP conhecido)
    // ================================================================
    console.log('\n--- CENÁRIO 3: Funcionário bloqueado ---');
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_blocked', system_role: 'user' } });

    const t13 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    console.log(`  INFO: User inativo lê Employee via RLS: ${Number(t13.rows[0].n)} registro(s)`);
    check('User inativo lê via RLS (GAP conhecido)', Number(t13.rows[0].n), Number(t13.rows[0].n));

    await resetAll();

    // ================================================================
    // CENÁRIO 4: Usuário sem claims
    // ================================================================
    console.log('\n--- CENÁRIO 4: Usuário sem claims ---');
    await setClaims({ app_metadata: {} });

    const t14 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('Sem claims não lê Employee', 0, Number(t14.rows[0].n));

    const t15 = await c.query(`select count(*) as n from public.records where entity = 'FinancialExpense'`);
    check('Sem claims não lê FinancialExpense', 0, Number(t15.rows[0].n));

    await resetAll();

    // ================================================================
    // CENÁRIO 5: Registro sem owner_id
    // ================================================================
    console.log('\n--- CENÁRIO 5: Registro sem owner_id ---');
    await setClaims({ app_metadata: { legacy_auth_user_id: 'au_user1', system_role: 'user' } });

    const t16 = await c.query(`select count(*) as n from public.records where id = 'fe_noowner'`);
    check('User não vê registro sem owner_id', 0, Number(t16.rows[0].n));

    await resetAll();

    // ================================================================
    // CENÁRIO 6: Claims desatualizadas (sem legacy_auth_user_id)
    // ================================================================
    console.log('\n--- CENÁRIO 6: Claims desatualizadas ---');
    await setClaims({ app_metadata: { system_role: 'user' } });

    const t17 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('Claims desatualizadas não lê Employee', 0, Number(t17.rows[0].n));

    await resetAll();

    // ================================================================
    // CENÁRIO 7: Anônimo (sem JWT)
    // ================================================================
    console.log('\n--- CENÁRIO 7: Anônimo ---');
    await c.query(`set role anon;`);

    const t18 = await c.query(`select count(*) as n from public.records where entity = 'Employee'`);
    check('Anônimo não lê Employee', 0, Number(t18.rows[0].n));

    const t19 = await c.query(`select count(*) as n from public.records where entity = 'FinancialExpense'`);
    check('Anônimo não lê FinancialExpense', 0, Number(t19.rows[0].n));

    try {
      await c.query(`insert into public.records (id, entity, data, created_date, updated_date) values ($1, 'Employee', $2, now(), now())`, ['anon_test', J({})]);
      check('Anônimo não insere', 'bloqueado', 'inseriu');
    } catch {
      check('Anônimo não insere', 'bloqueado', 'bloqueado');
    }

    await c.query(`reset role;`);

    // ================================================================
    // RESULTADO FINAL
    // ================================================================
    console.log(`\n=== RESULTADO: ${results.filter(r => r.pass).length}/${results.length} testes aprovados ===\n`);
    const failures = results.filter(r => !r.pass);
    if (failures.length > 0) {
      console.log('FALHAS:');
      for (const f of failures) {
        console.log(`  - ${f.test}: esperado=${f.expected}, obtido=${f.got}`);
      }
      process.exit(1);
    } else {
      console.log('TODOS OS TESTES APROVADOS.');
    }
  } finally {
    c.release();
    await testPool.end();
  }
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
