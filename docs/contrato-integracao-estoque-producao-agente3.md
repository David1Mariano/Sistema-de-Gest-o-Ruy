# AGENTE 3 — Contrato de Integracao Estoque / Producao com PostgreSQL Central

> Worktree proprio do Agente 3. Sem merge, sem rebase, sem push, sem migrations,
> sem alteracao de dados reais, sem copia de outros worktrees.
> Nenhuma regra de negocio foi alterada nesta execucao.

---

## 1. Branch, HEAD e status

- **Branch:** `agente-3`
- **HEAD:** `c45bfc62791efb7d97719e6269a3dc25ed288c0d` (fix collaborator expense deletion + history)
- **Log -3:** `c45bfc6` (HEAD), `2c3c045` merge daily expenses, `85231f0` stabilize daily expenses
- **Status no momento da entrega (`git status --porcelain=v1`):**
  - `M package.json` — scripts `server:*` + `test:api`, deps `express`, `pg`, `cors`, `@tanstack/react-query`
  - `M package-lock.json`
  - `?? docs/integracao-estoque-producao.md` — rascunho ja presente no worktree (nao commitado)
  - `?? server/` — infra Node/PostgreSQL **nao commitada** (observada, nao copiada, nao validada)
  - `?? src/api/postgresClient.js`, `?? src/hooks/useApi.js`, `?? src/lib/stockServicePostgres.js` (nao commitados)
- **Restricoes respeitadas:** sem merge/rebase/reset/push, sem migrations, sem credenciais, sem publish, sem apagar alteracoes, sem tocar na main.

---

## 2. Funcionalidades existentes (preservadas, sem alteracao)

Etapa 2A validada e intacta:

| Item | Arquivo | Garantia |
|---|---|---|
| Registro da producao | `DailyProductionDialog.jsx`, `src/pages/Producao.jsx` | CRUD DailyProduction, vinculo com ordem |
| Calculo do consumo (puro, sem I/O) | `src/lib/consumptionCalc.js` | `needed = quantity * (produced / yield_quantity)`; estados ok/no-recipe/bad-yield |
| Revisao de consumo (somente leitura) | `src/components/producao/ProductionConsumptionDialog.jsx` | Nao importa StockMovement/InventoryItem; texto "nenhuma alteracao sera feita no estoque" |
| Regras puras | `src/lib/stockRules.js` | tipos, validateMovement, costsAfter, roundQty/Money |
| Servico local (referencia, nao fonte central) | `src/lib/stockService.js` | CAS via transact, idempotencia por client_token, compensacao saldo-primeiro |
| Idempotencia app | `newClientToken()`, `findMovementByClientToken()` | duplicada retorna `duplicated:true` sem nova escrita |
| Concorrencia app-local | `InventoryItem.transact(..., {retries:6})` | le-calcula-grava dentro da transacao; nunca usa saldo da tela |

Nenhum arquivo de regra de negocio foi editado nesta execucao.

---

## 3. Funcionalidades ausentes ou nao verificadas (nao inventar Etapa 2B-2)

Nao existe no codigo commitado (HEAD), PENDENTE:

1. Botao "Confirmar baixa" no `ProductionConsumptionDialog.jsx` (hoje so Fechar/Continuar -> onClose).
2. Handler confirmacao -> gera client_token -> chama API atomica -> trata duplicated/conflict/insufficient.
---

## 4. Contrato necessario para a API central (necessidades, sem inventar endpoints/migrations)

Para o Agente 5 coordenar. Nomes abaixo sao necessidades, nao especificacao final:

