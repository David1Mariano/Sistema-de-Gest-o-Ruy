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
-- SEGURANÇA — LEIA ANTES DE APLICAR
-- a) `security definer` + `set search_path = public, pg_temp`: sem o
--    search_path fixo, um usuário com CREATE no schema poderia sequestrar a
--    função. Está fixado na assinatura.
-- b) A função NÃO recebe `user_id`/`tenant` do cliente para autorizar: seria
--    falsificável.
-- c) `revoke` de `public` (e de `authenticated`/`anon`) está no final.
-- d) IMPORTANTE: `security definer` com dono = dono da tabela (o padrão no
--    Supabase é `postgres`) EXECUTA ACIMA DO RLS. As policies da tabela não
--    são consultadas. Por isso esta função hoje NÃO recebe grant: falta um
--    modelo de autorização por loja/unidade no app. Ver o bloco "PERMISSÕES"
--    no final, que traz a análise completa e o caminho para liberar.
--
-- STATUS: nenhuma função foi criada; nada foi aplicado.
-- ===========================================================================

-- 1) A unicidade de client_token vem da migration anterior e é pré-requisito
--    desta (a RPC depende dela para a idempotência):
--    ver 20260929010000_estoque_client_token_unico.sql
--
-- ORDEM DE APLICAÇÃO: este arquivo é o 2º. O índice precisa existir antes,
-- senão a checagem de idempotência da RPC fica sem garantia no banco.
-- Nomes seguem o formato de 14 dígitos do Supabase (AAAAMMDDHHMMSS), que é o
-- que a CLI ordena lexicograficamente. Foi escolhido 2026-09-29 01:00 e
-- 01:01 para deixar espaço para o Delivery datar as dele sem colisão.


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
-- PERMISSÕES — REVISÃO DE SEGURANÇA OBRIGATÓRIA (leia antes de aplicar)
-- ---------------------------------------------------------------------------
-- Esta função NÃO recebe grant operacional. Ela fica preparada e inacessível.
--
-- MOTIVO (corrige uma afirmação anterior que estava errada):
-- Dizer "SECURITY DEFINER não é bypass de RLS" é FALSO. Se o dono da função
-- for o dono da tabela (no Supabase, por padrão `postgres`), a função roda
-- com os privilégios desse dono e as policies de RLS da tabela NÃO são
-- consultadas. Ou seja: um grant'ing careless permitiria a QUALQUER usuário
-- autenticado escrever em qualquer linha, ignorando a policy.
--
-- LACUNAS DE AUTORIZAÇÃO QUE IMPEDEM O GRANT (todas reais hoje):
--   1. A função NÃO chama `auth.uid()` em nenhum ponto executável — o único
--      `auth.uid` neste arquivo está num comentário. Não há como saber QUEM
--      chamou.
--   2. O app NÃO tem modelo de loja/unidade/tenant: não existe merchant_id,
--      unit_id nem tenant_id em nenhuma entidade (auditado). Portanto não há
--      escopo para restricting o acesso a um item.
--   3. `p_item_id` chega do cliente. Sem (1) e (2), qualquer autenticado
--      poderia movimentar o estoque de QUALQUER item, inclusive de outro
--      Establishamento, e escrever `responsible_user` com o nome de outra
--      pessoa — adulterando o histórico.
--   4. `p_responsavel` também vem do cliente e é gravado direto no
--      histórico, sem conferir com o JWT.
--
-- DECISÃO: enquanto (1)-(4) não forem resolvidos, a função fica SEM grant.
-- Ela serve de referência do desenho transacional, nada mais.
--
-- Para liberar no futuro, o caminho é:
--   a) ler `auth.uid()` dentro da função e recusar quando for null;
--   b) validar o papel/escopo do usuário contra uma tabela de autorização
--      real (a ser definida), NÃO contra um id enviado pelo cliente;
--   c) ignorar `p_responsavel` e usar o nome derivado do JWT;
--   d) só então conceder o grant, com `revoke` de `public` antes.
-- ---------------------------------------------------------------------------
revoke all on function public.aplicar_movimentacao_estoque(
  text, text, numeric, numeric, numeric, date, text, text, text, text, text
) from public;

revoke all on function public.aplicar_movimentacao_estoque(
  text, text, numeric, numeric, numeric, date, text, text, text, text, text
) from authenticated;

revoke all on function public.aplicar_movimentacao_estoque(
  text, text, numeric, numeric, numeric, date, text, text, text, text, text
) from anon;

-- NENHUM grant é emitido de propósito. Para ligar a função no futuro, troque
-- o bloco acima pelo procedimento (a)-(d) documentado acima.
-- Nenhuma linha desta migration deve ser descomentada sem revisão de
-- segurança e sem o modelo de autorização por loja/unidade definido.

-- ===========================================================================
-- PRÉ-CHECKS ANTES DE APLICAR
-- 1. Confirmar que a tabela `records` tem as colunas esperadas (entity, id,
--    data, created_date, updated_date).
-- 2. Confirmar que `gen_random_bytes` (pgcrypto) está disponível.
-- 3. Rodar o pré-check de tokens duplicados da migration do índice.
-- 4. Definir o modelo de autorização por loja/unidade (item (2) acima). Sem
--    isso a função não deve ser exposta a nenhum papel de aplicação.
-- 5. Aponderação completa do custo médio ainda mora em stockRules.js; antes
--    de trocar o frontend pela RPC, replicar essa regra aqui (hoje só há o
--    piso seguro: custo não negativo e arredondado).
-- 6. Conferir o DONO da função: se for `postgres`, lembrar que ela roda acima
--    do RLS. Restringir o dono, ou trocar por `security invoker` se as
--    policies forem suficientes.
-- ===========================================================================

  -- ---- (8) commit único (implícito ao fim da função) ------------------------
  return jsonb_build_object('duplicado', false, 'balance_before', v_atual, 'balance_after', v_prox);
end;
$$;

