# Sistema de Gestão Ruy — aplicativo Windows experimental

Este pacote é um protótipo de laboratório do mesmo produto, reaproveitando as
telas oficiais React. Não é substituto definitivo da aplicação 8080. Ainda não
habilita todos os módulos offline. Não instalar para operação real.

## Construção

Na raiz do checkout oficial, Node 24 e npm compatível com os lockfiles:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd ci --prefix server/d1-lab --ignore-scripts --no-audit --no-fund
npm.cmd ci --prefix desktop --no-audit --no-fund
# Caso o npm tenha bloqueado o script do runtime Electron:
node desktop/node_modules/electron/install.js
node node_modules/vite/bin/vite.js build --config lab/d1/vite.config.mjs
npm.cmd --prefix desktop run dist
```

Resultado atual: `artifacts/windows-lab/Sistema-Gestao-Ruy-Lab-0.2.0-Setup.exe`.
O pacote tem Chromium/Node via Electron, dependência `pg` e frontend compilado.
Não inclui banco, backups, usuários, `.env`, tokens ou diretórios privados.
Ícone R experimental e atalho com sufixo Laboratório; ainda sem assinatura digital.

O instalador NSIS é por usuário, permite escolher pasta e não remove dados de
usuário na desinstalação. Código e dados ficam separados. Sua validação nesta
máquina não equivale a Windows limpo, atualização de produção ou dois computadores.

## Dependências do laboratório

É necessário PostgreSQL 17 de origem confiável e um cluster D1 preparado pelo
usuário Windows atual, com marcador e DPAPI. Não existe instalação automática
de PostgreSQL, serviço Windows ou conta operacional neste instalador.

Se o D1 já existir, **não executar init**. Apenas iniciar o cluster se parado.
Preparar uma instalação inteiramente nova somente em laboratório:

```powershell
node scripts/d1-lab.mjs init
node scripts/d1-lab/prepare-catalog.mjs
powershell.exe -NoProfile -File scripts/d1-lab/create-user.ps1 -Role admin
```

O primeiro comando recusa home existente; os seguintes usam somente destino D1
validado. Criar conta fictícia admin para cadastrar colaboradores/configurações.
Dados pessoais/documentos de teste devem permanecer fictícios.

O aplicativo verifica configuração, identidade do dispositivo e disponibilidade
do PostgreSQL antes de abrir a interface. API/banco ausentes produzem mensagem
de indisponibilidade, sem fallback para Supabase ou banco operacional. Se o banco
estiver parado, usar `node scripts/d1-lab.mjs start-db` explicitamente.

API D1 existente é reaproveitada e não é encerrada pelo aplicativo. Se ausente,
o processo principal inicia sua API empacotada com `utilityProcess` e encerra
somente esse processo ao sair. O PostgreSQL é preservado. A porta 8080 nunca é usada.
Backups em execução são aguardados no encerramento normal.

## Segurança e testes

Renderer sem Node/preload/IPC genérico, sandbox e isolamento de contexto ativos.
Permissões, novas janelas, webview e navegação fora de 127.0.0.1:18087 são negadas.
Downloads também estão bloqueados neste protótipo: impressão/exportações precisam
de implementação/homologação específica antes de liberar o produto completo.
Fuses desabilitam RunAsNode, NODE_OPTIONS e argumentos de inspeção; cookies usam
criptografia Electron. Isso não protege contra administrador do próprio Windows.

Smoke automatizado `--lab-smoke --lab-evidence=<caminho absoluto novo>` usa conta
admin e setor sintéticos próprios, sessão Chromium não persistente, login real,
capturas de claro/escuro e navegação em telas oficiais. Nunca passar senha por CLI.
Esse modo existe apenas neste pacote marcado de laboratório e não usa conta real.

Limites e resultados: [ciclo de desenvolvimento](../docs/ciclo-windows-offline-20261015.md).

Atualização 0.2.0: [homologação D1/C2](../docs/homologacao-windows-d1-c2.md) e
[preparação em outra máquina](../docs/continuar-em-outro-computador.md). A versão
integra a tela oficial Estoque e APIs transacionais de produção/financeiro à fila.
O envio para C2 precisa de provisionamento explícito, e eventos críticos continuam
pendentes de reconciliação de negócio mesmo depois do recibo de transporte.
