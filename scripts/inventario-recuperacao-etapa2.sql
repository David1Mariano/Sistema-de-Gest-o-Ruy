-- ============================================================================
-- INVENTARIO DE RECUPERACAO — ETAPA 2 de 3 (somente leitura)
-- Projeto Supabase: wvcvveqdkecsoygtilop. Executar no SQL Editor (New query).
--
-- OBJETIVO: verificar tabelas social_*, perfil do AuthUser (sem credenciais)
-- e disponibilidade dos anexos no Storage (bucket anexos).
--
-- SEGURANCA: transacao READ ONLY. NAO seleciona a coluna `data` completa de
-- AuthUser, NAO consulta auth.users por e-mail/senha, NAO exporta hashes.
-- Nao modifica nada. Pode ser abortada com Rollback sem efeito colateral.
-- Prefixos de path do Storage NUNCA saem em texto puro (C5 agrega por classe;
-- C5b expoe apenas md5 com sal fixo).
--
-- Apos executar: copie TODAS as abas de resultado E a aba "Messages" e envie.
-- ============================================================================

begin transaction read only;

-- ---------------------------------------------------------------------------
-- PARTE A — Tabelas social_* existentes no schema public
-- ---------------------------------------------------------------------------

-- A1) Descoberta generica (pega QUALQUER tabela social_*)
select table_name as tabela_social
from information_schema.tables
where table_schema = 'public' and table_name like 'social\_%'
order by table_name;

-- A2) Existencia das tabelas do schema proposto (to_regclass nao falha se ausente)
select 'social_accounts' as tabela, to_regclass('public.social_accounts') is not null as existe union all
select 'social_comments',        to_regclass('public.social_comments') is not null union all
select 'social_ai_drafts',       to_regclass('public.social_ai_drafts') is not null union all
select 'social_replies',         to_regclass('public.social_replies') is not null union all
select 'social_metrics',         to_regclass('public.social_metrics') is not null union all
select 'social_events',          to_regclass('public.social_events') is not null union all
select 'social_account_access',  to_regclass('public.social_account_access') is not null
order by 1;

-- A3) Panorama ESTIMADO — estatico, sem SQL dinamico. Usa o catalogo pg_class
--     (reltuples = estimativa do analyze; null se nunca analisada). Serve para
--     descobrir rapido o que existe; contagem exata esta no A4.
select c.relname as tabela_social,
       case when c.reltuples < 0 then null else c.reltuples::bigint end as linhas_estimadas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname like 'social\_%'
order by 1;

-- A4) Contagem EXATA — UNICO trecho do script com SQL dinamico, necessario
--     porque as tabelas do schema social_* podem nao existir (um count(*)
--     estatico abortaria a transacao inteira). O loop executa somente "count(*)"
--     sobre tabelas descobertas pelo information_schema (BASE TABLE apenas);
--     em transacao READ ONLY qualquer escrita seria bloqueada pelo Postgres.
--     Os totais aparecem na aba "Messages" como NOTICE (uma linha por tabela).
do $$
declare t text; n bigint;
begin
  for t in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name like 'social\_%'
      and table_type = 'BASE TABLE'
    order by table_name
  loop
    execute format('select count(*) from public.%I', t) into n;
    raise notice 'social: % -> % linhas', t, n;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PARTE B — AuthUser (APENAS metadados; nenhum valor sensivel)
-- ---------------------------------------------------------------------------

-- B1) Contagem de espelhos AuthUser em records
select count(*) as authuser_total
from public.records where entity = 'AuthUser';

-- B2) Chaves do JSONB — APENAS os NOMES das chaves, nunca os valores.
--     Se existir chave de senha/hash, ela aparece aqui somente como NOME.
select distinct k as chave_jsonb
from public.records r lateral jsonb_object_keys(r.data) k
where r.entity = 'AuthUser'
order by 1;

-- B3) Perfil nao sensivel (papel e status)
select data->>'role' as role, data->>'status' as status, count(*) as linhas
from public.records where entity = 'AuthUser'
group by 1, 2 order by 1, 2;

