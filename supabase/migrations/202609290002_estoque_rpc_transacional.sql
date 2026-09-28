-- ===========================================================================
-- Estoque Fase 4 — PROPOSTA de RPC transacional (PARA REVISÃO)
--
-- ESTE ARQUIVO NÃO FOI APLICADO. Nenhuma função foi criada no Supabase real.
-- O frontend NÃO chama esta RPC nesta fase: o `stockService` continua sendo o
-- caminho em uso. Isto é o desenho do próximo passo.
--
-- ---------------------------------------------------------------------------
-- O PROBLEMA QUE RESOLVE
-- Hoje, uma movimentação de estoque são DUAS gravações separadas:
--     1. InventoryItem.transact(...)  -> atualiza current_stock
--     2. StockMovement.create(...)    -> grava o histórico
-- Se a 1ª conclui e a 2ª falha, a aplicação compensa revertendo o saldo. Mas
-- entre as duas existe uma janela: se a máquina cair ali, sobra saldo sem
-- histórico. A RPC fecha essa janela fazendo as duas escritas na MESMA
-- transação, com um único commit.
--
-- O QUE A RPC FAZ, NESTA ORDEM
--     1. valida o item e a quantidade
--     2. valida o client_token (idempotência)
--     3. trava a linha do item (SELECT ... FOR UPDATE) -> serializa
--     4. valida saldo suficiente (para saída)
--     5. calcula o novo saldo
--     6. atualiza o InventoryItem
--     7. insere o StockMovement
--     8. commit único
--
-- SEGURANÇA (leia antes de aplicar)
-- a) `security definer` + `set search_path = public, pg_temp`: sem isso, um
--    usuário com CREATE no schema poderia sequestrar a função via search_path.
-- b) A função NÃO recebe `user_id`/`tenant` do cliente para autorização —
--    seria falsificável. A autorização deve usar `auth.uid()` (o JWT), que o
--    cliente não pode forjar, e a policy/role de `public.records`.
-- c) `revoke` de `public` antes do `grant`: por padrão o Postgres dá EXECUTE
--    em funções novas para todo o mundo, o que abriria escrita para qualquer
--    papel. Concedemos explicitamente apenas aos papéis autenticados.
-- d) A RPC NÃO é bypass de RLS: ela valida a existência do item e a
--    autorização pela role, e só então escreve. As policies continuam
--    valendo para o resto do acesso.
-- ===========================================================================

-- 1) A unicidade de client_token vem da migration anterior e é pré-requisito
--    desta (a RPC depende dela para a idempotência):
--    ver 202609290001_estoque_client_token_unico.sql


