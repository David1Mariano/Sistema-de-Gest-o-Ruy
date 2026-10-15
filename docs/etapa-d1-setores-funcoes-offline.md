# D1 — Setores e Funções oficiais com PostgreSQL isolado

Evolução posterior: [ciclo Windows offline-first](ciclo-windows-offline-20261015.md).
Este documento preserva o escopo e as evidências originais da D1; o ciclo posterior
acrescenta cadastros e aplicativo experimental sem alterar a produção.

## Correção posterior — feedback ao salvar (15/10/2026)

O proprietário confirmou login real no navegador e relatou que criar/editar não fechava o formulário nem salvava. Encontrada falha de feedback: o aviso D1 ficava atrás do overlay do Dialog. Há validações adicionais do laboratório (prefixo FICTICIO e bloqueio de renomeação com vínculos); não foi possível identificar qual delas ocorreu na tentativa do proprietário sem o retorno do navegador.

Correção exclusiva do build D1: alias de DialogContent para wrapper que mantém o componente original e apresenta erro dentro do portal, instrução de nome e scroll em janela pequena. Exceções de storage/UUID anteriores ao fetch também geram aviso. Componentes oficiais permanecem intactos. Não foi desativada validação nem renomeado cadastro vinculado automaticamente.

Teste novo `scripts/d1-lab/test-save-feedback.mjs`: API e PostgreSQL reais, conta sintética própria, criação e consulta, edição com o objeto completo do formulário, auditoria, duas operações duráveis, erro de prefixo sinalizado uma vez e erro de storage sinalizado. Aprovado, com guarda de rede e sem reiniciar serviços. Lint e build D1 aprovados após a mudança. 8080 permanece na release oficial. Correção visual ainda requer atualizar a página no navegador real e repetir o teste; não foi declarada homologada por esse teste Node.

Data: 15/10/2026. Branch: `preparacao/windows-oficial-20261015`. Base `9d7e59ea59239f1ab25c0abbc346420d83e3783d`, release de referência `20261015T155237724Z-d597121d`. Sem commit, merge, push, deploy ou alterações na produção.

## Resultado e acesso

Implementação de laboratório disponível, com API/banco reais e componentes React oficiais. Aceite visual em navegador real permanece pendente.

- Setores: `http://127.0.0.1:18087/setores`.
- Funções: `http://127.0.0.1:18087/funcoes`.
- API e arquivos compilados D1 na mesma origem/porta, somente loopback.
- PostgreSQL exclusivo em `127.0.0.1:55436`, banco `ruy_d1_disposable`, papel aplicativo `ruy_d1_app`, home `%LOCALAPPDATA%\GestaoRuy\etapa-d1-lab`.
- Identidade persistente: `b30ba24b-fda7-4f44-a16c-0cc47c8a668b`.
- Conta manual fictícia criada e entregue ao proprietário no chat; senha não é registrada neste documento. Pode criar outra com o helper abaixo.

## Verificação inicial e preservação

Antes das mudanças, branch conferida; nenhum arquivo rastreado estava modificado. Havia quatro documentos não rastreados da auditoria, preservados. A auditoria anterior comprovou 340/340 fontes do snapshot iguais ao commit. Durante D1 foram comparados novamente os arquivos oficiais diretamente usados: Setores, Funções, formulários, helpers de setores/funções, Layout, Sidebar, Topbar, ThemeProvider, index.css, base44Client e AuthContext. Todos continuam iguais ao Git oficial, normalizando apenas CRLF/LF.

Serviços identificados: base44.entities.Sector/JobRole/Employee, logAudit e currentUserName; validações nos formulários e helpers sectorUtils/roleUtils. As telas fazem consultas de colaboradores para contagem, filtros e bloqueio de desativação. Não foi trocado o serviço Supabase global.

Foram reaproveitados, por cópia revisada e namespace próprio, ambiente DPAPI/ACL, validação de home, controle de cluster, scrypt, sessões/CSRF, rate limit, transações e esquema de outbox/auditoria de B/C1. Não foi importado o autenticador operacional, o worker central C2 ou seu token estático. C1/C2 permanecem nos caminhos/portas anteriores. Nenhum módulo de estoque ou financeiro foi integrado ou alterado.

## Como a interface original usa o banco de teste

