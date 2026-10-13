# Plano de recuperação de dados históricos — Supabase → PostgreSQL local

Status: **PLANO / INVESTIGAÇÃO**. Nenhum dado foi exportado, importado ou migrado.
Nenhuma migration foi aplicada. Nenhuma credencial foi copiada para o repositório.
Data da investigação: 13/10/2026. Branch: `agente-5-retomada-local` (criada a partir
de `integracao-filtro-categoria-gastos`, HEAD `bf2eac5`). O `main` original não foi
alterado.

## 1. Objetivo

Recuperar o histórico de dados hoje residentes no Supabase
(projeto `wvcvveqdkecsoygtilop`) para o PostgreSQL 17 local
(serviço `postgresql-x64-17`, máquina `ADM-RUY`), preservando:

- a autenticação e o trabalho do Agente 5 já presentes no código;
- o repositório original e o branch `main` intocados;
- a regra acordada: **nenhuma migração de dados roda sem autorização explícita**.

## 2. Estado verificado nesta investigação

### 2.1 Ambiente local

| Item | Estado |
|---|---|
| PostgreSQL | Serviço `postgresql-x64-17` **Running** (StartType Automatic) |
| `psql` | `C:\Program Files\PostgreSQL\17\bin\psql.exe` (fora do PATH) |
| Autenticação PG | `pg_hba.conf` exige `scram-sha-256` para local/TCP — **senha necessária** |
| Inventário de databases/tables | **Bloqueado**: senha do `postgres` desconhecida |
| Backups existentes no disco | Nenhum `.dump`/`.backup`/`.sql.gz` relevante em `C:\Users\Pichau` |
| `.env.local` | Inexistente neste checkout e no projeto original |
| Variáveis de ambiente PG/DATABASE | Nenhuma definida |

### 2.2 Repositório

- Histórico git recuperado com sucesso (log, branches, grafo). ~50 branches locais/remotos.
- Diretórios `repositorio_recuperacao/`, `backups_recuperacao/` e `worktrees/ruy_recuperacao`
  **não existem** (o registro de criação em sessão anterior não persistiu). Criar apenas
  quando a Fase 2 começar; backups de dump vão para `backups_recuperacao/` (gitignored).
- `supabase/migrations/` contém apenas 2 migrations, ambas **preparadas e não aplicadas**:
  - `20260929010000_estoque_client_token_unico.sql`
  - `20260929010100_estoque_rpc_transacional.sql`


### 2.3 Arquitetura de dados de origem (Supabase)

O app não usa schema por entidade. Toda a aplicação persiste em **UMA tabela
genérica** e nos serviços nativos do Supabase:

| Camada | Onde no Supabase | Detalhe |
|---|---|---|
| Entidades da aplicação | `public.records` | `(entity, id, data jsonb, created_date, updated_date)` — REST via `cloudDb.js` |
| Autenticação | `auth.users` (Supabase Auth) | Espelho da entidade `AuthUser` em `records` (contém senha compartilhada legada — **não exportar**; ver `docs/auth-migration-audit.md`) |
| Redes sociais | tabelas `social_*` | Schema proposto em `scripts/proposed-social-*.sql`; aplicação parcial/não confirmada — verificar antes de exportar |
| Anexos | Storage bucket `anexos` | Privado (`public=false`), 15MB, JPEG/PNG/WEBP/PDF; **zero policies** em `storage.objects`; upload já testado como 403 |

Entidades que trafegam em `records` (lista canônica em `src/api/base44Client.js`):
Absence, AccountsPayable, AccountsReceivable, AuditLog, CardReceivable, CashMovement,
Consumption, CostCenter, DailyFinancialClose, DailyProduction, DeliverySettlement,
Employee, EmployeeDocument, EmployeePayment, Evaluation, ExpenseCategory,
FechamentoCaixa, FinancialAccount, FinancialExpense, InventoryItem, JobRole,
MachineRotation, ManualReconciliation, ProductionOrder, ProductionProduct,
RecipeIngredient, RecurringExpense, Revenue, Sangria, Schedule, Sector,
StandardSchedule, StockMovement, Supplier, SystemSettings, TimeRecord, Vale, Warning.

