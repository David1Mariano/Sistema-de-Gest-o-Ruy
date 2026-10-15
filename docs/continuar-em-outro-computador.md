# Continuar o desenvolvimento Windows em outro computador

Branch: `preparacao/windows-oficial-20261015`. O commit e o push desta entrega
contêm fontes, schemas exclusivamente de laboratório, testes, lockfiles e assets
licenciados. Não contêm dados, contas, senhas, arquivos .env, DPAPI ou backups.

## Obter e conferir a fonte

```powershell
git clone --branch preparacao/windows-oficial-20261015 --single-branch https://github.com/David1Mariano/Sistema-de-Gest-o-Ruy.git
cd Sistema-de-Gest-o-Ruy
git status --short --branch
git log -1 --oneline
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd ci --prefix server/d1-lab --ignore-scripts --no-audit --no-fund
npm.cmd ci --prefix desktop --no-audit --no-fund
node desktop/node_modules/electron/install.js
```

Pré-requisitos de desenvolvimento: Windows, Git, Node 24/npm compatível com
lockfiles e PostgreSQL 17 instalado de origem confiável. O executável do aplicativo
inclui Electron/Node; a preparação do laboratório ainda depende do Node externo
e dos binários PostgreSQL. Não há serviço Windows permanente instalado pelo projeto.
Se o PostgreSQL estiver fora do caminho padrão, definir `RUY_LAB_PG_BIN` apenas
no processo que executará a preparação. Não reutilizar credenciais operacionais.

## Preparar ambientes novos, sem dados reais

Estado atual: [Produção/Financeiro 0.3.0 e pendências](etapa-e-producao-financeiro.md).
Em laboratório D1 já existente da etapa 0.2, não usar `init` ou bootstrap.
Aplicar somente a extensão sintética, antes de iniciar o aplicativo 0.3:

```powershell
node scripts/d1-lab/prepare-domain.mjs
node scripts/d1-lab.mjs stop-api
node scripts/d1-lab.mjs start-api
```

O primeiro comando preserva as linhas e amplia o contrato de documentos no
banco D1 marcado. Não recebe URL ou credencial do banco operacional.
Atualizar também a API C2 de laboratório para reconhecer os novos snapshots:

```powershell
node scripts/sync-lab.mjs stop central
node scripts/sync-lab.mjs start central
```

```powershell
node node_modules/vite/bin/vite.js build --config lab/d1/vite.config.mjs
node scripts/d1-lab/bootstrap-windows.mjs --new-synthetic-lab
powershell.exe -NoProfile -File scripts/d1-lab/create-user.ps1 -Role admin
# O helper retorna UUID e papel, nunca a senha. Usar o UUID retornado:
node scripts/d1-lab/provision-sync.mjs UUID_DO_ADMIN_FICTICIO
npm.cmd --prefix desktop run dist
```

O bootstrap recusa qualquer um dos dois diretórios já existentes e preserva
ambientes parciais em caso de falha. Nesse caso, investigar logs e retomar etapas
específicas; não apagar o cluster nem repetir init para contornar o bloqueio.
O teste desta entrega comprovou a recusa sobre ambiente existente. Execução
completa em um Windows novo ainda precisa de VM/máquina de homologação.

Destinos fixos, todos loopback e separados da produção:

| Ambiente | Home do usuário Windows | PostgreSQL | API |
|---|---|---|---|
| D1 | `%LOCALAPPDATA%\GestaoRuy\etapa-d1-lab` | 55436, `ruy_d1_disposable` | 18087 |
| C2 central/dispositivos | `%LOCALAPPDATA%\GestaoRuy\etapa-c2-sync` | 55435, bancos C2 próprios | 18086 central; 18084/18085 A/B |

As senhas são geradas no computador novo e protegidas por DPAPI/ACL. O PostgreSQL
operacional em 5432 e a aplicação 8080 não são usados por esses comandos. A ponte
D1/C2 usa token por usuário/dispositivo, fora do renderer, para a central local
fixa. Não aceita URL Supabase. O vínculo é explícito, não existe sincronização
operacional automática, e o piloto da ponte exige administrador fictício.

Para ambientes antigos já existentes, revisar e executar apenas preparações D1
idempotentes: `prepare-catalog.mjs`, `prepare-operations.mjs`, `prepare-sync.mjs`.
O último também exige a central C2 marcada e disponível. Schemas não são migrations
de produção nem devem ser executados no Supabase original.

## Retomada e testes

Se os clusters estiverem parados:

```powershell
node scripts/d1-lab.mjs start-db
node scripts/sync-lab.mjs start-db
node scripts/sync-lab.mjs start central
node scripts/d1-lab.mjs start-api
npm.cmd run lint
npm.cmd run build
npm.cmd run typecheck
$env:RUY_D1_ALLOW_TESTS='1'
# Somente numa máquina nova, sem produção 8080 nem active.json operacional:
$env:RUY_NEW_MACHINE_LAB='1'
node --require ./scripts/d1-lab/bridge-network-guard.cjs scripts/d1-lab/test-sync-bridge.mjs
node --require ./scripts/d1-lab/bridge-network-guard.cjs scripts/d1-lab/test-operational-persistence.mjs
```

As duas suítes reiniciam somente D1 e criam fixtures/bancos sintéticos novos sem
apagar os anteriores. Testes antigos D1/C2 têm pré-requisitos de health C1/8080:
não iniciar a produção antiga apenas para satisfazer esse pré-requisito numa VM
nova. Os dois testes novos suportam a ausência verificada da produção com
`RUY_NEW_MACHINE_LAB=1`; esse modo recusa ignorar falha se existir active.json
operacional e não aceita serviço inesperado na porta 8080. Nunca apontar teste de escrita
para banco operacional. A suíte oficial é `node --test` com a lista dos arquivos
`scripts/test-*.mjs`; no PowerShell expandir com `Get-ChildItem`.

O typecheck possui erros existentes registrados no relatório de homologação.
Não os ocultar nem declarar que a compilação TypeScript está limpa.

## Transferência de dados

Clonar o Git continua o desenvolvimento; não transfere dados nem contas. DPAPI
está vinculada ao Windows/usuário. Não copiar cluster, tokens ou .env para o Git.
A restauração validada nesta entrega cria banco descartável novo no laboratório.
Recuperação de chave em outro Windows, destino externo e retomada operacional
após restore ainda são bloqueios; não transportar dados reais para superá-los.
