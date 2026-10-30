-- ============================================================================
-- RECUPERACAO — 04/04: validacao do staging LOCAL (somente leitura)
-- Conectar em gestao_ruy_staging e rodar este arquivo apos a importacao.
-- Confere: quantidades, entities, integridade, checksum, totais financeiros
-- e referencias — contra os valores de referencia da Etapa 1/4 do Supabase.
-- ============================================================================

begin transaction read only;

-- ---------------------------------------------------------------------------
-- 1) QUANTIDADE TOTAL (referencia Etapa 1: 1067, menos AuthUser = 1066)
-- ---------------------------------------------------------------------------

select count(*) as total_obtido,
       1066 as total_esperado,
       count(*) = 1066 as ok
from recuperacao.records_stage;

-- AuthUser exportado SEPARADAMENTE e ja REDIGIDO na origem
select count(*) as authuser_obtido,
       1 as authuser_esperado,
       count(*) = 1 as ok,
       count(*) filter (where id is null or id = '') as sem_id
from recuperacao.authuser_stage;

-- ---------------------------------------------------------------------------
-- 2) CONTAGEM POR ENTITY vs REFERENCIA (FULL OUTER JOIN pega tambem
--    entities inesperadas ou faltantes)
-- ---------------------------------------------------------------------------

with expected(entity, linhas) as (values
  ('AuditLog',504),('FinancialExpense',165),('EmployeePayment',134),
  ('Consumption',93),('Employee',63),('Vale',55),('JobRole',17),
  ('Absence',8),('Warning',6),('Sector',6),('ExpenseCategory',5),
  ('AccountsPayable',4),('FechamentoCaixa',4),
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
-- 4) CHECKSUMS (comparar com Q1b/Q2b da Etapa 4 da origem)
--    Ver observacao no README: divergencia so de data/formato nao e perda.
-- ---------------------------------------------------------------------------

-- 4a) Checksum do recorte principal (mesma formula insensivel a ordem da Q1b
--     da Etapa 4 — as datas de exportacao continuam valendo como referencia)
select count(*) as total,
       md5(string_agg(lm, '|' order by lm)) as checksum_main_staging
from (
  select md5(entity || '|' || id || '|' || coalesce(data,'')
             || '|' || coalesce(created_date,'')
             || '|' || coalesce(updated_date,'')) as lm
  from recuperacao.records_stage
) s;

-- 4b) Checksum do AuthUser redigido (comparar com Q2b da Etapa 4)
select count(*) as authuser_rows,
       md5(string_agg(lm, '|' order by lm)) as checksum_authuser_staging
from (
  select md5(id || '|' || coalesce(data,'')
             || '|' || coalesce(created_date,'')
             || '|' || coalesce(updated_date,'')) as lm
  from recuperacao.authuser_stage
) s;

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
-- 6) INTEGRIDADE RELACIONAL (espelho EXATO da secao 4 da Etapa 3 origem,
--    incluindo grupos 4a/4b; pendencias 4c nao checadas nos dois lados).
--    Orfaos informativos: podem ser exclusoes legitimas do historico.
--    Comparar linha a linha com a saida da Etapa 3 na origem.
-- ---------------------------------------------------------------------------

with ids(entity, id) as (select entity, id from recuperacao.records_stage)

-- ===== 4a) fontes COM linhas na origem =====
select '4a' as grupo, 'EmployeePayment.employee_id->Employee' as verificacao, count(*) as orfaos
from recuperacao.records_stage p
where p.entity = 'EmployeePayment'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4a', 'Absence.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Absence'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4a', 'JobRole.sector_id->Sector', count(*)
from recuperacao.records_stage p
where p.entity = 'JobRole'
  and nullif(p.data::jsonb->>'sector_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Sector' and i.id = p.data::jsonb->>'sector_id')