Credencial pública conhecida (publishable/anon key) está em `src/lib/cloudConfig.js`
por design. A `service_role` **não existe no repositório** e não deve ser commitada.

## 3. Lacunas e bloqueios (precisam do usuário)

1. **Senha do PostgreSQL local** (`postgres` ou usuário equivalente). Sem ela não dá
   para inventariar o que já existe no banco local nem importar nada.
2. **Acesso administrativo ao Supabase** para exportação. Opções (em ordem de preferência):
   - (a) o usuário roda os SQL de inspeção somente-leitura já existentes
     (`scripts/inspect-records-auth.sql`, `scripts/inspect-payment-storage.sql`)
     no SQL Editor e fornece os resultados;
   - (b) exportação CSV/SQL via Dashboard do Supabase feita pelo próprio usuário;
   - (c) `service_role` fornecida **apenas como variável de ambiente da sessão de
     execução** (`SUPABASE_SERVICE_ROLE`), nunca em arquivo versionado — permite
     dump programático completo, contornando RLS.
   Obs.: a chave pública + sessão de usuário autenticado é insuficiente para um dump
   confiável: as policies de RLS de `records` são desconhecidas (risco de exportar
   um recorte parcial sem perceber).
3. **Decisão sobre anexos (`storage.objects`)**: o bucket é privado com zero policies.
   Se o acesso administrativo não recuperar os objetos, os comprovativos históricos
   precisam de plano próprio (ver Fase 2c).
4. **Confirmação de escopo**: recuperar apenas `records`+Auth, ou também `social_*`
   e Storage?


## 4. Plano em fases (nada executado sem autorização)

### Fase 0 — Preparação (sem tocar em dados)

1. Obter do usuário os itens da Seção 3.
2. Criar `backups_recuperacao/` com entrada no `.gitignore`.
3. Definir o schema alvo local (Seção 5) e revisar com o usuário.

### Fase 1 — Inventário somente leitura

1. Local: `psql` com senha efêmera (`PGPASSWORD` só na sessão) → listar databases,
   tabelas, contagens, tamanho. Nada de criar/dropar.
2. Remoto: rodar os SQL de inspeção (opção 3a/3b/3c) → políticas RLS de `records`,
   total de linhas por `entity`, inventário de `auth.users` **sem senhas**,
   estado real das tabelas `social_*`, objetos do bucket `anexos`.

### Fase 2 — Exportação (após autorização explícita)

- **2a. `records`**: dump JSON/CSV por `entity` (incluindo `created_date`/`updated_date`).
  Guardar em `backups_recuperacao/supabase-<data>/records/`.
- **2b. Auth**: apenas metadados (`id`, `email`, `created_at`, `last_sign_in_at`).
  **Nunca** exportar hashes/senhas legadas. A migração de identidade segue o plano
  de `docs/auth-migration-audit.md` (convite por provedor, não importação de senha).
- **2c. Anexos**: exportar `storage.objects` (path, tamanho, checksum) e baixar os
  arquivos pelo endpoint administrativo. Se indisponível, registrar inventário e
  escalonar ao usuário antes de qualquer tentativa mais intrusiva.
- **2d. `social_*`**: somente se confirmado aplicado e no escopo.

### Fase 3 — Schema alvo local

1. Reproduzir em database dedicado (ex.: `gestao_ruy`) o espelho de `records`
   com `entity, id, data jsonb, created_date, updated_date`, PK `(entity, id)`,
   índices por `entity` — mesma forma lógica que o app espera hoje.
2. Tabelas `social_*` apenas se no escopo (aplicar os `scripts/proposed-social-*.sql`
   revisados, não as migrations de estoque — estas seguem decisão separada).
3. NÃO expor o banco local sem um caminho de acesso no app (hoje o frontend fala
   REST do Supabase via `cloudDb.js`); isso é assunto da Fase 5.

### Fase 4 — Importação e verificação (dry-run antes)