- **Operacao atomica de confirmacao:** uma chamada, uma transacao PG. Entrada minima: clientToken (frontend), dailyProductionId, items[{inventoryItemId, neededQuantity>0, unitCost}], responsibleUser, observation?
- **Baixa multi-insumo em uma transacao:** SELECT FOR UPDATE nos InventoryItem em ordem estavel por ID; valida TODOS antes de escrever qualquer um; StockMovement(tipo=consumo_producao, origin_type=producao) por insumo + update de current_stock/average_cost/last_cost; marca daily_production.consumption_confirmed.
- **Validacao de saldo:** dentro da transacao, sobre valor com lock; erro tipado SALDO_INSUFICIENTE {itemId,itemName,currentStock,needed}; CHECK (current_stock >= 0) desejavel.
- **Concorrencia:** serializacao por FOR UPDATE; lock-timeout curto; retry limitado no frontend com NOVO token (nunca reutilizar token de tentativa incerta sem consultar antes).
- **Idempotente:** client_token UNIQUE; frontend gera antes da confirmacao; backend checa como 1a acao; se existe -> retorna original com duplicated:true.
- **Auditoria:** StockMovement{client_token,balance_before/after,responsible_user,origin_*} + AuditLog{action=confirmar_producao,entity=DailyProduction,user,details{clientToken,items}}; logar tentativas negadas.
- **Duplicada:** SELECT WHERE client_token=$1; sem nova escrita, sem 500.
- **Conflito:** SALDO_INSUFICIENTE (exige nova conferencia), CONFLICTO_CONCORRENCIA (retry limitado), TOKEN_DUPLICADO (retorna original), PERMISSAO_NEGADA (bloqueia botao).
- **Resposta perdida:** GET .../operacao/:clientToken -> {found:false} | {found:true,status,movements,items,error?}. Apos timeout, CONSULTAR primeiro; novo token so se found:false.
- **Permissoes:** validacao no backend + RLS em StockMovement/InventoryItem/DailyProduction; roles minimas producao,gerente,admin,super_admin; nunca confiar so no allowed do frontend.

---

## 5. Regras de confirmacao da baixa (nao negociaveis)

1. Revisao NAO baixa estoque (garantido por teste estatico, secao 7).
2. Baixa SO apos confirmacao explicita (botao dedicado; sem auto-baixa ao salvar DailyProduction).
3. Falha antes da confirmacao -> zero StockMovement, zero update de saldo.
4. Falha durante a transacao -> ROLLBACK total; nenhuma baixa parcial.
5. SALDO_INSUFICIENTE/conflito de versao -> exigir nova conferencia sobre saldo atual.
6. Apos timeout/erro de rede -> NAO reenviar automaticamente; consultar por client_token; novo token so se found:false.
7. IndexedDB/PGlite nunca e fonte central — no maximo cache/offline; saldos oficiais so do PG central.

---

## 6. Riscos de concorrencia e idempotencia
---

## 7. Testes executados (sem alterar dados reais)

| Comando | Resultado |
|---|---|
| `node scripts/test-fase2a.mjs` | FASE2A_OK 7/7 (proporcao 100/100, 200/100, fracionada, sem-ficha, rendimento invalido, comparacao estoque, dialogo-nunca-escreve-estoque) |
| `node scripts/check-fase2a.mjs` | FASE2A_STATIC_OK (dialogo-consulta-sem-escrita, acao-conferir-sem-persistencia) |
| `node scripts/test-production.mjs` | pass 5 / fail 0 (SPA/assets/rollback/seguranca/loopback) |
| `node scripts/test-daily-expenses.mjs` | pass 77 / fail 0 (warnings vite/esbuild no log, sem falha) |
| `node server/tests/api.test.js` (evidencia do worktree, PG local de teste) | pass 19 / fail 0: Fase2A (7) + Stock PG (6) + Production Flow (3) + Concorrencia FOR UPDATE (1) + Recovery (2). NAO reexecutado aqui para nao tocar em banco; validar com Agente 1/5 em BD isolado. |

Nenhum teste real de PG foi simulado com IndexedDB.

---

## 8. Testes pendentes (PENDENTES — contrato oficial nao confirmado)

Sem test-integracao-estoque-producao.mjs oficial. Preparar contra PG isolado (nunca dado real):

