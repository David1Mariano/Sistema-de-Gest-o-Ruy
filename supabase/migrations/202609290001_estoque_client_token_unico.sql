-- ===========================================================================
-- Estoque Fase 4 — unicidade de `client_token` em StockMovement
--
-- ESTE ARQUIVO NÃO FOI APLICADO. Está pronto para revisão.
-- Não rode `supabase db push` nem aplique no painel sem aprovação.
--
-- ---------------------------------------------------------------------------
-- O PROBLEMA
-- Hoje a proteção contra movimentação duplicada é SÓ DA APLICAÇÃO: o
-- `stockService` consulta `findMovementByClientToken()` e, se não achar,
-- grava. Isso é "ler e depois agir" (check-then-act) e NÃO é atômico. Duas
-- máquinas que enviam a MESMA operação com o mesmo token ao mesmo tempo
-- podem passar as duas pela consulta e criar DOIS lançamentos.
--
-- O ÍNDICE CORRETO
-- O escopo é UNICAMENTE por token, dentro da entidade StockMovement:
--
--   create unique index ... on public.records ((data->>'client_token'))
--   where entity = 'StockMovement' and coalesce(data->>'client_token','') <> '';
--
-- Por que NÃO é composto (ex.: por empresa/filial/usuário):
--   - Não existe multi-tenant no app: não há merchant_id, unit_id nem
--     equivalente em StockMovement (auditado no schema e no código).
--   - `client_token` é gerado pelo SERVIDOR dentro do stockService
--     (newClientToken: prefixo + UUID aleatório), não vem do cliente. Logo,
--     colisão entre instalações diferentes é desprezível por construção.
--   - Para compras o token é derivado do negócio e NÃO aleatório:
--     `compra:{purchase.id}:{purchaseItem.id}`. Ainda assim é único no
--     escopo global, porque compra.id e purchaseItem.id são ids únicos.
--   - Se um dia houver multi-tenant, é só prefixar o índice com a coluna de
--     escopo. Hoje ela não existe, e criar um índice por entidade já é o
--     isolamento correto.
--
-- Por que ÍNDICE PARCIAL (`where ... <> ''`):
--   - Movimentações legadas não têm `client_token` (a coluna não existia).
--   - Um índice UNIQUE sobre jsonb trata todo `NULL` como DISTINTO, então
--     múltiplos NULLs passariam. Mesmo assim o predicado deixa o índice
--     pequeno e explicita a intenção: só movimentos com token contam.
--   - `''` (vazio) também seria repetido, e NÃO deve ser: token vazio
--     significa "sem idempotência". O serviço nunca grava vazio.
-- ===========================================================================

-- 1) Índice único parcial por token, restrito a StockMovement.
create unique index if not exists records_movimento_client_token_unico
  on public.records ((data ->> 'client_token'))
  where entity = 'StockMovement'
    and coalesce(data ->> 'client_token', '') <> '';

comment on index public.records_movimento_client_token_unico is
  'Estoque: garante 1 StockMovement por client_token (idempotência contra duplo envio).';

-- ===========================================================================
-- PRÉ-CHECK (rode ANTES de aplicar; se devolver linhas, NÃO aplique ainda —
-- há tokens repetidos no histórico e é preciso decidir o que fazer com eles).
-- ===========================================================================
/*
select data ->> 'client_token' as token,
       count(*) as ocorrencias,
       array_agg(id) as ids
  from public.records
 where entity = 'StockMovement'
   and coalesce(data ->> 'client_token', '') <> ''
 group by 1
having count(*) > 1
 order by 2 desc;
*/
