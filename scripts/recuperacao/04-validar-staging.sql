-- ============================================================================
-- RECUPERACAO — 04/04: validacao do staging LOCAL (somente leitura)
-- Conectar em gestao_ruy_staging e rodar este arquivo apos a importacao.
-- Confere: quantidades, entities, integridade, checksum, totais financeiros
-- e referencias — contra os valores de referencia da Etapa 1/3 do Supabase.
-- ============================================================================

begin transaction read only;

-- ---------------------------------------------------------------------------
-- 1) QUANTIDADE TOTAL (referencia Etapa 1: 1067)
-- ---------------------------------------------------------------------------

select count(*) as total_obtido,
       1067 as total_esperado,
       count(*) = 1067 as ok
from recuperacao.records_stage;

-- ---------------------------------------------------------------------------
-- 2) CONTAGEM POR ENTITY vs REFERENCIA (FULL OUTER JOIN pega tambem
--    entities inesperadas ou faltantes)
-- ---------------------------------------------------------------------------

with expected(entity, linhas) as (values
  ('AuditLog',504),('FinancialExpense',165),('EmployeePayment',134),
  ('Consumption',93),('Employee',63),('Vale',55),('JobRole',17),
  ('Absence',8),('Warning',6),('Sector',6),('ExpenseCategory',5),
  ('AccountsPayable',4),('FechamentoCaixa',4),('AuthUser',1),
  ('StockMovement',1),('InventoryItem',1)),
actual as (select entity, count(*) as linhas
           from recuperacao.records_stage group by entity)
select coalesce(e.entity, a.entity) as entity,
       coalesce(e.linhas,0) as esperado,
       coalesce(a.linhas,0) as obtido,
       coalesce(e.linhas,0) = coalesce(a.linhas,0) as ok
from expected e full outer join actual a on a.entity = e.entity
order by 1;

-- ---------------------------------------------------------------------------
-- 3) INTEGRIDADE BASICA DO CSV
-- ---------------------------------------------------------------------------

select count(*) filter (where entity is null or entity = '')   as sem_entity,
       count(*) filter (where id is null or id = '')           as sem_id,
       count(*) filter (where not (data ~ '^\s*[\[{]'))        as data_nao_json,
       count(distinct id)                                      as ids_distintos,
       count(*)                                                as total
from recuperacao.records_stage;

-- ---------------------------------------------------------------------------
-- 4) CHECKSUM GLOBAL (comparar com 1a/1b da Etapa 3 da origem)
--    Ver observacao no README: divergencia so de data/formato nao e perda.
-- ---------------------------------------------------------------------------

select count(*) as total,
       md5(string_agg(
             md5(entity || '|' || id || '|' || coalesce(data,'')
                 || '|' || coalesce(created_date,'')
                 || '|' || coalesce(updated_date,'')),
             '|' order by entity, id)) as checksum_global_staging
from recuperacao.records_stage;

-- ---------------------------------------------------------------------------
-- 5) TOTAIS FINANCEIROS (mesmas formulas da Etapa 3 origem)
-- ---------------------------------------------------------------------------

select entity,
       count(*) as linhas,
       sum(case when (data::jsonb->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (data::jsonb->>'amount')::numeric end) as soma_amount,
       sum(case when (data::jsonb->>'net_amount') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (data::jsonb->>'net_amount')::numeric end) as soma_net_amount
from recuperacao.records_stage
where data ~ '^\s*[\[{]'
  and entity in ('FinancialExpense','EmployeePayment','Consumption',
                 'AccountsPayable','AccountsReceivable','CardReceivable',
                 'Revenue','FechamentoCaixa')
group by entity
order by entity;

-- 5b) Estoque
select entity,
       count(*) as linhas,
       count(*) filter (where data::jsonb ? 'current_stock') as com_current_stock,
       sum(case when (data::jsonb->>'current_stock') ~ '^-?[0-9]+(\.[0-9]+)?$'
                then (data::jsonb->>'current_stock')::numeric end) as soma_current_stock
from recuperacao.records_stage
where data ~ '^\s*[\[{]'
  and entity in ('InventoryItem','StockMovement')
group by entity
order by entity;

-- ---------------------------------------------------------------------------
-- 6) INTEGRIDADE RELACIONAL (mesmas checagens da Etapa 3 origem)
--    Orfaos informativos: podem ser exclusoes legitimas do historico.
-- ---------------------------------------------------------------------------

with ids(entity, id) as (select entity, id from recuperacao.records_stage)
select 'EmployeePayment->Employee' as verificacao, count(*) as orfaos
from recuperacao.records_stage p
where p.entity = 'EmployeePayment'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select 'Schedule->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Schedule'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select 'TimeRecord->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'TimeRecord'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select 'Absence->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Absence'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select 'JobRole->Sector', count(*)
from recuperacao.records_stage p
where p.entity = 'JobRole'
  and nullif(p.data::jsonb->>'sector_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Sector' and i.id = p.data::jsonb->>'sector_id')
union all
select 'StockMovement->InventoryItem', count(*)
from recuperacao.records_stage p
where p.entity = 'StockMovement'
  and nullif(p.data::jsonb->>'inventory_item_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'InventoryItem' and i.id = p.data::jsonb->>'inventory_item_id')
union all
select 'FinancialExpense->ExpenseCategory', count(*)
from recuperacao.records_stage p
where p.entity = 'FinancialExpense'
  and nullif(p.data::jsonb->>'category_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'ExpenseCategory' and i.id = p.data::jsonb->>'category_id');

commit;