1. Revisao sem persistencia (abre/fecha dialog -> zero escrita).
2. Confirmacao explicita (clique -> 201 -> saldos batem com needed).
3. Estoque insuficiente (saldo 5, precisa 10 -> SALDO_INSUFICIENTE, zero StockMovement, saldo intacto).
4. Concorrencia (saldo 10, 2x precisa 6 paralelo -> 1 ok saldo 4, outra CONFLICTO/SALDO_INSUFICIENTE, sem parcial).
5. Duplicidade (mesmo token 2x -> 2a duplicated:true, 1 movimento).
6. Falha de conexao (derruba rede no POST -> consulta por token recupera).
7. Resposta perdida (ignora resposta -> GET .../:token retorna found:true).
8. Transacao revertida (constraint no meio -> rollback total).
9. Auditoria (StockMovement + AuditLog com client_token/origin/responsible/balances).
10. Dois usuarios (A e B conferem 100; A confirma -30 -> 70; B tenta -> falha; B re-confere 70).

---

## 9. Dependencias do Agente 1 e do Agente 5

**Do Agente 1 (auditoria/governanca):**

- Confirmar origem/integridade dos nao-commitados server/, postgresClient.js, useApi.js, stockServicePostgres.js, docs/integracao-estoque-producao.md: sao Etapa 2B-2 em progresso ou experimento local?
- Confirmar DDL oficial: UNIQUE(client_token), CHECK(current_stock>=0), daily_production.consumption_confirmed*, indices, triggers. Nenhuma migration rodada aqui.
- Confirmar se server/tests/api.test.js (19 pass) rodou em BD isolado e pode ser promovido.
- Definir RLS/permissoes oficiais e dono de stock_movement/inventory_item/daily_production/audit_log.

**Para o Agente 5 (coordenacao):**

- Checklist: migration client_token UNIQUE; constraint saldo; endpoint confirmacao atomica; endpoint consulta por token (uniformizar igualdade exata x LIKE); RLS; botao/handler Confirmar baixa; retry com novo token; consulta pos-timeout; test-integracao-estoque-producao.mjs em PG isolado.
- Resolver divergencia observada: POST /stock/confirm-production/:id x POST /production/daily/:id/confirm-consumption — escolher UMA oficial.
- Resolver token por operacao x por item (`${token}:${itemId}`) para que operation-result enxergue o mesmo token da confirmacao.
- Garantir: sem auto-retry apos timeout, sem IndexedDB como central, sem alterar stockService.js/consumptionCalc.js/dialog de revisao sem evidencia.

---

*Entrega do Agente 3 — PARE. Sem integracao a main, sem operacoes reais.*


- **Lost update:** dois GET+PATCH sem lock sobrescrevem saldo (10-2 e 10-3 -> 8 ou 7 em vez de 5). Mitigacao: FOR UPDATE + calculo dentro da transacao.
- **Baixa parcial:** falhar no 2o de 3 insumos sem transacao deixa inconsistencia. Mitigacao: transacao unica + rollback.
- **Duplo clique/retry:** mesmo clientToken 2x deve retornar original. Risco observado: confirmProductionConsumption deriva `${token}:${itemId}` por linha e checkOperationResult usa LIKE '<token>%'; a rota /token/:t busca igualdade exata. Agente 5 deve uniformizar (operation_id por confirmacao + client_token unico por movimento, ou tabela de operacoes).
- **Resposta perdida:** processou mas o cliente nao soube. Mitigacao: consulta por token antes de nova tentativa.
- **Conferencia stale:** A e B veem 100; A baixa 30; B confirma sobre numero antigo -> deve falhar e re-conferir 70.
- **Deadlock:** lockar itens em ordem diferente por requisicao. Mitigacao: ORDER BY id antes dos FOR UPDATE.
- **Idempotencia so-app nao basta:** checagem previa sem UNIQUE tem corrida. Mitigacao: UNIQUE(client_token) + violacao tratada como duplicated:true. DDL observado ja declara UNIQUE, mas como nao-commitado, Agente 1/5 devem confirmar migration oficial.
- **Custo medio:** recalcular fora da transacao diverge sob concorrencia; usar costsAfter dentro da transacao.

3. Transacao multi-insumo no servidor como contrato oficial.
4. Consulta de operacao por token como contrato oficial.
5. RLS/permissoes backend (hoje so gate UX `allowed` em Producao.jsx).
6. `scripts/test-integracao-estoque-producao.mjs` contra API real (nao existe; nao simular com IndexedDB).

