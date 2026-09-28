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
--
-- CUIDADOS REVISADOS NESTA FASE (verificados por consulta, item 6):
--   1. VAZIO (''): excluído pelo predicado. O serviço nunca grava token
--      vazio — `...(clientToken ? { client_token: clientToken } : {})` só
--      inclui a chave quando ela é truthy. Sem isso, todos os lançamentos
--      sem token colidiram entre si e o índice falharia na aplicação.
--   2. ESPAÇOS: NÃO são removidos. Um token ' abc' e 'abc' seriam DIFERENTES
--      no índice, abrindo brecha de idempotência. Nenhum gerador do app
--      produz espaço, mas um cliente hostil poderia. Mitigação proposta
--      para quando a RPC entrar em uso: validar o formato do token na
--      própria função (item 6 do pré-check) e/ou normalizar com btrim().
--      Deixamos o índice literal de propósito: aplicar btrim() no índice
--      mudaria a semântica da chave e mascararia dado sujo.
--   3. CASE: o índice é case-SENSITIVE (btree em texto). 'ABC' ≠ 'abc'. Os
--      tokens gerados são minúsculos (`mov_`/`ajuste_`/`abertura:` +
--      hex lowercase, ou `compra:{id}:{id}`), então a colisão por caixa
--      alta não ocorre no uso normal — mas o índice NÃO impede alguém de
--      burlar a idempotência mudando a caixa. Mesma mitigação do item 2:
--      validação de formato no servidor.
--   4. DATA LEGADA: tokens com o MESMO valor em outro `entity` não
--      conflitam, porque o índice é parcial por entity='StockMovement'.
--
--(idx: os pontos 2 e 3 são lacunas conhecidas e só fecham quando a RPC
-- passar a validar o token. A migração do índice, sozinha, não é
-- suficiente para idempotência contra cliente hostil.)
-- ===========================================================================

-- 1) Índice único parcial por token, restrito a StockMovement.
create unique index if not exists records_movimento_client_token_unico
  on public.records ((data ->> 'client_token'))
  where entity = 'StockMovement'
    and coalesce(data ->> 'client_token', '') <> '';

comment on index public.records_movimento_client_token_unico is
  'Estoque: garante 1 StockMovement por client_token (idempotência contra duplo envio).';

-- ===========================================================================
-- PRÉ-CHECK (rode TODOS os blocos antes de aplicar). Se qualquer um devolver
-- linhas ou ≠ 0, NÃO aplique ainda.
-- ===========================================================================

-- (1) Tokens duplicados: impediria a criação do índice.
select data ->> 'client_token' as token,
       count(*) as ocorrencias,
       array_agg(id) as ids
  from public.records
 where entity = 'StockMovement'
   and coalesce(data ->> 'client_token', '') <> ''
 group by 1
having count(*) > 1
 order by 2 desc;

-- (2) Tokens com espaço nas pontas (não colidem no índice; ver item 2 acima).
select id, '[' || (data ->> 'client_token') || ']' as token_bruto
  from public.records
 where entity = 'StockMovement'
   and (data ->> 'client_token') <> ''
   and (data ->> 'client_token') <> btrim(data ->> 'client_token');

-- (3) Tokens com caixa alta (não colidem; ver item 3 acima).
select id, data ->> 'client_token' as token
  from public.records
 where entity = 'StockMovement'
   and (data ->> 'client_token') <> ''
   and (data ->> 'client_token') <> lower(data ->> 'client_token');

-- (4) Confere se algum movimento de outra entidade usa o MESMO token. Não é
--     conflito (o índice é parcial por entity), mas é informação útil.
select entity, data ->> 'client_token' as token, count(*)
  from public.records
 where coalesce(data ->> 'client_token', '') <> ''
 group by 1, 2
having count(*) > 1
 order by 3 desc;
