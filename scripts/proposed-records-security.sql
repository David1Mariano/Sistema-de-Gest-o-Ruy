-- ===========================================================================
-- PROPOSTA DE CORREÇÃO MÍNIMA — Segurança da tabela public.records
-- Supabase Pro: wvcvveqdkecsoygtilop
--
-- STATUS: PARA REVISÃO. NÃO EXECUTAR no banco operacional sem aprovação.
-- Execute primeiro no SQL Editor do Supabase apenas os blocos de PRÉ-CHECK.
--
-- OBJETIVO: eliminar acesso anônimo indevido à tabela records, preservando
-- login, cadastros e operações legítimas do Sistema Ruy.
--
-- MODELO DE AUTORIZAÇÃO (conforme authAdapter.js):
--   - app_metadata.legacy_auth_user_id: ID legado do perfil no records
--   - app_metadata.system_role: 'admin' | 'super_admin' | 'user'
--   - app_metadata.employee_payment_access: true (para financeiro)
--   - Usuário vê apenas registros com data->>'owner_id' = seu legacy_auth_user_id
--   - Admin/super_admin vê e escreve todos os registros
--   - Usuário comum escreve apenas registros onde é o owner
--   - Anônimo (sem JWT claims válidos) não lê nem escreve nada
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 1: verificar se RLS já está habilitado em public.records
-- (se retornar 0, RLS não está habilitado e deve ser ativado)
-- ---------------------------------------------------------------------------
select relrowsecurity as rls_ja_habilitado,
       relforcerowsecurity as force_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'records';

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 2: listar policies existentes em public.records
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
-- CORREÇÃO MÍNIMA — aplicar somente após aprovação e pré-check
-- ---------------------------------------------------------------------------

-- 1) Habilitar RLS (forçado, para não haver bypass por owner da tabela)
alter table public.records enable row level security;
alter table public.records force row level security;

-- 2) Revogar grants diretos em public.records para papéis públicos
revoke all on table public.records from public;
revoke all on table public.records from anon;
revoke all on table public.records from authenticated;

-- 3) Policy de leitura: usuário comum vê apenas seus próprios registros
--    (owner_id = legacy_auth_user_id) ou seu próprio perfil AuthUser
create policy if not exists "ruy_records_select_owner"
on public.records for select
to authenticated
using (
  coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb ->> 'legacy_auth_user_id' <> ''
  and (
    (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
    or (entity = 'AuthUser' and data->>'id' = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id')
  )
);

-- 4) Policy de leitura: admin/super_admin vê todos os registros
create policy if not exists "ruy_records_select_admin"
on public.records for select
to authenticated
using (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
);

-- 5) Policy de escrita: admin/super_admin pode inserir/atualizar/deletar tudo
create policy if not exists "ruy_records_write_admin"
on public.records for all
to authenticated
using (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
)
with check (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
);

-- 6) Policy de escrita: usuário comum escreve apenas registros onde é o owner
create policy if not exists "ruy_records_write_owner"
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

-- 7) Não há policy para o papel 'anon': qualquer consulta sem JWT válida
--    é negada por todas as policies (que só aplicam a 'authenticated').

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
--    Supabase contém o decoded JWT (incluindo app_metadata). Isso é padrão
--    do PostgREST e não requer funções adicionais.
--
-- 2. O `authAdapter.js` já exige `legacy_auth_user_id` e `system_role` no
--    app_metadata antes de permitir qualquer operação. Usuários sem esses
--    claims são rejeitados no próprio aplicativo (HTTP 403).
--
-- 3. A tabela `records` armazena todas as entidades (Employee,
--    FinancialExpense, etc.) com o campo `data->>'owner_id'` indicando o
--    proprietário. O isolamento é por owner_id, não por organização
--    (não há multi-tenant no app, conforme auditoria da migration de estoque).
--
-- 4. Não há concessão de grant para o papel `anon`. Como o PostgREST
--    usa o papel `anon` para requisições sem JWT, essas são negadas.
--
-- 5. Usuários desligados/bloqueados (status inativo/bloqueado) continuam
--    podendo ler seus próprios registros via RLS, mas o authAdapter.js
--    bloqueia o acesso no aplicativo (HTTP 403) antes de qualquer consulta
--    de dados. Isso preserva o login enquanto impede operações.
--
-- 6. Este SQL não altera: auth.users, grants do Storage, buckets,
--    funções SECURITY DEFINER, ou outras tabelas. Esses itens exigem
--    auditoria separada.
-- ===========================================================================