Observado como **nao-commitado no worktree** (sem validar, sem concluir que e oficial):

- `server/services/stockService.js` (applyMovement, adjustStock, confirmProductionConsumption com BEGIN/COMMIT/ROLLBACK e FOR UPDATE).
- `server/services/productionService.js` (createDailyProduction, computeConsumptionPreview leitura, checkOperationResult via LIKE).
- `server/api/routes/stock.js` (POST /movement, /adjust, /receive-purchase/:id, /confirm-production/:id, GET /token/:t).
- `server/api/routes/dailyProduction.js` (GET /:id/consumption-preview, POST /:id/confirm-consumption, GET /operation-result/:token).
- `server/db/init.js` (DDL inventory_item, stock_movement com client_token UNIQUE, daily_production com consumption_confirmed*, audit_log).
- `server/tests/api.test.js` (19 testes PG — ver secao 7).
- `src/api/postgresClient.js`, `src/hooks/useApi.js`, `src/lib/stockServicePostgres.js`.

Status: **NAO VERIFICADO / PENDENTE de auditoria do Agente 1 e coordenacao do Agente 5**. Sem migrations, sem dado real, sem commit.

---

## 10. Finalizacao controlada (sem banco, sem main, sem alteracao de regra/layout)

Finalizacao pedida pelo coordenador: nenhuma regra de negocio foi editada e
nenhum layout foi alterado nesta execucao. Nenhum merge/push/migration foi
feito. Nenhum endpoint paralelo foi implementado e nenhum servico existente
foi duplicado. Nenhuma operacao foi executada no PostgreSQL operacional nem
no Supabase historico. Testes executados sao somente leitura/estatico, salvo
evidencia previa citada sem reexecucao.

### 10.1 Origem e proposito dos arquivos nao commitados (nao apagados)

Status (`git status --porcelain=v1`): `M package.json`, `M package-lock.json`,
`?? docs/contrato-integracao-estoque-producao-agente3.md` (este documento),
`?? docs/integracao-estoque-producao.md`,
`?? server/`, `?? src/api/postgresClient.js`,
`?? src/hooks/useApi.js`, `?? src/lib/stockServicePostgres.js`.

Origem verificada (somente leitura):
- `git show --name-only 99e9134` ("untracked files on cline checkpoint")
  lista exatamente `server/...`, `src/api/postgresClient.js`,
  `src/hooks/useApi.js`, `src/lib/stockServicePostgres.js` e
  `docs/integracao-estoque-producao.md`.
- `git show --name-only 56e6f0e` repete a mesma lista + este contrato.
- Ambos sao commits de checkpoint do tipo "untracked files on cline
  checkpoint", com 1 parent vazio de stash (root stash), ou seja, artefato
  local do worktree/sessao, nao copia de outro worktree e nao commit de
  branch. Nao foram apagados nem sobrescritos.

Proposito observado (sem validar como oficial):
- `server/` (index.js, config/, db/init.js + repositories/, services/,
  api/routes/, tests/api.test.js): esboco local de API Node/PostgreSQL.
- `server/db/init.js`: DDL observada (inventory_item, stock_movement com
  `client_token UNIQUE`, daily_production com `consumption_confirmed*`,
  audit_log).
- `server/services/stockService.js`: applyMovement/adjustStock/
  confirmProductionConsumption com BEGIN/COMMIT/ROLLBACK e FOR UPDATE.
- `server/services/productionService.js`: createDailyProduction,
  computeConsumptionPreview (leitura), checkOperationResult via LIKE.
- `src/api/postgresClient.js` + `src/hooks/useApi.js` +
  `src/lib/stockServicePostgres.js`: client/hook/servico frontend para a API
  local (nao ligados ao `base44Client` atual).
- `package.json` (modificado, nao commitado): scripts `server:*` +
  `test:api`, deps `express`, `pg`, `cors`, types.

### 10.2 Etapa 2B-2 existe em outra branch? (verificacao somente leitura)