-- B4) Supabase Auth: apenas quantidade e faixa de criacao (metadados)
select count(*) as auth_users_total,
       min(created_at) as mais_antigo,
       max(created_at) as mais_recente
from auth.users;

-- ---------------------------------------------------------------------------
-- PARTE C — Storage: bucket anexos e disponibilidade dos arquivos
-- ---------------------------------------------------------------------------

-- C1) Estrutura de storage.objects (defensivo: confirma colunas antes de consultar)
select column_name, data_type
from information_schema.columns
where table_schema = 'storage' and table_name = 'objects'
order by ordinal_position;

-- C2) Bucket anexos (deve confirmar public=false, 15728640, JPEG/PNG/WEBP/PDF)
select id, name, public, file_size_limit, allowed_mime_types, created_at
from storage.buckets where id = 'anexos';

-- C3) Todos os buckets (para saber se ha outro de interesse)
select id, name, public from storage.buckets order by id;

-- C4) Objetos do bucket anexos: existem ainda? Quantos? Tamanho?
--     Defensivo: size so e convertido quando for digitos puros; ausente ou
--     invalido vira size_invalido em vez de derrubar a consulta com erro de
--     conversao para bigint.
select count(*) as objetos_total,
       sum(case when (metadata->>'size') ~ '^[0-9]+$'
                then (metadata->>'size')::bigint end) as bytes_total,
       min(created_at) as mais_antigo,
       max(created_at) as mais_recente,
       count(*) filter (where coalesce(metadata->>'size', '') = '0') as objetos_vazios,
       count(*) filter (where metadata->>'size' is null
                          or (metadata->>'size') !~ '^[0-9]+$') as size_invalido
from storage.objects where bucket_id = 'anexos';

-- C5) Quebra por CLASSE do prefixo raiz do path (agregacao segura).
--     O prefixo original NUNCA e retornado: pode conter nome, e-mail ou
--     identificador pessoal. Aqui ele so vira uma classe descritiva.
select case
         when prefixo = '' then 'sem_prefixo'
         when prefixo ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then 'uuid'
         when prefixo like '%@%' then 'possivel_email'
         when prefixo ~ '^[0-9]+$' then 'somente_digitos'
         when lower(prefixo) in ('employeepayment','consumption','absence','warning',
                                 'vale','jobrole','employee','sector','inventoryitem',
                                 'stockmovement','comprovante','comprovantes','anexo',
                                 'anexos','documento','documentos','doc','docs','file',
                                 'files','arquivo','arquivos','upload','uploads','imagem',
                                 'imagens','foto','fotos','recibo','recibos','receipt',
                                 'receipts')
           then 'categoria_conhecida'
         else 'outro_nao_identificado'
       end as classe_prefixo,
       count(*) as arquivos,
       sum(case when (metadata->>'size') ~ '^[0-9]+$'
                then (metadata->>'size')::bigint end) as bytes,
       count(*) filter (where metadata->>'size' is null
                          or (metadata->>'size') !~ '^[0-9]+$') as size_invalido
from (select split_part(name, '/', 1) as prefixo, metadata
      from storage.objects where bucket_id = 'anexos') s
group by 1 order by 2 desc, 1;

-- C5b) Identificador NAO REVERSIVEL por prefixo: md5 com sal fixo. Permite
--      correlacionar origem x staging no futuro sem expor o texto do prefixo.
--      Nota: para prefixos de baixa entropia (ex.: nomes de entity) o md5 so
--      permite confirmar um palpite ja conhecido — nao revela PII novo.
select md5('ruy-anexos-2026:' || split_part(name, '/', 1)) as prefixo_md5,
       count(*) as arquivos,
       sum(case when (metadata->>'size') ~ '^[0-9]+$'
                then (metadata->>'size')::bigint end) as bytes
from storage.objects where bucket_id = 'anexos'
group by 1 order by 1;

-- C6) Tipos de arquivo presentes
select metadata->>'mimetype' as mimetype, count(*) as arquivos
from storage.objects
where bucket_id = 'anexos' and metadata ? 'mimetype'
group by 1 order by 2 desc, 1;

commit;
