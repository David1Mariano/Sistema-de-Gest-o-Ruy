-- ============================================================================
-- RECUPERACAO — 02/04: schema + tabela de estagio no banco LOCAL gestao_ruy_staging
-- NAO EXECUTAR SEM AUTORIZACAO. Conectar no banco de staging e rodar este arquivo.
-- Nenhum DROP: seguro para banco recem-criado; reexecutavel (IF NOT EXISTS).
--
-- Colunas TEXT de proposito: preservam EXATAMENTE o que veio no CSV, sem cast.
-- Casteamos para uuid/jsonb/timestamp so na validacao (04) e na promocao futura.
-- ============================================================================

begin;

create schema if not exists recuperacao;

create table if not exists recuperacao.records_stage (
  entity       text,
  id           text,
  data         text,
  created_date text,
  updated_date text
);

create index if not exists records_stage_entity_idx on recuperacao.records_stage (entity);
create index if not exists records_stage_id_idx     on recuperacao.records_stage (id);

commit;
