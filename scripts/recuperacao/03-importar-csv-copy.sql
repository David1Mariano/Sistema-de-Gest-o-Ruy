-- ============================================================================
-- RECUPERACAO — 03/04: importar o CSV exportado no staging LOCAL
-- NAO EXECUTAR SEM AUTORIZACAO. Este arquivo roda via psql (contem \copy).
-- A senha e digitada por VOCÊ no terminal (PGPASSWORD/prompt), nunca aqui.
--
--   psql -U postgres -d gestao_ruy_staging -f 03-importar-csv-copy.sql
--
-- AJUSTE o caminho do CSV abaixo antes de rodar. O CSV e a fonte de verdade.
-- Espera-se cabecalho: entity,id,data,created_date,updated_date
-- (se o cabecalho do CSV exportado tiver outras colunas, avise antes de rodar)
-- ============================================================================

\copy recuperacao.records_stage (entity, id, data, created_date, updated_date) from 'C:\Users\Pichau\gestao-ruy-agente-5\backups_recuperacao\supabase-2026-10-13\records.csv' with (format csv, header true, encoding 'UTF8')

-- Contagem rapida pos-importacao (esperado: 1067):
select count(*) as linhas_importadas from recuperacao.records_stage;