Antes de classificar como ausente, verificado sem checkout/merge:

- `git ls-tree main -- server/services/stockService.js
  server/api/routes/stock.js server/db/init.js` -> vazio.
- `git ls-tree main -- server/ src/api/postgresClient.js
  src/lib/stockServicePostgres.js src/hooks/useApi.js` -> so `server/social`
  (diretorio legado nao relacionado).
- `git ls-tree agente-1 | agente-1-estoque-fase4 |
  agente-5-retomada-local -- server/` -> vazio nos tres.
- `git log --all -S "confirmProductionConsumption" -- server/ src/` ->
  vazio (nenhum commit rastreavel contem o simbolo via pickaxe).
- `git log --all -S "consumo_producao"` -> so checkpoints/stash locais
  (`8509a83` base segura de estoque, `48fd752`, `bfb7aa5`, `99e9134`,
  `56e6f0e`); nenhum branch real.
- `git stash list` -> vazio.

Conclusao: nenhuma branch com ref (`agente-1`, `agente-1-estoque-fase4`,
`agente-5-retomada-local`, `main`, demais locais listadas via for-each-ref)
contem `server/services/stockService.js` commitado. A implementacao da
confirmacao de baixa 2B-2 existe SOMENTE como artefato nao commitado deste
worktree (checkpoints `99e9134`/`56e6f0e`), portanto segue classificada como
**ausente do codigo commitado / NAO VERIFICADA**, sem afirmar que nunca foi
desenvolvida — a auditoria de origem/integridade cabe ao Agente 1.

### 10.3 Divergencias documentadas (observadas, sem implementar nada)

D1. Rotas duplicadas de confirmacao (colisao funcional). Ambas chamam o
mesmo `confirmProductionConsumption(productionId, confirmedBy, clientToken)`:
- `POST /api/stock/confirm-production/:productionId`
  (`server/api/routes/stock.js:132`, body `{confirmedBy, clientToken}`).
- `POST /api/production/daily/:id/confirm-consumption`
  (`server/api/routes/dailyProduction.js:92`, body identico).
Montadas em `server/api/routes/index.js` (`/stock` e `/production/daily`).
Client exposto nos dois: `postgresClient.js:69` (`stockApi.confirmProduction`)
e `:189` (`dailyProductionApi.confirmConsumption`); hook ativo so o segundo
(`useApi.js:410` `useConfirmConsumption`).
Contrato: Agente 5 escolhe UMA oficial e remove/desativa a outra (sem
endpoints paralelos).

D2. Token por operacao x por item + consulta inconsistente.
- `server/services/stockService.js:302` grava por linha
  `` `${clientToken}:${ing.inventory_item_id}` `` (ou `newClientToken('consumo')`
  se ausente); logo N linhas de uma confirmacao tem N tokens distintos.
- `confirmProductionConsumption` checa idempotencia via
  `LIKE '<token>%'` (`stockService.js:212-215`) e `checkOperationResult`
  (`productionService.js:287-311`) tambem usa `LIKE '<token>%'`.
- Porem `GET /api/stock/token/:clientToken` (`stock.js:40`) usa igualdade
  exata (`findByClientToken`), e `useApi.js:86`/`stockApi.getByToken`
  consultam por ela. Resultado: token-base da confirmacao NAO e encontrado
  pela rota de token exata; so aparece via LIKE de operation-result.
Contrato: separar `operation_token` (1 por confirmacao, UNIQUE em tabela de
operacoes ou coluna dedicada) de `client_token` (1 por StockMovement, UNIQUE);
consultas sempre por igualdade exata; LIKE proibido como mecanismo oficial.

D3. Import quebrado no client nao commitado.
- `src/lib/stockServicePostgres.js:7` importa `newClientToken` de
  `./consumptionCalc`, mas `consumptionCalc.js` NAO exporta esse simbolo
  (exports reais: CONSUMPTION_STATES, STOCK_STATES, toNumber,
  computeConsumption, stockStatus, findInventoryItem — confirmado via
  Select-String). A linha 176 reexporta o mesmo simbolo inexistente.
