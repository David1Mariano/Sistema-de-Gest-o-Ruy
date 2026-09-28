-- EXECUTAR MANUALMENTE no SQL Editor de wvcvveqdkecsoygtilop.
-- SOMENTE LEITURA: não consulta senhas, não modifica dados/grants/policies.
begin transaction read only;

select current_database(), current_user, now() as inspected_at;

select n.nspname as schema_name, c.relname, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as force_rls, pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'records';

select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'records'
order by policyname;

-- ACL explícita, incluindo PUBLIC (pode conceder acesso aos dois papéis).
select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type, a.is_grantable, pg_get_userbyid(a.grantor) as grantor
from pg_class c join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
where n.nspname = 'public' and c.relname = 'records'
order by grantee, privilege_type;

-- Privilégios efetivos: incluem grants herdados. Não equivalem à aprovação RLS.
select r.rolname, r.rolinherit, r.rolbypassrls,
       has_schema_privilege(r.oid, 'public', 'USAGE') as schema_usage,
       has_table_privilege(r.oid, 'public.records', 'SELECT') as can_select,
       has_table_privilege(r.oid, 'public.records', 'INSERT') as can_insert,
       has_table_privilege(r.oid, 'public.records', 'UPDATE') as can_update,
       has_table_privilege(r.oid, 'public.records', 'DELETE') as can_delete,
       has_table_privilege(r.oid, 'public.records', 'TRUNCATE') as can_truncate
from pg_roles r where r.rolname in ('anon', 'authenticated');

select r.rolname, a.attname,
       has_column_privilege(r.oid, c.oid, a.attnum, 'SELECT') as can_select,
       has_column_privilege(r.oid, c.oid, a.attnum, 'INSERT') as can_insert,
       has_column_privilege(r.oid, c.oid, a.attnum, 'UPDATE') as can_update
from pg_roles r cross join pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where r.rolname in ('anon', 'authenticated')
  and n.nspname = 'public' and c.relname = 'records'
order by r.rolname, a.attnum;

-- Inventário administrativo: somente os campos autorizados, nunca SELECT data.
select id as row_id, data->>'id' as authuser_id, data->>'email' as email,
       data->>'full_name' as full_name, data->>'role' as role, data->>'status' as status
from public.records where entity = 'AuthUser' order by id;

select count(*) as authuser_total,
       count(distinct lower(trim(data->>'email'))) as distinct_emails
from public.records where entity = 'AuthUser';

-- Confirmação das informações administrativas já fornecidas pelo proprietário.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'anexos';
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'storage' and tablename in ('objects', 'buckets')
order by tablename, policyname;

commit;
