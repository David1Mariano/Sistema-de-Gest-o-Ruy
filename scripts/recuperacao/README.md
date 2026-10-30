# Recuperação — banco de staging (LOCAL, SEPARADO do operacional)

> **NÃO EXECUTAR NENHUM DESTES SCRIPTS SEM AUTORIZAÇÃO EXPLÍCITA DO PROPRIETÁRIO.**
> Este diretório só prepara a restauração. Nada foi criado, importado ou alterado ainda.

## O que é o staging

- Banco local `gestao_ruy_staging`, totalmente **separado** do banco operacional.
- Dados importados como **texto bruto** (fidelidade byte a byte do CSV exportado);
  casts para tipos (uuid, jsonb, datas) acontecem só na validação/promoção futura.
- O CSV exportado é a **fonte de verdade**; o staging é apenas o espelho de trabalho.

## Pré-requisitos (executados por VOCÊ, no seu terminal)

1. Senha do PostgreSQL local digitada apenas no seu terminal (`PGPASSWORD` ou prompt).
   **Nunca** cole senha em chat, script, issue ou arquivo versionado.
2. CSVs exportados pela **Etapa 4** (`scripts/inventario-recuperacao-etapa4-exportacao.sql`),
   baixados direto do SQL Editor ("Download CSV" no painel de resultados) e
   salvos em `backups_recuperacao/supabase-AAAA-MM-DD/`:
   - `records.csv` — records SEM AuthUser (1.066 linhas; cabeçalho
     `entity,id,data,created_date,updated_date`).
   - `authuser.csv` — AuthUser **redigido** (1 linha; cabeçalho
     `id,data,created_date,updated_date`; já sem chaves de credencial/hash).
   - **Não abra os CSVs no Excel** (corrompe UUIDs, datas e JSON com vírgulas).
     Para inspecionar, use o Visual Studio Code ou Bloco de Notas.
   - Nunca cole o conteúdo dos CSVs ou das queries em chat/issue/arquivo.

## Sequência de execução (quando autorizada)

No PowerShell (ajuste o caminho do psql se a sua instalação for outra):

```powershell
# 0) Criar pasta de backup e colocar o records.csv lá
New-Item -ItemType Directory -Force "C:\Users\Pichau\gestao-ruy-agente-5\backups_recuperacao\supabase-2026-10-13"

# 1) Criar o banco de staging (arquivo 01)
$env:PGPASSWORD = Read-Host -MaskInput "Senha do postgres (aparece so na sua sessao)"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -c "create database gestao_ruy_staging encoding 'UTF8' template template0"

# 2) Criar schema + tabela de estagio (arquivo 02)
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d gestao_ruy_staging -f "C:\Users\Pichau\gestao-ruy-agente-5\scripts\recuperacao\02-criar-tabelas-staging.sql"

# 3) Importar os dois CSVs (arquivo 03 — ajuste os caminhos se necessario)
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d gestao_ruy_staging -f "C:\Users\Pichau\gestao-ruy-agente-5\scripts\recuperacao\03-importar-csv-copy.sql"

# 4) Validar (arquivo 04) e enviar os resultados para análise
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d gestao_ruy_staging -f "C:\Users\Pichau\gestao-ruy-agente-5\scripts\recuperacao\04-validar-staging.sql"

Remove-Item Env:\PGPASSWORD
```

## O que a validação confere

- Total de linhas = 1.066 (records) + 1 (AuthUser redigido) e contagem por
  entity = tabela da Etapa 1 sem AuthUser (inclusive entities inesperadas ou
  faltantes via FULL OUTER JOIN).
- ID semântico: sem entity vazia, sem id vazio, data válida como JSON.
- Checksums (insensíveis à ordem) comparáveis com a Etapa 4 da origem.
- Totais financeiros (amount / net_amount / current_stock) por entity.
- Referências por id (ex.: EmployeePayment→Employee); órfãos são informativos.

## Observação sobre divergência de checksum

Se contagens, ids e totais financeiros baterem mas o checksum global divergir,
quase sempre é diferença de **formatação de data/JSON** entre a saída de texto
do Supabase e o CSV do Dashboard. Nesse caso, mande as duas saídas (origem e
staging) para análise — o CSV exportado continua sendo a fonte de verdade.