Efeito: qualquer caminho que importe `stockServicePostgres.js` quebra em
runtime/bundler. Como o arquivo e nao commitado e nao e usado pelo
`base44Client` atual, NAO foi corrigido aqui (proibido implementar/duplicar
servicos); Agente 5 deve importar `newClientToken` da origem correta
(`stockService.js` local) ou definir gerador unico no contrato oficial, e
Agente 1 deve auditar.

D4. Sem ordem de lock declarada.
- `confirmProductionConsumption` faz `SELECT ... FOR UPDATE` por ingrediente
  na ordem da ficha (`stockService.js:264`), sem `ORDER BY id`.
Contrato: ordenar itens por `inventory_item_id` antes dos locks (anti-deadlock)
e validar TODOS os saldos antes de qualquer escrita.

D5. Custos fora do padrao local.
- `stockService.js` nao-commitado usa `unit_cost = ing.unit_cost || 0` sem
  `costsAfter/average_cost` do `stockRules.js` commitado.
Contrato: recalcular custo medio dentro da transacao (regra de
`stockRules.js`), sem alterar o arquivo commitado sem evidencia.

### 10.4 Contrato recomendado (atomica, idempotencia, rollback, auditoria)

Sem inventar migration/endpoint final — requisitos que o Agente 5 oficializa:

1. **Atomica:** 1 chamada = 1 transacao PG (`BEGIN`, `COMMIT`, `ROLLBACK` em
   erro). Ordem: `daily_production FOR UPDATE` (recusa se
   `consumption_confirmed=TRUE`) -> checa `operation_token` exato (se existe,
   retorna original `duplicated:true`, sem escrita) -> `SELECT inventory_item
   ... FOR UPDATE` em ordem por ID -> valida saldo de TODOS ->
   N `INSERT stock_movement` (tipo `consumo_producao`, `origin_type=producao`,
   `balance_before/after`, `responsible_user`) + N `UPDATE inventory_item` ->
   marca `consumption_confirmed{,_at,_by}` -> `AuditLog(action=
   confirmar_producao, entity=DailyProduction)` -> `COMMIT`.
2. **Idempotencia:** `operation_token` gerado no frontend antes do clique
   (1 por confirmacao, nunca reutilizado apos timeout sem consulta);
   `client_token` unico por movimento (UNIQUE no banco; violacao = retornar
   original, nunca 500). Consulta oficial `GET .../operacao/:operationToken`
   por igualdade exata -> `{found:false}` ou `{found:true,status,movements,
   items,error?}`. Proibido auto-retry; proibido LIKE.
3. **Rollback:** qualquer falha (saldo, lock, constraint, auditoria) =
   `ROLLBACK` total, zero baixa parcial; erro tipado
   (`SALDO_INSUFICIENTE{...}`, `JA_CONFIRMADA`, `TOKEN_DUPLICADO`,
   `CONFLICTO_CONCORRENCIA`, `PERMISSAO_NEGADA`). Insuficiencia/conflito exige
   nova conferencia sobre saldo atual.
4. **Auditoria:** por confirmacao, `StockMovement` completo por insumo +
   `AuditLog` com `{operationToken, items, confirmedBy}`; tentativas negadas
   tambem logadas. Permissoes no backend + RLS (roles minimas
   producao/gerente/admin/super_admin); nunca so o `allowed` do frontend
   (`Producao.jsx:18`).
5. **Seguranca de revisao:** `ProductionConsumptionDialog` permanece somente
   leitura (teste estatico §7); baixa so apos clique explicito; falha
   pre-confirmacao = zero escrita; IndexedDB/PGlite jamais fonte central.

### 10.5 Separacao implementado x testado x pendente + riscos/dependencias

- **Implementado e preservado (commitado):** Etapa 2A completa
  (`DailyProductionDialog`, `consumptionCalc.js`, `ProductionConsumptionDialog`
  somente leitura, `stockRules.js`, `stockService.js` local com CAS +
  idempotencia + compensacao). Nenhum arquivo alterado aqui.