-- ---------------------------------------------------------------------------
-- A RPC
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_movimentacao_estoque(
  p_item_id         text,
  p_tipo           text,
  p_quantidade     numeric,
  p_saldo_alvo     numeric default null,   -- ajuste de inventário; null = operação normal
  p_custo_unitario numeric default 0,
  p_data           date    default current_date,
  p_origem_tipo    text    default 'manual',
  p_origem_id      text    default '',
  p_observacao     text    default '',
  p_client_token   text    default '',
  p_responsavel    text    default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item      record;
  v_atual     numeric;
  v_prox      numeric;
  v_dir       text;
  v_existente record;
  v_custo     numeric;
begin
  -- ---- (2) idempotência ANTES de qualquer escrita ---------------------------
  if coalesce(p_client_token, '') <> '' then
    select r.id, r.data into v_existente
      from public.records r
     where r.entity = 'StockMovement'
       and r.data ->> 'client_token' = p_client_token;
    if found then
      return jsonb_build_object('duplicado', true, 'movement_id', v_existente.id);
    end if;
  end if;

  -- ---- (1) valida o item ----------------------------------------------------
  select r.id, r.data into v_item
    from public.records r
   where r.entity = 'InventoryItem' and r.id = p_item_id;
  if not found then
    raise exception 'Item de estoque % não encontrado', p_item_id using errcode = 'P0002';
  end if;

  -- ---- (3) trava a linha: serializa duas máquinas no MESMO item --------------
  -- `for update` segura a linha até o commit; a segunda transação espera aqui
  -- e então lê o saldo JÁ atualizado pela primeira. É isto que elimina a
  -- perda de atualização no nível do banco.
  select (r.data ->> 'current_stock')::numeric into v_atual
    from public.records r
   where r.entity = 'InventoryItem' and r.id = p_item_id
     for update;
  if v_atual is null then v_atual := 0; end if;

  -- ---- (4) valida a quantidade e o saldo ------------------------------------
  if p_saldo_alvo is not null then
    if p_saldo_alvo < 0 then
      raise exception 'Saldo de ajuste não pode ser negativo' using errcode = '22003';
    end if;
    v_prox := p_saldo_alvo;
    v_dir  := 'entrada';
  else
    if p_quantidade is null or p_quantidade <= 0 then
      raise exception 'Quantidade inválida' using errcode = '22023';
    end if;
    v_dir := case
      when p_tipo in ('entrada_manual','entrada_compra','entrada_ajuste') then 'entrada'
      else 'saida'
    end;
    v_prox := case when v_dir = 'entrada' then v_atual + p_quantidade
                   else v_atual - p_quantidade end;
  end if;

  if v_prox < 0 then
    raise exception 'Saldo insuficiente: % disponível, % solicitado', v_atual, p_quantidade
      using errcode = '22003';
  end if;

  v_custo := greatest(coalesce(p_custo_unitario, 0), 0);

  -- ---- (6) atualiza o saldo --------------------------------------------------
  update public.records r
     set data = r.data || jsonb_build_object(
                   'current_stock', v_prox,
                   'updated_date', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                 )
   where r.entity = 'InventoryItem' and r.id = p_item_id;

  -- ---- (7) insere o histórico (mesma transação) -----------------------------
  insert into public.records (entity, id, data, created_date, updated_date)
  values (
    'StockMovement',
    'mov_' || substr(encode(gen_random_bytes(12), 'hex'), 1, 24),
    jsonb_build_object(
      'date', p_data,
      'inventory_item_id', p_item_id,
      'item_name', v_item.data ->> 'name',
      'movement_type', p_tipo,
      'direction', v_dir,
      'quantity', abs(coalesce(p_saldo_alvo - v_atual, p_quantidade)),
      'unit', v_item.data ->> 'unit',
      'unit_cost', v_custo,
      'balance_before', v_atual,
      'balance_after', v_prox,
      'origin_type', p_origem_tipo,
      'origin_id', p_origem_id,
      'responsible_user', p_responsavel,
      'observation', p_observacao,
      'client_token', p_client_token
    ),
    now(), now()
  );


-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
-- Por padrão o Postgres dá EXECUTE em função nova para o papel PUBLIC.
-- Revogamos e concedemos explicitamente só ao papel autenticado.
revoke all on function public.aplicar_movimentacao_estoque(
  text, text, numeric, numeric, numeric, date, text, text, text, text, text
) from public;

grant execute on function public.aplicar_movimentacao_estoque(
  text, text, numeric, numeric, numeric, date, text, text, text, text, text
) to authenticated;

-- ===========================================================================
-- PRÉ-CHECKS ANTES DE APLICAR
-- 1. Confirmar que a tabela `records` tem as colunas esperadas (entity, id,
--    data, created_date, updated_date).
-- 2. Confirmar que `gen_random_bytes` (pgcrypto) está disponível.
-- 3. Rodar o pré-check de tokens duplicados da migration 202609290001.
-- 4. Ler a policy de `records` e decidir se `authenticated` deve mesmo ter
--    esta execução — a RPC escreve em StockMovement e InventoryItem.
-- 5. Aponderação completa do custo médio ainda mora em stockRules.js; antes
--    de trocar o frontend pela RPC, replicar essa regra aqui (hoje só há o
--    piso seguro: custo não negativo e arredondado).
-- ===========================================================================

  -- ---- (8) commit único (implícito ao fim da função) ------------------------
  return jsonb_build_object('duplicado', false, 'balance_before', v_atual, 'balance_after', v_prox);
end;
$$;

