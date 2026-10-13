-- ============================================================================
-- INVENTARIO DE RECUPERACAO — ETAPA 3 de 3 (somente leitura)
-- Projeto Supabase: wvcvveqdkecsoygtilop. Executar no SQL Editor (New query).
--
-- OBJETIVO: gerar as impressoes digitais (checksums), totais financeiros e
-- checagens de integridade da ORIGEM, para comparar com o banco de staging
-- local depois da exportacao/importacao autorizadas.
--
-- SEGURANCA: transacao READ ONLY. Nao modifica nada. Nao seleciona campos
-- sensiveis. Pode ser abortada com Rollback sem efeito colateral.
--
-- IMPORTANTE: guarde TODAS as saidas desta etapa. Elas sao a referencia
-- oficial de verificacao da recuperacao.
-- ============================================================================

begin transaction read only;

-- ---------------------------------------------------------------------------
-- 1) IMPRESSOES DIGITAIS (checksums) — comparar depois com staging
-- ---------------------------------------------------------------------------

-- 1a) Checksum global (count + md5 de todas as linhas, ordenado por entity+id)
select count(*) as total_records,
       md5(string_agg(
             md5(entity || '|' || id::text || '|' || coalesce(data::text,'')
                 || '|' || coalesce(created_date::text,'')
                 || '|' || coalesce(updated_date::text,'')),
             '|' order by entity, id)) as checksum_global
from public.records;

-- 1b) Checksum por entity (detecta COM QUE entity houve divergencia)
select entity,
       count(*) as linhas,
       md5(string_agg(md5(id::text || '|' || coalesce(data::text,'')),
                      '|' order by id)) as checksum_entity
from public.records
group by entity
order by entity;

-- ---------------------------------------------------------------------------
-- 2) TOTAIS FINANCEIROS por entity (chaves reais usadas pelo app)
--    Guardas regex impedem erro se algum valor nao for numerico.
-- ---------------------------------------------------------------------------

select entity,
       count(*) as linhas,
       sum(case when (data->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (data->>'amount')::numeric end) as soma_amount,
       sum(case when (data->>'net_amount') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (data->>'net_amount')::numeric end) as soma_net_amount
from public.records
where entity in ('FinancialExpense','EmployeePayment','Consumption',
                 'AccountsPayable','AccountsReceivable','CardReceivable',
                 'Revenue','FechamentoCaixa')
group by entity
order by entity;

-- 2b) Estoque
select entity,
       count(*) as linhas,
       count(*) filter (where data ? 'current_stock') as com_current_stock,
       sum(case when (data->>'current_stock') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (data->>'current_stock')::numeric end) as soma_current_stock
from public.records
where entity in ('InventoryItem','StockMovement')
group by entity
order by entity;

-- ---------------------------------------------------------------------------
-- 3) ANEXOS EMBUTIDOS no JSON (proof_url / invoice_url)
--    Distingue: data URI (base64 colado), URL http e caminho relativo (Storage).
-- ---------------------------------------------------------------------------

select entity,
       count(*) filter (where nullif(data->>'proof_url','')  is not null) as com_proof_url,
       count(*) filter (where coalesce(data->>'proof_url','') like 'data:%')  as proof_data_uri,
       count(*) filter (where coalesce(data->>'proof_url','') like 'http%')   as proof_url_http,
       count(*) filter (where nullif(data->>'proof_url','') is not null
                          and coalesce(data->>'proof_url','') not like 'http%'
                          and coalesce(data->>'proof_url','') not like 'data:%') as proof_caminho_relativo,
       count(*) filter (where nullif(data->>'invoice_url','') is not null) as com_invoice_url,
       count(*) filter (where coalesce(data->>'invoice_url','') like 'http%') as invoice_url_http
from public.records
group by entity
having count(*) filter (where nullif(data->>'proof_url','')  is not null) > 0
    or count(*) filter (where nullif(data->>'invoice_url','') is not null) > 0
order by entity;

-- ---------------------------------------------------------------------------
-- 4) INTEGRIDADE RELACIONAL no JSON (referencias por id; orfaos INFORMATIVOS)
--    Orfaos podem ser exclusoes legitimas do passado — sao achados, nao erros.
--    Replicada igual no staging (04-validar-staging.sql) para comparacao.
-- ---------------------------------------------------------------------------

with ids as (select entity, id from public.records)
select 'EmployeePayment->Employee' as verificacao, count(*) as orfaos
from public.records p
where p.entity = 'EmployeePayment'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select 'Schedule->Employee', count(*)
from public.records p
where p.entity = 'Schedule'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select 'TimeRecord->Employee', count(*)
from public.records p
where p.entity = 'TimeRecord'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select 'Absence->Employee', count(*)
from public.records p
where p.entity = 'Absence'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select 'JobRole->Sector', count(*)
from public.records p
where p.entity = 'JobRole'
  and nullif(p.data->>'sector_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Sector' and i.id = p.data->>'sector_id')
union all
select 'StockMovement->InventoryItem', count(*)
from public.records p
where p.entity = 'StockMovement'
  and nullif(p.data->>'inventory_item_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'InventoryItem' and i.id = p.data->>'inventory_item_id')
union all
select 'FinancialExpense->ExpenseCategory', count(*)
from public.records p
where p.entity = 'FinancialExpense'
  and nullif(p.data->>'category_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'ExpenseCategory' and i.id = p.data->>'category_id');

commit;