`lab/d1/vite.config.mjs` define uma entrada/build separado e aliases exclusivos para persistência e sessão do laboratório. Vite normal, App, base44Client e autenticação operacional permanecem intactos. O bundle D1 não inclui URL do projeto Supabase nem SDK/configuração cloud operacional; envDir e public operacional não são usados nesse build.

A entrada D1 monta Setores/Funções originais, ThemeProvider, CSS, Layout, Sidebar e Topbar oficiais. Outros destinos do menu permanecem na navegação original, mas mostram aviso de fora de escopo em D1. Não foram implementadas novas telas de RH, estoque, financeiro ou ficha de colaborador. O link da ficha no detalhe de Setores continua com seu destino original, porém a ficha não é habilitada no laboratório.

O adaptador só permite Sector, JobRole e Employee (consulta). Respostas mantêm id, datas, campos e acrescentam `_version`. Lista aceita a ordenação efetivamente utilizada `-created_date` e o limite solicitado pelas páginas. API consulta o escopo completo para regras de dependência, independentemente do limite de 500 empregados apresentado ao cliente.

AuditLog.create da UI consome o recibo da gravação transacional já concluída: não insere segunda auditoria, não aceita evento livre. O servidor registra autor, comando, entidade e operationId junto do cadastro/outbox; valores antes/depois não são um histórico detalhado de campos nesta etapa.

## Funcionalidades preservadas e diferenças intencionais

Setores mantém cartões, detalhe por ID, campos name/description/role_purpose/responsible_name/status, contadores, busca por nome/apelido/função, filtros de situação, resumo por função, criação, edição, confirmação ao inativar com vínculos e mensagens oficiais.

Funções mantém grupos por setor e “Sem setor”, formulário com sector_id/sector_name, edição, confirmação e exclusão lógica, bloqueio quando há colaboradores e histórico preservado. A API também bloqueia desativação em uso, mesmo se chamada diretamente, e não oferece exclusão física.

Diferenças do laboratório:

- Banner permanente informa D1, dados fictícios, perfil, quantidade real da fila e sincronização **DESATIVADA**. Não existe check verde nem confirmação remota simulada.
- Login próprio D1 e botão de alternar tema para teste; não substituem as telas de autenticação/configurações do produto.
- Apenas nomes iniciados por `FICTICIO `, permissões admin/writer/viewer de teste e escopo por usuário. Isso não pretende reproduzir ainda todos os papéis administrativos operacionais.
- Erros da persistência aparecem em aviso D1 sem descartar o formulário. Cache de registros/recibos é limpo ao trocar de conta.
- Fontes Inter e Plus Jakarta Sans foram empacotadas localmente (quatro arquivos TTF, hashes/origem em font-sources.json e licenças junto dos arquivos), eliminando a chamada Google Fonts nesse build. O index.css oficial não foi editado; transformação ocorre só na configuração D1.
- Nome duplicado normalizado é recusado. Renomeação com referências é temporariamente bloqueada, pois vínculos legados usam texto e regra de cascata ainda não foi aprovada. Setor inativo não recebe novo vínculo; nenhum relacionamento é reescrito automaticamente.

Nenhuma diferença visual de pixels foi medida: componentes iguais e fontes locais não substituem screenshots e homologação. O banner/login adicionais são diferenças conhecidas. No navegador de um proprietário com fonte anteriormente baixada de outra versão pode haver diferença tipográfica a avaliar.

## Segurança e contrato de operações

API valida Host/Origin/Sec-Fetch-Site, Content-Type, limite de JSON, sessão ativa e CSRF. Cookie D1 próprio, HttpOnly, SameSite Strict, Path `/api/d1`, expiração de oito horas. Nenhuma conta/sessão de produção é reutilizada. Senhas são scrypt; tentativas são limitadas de forma persistente. Segredos do banco ficam sob DPAPI/ACL Windows, fora do navegador.

Leitura e escrita são restritas ao usuário da sessão. Viewer consulta seu escopo e não escreve; o adaptador também recusa escrita antes do envio. Autor e dispositivo não são escolhidos pelo formulário. O papel PostgreSQL não é superusuário; registro não pode ser apagado pelo aplicativo e auditoria/outbox são append-only para esse papel. Não foi alegada RLS por usuário do banco local: a fronteira é a API autenticada, com credenciais locais restritas ao backend.