1. Importar para staging, nunca direto na tabela final.
2. Verificar: contagem de linhas por `entity` origem×destino; soma de campos
   financeiros-chave (`amount`, `net_amount`, `current_stock`) por entidade;
   amostragem de 10 registros por entidade conferindo JSON.
3. Só após aprovação, promover staging → final dentro de transação, com
   backup local prévio (`pg_dump` do banco vazio/staging).

### Fase 5 — Corte do app para o banco local (decisão separada)

Requer: caminho de acesso no frontend (adaptar `cloudDb.js`/novo backend local
mantendo a mesma interface de entidades), política de sessão (o trabalho de auth
do Agente 5), e janela de parada combinada. **Fora do escopo deste plano até
autorização explícita.**



## 5. Regras de segurança

- Segredos só por variável de ambiente da sessão; zero segredos em arquivos
  versionados (a publicação de produção já bloqueia `service_role`/`sb_secret`).
- Nunca exportar/importar senhas legadas; identidades vão por convite do provedor.
- Nenhum comando destrutivo: sem `DROP`, sem `DELETE`, sem recriar cluster PG,
  sem `git reset/checkout` em branches de terceiros.
- Backups de dump fora do git (`backups_recuperacao/`).
- Toda Fase 2+ começa apenas com autorização explícita registrada nesta thread.

## 6. Próximos passos imediatos

1. Usuário fornece: senha do PostgreSQL local; forma de acesso administrativo ao
   Supabase (3a/3b/3c); escopo confirmado (records+Auth / +social / +anexos).
2. Rodar Fase 1 (inventário somente leitura) e anexar resultados a este documento.
3. Apresentar contagens e divergências ao usuário antes de qualquer exportação.

## 7. Progresso da Fase 1 (atualizado em 13/10/2026)

### 7.1 Etapa 1 concluída — inventário do Supabase (confirmado pelo usuário)

`public.records` tem **1.067 registros em 16 entidades**:

| Entity | Linhas |
|---|---:|
| AuditLog | 504 |
| FinancialExpense | 165 |
| EmployeePayment | 134 |
| Consumption | 93 |
| Employee | 63 |
| Vale | 55 |
| JobRole | 17 |
| Absence | 8 |
| Warning | 6 |
| Sector | 6 |
| ExpenseCategory | 5 |
| AccountsPayable | 4 |
| FechamentoCaixa | 4 |
| AuthUser | 1 |
| StockMovement | 1 |
| InventoryItem | 1 |

Não há, nesta contagem, linhas sem `entity` (nenhuma entity extra apareceu).

### 7.2 Etapas 2 e 3 prontas para execução (somente leitura, SQL Editor do Supabase)

- `scripts/inventario-recuperacao-etapa2.sql`: existência/contagem das tabelas
  `social_*`; perfil do `AuthUser` SEM valores sensíveis (só nomes de chaves do
  JSONB, papel e status — nunca senha/hash); contagem de `auth.users`
  (metadados); bucket `anexos` (política, MIME, tamanho, objetos, prefixos).
- `scripts/inventario-recuperacao-etapa3.sql`: checksums globais e por entity,
  totais financeiros (`amount`, `net_amount`, `current_stock`), anexos embutidos
  no JSON (`proof_url`/`invoice_url`: data URI vs URL vs caminho) e checagens
  relacionais informativas. Estas saídas são a referência oficial de validação.
- `scripts/inventario-recuperacao-etapa4-exportacao.sql`: exportação em dois
  CSVs baixados do próprio SQL Editor ("Download CSV"): `records.csv` **sem**
  AuthUser (1.066 linhas) e `authuser.csv` com AuthUser **redigido** (chaves de
  credencial/hash removidas do JSON), cada um com checksum insensível à ordem
  para conferência bit a bit no staging.

### 7.3 Exportação e staging preparados (NÃO executados; aguardam autorização)

- Exportação alvo (Etapa 4): `records.csv` (records sem AuthUser) + `authuser.csv`
  (AuthUser redigido), baixados do SQL Editor e salvos em `backups_recuperacao/`
  (pasta ignorada pelo git). **Não abrir no Excel.**
