-- ============================================================================
-- INVENTARIO DE RECUPERACAO — ETAPA 4: EXPORTACAO (somente leitura)
-- Projeto Supabase: wvcvveqdkecsoygtilop. Executar no SQL Editor.
--
-- SEGURANCA: transacao READ ONLY. Nao modifica nada no Supabase.
-- AuthUser e tratado SEPARADAMENTE:
--   * a exportacao principal o EXCLUI (1066 linhas de 1067);
--   * a exportacao do AuthUser REDIGE chaves de credencial/hash do JSON.
-- Nao cole o conteudo das saidas em chat algum — baixe os CSVs direto.
--
-- FLUXO: rode cada query; no painel de resultados clique em "Download CSV"
-- (icone de download) e salve os arquivos nos caminhos indicados abaixo.
-- ============================================================================

begin transaction read only;

-- ---------------------------------------------------------------------------
-- Q1) EXPORTACAO PRINCIPAL — records SEM AuthUser (1066 linhas esperadas)
--     Download CSV -> backups_recuperacao/supabase-2026-10-13/records.csv
-- ---------------------------------------------------------------------------

select entity, id, data, created_date, updated_date
from public.records
where entity <> 'AuthUser'
order by entity, id;

-- Q1b) Checksum do mesmo recorte (insensivel a ordem das linhas)
select count(*) as total_main,
       md5(string_agg(lm, '|' order by lm)) as checksum_main
from (
  select md5(entity || '|' || id::text || '|' || coalesce(data::text,'')
             || '|' || coalesce(created_date::text,'')
             || '|' || coalesce(updated_date::text,'')) as lm
  from public.records
  where entity <> 'AuthUser'
) s;

-- ---------------------------------------------------------------------------
-- Q2) EXPORTACAO AuthUser REDIGIDA (1 linha)
--     Remove do JSON as chaves de credencial/hashes (senha, token etc.).
--     A Etapa 2 (consulta B2) mostra os NOMES reais das chaves: se existir
--     outra chave sensive, acrescente-a ao `-` abaixo ANTES de baixar.
--     Download CSV -> backups_recuperacao/supabase-2026-10-13/authuser.csv
-- ---------------------------------------------------------------------------

select id,
       (data - 'password' - 'password_hash' - 'hash' - 'senha'
             - 'encrypted_password' - 'token' - 'secret') as data,
       created_date, updated_date
from public.records
where entity = 'AuthUser';

-- Q2b) Checksum do AuthUser redigido (mesma transformacao; insensivel a ordem)
select count(*) as authuser_rows,
       md5(string_agg(lm, '|' order by lm)) as checksum_authuser
from (
  select md5(id::text || '|'
             || coalesce((data - 'password' - 'password_hash' - 'hash' - 'senha'
                                - 'encrypted_password' - 'token' - 'secret')::text,'')
             || '|' || coalesce(created_date::text,'')
             || '|' || coalesce(updated_date::text,'')) as lm
  from public.records
  where entity = 'AuthUser'
) s;

commit;