Cadastro, incremento de versão, auditoria e outbox fazem uma única transação. UUID de operação + hash dão idempotência; mesma operação com conteúdo diferente é rejeitada. Controle de versão impede sobrescrita concorrente. Uma tentativa com resposta perdida mantém o mesmo envelope no localStorage D1, separado por usuário/entidade/registro, até confirmar o reenvio. Só contém dados sintéticos, nunca credenciais. Esse rascunho não é a fila: a fila durável está no PostgreSQL.

Outbox contém operação, registro, dispositivo, autor, entidade, tipo, versão-base, versão resultante, payload/hash, protocolo, criação, estado pending e confirmed_at nulo. Não há envio nem recebimento Supabase. Contrato de escopo operacional e IDs legados ainda precisa ser aprovado antes de migrar dados reais; UUIDs D1 são apenas sintéticos.

O preload de rede nos processos API/testes nega TCP/fetch para fora de portas loopback explicitamente permitidas. CSP do frontend permite conexão apenas à própria origem. Não é firewall de toda a máquina nem prova de queda física da internet.

**Bloqueio crítico:** exposição anônima Supabase previamente identificada continua sem correção operacional aplicada. Não conectar worker real enquanto RLS/grants/Storage e autorização por usuário não forem corrigidos e homologados com aprovação.

## Testes executados

| Verificação | Resultado |
| --- | --- |
| npm.cmd run lint | Aprovado |
| npm.cmd run build (oficial, somente dist isolado) | Aprovado; sem publicação |
| Vite build com lab/d1/vite.config.mjs | Aprovado |
| Testes existentes Setores/Funções/tema | 56 aprovados, zero falhas |
| scripts/d1-lab/test-api.mjs | 27 verificações aprovadas, PostgreSQL/API reais |
| Comparação dos componentes oficiais usados | Iguais à base oficial |
| Browser real / screenshots claro e escuro | Pendente; inventário de automação retornou apps e browsers vazios |

As 27 verificações abrangem bloqueio de rede externa, login, anonimato, credencial inválida/sessão C1 recusada, Origin/CSRF, criação/consulta/edição, idempotência, reuso adulterado, versão concorrente, duplicidade, isolamento, viewer, relação de função/setor, projeção de colaborador sintético, bloqueio de desativação/renomeação em uso, inativação sem cascata, exclusão lógica, rollback de cadastro/fila/auditoria, pending sem confirmação, fontes/assets locais, preservação dos componentes, reinício API/PostgreSQL e cliente de persistência efetivamente usado pelas páginas. O teste do adaptador inclui ACK perdido após COMMIT e reenvio do mesmo ID, além de bloqueio frontend de viewer.

Durante parada completa de D1, health de 8080/C1/central C2 permaneceu igual. Depois do reinício D1, registros, sessões e envelopes da fila foram comparados integralmente com a captura anterior. Não foi reiniciado o Windows nem o navegador. Os testes do adaptador usam APIs nativas Node e storage em memória, sem fingir homologação de DOM ou navegador.

Evidência offline: guarda confirmou ENETUNREACH para destino externo; API/PG e assets/fontes funcionaram só por loopback. Não foi desligada a rede física do proprietário. Abrir e operar as telas num navegador realmente sem saída externa ainda exige teste manual/VM; não declarar esse aceite concluído.

Builds registraram aviso de Browserslist desatualizado e, no build oficial, chunks maiores que 500 kB. Nenhuma dependência oficial foi atualizada por isso. Uma execução inicial detectou assets antigos acumulados na pasta D1; configuração de build passou a limpar somente dist-d1 e a execução completa seguinte passou. Fixtures de testes interrompidos foram preservadas.

Evidências resumidas em [evidencias-d1-20261015.json](evidencias-d1-20261015.json) e `%LOCALAPPDATA%\GestaoRuy\etapa-d1-lab\last-test.json`. Não contêm senhas.

## Fila e fixtures no momento da entrega

Após testes e preparação manual: 24 registros sintéticos e 26 operações pendentes globais; inclui execuções anteriores, sem excluir fixtures. Todos os comandos D1 têm confirmação remota nula.

