# Sistema de Gestão Ruy

Sistema administrativo e operacional desenvolvido para o **Ruy Caldo de Cana**, criado para centralizar processos, informações e rotinas do negócio em uma única plataforma.

O projeto reúne funcionalidades de gestão financeira, estoque, produção, colaboradores, compras, operação diária e demais processos internos, com foco em **organização, segurança dos dados, redução de tarefas manuais e evolução contínua da operação**.

---

## 📌 Visão geral

O **Sistema de Gestão Ruy** é uma aplicação web desenvolvida internamente para apoiar a gestão do estabelecimento.

Entre os objetivos do projeto estão:

- centralizar informações administrativas e operacionais;
- reduzir controles paralelos e processos manuais;
- melhorar a rastreabilidade das movimentações;
- organizar dados financeiros;
- controlar estoque e movimentações de produtos;
- acompanhar produção;
- apoiar a gestão de colaboradores;
- facilitar compras e rotinas administrativas;
- oferecer uma base própria para novas automações e integrações.

O sistema continua em desenvolvimento ativo e recebe melhorias de forma incremental, com validações antes da publicação no ambiente utilizado pela empresa.

---

# 🚀 Ambientes

O projeto possui separação entre **desenvolvimento** e **produção local**.

## Desenvolvimento

Ambiente padrão:

```text
http://localhost:5173
```

O ambiente de desenvolvimento utiliza Vite e possui atualização automática durante a edição do código.

Para iniciar:

```bash
npm run dev
```

No Windows, também pode ser utilizado:

```powershell
npm.cmd run dev
```

---

## Produção local

O sistema utilizado pela empresa é disponibilizado em:

```text
http://ADM-RUY:8080
```

A produção é independente do servidor de desenvolvimento e não acompanha alterações do Vite/HMR.

A aplicação publicada é composta por arquivos compilados e versionados em releases próprias.

Estrutura simplificada:

```text
%LOCALAPPDATA%\GestaoRuy\producao\

├── active.json
├── releases\
│   └── <release-id>\
│       ├── site\
│       └── manifest.json
├── runtime\
└── logs\
```

O arquivo `active.json` define qual release está atualmente ativa e mantém referência à release anterior quando disponível.

O servidor de produção é um servidor Node.js próprio do projeto, executado por um supervisor com reinicialização automática em caso de falha.

> O diretório `dist/` gerado pelo build convencional não é utilizado diretamente pela produção.

Documentação detalhada:

```text
docs/producao-local.md
```

---

# 📦 Publicação em produção

A publicação deve ser realizada exclusivamente pelo fluxo oficial do projeto.

Comando:

```powershell
npm.cmd run prod:publish
```

Antes de ativar uma nova versão, o processo de publicação executa verificações automáticas, incluindo testes e lint.

A nova aplicação é compilada em uma release separada e somente depois das validações a referência ativa é alterada.

Isso evita substituir parcialmente o sistema utilizado pela empresa.

## Consultar produção

```powershell
npm.cmd run prod:status
```

## Iniciar ambiente de produção

```powershell
npm.cmd run prod:start
```

## Rollback

```powershell
npm.cmd run prod:rollback
```

O rollback altera a release ativa para a versão anterior sem precisar recompilar a aplicação.

> Alterações em produção não devem ser realizadas copiando manualmente arquivos de `dist/`, iniciando `vite preview` ou substituindo arquivos da release ativa.

---

# 🧩 Principais módulos

O sistema é organizado em módulos administrativos e operacionais.

Entre as áreas atualmente existentes ou em desenvolvimento estão:

### 📊 Financeiro

Controle e acompanhamento de informações financeiras da empresa.

Inclui funcionalidades relacionadas a:

- movimentações financeiras;
- contas;
- pagamentos;
- comprovantes;
- acompanhamento de lançamentos;
- integração com rotinas administrativas.

### 💸 Gastos Diários

Área dedicada ao registro e acompanhamento das despesas operacionais da empresa.

