-- ============================================================================
-- DIAGNOSTICO SOMENTE LEITURA — 1 registro orfao
-- EmployeePayment.financial_expense_id -> FinancialExpense (Etapa 3, grupo 4a)
-- Projeto Supabase: wvcvveqdkecsoygtilop. Executar no SQL Editor (New query).
--
-- OBJETIVO: localizar o EmployeePayment com a referencia inconsistente,
-- confirmar se o FinancialExpense apontado realmente nao existe, reunir
-- evidencias de historico (AuditLog) e classificar a causa — SEM alterar nada.
--
-- SEGURANCA: transacao READ ONLY. Nao modifica nada. Nao seleciona nomes de
-- pessoas, valores, chaves PIX, observacoes livres, old_value/new_value,
-- responsible_user nem credenciais. Pode ser abortada com Rollback sem
-- efeito colateral.
--
-- PROIBICOES: nao excluir, corrigir, recriar ou migrar registro. Este script
-- apenas DIAGNOSTICA; o tratamento (preservar identico na origem e no staging,
-- documentar a inconsistencia) esta registrado em
-- docs/recuperacao-dados-supabase-postgres.md, secao 7.7.
--
-- SAIDAS: 7 consultas (Q0..Q6), cada aba um resultado. Guarde TODAS as abas.
-- ============================================================================

begin transaction read only;

-- ---------------------------------------------------------------------------
-- Q0) REPRODUZ a checagem da Etapa 3 (deve voltar exatamente 1)
--     Mesma formula do grupo 4a: nullif sem trim, para bater identico.
-- ---------------------------------------------------------------------------
with ids as (select entity, id from public.records)
select 'Q0' as consulta,
       'EmployeePayment.financial_expense_id->FinancialExpense' as verificacao,
       count(*) as orfaos
from public.records p
where p.entity = 'EmployeePayment'
  and nullif(p.data->>'financial_expense_id', '') is not null
  and not exists (select 1 from ids i
                  where i.entity = 'FinancialExpense'
                    and i.id = p.data->>'financial_expense_id');

-- ---------------------------------------------------------------------------
-- Q1) IDENTIFICA o(s) registro(s) orfao(s).
--     Expoe apenas: id interno, valor branco do vinculo, situacao do campo,
--     status/tipo do pagamento, employee_id (chave pseudonima) e datas.
--     NAO traz nome, valor monetario, forma de pagamento, observacao ou PIX.
-- ---------------------------------------------------------------------------
with orfaos as (
  select p.id,
         p.data->>'financial_expense_id' as fe_id,
         p.data->>'status'               as status_pagamento,
         p.data->>'payment_type'         as tipo_pagamento,
         p.data->>'employee_id'          as employee_id,
         p.created_date,
         p.updated_date
  from public.records p
  where p.entity = 'EmployeePayment'
    and nullif(p.data->>'financial_expense_id', '') is not null
    and not exists (select 1 from public.records f
                    where f.entity = 'FinancialExpense'
                      and f.id = p.data->>'financial_expense_id')
)
select 'Q1' as consulta,
       o.id as payment_id,
       o.fe_id as financial_expense_id_bruto,
       length(o.fe_id) as tamanho_campo,
       (o.fe_id <> trim(o.fe_id)) as tem_espaco_nas_pontas,
       o.status_pagamento,
       o.tipo_pagamento,
       o.employee_id,
       o.created_date,
       o.updated_date
from orfaos o
order by o.id;

-- ---------------------------------------------------------------------------
-- Q2) CONFIRMA a ausencia do alvo e procura o gasto "do outro lado".
--     gasto_com_este_id           = 0 -> o FinancialExpense realmente nao existe.
--     gasto_com_este_id_apos_trim > 0 -> so um espaco sobrando no id (artefato).
--     gasto_que_aponta_pra_este_pagamento =
--        1 -> o gasto EXISTE mas com outro id (link desatualizado);
--        0 -> o gasto foi realmente removido da origem.
-- ---------------------------------------------------------------------------
with orfaos as (
  select p.id, p.data->>'financial_expense_id' as fe_id
  from public.records p
  where p.entity = 'EmployeePayment'
    and nullif(p.data->>'financial_expense_id', '') is not null
    and not exists (select 1 from public.records f
                    where f.entity = 'FinancialExpense'
                      and f.id = p.data->>'financial_expense_id')
)
select 'Q2' as consulta,
       o.id as payment_id,
       o.fe_id as financial_expense_id,
       (select count(*) from public.records f
         where f.entity = 'FinancialExpense' and f.id = o.fe_id)
         as gasto_com_este_id,
       (select count(*) from public.records f
         where f.entity = 'FinancialExpense'
           and trim(f.id) = trim(o.fe_id))
         as gasto_com_este_id_apos_trim,
       (select count(*) from public.records f
         where f.entity = 'FinancialExpense'
           and f.data->>'origin_type' = 'pagamento_colaborador'
           and f.data->>'origin_id' = o.id)
         as gasto_que_aponta_pra_este_pagamento