Conta de homologação: um setor, duas funções e seis colaboradores sintéticos com situações diferentes para busca/filtros. Começa com **três pendências próprias**, relativas a Setor/Funções; os colaboradores são fixtures de leitura inseridas pelo setup de laboratório, não operações operacionais pendentes. Cada usuário vê apenas sua própria fila, não o total global. Quantidades aumentarão conforme o teste manual.

## Arquivos

Alterados: `.gitignore` (dist-d1), `eslint.config.js` (lint dos novos arquivos). Nenhum src/ oficial foi alterado.

Criados:

- `lab/d1/`: entrada HTML/React, configuração Vite isolada, adaptador de entidades/sessão, contexto de autenticação local, ponte de usuário, fontes CSS, manifesto de origem/hashes e fontes/licenças em public/fonts.
- `server/d1-lab/`: environment.mjs, core.mjs, api.mjs, start.mjs, routes.mjs, entities.mjs, schema.sql, entities.sql, package.json/package-lock.json. O pacote backend declara pg 8.12.0; package/lock oficiais permanecem intactos.
- `scripts/d1-lab.mjs`: controle exclusivo de cluster/API D1.
- `scripts/d1-lab/`: create-user.mjs, create-user.ps1, network-guard.cjs e test-api.mjs.
- Este relatório e evidencias-d1-20261015.json. Documentos anteriores do worktree foram preservados.

## Inicialização, testes e recuperação

Na raiz do worktree isolado:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd install --prefix server/d1-lab --ignore-scripts --no-audit --no-fund
node node_modules/vite/bin/vite.js build --config lab/d1/vite.config.mjs
# Somente em instalação nova e destino D1 inexistente:
node scripts/d1-lab.mjs init
# Na instalação já existente: usar start-db se o cluster estiver parado.
node scripts/d1-lab.mjs start-api
node scripts/d1-lab.mjs status
```

Init recusa home existente; não repetir para recuperar falha. PostgreSQL 17 oficial precisa estar instalado; nenhuma instalação permanente de serviço foi feita. Processos separados ficam em execução, mas ainda não há inicialização automática após reinício Windows.

Nova conta fictícia, se necessária:

```powershell
powershell.exe -NoProfile -File scripts/d1-lab/create-user.ps1
```

Usar e-mail @example.invalid e senha exclusiva com mínimo de 12 caracteres. Não usar o helper C1 para entrar em D1. A conta de homologação entregue já existe.

Reprodução dos testes (reinicia somente D1; não executar durante homologação manual):

```powershell
npm.cmd run lint
node --test scripts/test-sectors.mjs scripts/test-funcoes.mjs scripts/test-theme.mjs
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_NETWORK_GUARD='1'
node --require ./scripts/d1-lab/network-guard.cjs scripts/d1-lab/test-api.mjs
```

Recuperação: ler api.log/postgres.log no home protegido; parar somente D1 com stop-api e stop-db; iniciar cluster com start-db e API com start-api. Não apagar home, tabelas, outbox ou releases; não executar prod:publish. Reversão da experiência D1 é parar seus processos e conservar dados sintéticos; não exige alterar 8080.

## Pendências e próxima etapa

Homologar no Chrome/Edge real: abrir as duas URLs, entrar com a conta D1, criar setor e função com nomes FICTICIO, consultar, editar, inativar função sem vínculo, tentar inativar a vinculada, conferir filtros/detalhe e alternar claro/escuro. Comparar aparência com a referência oficial; documentar qualquer diferença. Testar recarregamento e ambiente de navegador sem internet sem interromper o computador operacional.

Só depois desse aceite, propor ajustes de paridade e contrato de permissões/renomeação de cadastros para eventual evolução de sincronização sintética. Não avançar para outro módulo, importação real, instalador definitivo ou integração Supabase nesta etapa.

## Confirma??o posterior do propriet?rio

Ap?s a revis?o salvar-3, o propriet?rio confirmou no navegador: ?ta funcionando perfeitamente?. Isso confirma a resolu??o manual do problema de salvamento relatado no D1. N?o equivale a homologa??o de todas as telas, compara??o visual por screenshots, rein?cio do Windows ou teste f?sico sem internet. A produ??o 8080 e a sincroniza??o operacional n?o foram alteradas por este registro.
