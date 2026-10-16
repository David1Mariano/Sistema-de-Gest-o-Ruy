-- ===========================================================================
-- PROPOSTA DE CORREÇÃO MÍNIMA v2 — Segurança da tabela public.records
-- Supabase Pro: wvcvveqdkecsoygtilop
--
-- STATUS: PARA REVISÃO. NÃO EXECUTAR no banco operacional sem aprovação.
-- Execute primeiro no SQL Editor do Supabase apenas os blocos de PRÉ-CHECK.
--
-- CORREÇÕES em relação à v1:
--  A. Mantém grant mínimo de SELECT para 'authenticated' (não revoga tudo)
--  B. Remove policies existentes antes de criar as novas
--  C. Adiciona pré-check de cobertura do campo 'owner_id'
--  D. Nota explícita: Storage requer correção separada
--
-- OBJETIVO: eliminar acesso anônimo indevido à tabela records, preservando
-- login, cadastros e operações legítimas do Sistema Ruy.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 1: verificar se RLS já está habilitado em public.records
-- ---------------------------------------------------------------------------
select relrowsecurity as rls_ja_habilitado,
       relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'records';

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 2: listar policies existentes em public.records
-- (qualquer policy listada aqui deve ser removida antes de criar as novas)
-- ---------------------------------------------------------------------------
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'records'
order by policyname;

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 3: grants explícitos em public.records para anon/authenticated
-- ---------------------------------------------------------------------------
select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where n.nspname = 'public' and c.relname = 'records'
order by grantee, a.privilege_type;

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 4 (NOVO): cobertura do campo 'owner_id' nos registros
-- Se alguma entidade tem muitos registros sem owner_id, revisar antes de aplicar.
-- ---------------------------------------------------------------------------
select entity, count(*) as total,
       count(*) filter (where data ? 'owner_id') as com_owner_id,
       count(*) filter (where data ? 'status') as com_status
from public.records
group by entity
order by entity;

-- ---------------------------------------------------------------------------
-- CORREÇÃO MÍNIMA — aplicar somente após aprovação e pré-check
-- ---------------------------------------------------------------------------

-- 1) Habilitar RLS (forçado, para não haver bypass por owner da tabela)
alter table public.records enable row level security;
alter table public.records force row level security;

-- 2) Revogar grants diretos: manter apenas SELECT mínimo para authenticated
--    (PostgREST precisa de privilégio mínimo de leitura na tabela)
revoke all on table public.records from public;
revoke all on table public.records from anon;
grant select on table public.records to authenticated;
revoke insert, update, delete on table public.records from authenticated;

-- 3) Remover TODAS as policies existentes em public.records antes de criar
--    (evita que policies permissivas antigas mantenham acesso aberto via OR)
drop policy if exists "ruy_records_select_owner" on public.records;
drop policy if exists "ruy_records_select_admin" on public.records;
drop policy if exists "ruy_records_write_admin" on public.records;
drop policy if exists "ruy_records_write_owner" on public.records;
-- Se o PRÉ-CHECK 2 listou outras policies, removê-las explicitamente aqui.

-- 4) Policy de leitura: usuário comum vê apenas seus próprios registros
--    (owner_id = legacy_auth_user_id) ou seu próprio perfil AuthUser
create policy "ruy_records_select_owner"
on public.records for select
to authenticated
using (
  coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb ->> 'legacy_auth_user_id' <> ''
  and (
    (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
    or (entity = 'AuthUser' and data->>'id' = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id')
  )
);

-- 5) Policy de leitura: admin/super_admin vê todos os registros
create policy "ruy_records_select_admin"
on public.records for select
to authenticated
using (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
);

-- 6) Policy de escrita: admin/super_admin pode inserir/atualizar/deletar tudo
create policy "ruy_records_write_admin"
on public.records for all
to authenticated
using (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
)
with check (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
);

-- 7) Policy de escrita: usuário comum escreve apenas registros onde é o owner
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
);

-- 8) Não há policy para o papel 'anon': qualquer consulta sem JWT válida
--    é negada por todas as políticas (que só aplicam a 'authenticated').

-- ---------------------------------------------------------------------------
-- VALIDAÇÃO PÓS-APLICAÇÃO (consultas de leitura, sem modificar dados)
-- ---------------------------------------------------------------------------

-- Confirmar RLS ativo:
select relrowsecurity, relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'records';

-- Listar policies aplicadas:
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'records'
order by policyname;

-- Confirmar que anon não tem privilégios na tabela:
select grantee, privilege_type
from (
  select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
         a.privilege_type
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public' and c.relname = 'records'
) s
where grantee in ('PUBLIC','anon','authenticated')
order by grantee, privilege_type;

-- ===========================================================================
-- NOTAS DE IMPLEMENTAÇÃO
-- ===========================================================================
-- 1. As policies usam `current_setting('request.jwt.claims', true)` que no
--    Supabase contém o decoded JWT (incluindo app_metadata). Padrão PostgREST.
--
-- 2. O `authAdapter.js` já exige `legacy_auth_user_id` e `system_role` no
--    app_metadata antes de permitir qualquer operação. Usuários sem esses
--    claims são rejeitados no próprio aplicativo (HTTP 403).
--
-- 3. GAP CONHECIDO: usuários inativos (status inativo/bloqueado) continuam
--    podendo ler seus próprios registros via RLS. O bloqueio de inativos é
--    feito apenas no frontend (authAdapter.js). Para defense in depth,
--    adicionar condição de status nas policies seria desejável, mas exige que
--    TODOS os registros tenham o campo 'status' (não confirmado).
--
-- 4. GAP CONHECIDO: Storage (bucket 'anexos') não é coberto por este SQL.
--    Requer correção separada com políticas de storage.objects.
--
-- 5. Este SQL não altera: auth.users, grants do Storage, buckets,
--    funções SECURITY DEFINER, ou outras tabelas.
--
-- 6. `FORCE ROW LEVEL SECURITY` afeta também o owner da tabela (postgres).
--    Scripts de administração direta como owner ficarão sujeitos a RLS.
-- ===========================================================================
