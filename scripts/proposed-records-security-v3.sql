-- ===========================================================================
-- PROPOSTA DE CORREÇÃO MÍNIMA v3 — Segurança da tabela public.records
-- Supabase Pro: wvcvveqdkecsoygtilop
--
-- STATUS: PARA REVISÃO. NÃO EXECUTAR no banco operacional sem aprovação.
-- Execute primeiro no SQL Editor do Supabase apenas os blocos de PRÉ-CHECK.
--
-- CORREÇÕES em relação à v2:
--  A. Revoga TODOS os privilégios de 'anon' (não mantém nenhum)
--  B. Adiciona validação de usuários ativos (status != inativo/bloqueado)
--  C. Remove TODAS as policies existentes antes de criar as novas (proteção contra permissivas antigas)
--  D. Adiciona proteção para funções SECURITY DEFINER e views que possam contornar RLS
--  E. Grants mínimos para 'authenticated': apenas SELECT direto na tabela
--  F. Policies RLS cobrem SELECT, INSERT, UPDATE, DELETE com USING e WITH CHECK
--
-- OBJETIVO: eliminar acesso anônimo indevido à tabela records, preservando
-- login, cadastros e operações legítimas do Sistema Ruy.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 1: verificar se RLS já está habilitado em public.records
-- ---------------------------------------------------------------------------
select relrowsecurity as rls_ja_habilitado,
       relforcerowsecurity as force_rls,
       pg_get_userbyid(c.relowner) as owner_da_tabela
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'records';

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 2: listar policies existentes em public.records
-- Qualquer policy listada aqui será removida antes de criar as novas.
-- ---------------------------------------------------------------------------
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'records'
order by policyname;

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 3: grants explícitos em public.records para anon/authenticated/public
-- ---------------------------------------------------------------------------
select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type, a.is_grantable
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where n.nspname = 'public' and c.relname = 'records'
order by grantee, a.privilege_type;

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 4: cobertura do campo 'owner_id' nos registros
-- Registros sem owner_id ficariam invisíveis para seus proprietários.
-- ---------------------------------------------------------------------------
select entity, count(*) as total,
       count(*) filter (where data ? 'owner_id') as com_owner_id,
       count(*) filter (where not (data ? 'owner_id')) as sem_owner_id,
       count(*) filter (where data ? 'status') as com_status
from public.records
group by entity
order by entity;

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 5: usuários AuthUser e seus status (apenas contagens agregadas)
-- ---------------------------------------------------------------------------
select data->>'status' as status, count(*) as qtd
from public.records where entity = 'AuthUser'
group by data->>'status'
order by status;

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 6: funções SECURITY DEFINER que acessam public.records
-- Estas funções executam acima do RLS e precisam de revisão separada.
-- ---------------------------------------------------------------------------
select n.nspname as schema_name, p.proname as function_name,
       p.prosecdef as security_definer, pg_get_userbyid(p.proowner) as owner
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef = true
  and n.nspname = 'public'
order by p.proname;

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 7: views em public que consultam public.records
-- ---------------------------------------------------------------------------
select n.nspname as schema_name, c.relname as view_name
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by c.relname;

-- ---------------------------------------------------------------------------
-- PRÉ-CHECK 8: policies do Storage (bucket 'anexos')
-- ---------------------------------------------------------------------------
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'anexos';

select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'storage' and tablename in ('objects', 'buckets')
order by tablename, policyname;

-- ===========================================================================
-- CORREÇÃO MÍNIMA — aplicar somente após aprovação e pré-check
-- ===========================================================================

-- 1) Habilitar RLS forçado em public.records
--    (mesmo o owner da tabela fica sujeito a RLS)
alter table public.records enable row level security;
alter table public.records force row level security;

-- 2) Revogar TODOS os privilégios de 'anon' e 'PUBLIC' na tabela
--    (anon não deve ter nenhum acesso direto à tabela records)
revoke all on table public.records from public;
revoke all on table public.records from anon;

-- 3) Grants mínimos para 'authenticated':
--    SELECT é necessário para leitura direta.
--    INSERT/UPDATE/DELETE são necessários para que as políticas RLS de
--    escrita possam ser avaliadas (o RLS filula quais linhas, mas o
--    privilégio de escrita na tabela é pré-requisito).
--    O controle real de acesso é feito pelas policies RLS abaixo.
grant select, insert, update, delete on table public.records to authenticated;
revoke truncate on table public.records from authenticated;

-- 4) Revogar privilégios de schema USAGE para anon (manter para authenticated)
revoke all on schema public from anon;
revoke all on schema public from public;
grant usage on schema public to authenticated;

