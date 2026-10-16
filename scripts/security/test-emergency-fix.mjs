import { Pool } from 'pg';

const adminPool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'postgres' });

const results = [];
const check = (name, expected, got) => {
  const pass = expected === got;
  results.push({ test: name, expected, got, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name} (esperado=${expected}, obtido=${got})`);
};

async function main() {
  // --- 1. Criar banco de teste isolado ---
  const admin = await adminPool.connect();
  try {
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = 'ruy_security_emergency' and pid <> pg_backend_pid()`);
    await admin.query(`drop database if exists ruy_security_emergency`);
    await admin.query(`create database ruy_security_emergency`);
    console.log('Banco ruy_security_emergency criado.');
  } finally {
    admin.release();
    await adminPool.end();
  }

  const testPool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', database: 'ruy_security_emergency' });
  const c = await testPool.connect();

  try {
    // --- 2. Simular o estado real do Supabase ---
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
    await c.query(`alter table public.records enable row level security`);
    // relforcerowsecurity = false (como no real)
    // NÃO forçamos RLS aqui para simular exatamente o ambiente real

    // Criar papéis Supabase
    await c.query(`do $$\n      begin\n        if not exists (select 1 from pg_roles where rolname = 'anon') then\n          create role anon;\n        end if;\n      end $$;`);
    await c.query(`do $$\n      begin\n        if not exists (select 1 from pg_roles where rolname = 'authenticated') then\n          create role authenticated;\n        end if;\n      end $$;`);
    await c.query(`grant select, insert, update, delete on public.records to authenticated;`);

    // --- 3. Criar as duas policies existentes (estado real) ---
    // Policy vulnerável: anon full access
    await c.query(`
      create policy "anon full access"
      on public.records for all
      to anon
      using (true)
      with check (true)
    `);

    // Policy administrativa existente (restrita a UID específico)
    await c.query(`
      create policy "ruy_records_pilot_admin"
      on public.records for all
      to authenticated
      using (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id' = 'admin_uid_real'
      )
      with check (
        (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id' = 'admin_uid_real'
      )
    `);

    // --- 4. Conceder privilégio de SELECT para anon (como pode estar no real) ---
    await c.query(`grant select on public.records to anon;`);

    // --- 5. Inserir dados sintéticos ---
    const J = (obj) => JSON.stringify(obj);
    const insertRows = [
      ['au_admin', 'AuthUser', J({ id: 'admin_uid_real', email: 'admin@ruy.test', full_name: 'Admin Ruy', role: 'admin', status: 'ativo', owner_id: 'admin_uid_real' })],
      ['au_user1', 'AuthUser', J({ id: 'user_uid_real', email: 'user@ruy.test', full_name: 'User Comum', role: 'user', status: 'ativo', owner_id: 'user_uid_real' })],
      ['emp_1', 'Employee', J({ id: 'emp_1', name: 'Joao Silva', status: 'ativo', owner_id: 'admin_uid_real' })],
      ['emp_2', 'Employee', J({ id: 'emp_2', name: 'Maria Souza', status: 'ativo', owner_id: 'user_uid_real' })],
      ['fe_1', 'FinancialExpense', J({ id: 'fe_1', description: 'Despesa sigilosa', amount: 5000, status: 'pago', owner_id: 'admin_uid_real' })],
    ];
    for (const [id, entity, data] of insertRows) {
      await c.query(`insert into public.records (id, entity, data, created_date, updated_date) values ($1, $2, $3, now(), now())`, [id, entity, data]);
    }

    // ================================================================
    // ESTADO ANTES DA CORREÇÃO: verificar que anon consegue acessar
    // ================================================================
    console.log('\n--- ESTADO ANTES DA CORREÇÃO (anon full access ativa) ---');
    await c.query(`set role anon;`);

    const antes_select = await c.query(`select count(*) as n from public.records`);
    check('ANTES: anon consegue ler registros (vulnerabilidade)', antes_select.rows[0].n > 0, true);

    try {
      await c.query(`insert into public.records (id, entity, data, created_date, updated_date) values ($1, 'Employee', $2, now(), now())`, ['anon_invasao', J({ name: 'Invasor', owner_id: 'anon' })]);
      check('ANTES: anon consegue inserir (vulnerabilidade)', true, true);
      // Limpar a invasão de teste
      await c.query(`delete from public.records where id = 'anon_invasao'`);
    } catch {
      check('ANTES: anon consegue inserir (vulnerabilidade)', true, false);
    }

    await c.query(`reset role;`);

    // ================================================================
    // APLICAR CORREÇÃO MÍNIMA
    // ================================================================
    console.log('\n--- APLICANDO CORREÇÃO MÍNIMA ---');

    // Revogar privilégios de anon
    await c.query(`revoke all on table public.records from anon;`);

    // Remover policy de acesso anônimo
    await c.query(`drop policy if exists "anon full access" on public.records;`);

    console.log('Correção aplicada: privilégios de anon revogados e policy removida.');

    // ================================================================
    // ESTADO DEPOIS DA CORREÇÃO: verificar que anon NÃO consegue acessar
    // ================================================================
    console.log('\n--- ESTADO DEPOIS DA CORREÇÃO (anon bloqueado) ---');

    // Teste de SELECT como anon
    try {
      const depois_select = await c.query(`select count(*) as n from public.records`);
      check('DEPOIS: anon NÃO consegue ler registros', 0, depois_select.rows[0].n);
    } catch (e) {
      check('DEPOIS: anon NÃO consegue ler registros (erro de permissão)', 'bloqueado', 'bloqueado');
    }

    // Teste de INSERT como anon
    try {
      await c.query(`insert into public.records (id, entity, data, created_date, updated_date) values ($1, 'Employee', $2, now(), now())`, ['anon_invasao2', J({ name: 'Invasor2', owner_id: 'anon' })]);
      check('DEPOIS: anon NÃO consegue inserir', 'bloqueado', 'inseriu');
    } catch {
      check('DEPOIS: anon NÃO consegue inserir', 'bloqueado', 'bloqueado');
    }

    await c.query(`reset role;`);

    // ================================================================
    // VERIFICAR QUE POLICY ADMINISTRATIVA FOI PRESERVADA
    // ================================================================
    console.log('\n--- VERIFICANDO POLICY ADMINISTRATIVA PRESERVADA ---');

    const policies = await c.query(`select policyname from pg_policies where schemaname = 'public' and tablename = 'records' order by policyname`);
    const policyNames = policies.rows.map(r => r.policyname);
    console.log('Policies restantes:', policyNames);

    check('Policy "ruy_records_pilot_admin" preservada', true, policyNames.includes('ruy_records_pilot_admin'));
    check('Policy "anon full access" removida', false, policyNames.includes('anon full access'));

    // ================================================================
    // VERIFICAR QUE RLS PERMANECE HABILITADO
    // ================================================================
    const rls = await c.query(`select relrowsecurity as rls_habilitado, relforcerowsecurity as rls_forcado from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'records'`);
    check('RLS permanece habilitado', true, rls.rows[0].rls_habilitado === true);
    console.log('  RLS habilitado:', rls.rows[0].rls_habilitado, '| Forçado:', rls.rows[0].rls_forcado);

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