from orfaos o
order by o.id;

-- ---------------------------------------------------------------------------
-- Q3) HISTORICO no AuditLog para o gasto faltante e para o pagamento.
--     Respeita o padrao de escrita de auditExpense/logAudit (entity_type,
--     entity_id, action, field, reason). NAO seleciona old_value/new_value
--     (podem conter descricao e valor) nem responsible_user (pessoa).
--     OBS: auditoria de FinancialExpense so existe a partir de uma versao
--     recente; vazio aqui NAO descarta a hipotese de exclusao antiga.
-- ---------------------------------------------------------------------------
with orfaos as (
  select p.id, p.data->>'financial_expense_id' as fe_id
  from public.records p
  where p.entity = 'EmployeePayment'
    and nullif(p.data->>'financial_expense_id', '') is not null
    and not exists (select 1 from public.records f
                    where f.entity = 'FinancialExpense'
                      and f.id = p.data->>'financial_expense_id')
)
select 'Q3' as consulta,
       a.data->>'entity_type'  as entity_type,
       a.data->>'entity_id'    as entity_id,
       a.data->>'action'       as action,
       a.data->>'field'        as field,
       left(a.data->>'reason', 120) as reason,
       a.created_date
from public.records a
where a.entity = 'AuditLog'
  and ( (a.data->>'entity_type' = 'FinancialExpense'
         and a.data->>'entity_id' in (select fe_id from orfaos))
     or a.data->>'entity_id' in (select id from orfaos) )
order by a.created_date;

-- ---------------------------------------------------------------------------
-- Q4) VINCULOS COLATERAIS: Vale ou AccountsPayable apontando para o MESMO
--     FinancialExpense faltante (as checagens 4a deram 0; aqui fica a prova
--     linha a linha). Resultado vazio = nao ha outro registro dependente.
-- ---------------------------------------------------------------------------
with orfaos as (
  select p.id, p.data->>'financial_expense_id' as fe_id
  from public.records p
  where p.entity = 'EmployeePayment'
    and nullif(p.data->>'financial_expense_id', '') is not null
    and not exists (select 1 from public.records f
                    where f.entity = 'FinancialExpense'
                      and f.id = p.data->>'financial_expense_id')
)
select 'Q4' as consulta, 'Vale' as entity, v.id as registro_id,
       o.id as payment_id, o.fe_id as financial_expense_id
from orfaos o
join public.records v on v.entity = 'Vale'
  and nullif(v.data->>'financial_expense_id', '') = o.fe_id
union all
select 'Q4', 'AccountsPayable', a.id, o.id, o.fe_id
from orfaos o
join public.records a on a.entity = 'AccountsPayable'
  and nullif(a.data->>'financial_expense_id', '') = o.fe_id;

-- ---------------------------------------------------------------------------
-- Q5) SAUDE GERAL dos vinculos preenchidos, por status do pagamento.
--     Mostra se o problema e isolado (1 quebrado) ou sistemático, e se o
--     orfao esta em pagamento ATIVO (grave) ou CANCELADO (exclusao legitima
--     do passado — comportamento documentado em dailyExpenses.js).
-- ---------------------------------------------------------------------------
select 'Q5' as consulta,
       p.data->>'status' as status_pagamento,
       count(*) as vinculos_preenchidos,
       count(*) filter (where exists (
         select 1 from public.records f
         where f.entity = 'FinancialExpense'
           and f.id = p.data->>'financial_expense_id')) as vinculo_ok,
       count(*) filter (where not exists (
         select 1 from public.records f
         where f.entity = 'FinancialExpense'
           and f.id = p.data->>'financial_expense_id')) as vinculo_quebrado
from public.records p
where p.entity = 'EmployeePayment'
  and nullif(p.data->>'financial_expense_id', '') is not null
group by 2
order by 2;

-- ---------------------------------------------------------------------------
-- Q6) ARTEFATO DE ESPACO: valor que a origem conta como vinculo (nullif so
--     trata string vazia) mas que com trim seria vazio. 0 = o id do orfao e
--     um valor real de texto, nao um espaco em branco.
-- ---------------------------------------------------------------------------
select 'Q6' as consulta,
       count(*) as vinculo_somente_espacos
from public.records p
where p.entity = 'EmployeePayment'
  and nullif(p.data->>'financial_expense_id', '') is not null
  and nullif(trim(p.data->>'financial_expense_id'), '') is null;

commit;