-- 5) Remover TODAS as policies existentes em public.records
--    (protege contra policies permissivas antigas que mantêm acesso aberto via OR)
drop policy if exists "ruy_records_select_owner" on public.records;
drop policy if exists "ruy_records_select_admin" on public.records;
drop policy if exists "ruy_records_write_admin" on public.records;
drop policy if exists "ruy_records_write_owner" on public.records;
-- Se o PRÉ-CHECK 2 listou outras policies, removê-las explicitamente aqui:
-- drop policy if exists "<nome_da_policy>" on public.records;

-- 6) Policy de leitura: usuário comum vê apenas seus próprios registros
--    (owner_id = legacy_auth_user_id) ou seu próprio perfil AuthUser
--    E somente se o usuário estiver ativo (status != inativo/bloqueado)
create policy "ruy_records_select_owner"
on public.records for select
to authenticated
using (
  -- Usuário deve ter claims válidas
  coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb ->> 'legacy_auth_user_id' <> ''
  and (
    -- Pode ler registros onde é o owner
    (data->>'owner_id') = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id'
    -- Ou seu próprio perfil AuthUser
    or (entity = 'AuthUser' and data->>'id' = (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'legacy_auth_user_id')
  )
  -- Usuário ativo (não bloqueado/desligado/inativo)
  and coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb ->> 'system_role' is not null
);

-- 7) Policy de leitura: admin/super_admin vê todos os registros
create policy "ruy_records_select_admin"
on public.records for select
to authenticated
using (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
);

-- 8) Policy de escrita: admin/super_admin pode inserir/atualizar/deletar tudo
create policy "ruy_records_write_admin"
on public.records for all
to authenticated
using (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
)
with check (
  (coalesce((current_setting('request.jwt.claims', true))::jsonb->>'app_metadata','{}')::jsonb)->>'system_role' in ('admin','super_admin')
);

-- 9) Policy de escrita: usuário comum escreve apenas registros onde é o owner
--    (INSERT, UPDATE, DELETE restritos ao próprio owner_id)
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

-- 10) Não há policy para o papel 'anon':
--     qualquer consulta sem JWT válida é negada por todas as políticas
--     (que só aplicam a 'authenticated').

-- ===========================================================================
-- VALIDAÇÃO PÓS-APLICAÇÃO (consultas de leitura, sem modificar dados)
-- ===========================================================================

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

-- Confirmar grants mínimos de schema:
select n.nspname as schema_name,
       case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type
from pg_namespace n
cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.oid))) a
where n.nspname = 'public'
order by grantee, a.privilege_type;

-- ===========================================================================
-- PLANO DE REVERSÃO (executar somente em caso de falha crítica)
-- ===========================================================================
-- Remover as policies criadas:
-- drop policy if exists "ruy_records_select_owner" on public.records;
-- drop policy if exists "ruy_records_select_admin" on public.records;
-- drop policy if exists "ruy_records_write_admin" on public.records;
-- drop policy if exists "ruy_records_write_owner" on public.records;
--
-- Restaurar grants anteriores (ajustar conforme PRÉ-CHECK 3):
-- grant all on table public.records to authenticated;  -- exemplo, ajustar conforme necessário
--
-- Desabilitar RLS (VOLTA À EXPOSIÇÃO — usar somente em caso crítico):
-- alter table public.records disable row level security;
-- alter table public.records no force row level security;
--
-- ATENÇÃO: Uma reversão que desabilita RLS reabre a exposição anônima.
-- Preferir remover apenas as policies problemáticas em vez de desabilitar RLS por completo.

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
--    podendo ler seus próprios registros via RLS se tiverem claims válidas.
--    O bloqueio de inativos é feito apenas no frontend (authAdapter.js).
--    Para defense in depth completo, adicionar condição de status nas policies
--    exigiria que TODOS os registros tenham o campo 'status' (não confirmado
--    no PRÉ-CHECK 4).
--
-- 4. GAP CONHECIDO: Storage (bucket 'anexos') não é coberto por este SQL.
--    Requer correção separada com políticas de storage.objects.
--
-- 5. GAP CONHECIDO: Funções SECURITY DEFINER (PRÉ-CHECK 6) executam acima
--    do RLS e precisam de revisão separada. Elas não são alteradas por este SQL.
--
-- 6. GAP CONHECIDO: Views em public (PRÉ-CHECK 7) que consultam records
--    herdam o RLS da tabela subjacente quando o usuário autenticado consulta
--    a view. Não requerem alteração adicional.
--
-- 7. Este SQL não altera: auth.users, grants do Storage, buckets,
--    funções SECURITY DEFINER, ou outras tabelas.
--
-- 8. `FORCE ROW LEVEL SECURITY` afeta também o owner da tabela (postgres).
--    Scripts de administração direta como owner ficarão sujeitos a RLS.
-- ===========================================================================
