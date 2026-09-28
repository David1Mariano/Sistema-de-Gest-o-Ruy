-- Somente leitura. Executar no SQL Editor do projeto wvcvveqdkecsoygtilop.
-- Não cria buckets, usuários ou policies; não acessa dados financeiros.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'anexos';

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename in ('buckets', 'objects')
order by tablename, policyname;
