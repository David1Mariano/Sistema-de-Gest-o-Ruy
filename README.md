# Sistema de Gestão Ruy

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

## 📁 Estrutura do projeto

A estrutura do projeto pode ser organizada de acordo com os módulos e funcionalidades do sistema.

À medida que o desenvolvimento avançar, esta seção será atualizada com a descrição das principais pastas e componentes.

## Verificações

```bash
npm run lint    # eslint (somente erros)
npm run build   # vite build

# Testes de regressão (sem navegador, rodam em Node puro)
node scripts/test-fase2a.mjs           # regras de consumo da produção
node scripts/check-fase2a.mjs          # a conferência de produção não escreve estoque
node scripts/test-estoque-gastos.mjs   # estoque, gastos, parse monetário e garantias de fluxo

# Teste de ponta a ponta CONTRA O BANCO REAL (cria e apaga dados de teste)
# Exige SUPABASE_URL e SUPABASE_ANON_KEY no ambiente (nada de credencial no repo):
#   PowerShell: $env:SUPABASE_URL='https://SEU-PROJETO.supabase.co'; $env:SUPABASE_ANON_KEY='sua-chave-anon'
node scripts/test-e2e-estoque-gastos.mjs
```

O teste `test-e2e-estoque-gastos.mjs` grava apenas registros com o prefixo
`ZZTEST-`, valida o fluxo completo (cadastro → entrada → saída → histórico →
estorno → gasto → financeiro) e **apaga tudo no final**, inclusive se alguma
verificação falhar. Sem as variáveis de ambiente ele apenas imprime a
instrução e sai com código 2, sem tocar em nada.

> **Segurança:** a chave `anon` do Supabase é pública por desenho — quem protege
> os dados é o RLS. Em `src/lib/cloudDb.js` há URL e chave anon como valor
> padrão de `import.meta.env`, para o app funcionar sem configuração local.
> Nunca comite `service_role`, senhas ou `.env`.

## Banco de dados (Supabase)

Os dados ficam em UMA tabela genérica `records` (`entity`, `id`, `data` jsonb).

- O app grava o `id` **também** dentro de `data` (ver `toRow` em `src/lib/cloudDb.js`).
- `data->>'updated_date'` é usado como versão para o compare-and-swap
  (`transact`/`transactRow`), que evita que dois lançamentos simultâneos
  sobrescrevam um o outro.

Em `supabase/migrations/` há constraints SQL **opcionais** (índices, CHECKs de
valor numérico, unicidade de despesa por origem e de movimentação por
`client_token`). Elas são uma rede de segurança no banco: o app já funciona sem
aplicá-las. Cada arquivo é idempotente e deve ser aplicado pelo SQL Editor do
Supabase.



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
