-- ===========================================================================
-- CORREÇÃO MÍNIMA EMERGENCIAL — Exposição anônima em public.records
-- Supabase Pro: wvcvveqdkecsoygtilop
--
-- STATUS: PARA REVISÃO. NÃO EXECUTAR no banco operacional sem aprovação explícita.
--
-- OBJETIVO: remover o acesso anônimo indevido à tabela public.records
-- (policy "anon full access": ALL com USING true e WITH CHECK true),
-- preservando a policy administrativa existente e o funcionamento do sistema.
--
-- NÃO desativa RLS. NÃO cria permissões amplas para authenticated.
-- NÃO modifica auth.users, Storage, ou outras tabelas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK: confirmar o estado atual antes de aplicar
-- ---------------------------------------------------------------------------

-- 1. Confirmar RLS habilitado na tabela
select relrowsecurity as rls_habilitado,
       relforcerowsecurity as rls_forcado,
       pg_get_userbyid(c.relowner) as proprietario
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'records';

-- 2. Listar policies existentes (deve mostrar "anon full access" e "ruy_records_pilot_admin")
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'records'
order by policyname;

-- 3. Confirmar privilégios de anon na tabela
select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where n.nspname = 'public' and c.relname = 'records'
order by grantee, a.privilege_type;

-- ---------------------------------------------------------------------------
-- CORREÇÃO MÍNIMA — aplicar somente após aprovação
-- ---------------------------------------------------------------------------

-- 1) Revogar TODOS os privilégios diretos de 'anon' na tabela public.records
--    (anon não deve ter SELECT, INSERT, UPDATE, DELETE nem qualquer privilégio)
revoke all on table public.records from anon;

-- 2) Remover a policy permissiva "anon full access"
--    (esta policy permitia ALL com USING true e WITH CHECK true para qualquer requisição sem JWT)
drop policy if exists "anon full access" on public.records;

-- ---------------------------------------------------------------------------
-- VALIDAÇÃO PÓS-APLICAÇÃO (consultas de leitura, sem modificar dados)
-- ---------------------------------------------------------------------------

-- Confirmar que anon não tem privilégios na tabela
select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where n.nspname = 'public' and c.relname = 'records'
  and (a.grantee = 0 or pg_get_userbyid(a.grantee) = 'anon')
order by grantee, a.privilege_type;

-- Confirmar que a policy "anon full access" foi removida
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'records'
  and policyname = 'anon full access';

-- Confirmar que a policy administrativa foi preservada
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'records'
  and policyname = 'ruy_records_pilot_admin';

-- Confirmar que RLS permanece habilitado
select relrowsecurity as rls_habilitado,
       relforcerowsecurity as rls_forcado
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'records';

-- ---------------------------------------------------------------------------
-- PLANO DE REVERSÃO (executar somente em caso de falha crítica)
-- ---------------------------------------------------------------------------
-- Restaurar a policy de acesso anônimo (VOLTA À EXPOSIÇÃO — usar somente em emergência):
-- create policy "anon full access"
--   on public.records for all
--   to anon
--   using (true)
--   with check (true);
--
-- Restaurar privilégios de anon (ajustar conforme necessário):
-- grant select on table public.records to anon;
--
-- ATENÇÃO: Uma reversão reabre o acesso anônimo à tabela records.
-- Preferir diagnosticar e corrigir o problema específico em vez de reverter totalmente.
-- ===========================================================================