- **Testado nesta execucao (sem banco):** `test-fase2a.mjs` FASE2A_OK 7/7 e
  `check-fase2a.mjs` FASE2A_STATIC_OK (reexecutados agora). Evidencias
  anteriores preservadas sem reexecucao: `test-production.mjs` 5/5,
  `test-daily-expenses.mjs` 77/77, `server/tests/api.test.js` 19/19 (so em BD
  isolado; NAO rodado aqui para nao tocar em banco).
- **Pendente do Agente 5 (oficializar sem duplicar):** rota unica de
  confirmacao, modelo operation_token x client_token, ORDER BY nos locks,
  custo medio transacional, botao/handler Confirmar baixa, retry/consulta
  pos-timeout, RLS, `test-integracao-estoque-producao.mjs` em PG isolado
  (10 casos §8). Depende antes do Agente 1: origem/integridade dos
  nao-commitados, DDL oficial (UNIQUE/CHECK/`consumption_confirmed*`/indices),
  validade dos 19 testes, dono/RLS das tabelas.
- **Riscos se D1-D5 nao forem resolvidos:** dupla baixa pela rota errada,
  resposta-perdida irrecuperavel pelo token exato, crash de import no client
  PG, deadlock sob concorrencia, custo medio divergente, idempotencia so-app
  com corrida.
- **Arquivos envolvidos:** este contrato
  (`docs/contrato-integracao-estoque-producao-agente3.md`), rascunho
  (`docs/integracao-estoque-producao.md`), `server/` (25 arquivos, ex.
  `services/stockService.js`, `services/productionService.js`,
  `api/routes/stock.js`, `api/routes/dailyProduction.js`, `db/init.js`,
  `tests/api.test.js`), `src/api/postgresClient.js`, `src/hooks/useApi.js`,
  `src/lib/stockServicePostgres.js`, `package.json`/`package-lock.json`
  (modificados, nao commitados), mais os preservados da Etapa 2A (§2).

*Fim da finalizacao do Agente 3 — PARE. Sem merge/push/migration, sem main,
sem operacoes reais, sem PostgreSQL operacional/Supabase tocados.*

---

## 11. FINALIZACAO CONTROLADA (sem banco, sem main, sem endpoints paralelos)

Verificacao executada em 2026-10-13 no worktree `agente-3`, HEAD `c45bfc6`,
somente leitura + `node scripts/test-fase2a.mjs` e `node scripts/check-fase2a.mjs`.
Nenhuma regra de negocio e nenhum layout foram alterados.

### 11.1 Origem e proposito dos nao-commitados (preservados, nao apagados)

- `M package.json` / `M package-lock.json`: diff confirma adicao de scripts
  `server:dev`, `server:start`, `server:init-db`, `test:api` e deps
  `express`, `pg`, `cors`, `@types/*` — suporte a API Node/PostgreSQL local.
- `?? server/` (25 arquivos, ex. `services/stockService.js`,
  `services/productionService.js`, `api/routes/stock.js`,
  `api/routes/dailyProduction.js`, `db/init.js`, `tests/api.test.js`):
  infra B/C1 observada no worktree.
- `?? src/api/postgresClient.js`, `?? src/hooks/useApi.js`,
  `?? src/lib/stockServicePostgres.js`: client + servico PG no frontend.
- `?? docs/integracao-estoque-producao.md`: rascunho ja presente.
- Origem git: `99e9134` e `56e6f0e` ("untracked files on cline checkpoint")
  listam exatamente esses mesmos arquivos — ou seja, vieram de checkpoint
  automatico do Cline neste worktree, nao de commit em branch. Nao ha
  `show-ref` para esses hashes (objetos orfaos de checkpoint). Nao apagados,
  nao sobrescritos, nao copiados de outro worktree.

### 11.2 Etapa 2B-2 existe em outra branch? (verificacao somente leitura)

- `main -- server/` contem apenas `server/social/*` (Social/ManyChat); nenhum
  `server/services/stockService.js`, nenhuma rota `stock.js`/`dailyProduction.js`.
