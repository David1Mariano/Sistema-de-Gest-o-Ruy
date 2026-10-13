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
--    Campos CONFIRMADOS no codigo (nao presumidos): employeeDelete.js
--    (EMPLOYEE_DELETE_RELATIONS), ValeForm.jsx, WarningForm.jsx,
--    Financeiro.jsx, dailyExpenses.js, Compras.jsx, standardScheduleData.js,
--    evaluationsData.js, employeeDocumentStorage.js.
--    Replicada igual no staging (04-validar-staging.sql) para comparacao.
--
--    Coluna 'grupo':
--      4a = fonte COM linhas na origem (resultado util ja nesta etapa)
--      4b = checagem VALIDA porem fonte VAZIA hoje (entidade sem linhas na
--           origem; mantida para paridade com o staging e dados futuros)
--
--    4c) PENDENTES — NAO checadas aqui (exigem decisao do proprietario):
--      - AuditLog.entity_id (polimorfico via entity_type; 504 linhas);
--      - FinancialExpense.origin_id dos tipos 'recorrencia' e 'lote'
--        (escritor/alvo nao confirmados no codigo atual);
--      - *_id -> CostCenter, FinancialAccount, Supplier, Purchase
--        (alvos com 0 linhas no records da origem).
-- ---------------------------------------------------------------------------

with ids as (select entity, id from public.records)

-- ===== 4a) fontes COM linhas na origem =====
select '4a' as grupo, 'EmployeePayment.employee_id->Employee' as verificacao, count(*) as orfaos
from public.records p
where p.entity = 'EmployeePayment'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4a', 'Absence.employee_id->Employee', count(*)
from public.records p
where p.entity = 'Absence'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4a', 'JobRole.sector_id->Sector', count(*)
from public.records p
where p.entity = 'JobRole'
  and nullif(p.data->>'sector_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Sector' and i.id = p.data->>'sector_id')
union all
select '4a', 'StockMovement.inventory_item_id->InventoryItem', count(*)
from public.records p
where p.entity = 'StockMovement'
  and nullif(p.data->>'inventory_item_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'InventoryItem' and i.id = p.data->>'inventory_item_id')
union all
select '4a', 'FinancialExpense.category_id->ExpenseCategory', count(*)
from public.records p
where p.entity = 'FinancialExpense'
  and nullif(p.data->>'category_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'ExpenseCategory' and i.id = p.data->>'category_id')
union all
select '4a', 'Vale.employee_id->Employee', count(*)
from public.records p
where p.entity = 'Vale'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4a', 'Warning.employee_id->Employee', count(*)
from public.records p
where p.entity = 'Warning'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4a', 'Consumption.employee_id->Employee', count(*)
from public.records p
where p.entity = 'Consumption'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4a', 'FinancialExpense.employee_id->Employee', count(*)
from public.records p
where p.entity = 'FinancialExpense'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4a', 'FinancialExpense.beneficiary_id->Employee', count(*)
from public.records p
where p.entity = 'FinancialExpense'
  and nullif(p.data->>'beneficiary_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'beneficiary_id')
union all
select '4a', 'EmployeePayment.financial_expense_id->FinancialExpense', count(*)
from public.records p
where p.entity = 'EmployeePayment'
  and nullif(p.data->>'financial_expense_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'FinancialExpense' and i.id = p.data->>'financial_expense_id')
union all
select '4a', 'Vale.financial_expense_id->FinancialExpense', count(*)
from public.records p
where p.entity = 'Vale'
  and nullif(p.data->>'financial_expense_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'FinancialExpense' and i.id = p.data->>'financial_expense_id')
union all
select '4a', 'AccountsPayable.financial_expense_id->FinancialExpense', count(*)
from public.records p
where p.entity = 'AccountsPayable'
  and nullif(p.data->>'financial_expense_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'FinancialExpense' and i.id = p.data->>'financial_expense_id')
union all
select '4a', 'AccountsPayable.category_id->ExpenseCategory', count(*)
from public.records p
where p.entity = 'AccountsPayable'
  and nullif(p.data->>'category_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'ExpenseCategory' and i.id = p.data->>'category_id')
union all
-- FinancialExpense.origin_id e POLIMORFICO: o alvo depende de origin_type.
-- So os tipos com escritor confirmado no codigo entram aqui.
select '4a', 'FinancialExpense.origin_id->Vale [origin_type=vale]', count(*)
from public.records p
where p.entity = 'FinancialExpense'
  and p.data->>'origin_type' = 'vale'
  and nullif(p.data->>'origin_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Vale' and i.id = p.data->>'origin_id')
union all
select '4a', 'FinancialExpense.origin_id->AccountsPayable [origin_type=conta_pagar]', count(*)
from public.records p
where p.entity = 'FinancialExpense'
  and p.data->>'origin_type' = 'conta_pagar'
  and nullif(p.data->>'origin_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'AccountsPayable' and i.id = p.data->>'origin_id')
union all
select '4a', 'FinancialExpense.origin_id->EmployeePayment [origin_type=pagamento_colaborador]', count(*)
from public.records p
where p.entity = 'FinancialExpense'
  and p.data->>'origin_type' = 'pagamento_colaborador'
  and nullif(p.data->>'origin_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'EmployeePayment' and i.id = p.data->>'origin_id')
union all

-- ===== 4b) checagens validas porem fonte VAZIA hoje (paridade staging) =====
select '4b', 'Schedule.employee_id->Employee', count(*)
from public.records p
where p.entity = 'Schedule'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4b', 'Schedule.substitute_id->Employee', count(*)
from public.records p
where p.entity = 'Schedule'
  and nullif(p.data->>'substitute_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'substitute_id')
union all
select '4b', 'TimeRecord.employee_id->Employee', count(*)
from public.records p
where p.entity = 'TimeRecord'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4b', 'StandardSchedule.employee_id->Employee', count(*)
from public.records p
where p.entity = 'StandardSchedule'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4b', 'Evaluation.employee_id->Employee', count(*)
from public.records p
where p.entity = 'Evaluation'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id')
union all
select '4b', 'EmployeeDocument.employee_id->Employee', count(*)
from public.records p
where p.entity = 'EmployeeDocument'
  and nullif(p.data->>'employee_id','') is not null
  and not exists (select 1 from ids i where i.entity = 'Employee' and i.id = p.data->>'employee_id');

commit;