Entre as funcionalidades estão:

- cadastro de gastos;
- categorização das despesas;
- criação e gerenciamento de categorias;
- totais por categoria;
- total geral do período;
- histórico de gastos;
- pesquisa;
- filtros;
- identificação de favorecido;
- situação do lançamento;
- comprovante de pagamento;
- visualização segura de anexos;
- edição protegida contra alterações concorrentes;
- prevenção de registros duplicados;
- integração controlada com pagamentos de colaboradores.

Os valores exibidos nos resumos são derivados dos lançamentos registrados, evitando manter totalizadores manuais que possam ficar inconsistentes.

### 📦 Estoque

Controle de produtos, saldos e movimentações.

As alterações de saldo de itens existentes utilizam uma camada transacional centralizada para reduzir problemas de concorrência entre diferentes computadores utilizando o sistema ao mesmo tempo.

As principais operações incluem:

- entradas;
- saídas;
- perdas;
- ajustes;
- recebimento de compras;
- histórico de movimentações.

### 🛒 Compras

Registro e acompanhamento de compras e entrada de mercadorias.

As entradas que alteram o estoque são encaminhadas pela camada transacional de estoque.

### 🏭 Produção

Controle das rotinas de produção, registros de produção e acompanhamento operacional.

O projeto também possui mecanismos de conferência antes de determinadas movimentações de estoque relacionadas ao processo produtivo.

### 👥 Colaboradores

Gerenciamento de informações dos colaboradores e rotinas administrativas relacionadas.

### 🚚 Central de Delivery

Arquitetura destinada à centralização de atendimentos e integrações com canais de delivery.

Algumas funcionalidades e integrações permanecem em desenvolvimento e somente são disponibilizadas em produção após validação específica.

---

# 🛠️ Tecnologias

O projeto utiliza principalmente:

- **React 18**
- **Vite 6**
- **JavaScript**
- **Tailwind CSS 3**
- **Node.js**
- **npm**
- **Supabase**
- **Git**
- **GitHub**

O projeto possui `package-lock.json` versionado para garantir maior consistência na instalação das dependências.

---

# 💻 Configuração do ambiente de desenvolvimento

## Pré-requisitos

Instale:

- Node.js;
- npm;
- Git;
- Visual Studio Code ou outro editor compatível.

Ambiente Windows já utilizado no desenvolvimento:

```text
Node.js 24.19.0
npm 11.17.0
Git 2.55.0.windows.5
```

Versões diferentes podem funcionar, desde que sejam compatíveis com as dependências definidas no projeto.

---

## Clonar o repositório

```bash
git clone https://github.com/David1Mariano/Sistema-de-Gest-o-Ruy.git
```

Entre na pasta:

```bash
cd Sistema-de-Gest-o-Ruy
```

---

## Instalar dependências

```bash
npm install
```

No PowerShell:

```powershell
npm.cmd install
```

---

## Iniciar desenvolvimento

```bash
npm run dev
```

ou:

```powershell
npm.cmd run dev
```

Acesse:

```text
http://localhost:5173
```

---

# 🪟 Windows / PowerShell

Caso Node.js ou Git estejam instalados, mas não sejam reconhecidos na sessão atual:

```powershell
$env:Path = 'C:\Program Files\Git\cmd;C:\Program Files\nodejs;' + $env:Path
```

Depois:

```powershell
node --version
npm.cmd --version
git --version
```

Utilizar `npm.cmd` no PowerShell também evita problemas relacionados à política de execução de scripts `.ps1`.

---

# ☁️ Dados e serviços

O sistema utiliza serviços em nuvem para persistência e autenticação.