- `agente-5-retomada-local -- server/` = apenas `server/social/*`. Nao ha B/C1
  commitado la.
- `agente-1` e `agente-1-estoque-fase4` nao tem `server/` algum.
- `git log --all -S confirmProductionConsumption` e `-S consumo_producao`
  retornam apenas os checkpoints orfaos `99e9134`/`56e6f0e` + commits antigos
  de base segura (`8509a83`, `48fd752`, `bfb7aa5` — Fase 2A/CAS/Supabase, nao 2B-2).
- Conclusao: a 2B-2 **existe apenas como nao-commitado neste worktree**
  (checkpoint Cline), nao como implementacao commitada em outra branch. Por isso
  permanece classificada como NAO VERIFICADA / nao oficial — sem afirmar que
  "nunca foi desenvolvida".

### 11.3 Divergencias documentadas (sem duplicar servicos)

- D1 rota dupla confirmacao: `POST /stock/confirm-production/:productionId`
  (server/api/routes/stock.js:132, gera token se ausente) x
  `POST /production/daily/:id/confirm-consumption`
  (server/api/routes/dailyProduction.js:92, exige clientToken). Mesmo service
  `confirmProductionConsumption`, mesma tabela — risco de dupla baixa pela rota
  errada.
- D2 token por movimento x consulta inexata: gravacao
  `` `${clientToken}:${ing.inventory_item_id}` `` (stockService.js:302) +
  idempotencia via `WHERE client_token LIKE $1` (`${clientToken}%`, :215) e
  `checkOperationResult` via `LIKE` (productionService.js) x
  `GET /stock/token/:clientToken` exato (stock.js:40) e
  `postgresClient.stockApi.confirmProduction` apontando para a rota /stock.
  Agente 5 deve uniformizar para operation_token exato (contrato §10.4).
- D3 erro inconsistente: rota /stock retorna `StockError{code}` (400) x rota
  /daily faz match de substring (400) x demais erros 500.
- D4 import quebrado: `src/lib/stockServicePostgres.js:7` importa
  `newClientToken` de `./consumptionCalc`, mas `consumptionCalc.js` nao exporta
  essa funcao — crash em runtime se esse client for usado.
- D5 lock sem ordem: `SELECT ... FOR UPDATE` por ingrediente na ordem da ficha
  (stockService.js:263), sem ORDER BY — risco de deadlock; custo medio nao
  recalculado na confirmacao (so current_stock).
- Nenhum endpoint paralelo foi criado e nenhum servico foi duplicado nesta
  finalizacao.

### 11.4 Separacao final + arquivos, riscos, dependencias

- Implementado (commitado, preservado): Etapa 2A (§2). Nao alterado.
- Testado agora (sem banco): `test-fase2a.mjs` FASE2A_OK 7/7,
  `check-fase2a.mjs` FASE2A_STATIC_OK (reexecutados nesta finalizacao).
- Nao reexecutado de proposito: `server/tests/api.test.js` (exigiria PG),
  `test-production.mjs`, `test-daily-expenses.mjs` (evidencias anteriores
  preservadas).
- Pendente Agente 5: rota unica, modelo operation_token, ORDER BY, custo
  transacional, botao/handler Confirmar, retry/consulta pos-timeout, RLS,
  `test-integracao-estoque-producao.mjs` em PG isolado. Pre-req Agente 1:
  DDL oficial, validade dos 19 testes, dono/RLS.
- Arquivos envolvidos: este contrato + `docs/integracao-estoque-producao.md`,
  `server/` (25), `src/api/postgresClient.js`, `src/hooks/useApi.js`,
  `src/lib/stockServicePostgres.js`, `package.json`/`package-lock.json`.
- Riscos: D1 dupla baixa, D2 resposta-perdida irrecuperavel, D4 crash de import,
  D5 deadlock/custo, idempotencia so-app com corrida.
- Dependencias: Agente 1 (origem/integridade/DDL/RLS) -> Agente 5 (oficializar
  sem duplicar). Sem tocar PostgreSQL operacional ou Supabase historico.

*Entrega final do Agente 3 — PARE.*

