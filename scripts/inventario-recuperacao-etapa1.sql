-- ============================================================================
-- INVENTARIO DE RECUPERACAO — ETAPA 1 de 3 (somente leitura)
-- Projeto Supabase: wvcvveqdkecsoygtilop. Executar no SQL Editor (New query).
--
-- OBJETIVO: descobrir quantos registros historicos existem em public.records,
-- quais entidades possuem dados e qual a faixa de datas de cada uma.
--
-- SEGURANCA: transacao READ ONLY — nao modifica dados, grants, policies nem
-- schema. Nao consulta senhas nem hashes. Pode ser abortada com Rollback a
-- qualquer momento sem efeito colateral.
--
-- Apos executar: copie TODAS as tabelas de resultado (abas de baixo) e envie
-- na conversa. Nenhuma senha ou chave e necessaria para isto.
-- ============================================================================

begin transaction read only;

-- 1) Contexto da execucao (confirma que roda no projeto/rol corretos)
select current_database() as database,
       current_user as usuario,
       version() as postgres_version,
       now() as executed_at;

-- 2) Estrutura fisica de public.records (colunas e tipos)
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'records'
order by ordinal_position;

-- 3) TOTAL de linhas em public.records (o numero-âncora da recuperacao)
select count(*) as total_records
from public.records;

-- 4) CONTAGEM por entity + faixa de datas
--    (responde "quais entidades tem dados" e "de quando e o historico")
select entity,
       count(*) as linhas,
       min(created_date) as mais_antigo,
       max(created_date) as mais_recente
from public.records
group by entity
order by entity;

-- 5) Linhas sem entity definida (integridade: tudo deve estar amarrado a uma entity)
select count(*) as linhas_sem_entity
from public.records
where entity is null or entity = '';

commit;
