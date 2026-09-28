# Sistema de Gestão Ruy

## Produção local e desenvolvimento separados

DEV continua em `http://localhost:5173`. A produção compilada usa
`http://ADM-RUY:8080`, com publicação explícita e rollback, sem acompanhar o HMR.
Consulte [o guia de produção local](docs/producao-local.md) para comandos,
atalhos, validação nos clientes, firewall e a etapa administrativa de boot.

Comandos: `npm.cmd run prod:publish`, `npm.cmd run prod:start`,
`npm.cmd run prod:status` e `npm.cmd run prod:rollback`.

Sistema de gestão desenvolvido para o **Ruy Caldo de Cana**, com o objetivo de centralizar, organizar e facilitar os processos administrativos e operacionais do negócio.

## 📋 Sobre o projeto

O **Sistema de Gestão Ruy** está sendo desenvolvido para oferecer uma solução própria de gerenciamento, permitindo centralizar informações e facilitar o acompanhamento das atividades do estabelecimento.

O projeto busca reduzir processos manuais, melhorar a organização das informações e proporcionar uma gestão mais eficiente e integrada.

## 🚀 Objetivos

* Centralizar as informações do negócio
* Gerenciar produtos e categorias
* Controlar estoque
* Organizar a produção
* Acompanhar vendas e pedidos
* Gerenciar funcionários
* Facilitar processos administrativos
* Automatizar tarefas operacionais
* Melhorar a visualização das informações da empresa

## 💻 Desenvolvimento local

### Pré-requisitos

Antes de começar, certifique-se de ter instalado:

* [Node.js](https://nodejs.org/)
* [Git](https://git-scm.com/)
* Visual Studio Code ou outro editor de código de sua preferência

### Instalação

Clone o repositório:

```bash
git clone https://github.com/David1Mariano/Sistema-de-Gest-o-Ruy.git
```

Entre na pasta do projeto:

```bash
cd Sistema-de-Gest-o-Ruy
```

Instale as dependências:

```bash
npm install
```

### Executando o projeto

Para iniciar o ambiente de desenvolvimento:

```bash
npm run dev
```

Após iniciar, o terminal exibirá o endereço local para acessar o sistema.

## Ambiente local verificado (Windows)

O código atual usa React 18, Vite 6, Tailwind CSS 3 e npm com
`package-lock.json`. Não é necessário instalar o CLI ou SDK Base44: o arquivo
`src/api/base44Client.js` mantém uma interface de compatibilidade implementada
no próprio projeto. Não há servidor Node de aplicação para iniciar separadamente.

Ambiente verificado: Node.js 24.19.0, npm 11.17.0 e Git 2.55.0.windows.5.
Se as ferramentas instaladas não forem reconhecidas no PowerShell, ajuste
somente o PATH da sessão:

```powershell
$env:Path = 'C:\Program Files\Git\cmd;C:\Program Files\nodejs;' + $env:Path
npm.cmd install
npm.cmd run dev
```

Acesse http://localhost:5173. A configuração também permite acesso pela rede
local; a porta 5173 precisa estar livre. Para encerrar, use Ctrl+C no terminal
do servidor. `npm.cmd` evita depender da política de execução de scripts `.ps1`.

Não há `.env` obrigatório para iniciar com a configuração atual. O código já
contém valores de Supabase e Web3Forms, que podem ser sobrescritos em um
`.env.local` não versionado pelas variáveis abaixo, usando valores reais:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_WEB3FORMS_ACCESS_KEY`

O Supabase é acessado por REST e utiliza a tabela `records`; não é necessário
instalar `@supabase/supabase-js`. A autenticação é implementada em
`src/lib/localAuth.js`. Com a configuração atual, os dados são compartilhados
na nuvem. Valores vazios no `.env.local` não desativam os valores padrão do
código. O envio de e-mail depende do serviço Web3Forms. As referências
`VITE_BASE44_*` em `app-params.js` são legadas e não são necessárias para a
inicialização atual.

Verificações existentes:

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd run typecheck
node scripts/test-fase2a.mjs
node scripts/check-fase2a.mjs
```

Na preparação local, build e lint passaram, assim como os sete testes de
`test-fase2a.mjs`. O typecheck ainda apresenta erros preexistentes de tipagem
JavaScript/React. A checagem estática `check-fase2a.mjs` rejeita a leitura de
`current_stock` no diálogo de conferência, embora a tela precise desse campo
para exibir o estoque. Essas pendências não impedem o servidor Vite nem o build.
O build também avisa sobre tamanho do bundle, importação estática/dinâmica
do mesmo módulo e dados antigos do Browserslist.

## 📁 Estrutura do projeto

A estrutura do projeto pode ser organizada de acordo com os módulos e funcionalidades do sistema.

À medida que o desenvolvimento avançar, esta seção será atualizada com a descrição das principais pastas e componentes.

## 🔐 Segurança

Informações sensíveis, como senhas, chaves de API, tokens e credenciais, **não devem ser armazenadas diretamente no código ou enviadas para o GitHub**.

Utilize arquivos de ambiente, como `.env.local`, quando necessário, e mantenha esses arquivos fora do controle de versão por meio do `.gitignore`.

## 🔄 Controle de versões

O projeto utiliza **Git** para controle de versão e **GitHub** para armazenamento e gerenciamento do código-fonte.

Para registrar alterações:

```bash
git add .
git commit -m "Descrição da alteração"
git push
```

## 📌 Status do projeto

🚧 **Em desenvolvimento**

Novas funcionalidades e melhorias serão adicionadas continuamente ao sistema.

## 👨‍💻 Projeto

**Sistema de Gestão Ruy**
Desenvolvido para o **Ruy Caldo de Cana**.