A configuração pode utilizar variáveis Vite como:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_WEB3FORMS_ACCESS_KEY
```

Valores específicos de ambiente não devem ser documentados neste README.

Caso seja necessário utilizar um `.env.local`, ele deve permanecer fora do versionamento.

Exemplo:

```text
.env.local
```

Nunca devem ser enviados ao GitHub:

- senhas;
- tokens;
- chaves privadas;
- `service_role`;
- credenciais administrativas;
- arquivos `.env` contendo valores reais.

---

# 🔐 Segurança e integridade

O sistema possui diferentes mecanismos para reduzir inconsistências e problemas decorrentes do uso simultâneo em múltiplos computadores.

Entre os padrões adotados estão:

- operações transacionais para alterações críticas;
- controle de concorrência baseado em versão;
- prevenção de sobrescrita silenciosa;
- idempotência em operações sensíveis;
- confirmação antes de determinadas alterações;
- rastreabilidade de movimentações;
- proteção de anexos;
- separação entre frontend e credenciais administrativas;
- validações antes da publicação em produção.

Novas funcionalidades que alterem dados financeiros, estoque, autenticação ou integrações devem preservar esses mecanismos.

---

# 🧪 Validação

Antes de integrar alterações importantes, execute:

```powershell
npm.cmd run lint
npm.cmd run build
```

O projeto também possui testes específicos em `scripts/`.

Entre eles:

```powershell
node scripts/test-daily-expenses.mjs
node scripts/test-payment-proof.mjs
node scripts/test-payable-attachment.mjs
node scripts/test-fase2a.mjs
node scripts/check-fase2a.mjs
node scripts/test-production.mjs
```

Outras suítes podem existir conforme novos módulos forem implementados.

O comando oficial de publicação também executa verificações antes de ativar uma nova release.

---

# 📁 Estrutura geral

Estrutura simplificada do projeto:

```text
Sistema-de-Gest-o-Ruy/

├── docs/
│   └── documentações operacionais
│
├── scripts/
│   ├── testes
│   └── ferramentas de produção
│
├── src/
│   ├── components/
│   ├── lib/
│   ├── pages/
│   └── ...
│
├── supabase/
│   ├── functions/
│   └── migrations/
│
├── package.json
├── package-lock.json
└── README.md
```

A estrutura evolui conforme novas funcionalidades são adicionadas.

---

# 🔄 Fluxo de desenvolvimento

O projeto utiliza **Git** para controle de versão e **GitHub** como repositório remoto.

Fluxo recomendado:

```text
Branch de desenvolvimento
        ↓
Implementação
        ↓
Testes
        ↓
Lint / Build
        ↓
Revisão
        ↓
Integração na main
        ↓
Push para GitHub
        ↓
Publicação controlada
        ↓
Validação em produção
```

Para alterações controladas, prefira adicionar explicitamente os arquivos desejados:

```bash
git add caminho/do/arquivo1 caminho/do/arquivo2
git commit -m "descrição objetiva da alteração"
git push origin <branch>
```

Antes de enviar:

```bash
git status
git diff --check
```

Evite incluir arquivos temporários, builds locais, credenciais ou alterações sem relação com o trabalho atual.

---

# 🌐 GitHub

Repositório:

```text
https://github.com/David1Mariano/Sistema-de-Gest-o-Ruy
```

A branch `main` representa a base consolidada do projeto.

Mudanças desenvolvidas em branches de trabalho devem ser validadas antes de sua integração.

---

# 📚 Documentação

Documentações adicionais ficam no diretório:

```text
docs/
```

A documentação de produção local está disponível em:

```text
docs/producao-local.md
```

Essa documentação deve ser consultada antes de alterar o processo de publicação, inicialização, rede ou rollback.

---

# 📌 Status do projeto

> **Em desenvolvimento ativo**

O sistema já é utilizado nas rotinas da empresa e continua recebendo novos módulos, correções e melhorias.

Toda alteração crítica deve passar por validação antes de ser disponibilizada no ambiente utilizado pela operação.

---

# 🏢 Projeto

**Sistema de Gestão Ruy**

Desenvolvido para apoiar a operação e a gestão do **Ruy Caldo de Cana**.

Projeto privado de uso administrativo e operacional.
