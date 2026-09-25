-- ===========================================================================
-- MIGRATION: integridade de ESTOQUE e GASTOS DIÁRIOS (opcional / hardening)
--
-- O app JÁ FUNCIONA sem esta migration: o controle de concorrência é feito no
-- cliente com compare-and-swap (cloudDb.transact) e a idempotência com
-- clientToken. Estas constraints são a rede de segurança do BANCO, para que
-- nem outro cliente (SQL, script, app futuro) consiga quebrar a regra.
--
-- Tabela alvo: `records` (uma tabela genérica: entity, id, data jsonb).
-- Como os campos vivem em jsonb, usamos índices/constraints sobre expressões.
--
-- COMO APLICAR (uma única vez), no SQL Editor do Supabase:
--   cole o conteúdo deste arquivo e execute. É idempotente: pode rodar mais
--   de uma vez sem efeito colateral. Não altera/apaga dados existentes.
-- ===========================================================================

-- 1) TIMESTAMPS ------------------------------------------------------------
-- Hoje created_date/updated_date aceitam NULL e o app ordena por
-- created_date. Sem default, uma linha gravada fora do app fica sem ordem.
alter table public.records
  alter column created_date set default now(),
  alter column updated_date set default now();

-- 2) ÍNDICES ---------------------------------------------------------------
-- O app sempre filtra por entidade e ordena por data; sem índice, cada tela
-- baixa a tabela inteira.
create index if not exists records_entity_created_date_idx
  on public.records (entity, created_date desc);

create index if not exists records_updated_date_idx
  on public.records (updated_date);

-- 3) VALORES MONETÁRIOS / QUANTIDADES --------------------------------------
-- Nenhum cálculo deve rodar sobre string formatada. Garante que o que entra
-- no banco é número real e nunca "25,50", "R$ 1.234,56" ou NaN.
alter table public.records
  drop constraint if exists records_valores_numericos;

alter table public.records
  add constraint records_valores_numericos check (
    entity not in ('StockMovement', 'FinancialExpense', 'InventoryItem', 'PurchaseItem')
    or (
      (case when data ? 'amount'        then (data->>'amount')::numeric is not null        else true end)
      and (case when data ? 'quantity'    then (data->>'quantity')::numeric is not null    else true end)
      and (case when data ? 'unit_cost'   then (data->>'unit_cost')::numeric is not null   else true end)
      and (case when data ? 'total_cost'  then (data->>'total_cost')::numeric is not null  else true end)
      and (case when data ? 'current_stock' then (data->>'current_stock')::numeric is not null else true end)
      and (case when data ? 'average_cost'  then (data->>'average_cost')::numeric is not null  else true end)
    )
  );

-- 4) GASTO NÃO NEGATIVO ----------------------------------------------------
-- Gasto de R$ -10 não é despesa; antes o formulário aceitava.
alter table public.records
  drop constraint if exists records_expense_valor_positivo;

alter table public.records

-- 5) SEM DUPLICAÇÃO DE DESPESA LIGADA À MESMA ORIGEM ------------------------
-- É a garantia de contábil: um pagamento de conta a pagar, ou um vale
-- lançado no Financeiro, só pode virar UM FinancialExpense. Sem isto, abrir
-- o diálogo de pagamento em dois dispositivos gera R$ 200 por R$ 100 pago.
create unique index if not exists records_expense_origem_unica
  on public.records (entity, (data->>'origin_type'), (data->>'origin_id'))
  where entity = 'FinancialExpense'
    and (data->>'origin_id') is not null
    and (data->>'origin_id') <> ''
    and coalesce(data->>'status', 'pago') <> 'cancelado';

-- 6) SEM DUPLICAÇÃO DE MOVIMENTAÇÃO (clientToken) ---------------------------
-- O app manda clientToken para tornar o lançamento idempotente; aqui o banco
-- passa a garantir, mesmo que o cliente erre.
create unique index if not exists records_movimento_token_unico
  on public.records (entity, (data->>'client_token'))
  where entity = 'StockMovement'
    and (data->>'client_token') is not null
    and (data->>'client_token') <> '';

-- 7) MOVIMENTAÇÃO SEM ITEM, SEM TIPO OU COM QUANTIDADE INVÁLIDA --------------
alter table public.records
  drop constraint if exists records_movimento_campos_obrigatorios;

alter table public.records
  add constraint records_movimento_campos_obrigatorios check (
    entity <> 'StockMovement'
    or (
      coalesce(data->>'inventory_item_id', '') <> ''
      and coalesce(data->>'movement_type', '') <> ''
      and (data->>'quantity')::numeric > 0
    )
  );

-- 8) TIPO DE MOVIMENTAÇÃO VÁLIDO --------------------------------------------
-- Vocabulário que o projeto já usa (inclui os tipos legados, que continuam
-- válidos para não quebrar o histórico existente).
alter table public.records
  drop constraint if exists records_movimento_tipo_valido;

alter table public.records
  add constraint records_movimento_tipo_valido check (

-- ===========================================================================
-- NOTA SOBRE RLS (auditoria)
--
-- Verificado em 25/09/2026: a tabela `records` hoje é lida e ESCRITA pela
-- anon key (`sb_publishable_...`) sem restrição — confirmamos com um INSERT
-- e um DELETE deprobe usando apenas a chave pública. Ou seja, qualquer
-- pessoa com a chave pública do projeto consegue ler e alterar os dados.
-- Isso é anterior a esta fase e vale para todos os módulos, não só estoque.
--
-- As policies abaixo LIGAM o RLS mantendo o comportamento atual do app
-- (esta projeto usa autenticação própria, com AuthUser na própria tabela).
-- Aplique SÓ depois de confirmar em homologação que o app continua
-- autenticando e gravando — ativar RLS errado derruba o sistema inteiro.
-- ===========================================================================
-- alter table public.records enable row level security;
--
-- create or replace function public.current_user_role() returns text
-- language sql stable as $$
--   select coalesce(
--     (select (r.data->>'role') from public.records r
--       where r.entity = 'AuthUser'
--         and r.id = coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')),
--     'user'
--   );
-- $$;
--
-- create policy records_read on public.records for select using (true);
--
-- create policy records_write on public.records for insert
--   with check (public.current_user_role() in ('admin','super_admin','gerente','manager','producao','user'));
--
-- create policy records_update on public.records for update
--   using      (public.current_user_role() in ('admin','super_admin','gerente','manager','producao','user'))
--   with check (public.current_user_role() in ('admin','super_admin','gerente','manager','producao','user'));
--
-- create policy records_delete on public.records for delete
--   using (public.current_user_role() in ('admin','super_admin'));

    entity <> 'StockMovement'
    or (data->>'movement_type') in (
      'entrada_manual', 'entrada_compra', 'entrada_ajuste',
      'saida_manual', 'saida_ajuste', 'saida_perda',
      'inventario', 'consumo_producao'
    )
  );

  add constraint records_expense_valor_positivo check (
    entity <> 'FinancialExpense'
    or coalesce(data->>'status', '') = 'cancelado'
    or (data ? 'amount' and (data->>'amount')::numeric > 0)
  );