union all
select '4a', 'StockMovement.inventory_item_id->InventoryItem', count(*)
from recuperacao.records_stage p
where p.entity = 'StockMovement'
  and nullif(p.data::jsonb->>'inventory_item_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'InventoryItem' and i.id = p.data::jsonb->>'inventory_item_id')
union all
select '4a', 'FinancialExpense.category_id->ExpenseCategory', count(*)
from recuperacao.records_stage p
where p.entity = 'FinancialExpense'
  and nullif(p.data::jsonb->>'category_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'ExpenseCategory' and i.id = p.data::jsonb->>'category_id')
union all
select '4a', 'Vale.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Vale'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4a', 'Warning.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Warning'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4a', 'Consumption.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Consumption'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4a', 'FinancialExpense.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'FinancialExpense'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4a', 'FinancialExpense.beneficiary_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'FinancialExpense'
  and nullif(p.data::jsonb->>'beneficiary_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'beneficiary_id')
union all
select '4a', 'EmployeePayment.financial_expense_id->FinancialExpense', count(*)
from recuperacao.records_stage p
where p.entity = 'EmployeePayment'
  and nullif(p.data::jsonb->>'financial_expense_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'FinancialExpense' and i.id = p.data::jsonb->>'financial_expense_id')
union all
select '4a', 'Vale.financial_expense_id->FinancialExpense', count(*)
from recuperacao.records_stage p
where p.entity = 'Vale'
  and nullif(p.data::jsonb->>'financial_expense_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'FinancialExpense' and i.id = p.data::jsonb->>'financial_expense_id')
union all
select '4a', 'AccountsPayable.financial_expense_id->FinancialExpense', count(*)
from recuperacao.records_stage p
where p.entity = 'AccountsPayable'
  and nullif(p.data::jsonb->>'financial_expense_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'FinancialExpense' and i.id = p.data::jsonb->>'financial_expense_id')
union all
select '4a', 'AccountsPayable.category_id->ExpenseCategory', count(*)
from recuperacao.records_stage p
where p.entity = 'AccountsPayable'
  and nullif(p.data::jsonb->>'category_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'ExpenseCategory' and i.id = p.data::jsonb->>'category_id')
union all
-- FinancialExpense.origin_id e POLIMORFICO: o alvo depende de origin_type.
-- So os tipos com escritor confirmado no codigo entram aqui.
select '4a', 'FinancialExpense.origin_id->Vale [origin_type=vale]', count(*)
from recuperacao.records_stage p
where p.entity = 'FinancialExpense'
  and p.data::jsonb->>'origin_type' = 'vale'
  and nullif(p.data::jsonb->>'origin_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Vale' and i.id = p.data::jsonb->>'origin_id')
union all
select '4a', 'FinancialExpense.origin_id->AccountsPayable [origin_type=conta_pagar]', count(*)
from recuperacao.records_stage p
where p.entity = 'FinancialExpense'
  and p.data::jsonb->>'origin_type' = 'conta_pagar'
  and nullif(p.data::jsonb->>'origin_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'AccountsPayable' and i.id = p.data::jsonb->>'origin_id')
union all
select '4a', 'FinancialExpense.origin_id->EmployeePayment [origin_type=pagamento_colaborador]', count(*)
from recuperacao.records_stage p
where p.entity = 'FinancialExpense'
  and p.data::jsonb->>'origin_type' = 'pagamento_colaborador'
  and nullif(p.data::jsonb->>'origin_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'EmployeePayment' and i.id = p.data::jsonb->>'origin_id')
union all

-- ===== 4b) checagens validas porem fonte VAZIA hoje (paridade origem) =====
select '4b', 'Schedule.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Schedule'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4b', 'Schedule.substitute_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Schedule'
  and nullif(p.data::jsonb->>'substitute_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'substitute_id')
union all
select '4b', 'TimeRecord.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'TimeRecord'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4b', 'StandardSchedule.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'StandardSchedule'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4b', 'Evaluation.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'Evaluation'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id')
union all
select '4b', 'EmployeeDocument.employee_id->Employee', count(*)
from recuperacao.records_stage p
where p.entity = 'EmployeeDocument'
  and nullif(p.data::jsonb->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data::jsonb->>'employee_id');

commit;
