-- ============================================================================
-- RECUPERACAO — 01/04: criar banco de staging LOCAL (separado do operacional)
-- NAO EXECUTAR SEM AUTORIZACAO. Nao toca em nenhum banco existente.
-- Executar fora de transacao (psql -f ou -c). Requer senha digitada por VOCÊ
-- no seu terminal — nunca em arquivo ou conversa.
--
--   psql -U postgres -c "create database gestao_ruy_staging encoding 'UTF8' template template0"
--
-- O banco criado nao tem relacao com o banco operacional da aplicacao.
-- ============================================================================

create database gestao_ruy_staging
  encoding 'UTF8'
  template template0;