- Staging local preparado em `scripts/recuperacao/`:
  `01` cria banco separado `gestao_ruy_staging`; `02` cria schema/tabela de
  estágio (colunas TEXT, sem casts); `03` importa via `\copy`; `04` valida
  total (1.066 + AuthUser redigido), contagem por entity, integridade básica,
  checksums, totais financeiros e referências por id — tudo comparado com as
  Etapas 1 e 4.
- Senha do PostgreSQL local: digitada pelo proprietário no próprio terminal.
  Nada de senhas/chaves em conversa, scripts ou repositório.
- Nenhuma escrita foi feita no Supabase; nenhum banco local foi criado ainda.

### 7.4 Resultados parciais da Etapa 2 — parte Storage (executada pelo proprietário)

- Bucket `anexos`: `public=false`, limite 15 MB/arquivo, MIME permitidos
  JPEG/PNG/WEBP/PDF.
- **59 objetos, total 2.928.141 bytes.**
- Partes A (tabelas `social_*`) e B (AuthUser/auth.users) da Etapa 2 ainda
  aguardam o envio das abas de resultado; Etapa 3 entregue para revisão.
- Procedimento separado de verificação de download dos 59 anexos:
  `scripts/verificar-download-anexos.ps1` — testa o GET de cada objeto via API
  **sem** tornar o bucket público; o relatório contém apenas status HTTP, bytes
  e hash md5+sal do caminho (nunca conteúdo, nome de arquivo ou chave).
  **NÃO executado; aguarda autorização.**

### 7.5 Revisão da Etapa 3 — integridade relacional ampliada (NÃO executada)

- Motivo: o proprietário pediu conferência dos vínculos ainda não verificados,
  com destaque para `Vale` e `Warning`, antes de autorizar a execução.
- Seção 4 da Etapa 3 revisada com base no código real (`employeeDelete.js`,
  `ValeForm.jsx`, `WarningForm.jsx`, `Financeiro.jsx`, `dailyExpenses.js`,
  `Compras.jsx`, `standardScheduleData.js`, `evaluationsData.js`,
  `employeeDocumentStorage.js`):
  - **4a — fonte COM linhas na origem (17 checagens):** as 5 já existentes
    (EmployeePayment→Employee, Absence→Employee, JobRole→Sector,
    StockMovement→InventoryItem, FinancialExpense→ExpenseCategory) + 12 novas:
    `Vale.employee_id`, `Warning.employee_id`, `Consumption.employee_id`,
    `FinancialExpense.employee_id`, `FinancialExpense.beneficiary_id`,
    `EmployeePayment.financial_expense_id`, `Vale.financial_expense_id`,
    `AccountsPayable.financial_expense_id`, `AccountsPayable.category_id` e
    `FinancialExpense.origin_id` polimórfico (origin_type `vale`→Vale,
    `conta_pagar`→AccountsPayable, `pagamento_colaborador`→EmployeePayment).
  - **4b — checagens válidas porém fonte vazia hoje (6):** `Schedule.employee_id`,
    `Schedule.substitute_id`, `TimeRecord.employee_id` e
    StandardSchedule/Evaluation/EmployeeDocument → Employee (entidades sem
    linhas na origem; mantidas por paridade com o staging).
  - **4c — pendentes (não checadas):** `AuditLog.entity_id` (polimórfico),
    `origin_id` dos tipos `recorrencia`/`lote` (escritor/alvo não confirmados)
    e `*_id` → CostCenter/FinancialAccount/Supplier/Purchase (alvos com 0
    linhas no records) — exigem decisão do proprietário.
- Espelho exato aplicado em `scripts/recuperacao/04-validar-staging.sql`
  (seção 6), com coluna `grupo` (4a/4b) nos dois lados para comparação
  linha a linha entre origem e staging.
- Ainda **NÃO executado**: aguarda autorização do proprietário para rodar a
  Etapa 3 no SQL Editor. Nenhuma escrita foi feita em Supabase ou PostgreSQL.
- `scripts/verificar-download-anexos.ps1` revisado junto; **NÃO executado;
  aguarda autorização separada.**

