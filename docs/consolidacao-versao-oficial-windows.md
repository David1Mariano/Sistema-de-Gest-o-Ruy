# Consolidação da versão oficial — auditoria e preparação

Data: 15/10/2026. Escopo executado: arquivos locais, histórico Git, comparação, cópia de preservação e criação de worktree isolado. Sem alterações de dados, migrations, autenticação, sincronização operacional, merge, commit, push ou deploy.

## 1. Versão oficial identificada

| Evidência | Resultado |
| --- | --- |
| Health da porta 8080 | Serviço gestao-ruy-production, release `20261015T155237724Z-d597121d` |
| active.json | Mesma release, anterior `20261015T154558108Z-53d5f7d8` |
| source.json privado da release | Commit `9d7e59ea59239f1ab25c0abbc346420d83e3783d`; origem git archive da main; mudanças do worktree excluídas |
| Commit no Git local | Disponível, apontado por main e chalk-form na captura |
| Verificação do site publicado | 77 arquivos do manifesto com SHA-256 correto |
| Fonte recuperada em disco | 340/340 arquivos rastreados iguais ao commit, normalizando apenas CRLF/LF; zero ausentes ou divergentes |
| Branch de desenvolvimento auditada | agente-3, `f3be62be13094e4e78436d954b3094d04f96633b` |
| Diferença HEAD agente-3 → oficial | 170 arquivos no repositório, 78 em src/ |
| Branches locais comparadas | 38, antes da criação da branch de preparação; sem fetch |

Fonte original encontrada em `%LOCALAPPDATA%\GestaoRuy\recovery-sources\main-9d7e59e-20261015-125035\source`. Não se trata de decompilação de JavaScript. Git contém componentes React, CSS, API social, scripts, testes, package-lock e histórico. Não há componente do frontend oficial identificado como sem fonte recuperável nesta auditoria.

Limite de proveniência: o manifesto publicado não contém vínculo criptográfico do build ao commit. source.json registra a origem e o snapshot corresponde integralmente ao Git; não foi reconstruído um build reproduzível byte a byte nesta execução. Os 773 testes constam do registro da publicação anterior, não foram reexecutados agora.

**O runtime instalado tem uma adaptação além do commit do site.** server.mjs e supervisor.mjs correspondem à fonte oficial após normalização de quebras de linha. store.mjs possui seis linhas adicionais em prepareBuild para retirar `_headers` e `_redirects` somente da cópia compilada. Fonte instalada e patch foram preservados. A baseline completa é o commit oficial do aplicativo mais esse overlay de runtime; não declarar todo o ambiente idêntico ao commit. Nenhuma dessas linhas foi aplicada ao novo worktree.

Trecho do histórico recuperado: `9d7e59e` reduz startup e adia prefetch financeiro; `fdf8e09` integra dashboards v2; `7d0e589` integra main nos dashboards; `b0955dd` corrige indicadores da Direção; `bb3eca1` corrige filtro de categoria; `a9f4818`/`0130264` tornam teste de gastos determinístico. O bundle preservado inclui o histórico completo alcançável por main.

## 2. Preservação e recuperação

Cópia privada, com ACL exclusiva do usuário Windows atual, em:

`%LOCALAPPDATA%\GestaoRuy\audits\consolidacao-20261015`

Conteúdo preservado:

- active.json, runtime e diretórios completos das duas releases atuais, incluindo manifestos e source.json disponíveis: 87 arquivos copiados, conteúdo conferido por SHA-256 contra os originais.
- `production-hashes.json`, com hashes de cada arquivo copiado.
- `official-source.zip`, exportação original do commit, e `official-history.bundle`, verificado por git bundle verify como histórico completo.
- `runtime-store.patch` e `official-store.mjs`, para explicar a diferença de runtime sem sobrescrever nada.
- `working-tree.patch`, preservando alterações rastreadas ainda não commitadas da agente-3, e `working-source/` com os núcleos B/C1/C2, scripts de controle e adaptadores PostgreSQL propostos.
- `audit.json`, com IDs, contagens, referências e comparações; sem conteúdo de registros ou credenciais.

Não foram encontrados arquivos .env nas quatro localizações usuais da raiz do snapshot recuperado. Não foram varridas nem exportadas credenciais de usuário/máquina. Configuração efetivamente embutida no frontend permanece preservada na cópia privada dos assets. Dependências serão reconstruídas pelo lock; node_modules não foi copiado.

Essa é preservação local de código/runtime, no mesmo disco, **não backup independente do banco nem restauração operacional validada**. Não houve dump de dados, cópia de dados reais ou execução da release copiada. Recuperação futura deverá validar arquivos, paths, runtime e processo em ambiente descartável antes de qualquer ativação. Não executar rollback ou editar active.json nesta etapa.

## 3. Matriz de diferenças por módulo

Referência: comparação do HEAD commitado da agente-3 com o commit oficial. “Igual” não implica segurança comprovada ou homologação funcional. Alterações não commitadas da agente-3 foram preservadas separadamente e não misturadas à baseline.

| Módulo | Produção/oficial ausente ou diferente na agente-3 | Arquivos de referência a preservar | Diretriz |
| --- | --- | --- | --- |
| Tema/aparência | Provider de tema e extensa cobertura CSS; configurações de claro/escuro | src/lib/theme/ThemeProvider.jsx, src/main.jsx, src/index.css, src/pages/Configuracoes.jsx | Usar fonte oficial inteira, testar ambos os temas |
| Navegação/startup | Redes Sociais, lazy loading e prefetch financeiro controlado | src/App.jsx, src/lib/navigation.js, src/components/Layout.jsx, usePrefetchFinanceiro.js | Não copiar App antigo sobre o oficial |
| Dashboards | Cálculos/indicadores em Home, RH, Direção e financeiro; fontes e estados de carga | financialDashboard.js, rhDashboardMetrics.js, directionMetrics.js, páginas e DirectionMetric.jsx | Fixtures com resultados conhecidos; não reduzir aos cards antigos |
| Colaboradores | Formulários, exclusão segura, ficha e opções válidas de setor/função | EmployeeForm.jsx, EmployeeDeleteDialog.jsx, employeeDelete.js, Funcionarios.jsx, FichaColaborador.jsx | Preservar dependências e privacidade |
| Setores | Detalhe por ID, role_purpose, colaboradores, filtros por status, busca e resumos; aviso na desativação | Setores.jsx, SectorForm.jsx, sectorUtils.js | Primeira integração deve incluir detalhe, não apenas CRUD mínimo |
| Funções | Exclusão lógica, bloqueio por colaboradores, confirmação, erros e opções ativas | Funcoes.jsx, roleUtils.js | Reproduzir bloqueio no servidor, sem excluir fisicamente |
| Estoque/compras | Exclusão de item e guardas; serviços e recebimento/concorrência aprimorados | Estoque.jsx, Compras.jsx, stockItemUtils.js, stockService.js | Manter transações; não trocar pelo protótipo genérico |
| Produção | Fluxo do formulário de ordem e dependências de estoque | ProductionOrderDialog.jsx e serviços oficiais | Producao.jsx em si não difere; dependências mudaram |
| Financeiro/gastos | Carregamento, rascunhos, categorias, histórico, destinatários e resumos | Financeiro.jsx, CategoryDigest.jsx, DailyExpense*, ExpenseCategoryManager.jsx, financeiroLoad.js, financeiroPrefetch.js, dailyExpenses.js, paymentRecipients.js | Maior risco de regressão; preservar integrações e testes |
| Vendas/receitas | Ajustes na página de receitas e conciliação | ReceitasFinanceiras.jsx, componentes financeiros | Não foi encontrada rota geral de Vendas no App oficial |
| Delivery | Oficial contém liquidações financeiras; CentralDelivery completa existe em outras branches, não no App oficial | agente-2: src/pages/CentralDelivery.jsx e components/integrations/* | Candidato de consolidação separado, nunca afirmar que já está na release |
| Redes Sociais | Rota/página, dashboards, relatórios, mensagens, comentários, acessos, IA e ManyChat | RedesSociais.jsx, components/social/*, lib/social/*, server/social/* | Preservar backend-fonte; presença do chunk não prova integração externa ativa |
| Login/permissões | Fluxo principal permanece, supabaseClient ganhou alterações; filtragem de menus ampliada | AuthContext.jsx, authAdapter.js, ProtectedRoute.jsx, useUserRole.js, supabaseClient.js | Preservar comportamento; permissões reais no servidor/RLS ainda precisam auditoria |
| Relatórios/anexos | Preview unificado/normalizador e melhorias nos relatórios financeiros | AttachmentPreview.jsx, attachmentViewer.js, FinancialSummary.jsx, Relatorios.jsx, RelatorioFinanceiro.jsx | Preservar todos os formatos e checagens de autorização |
| Ponto/escalas/rotinas RH | Ajustes em registro rápido, escala padrão/duplicação, ponto, vales, consumo, ocorrências e advertências | páginas correspondentes, pontoData.js, rhUtils.js | Cobrir cálculos, rascunhos e retorno da navegação |
| Rascunhos transversais | Persistência, aviso e recuperação de formulários | draftStore.js, draftConfig.js, usePersistentDraft.js, DraftNotice.jsx | Não confundir rascunho do formulário com operação confirmada |

Lista completa de arquivos e tabela de todas as branches: [comparacao-branches-oficial-20261015.md](comparacao-branches-oficial-20261015.md). Evidência estruturada: [auditoria-versao-oficial-20261015.json](auditoria-versao-oficial-20261015.json). Inventário de todas as rotas: [plano-aplicativo-windows-unico.md](plano-aplicativo-windows-unico.md).

## 4. Outras branches e estratégia de consolidação

main e chalk-form apontam para a fonte oficial. Grande parte das branches de tema, social, RH e financeiro é ancestral do oficial: seus recursos já estão incorporados, embora a ponta dessas branches tenha muitos arquivos diferentes. Reaplicar seus arquivos antigos causaria regressão.

13 branches têm commits exclusivos em relação ao oficial, incluindo agente-2 (12), agente-5-retomada-local (14), backup-agente-2-dc202f1 (6), codex-storage-r2 (2) e codex-storage-r2-base64-flows (mesmo commit, 2). Exclusividade de histórico não comprova novidade funcional: patch equivalente pode já ter sido integrado. A tabela anexa registra contagens dos dois lados e títulos de todos os commits exclusivos. Não foram alterados nem inspecionados como fonte oficial os arquivos não commitados dos worktrees de outros agentes.

CentralDelivery foi recuperada no Git da agente-2/backup: precisa revisão por contrato e testes específicos antes de seleção. R2 é outra arquitetura de armazenamento candidata; não mudar o destino Supabase Storage nem incorporá-la por ser de outra branch. agente-5-retomada-local contém material de investigação/recuperação, não autorização para importar dados.

Área criada para preparação:

- Branch nova: `preparacao/windows-oficial-20261015`.
- Worktree: `C:\Users\Pichau\gestao-ruy-windows-oficial-20261015`.
- Base exata: `9d7e59ea59239f1ab25c0abbc346420d83e3783d`.
- Nenhum merge, cherry-pick, commit, instalação de dependência, build ou início de serviço nessa área.
- agente-3, main, chalk-form e demais branches existentes permaneceram nas mesmas referências; o servidor 8080 segue usando a release instalada, não esse novo worktree.

Procedimento proposto para a próxima autorização:

1. Congelar essa baseline e homologar a matriz visual/funcional. Não atualizar automaticamente com outra branch.
2. Revisar o overlay de runtime e testes correspondentes, por patch pequeno, sem substituir arquivos oficiais inteiros pelo conteúdo da agente-3.
3. Catalogar candidatos exclusivos, comparar patches/contratos e selecionar apenas mudanças aprovadas; registrar “já integrado”, “a avaliar” ou “descartado com motivo”. Não fazer merge geral da agente-3 nem de agente-2.
4. Portar os núcleos de laboratório por arquivos revisados, mantendo separação de configuração e removendo qualquer fallback para o Supabase operacional no ambiente de teste.
5. Validar cada incremento com fixtures e interface original. Nenhuma ativação de release 8080 até autorização específica.

## 5. Preparação offline de Setores e Funções

Usar Setores/Funções da fonte oficial, dentro do layout, tema e navegação originais. A tela C1 é evidência de infraestrutura; não substituir essas páginas por ela. C1 atualmente só implementa LabRegistration e C2 só aceita code/name fictícios: nenhum dos dois atende diretamente o contrato Sector/JobRole. A expansão exige implementação e testes futuros.

### Contrato mínimo a implementar no laboratório

- Sector: id estável, name, description, role_purpose, responsible_name, status, created_date/updated_date, versão e escopo de autorização. Conservar campos legados ausentes sem inventar conteúdo.
- JobRole: id, name, sector_id, sector_name, status, datas, versão e escopo. Nome textual legado de Employee.function/sector precisa continuar compatível; não migrar silenciosamente vínculos para IDs.
- Employee sintético: projeção mínima autorizada para contagem, detalhe, resumo, busca e checagem de dependências. Setores lê até 500 empregados e Funções também os lê; não retornar lista vazia só para carregar a página. Esses limites atuais precisam teste de completude/paginação, pois bloqueio de exclusão no cliente pode ignorar registros fora do limite.
- AuditLog: comando e autoria verificados no servidor, gravados atomicamente com cadastro e outbox. Hoje formulário salva e depois chama logAudit separadamente; preservar experiência e evento, corrigindo atomicidade no adaptador/endpoint proposto, sem auditar duas vezes.
- Operações: list ordenada/limitada, create, update, ativar/desativar e exclusão lógica de função. Checar uso da função no servidor contra todo o escopo, não apenas os 500 empregados da UI. Não oferecer delete físico genérico.
- Duplicidade por nome normalizado, regras de renomeação e inativação com vínculos devem ser especificadas e aprovadas; preservar confirmação atual e ausência de cascata. Conflito de versão retorna erro explícito, mantendo o formulário.

Primeiro incremento: adaptador de entidades habilitado apenas na configuração isolada e allowlist Sector/JobRole/Employee sintético/AuditLog. Qualquer outro domínio deve falhar de forma explícita no laboratório, sem chamar Supabase, sem fallback a IndexedDB e sem acionar prefetch operacional. Todas as telas continuam no código; sua paridade completa será homologada progressivamente. API própria somente loopback e sessão local autorizada, nunca sessão da produção. PostgreSQL descartável existente só recebe schema aditivo após próxima autorização.

Outbox guarda UUID da operação, registro, dispositivo, autor/escopo derivados da sessão, tipo, versão-base, versão resultante, payload validado, estado, criação e confirmação. A primeira integração pode permanecer sem worker remoto. Validação bidirecional futura usa somente central C2 adaptado, nunca o projeto original. Não converter o adaptador cloud globalmente.

### Arquivos candidatos para alteração futura

| Arquivos | Intervenção prevista |
| --- | --- |
| src/api/base44Client.js e novo adaptador isolado de entidades | Injeção por configuração explícita de laboratório; preservar contrato existente |
| src/pages/Setores.jsx, src/pages/Funcoes.jsx | Preferencialmente nenhuma alteração visual; somente tratamento de erros/versão se necessário, com revisão de paridade |
| SectorForm.jsx, JobRoleForm.jsx | Manter campos/validações; proposta de tratamento de conflito e ID idempotente persistido por tentativa |
| sectorUtils.js, roleUtils.js, EmployeeForm.jsx | Preservar normalização/opções/referências; revisar contrato, não portar arquivos antigos |
| AuthContext.jsx, pontoUtils.js, currentUserStore.js e inicialização de prefetch | Pontos a analisar para injetar sessão/auditoria local e impedir consulta operacional; não substituir auth de produção |
| server/local-lab: novo schema e serviço de cadastros, api.mjs | Endpoints tipados, autorização, versão, integridade, audit/outbox na mesma transação |
| server/sync-lab/protocol.mjs e schemas | Somente em incremento posterior: múltiplas entidades, relações e permissões; atual code/name insuficiente |
| scripts e testes novos de paridade | Fixtures, contrato, E2E real, reinícios e segurança; sem prod:publish |
| scripts/production/store.mjs | Overlay instalado identificado, a revisar separadamente; nenhuma mudança nesta execução |

Não reutilizar automaticamente o protótipo server/api de estoque nem src/api/postgresClient.js: possuem contrato diferente e não comprovam autenticação/permissões exigidas para essa integração.

## 6. Testes e critérios de aprovação

| Grupo | Evidência exigida antes de avançar |
| --- | --- |
| Proveniência | 340 fontes disponíveis, histórico preservado, manifesto íntegro, overlay documentado e zero perda de rotas |
| Paridade visual | Navegador real, mesmo fixture/viewport, screenshots claro/escuro de lista, detalhe, modais e erros; comparar com fonte oficial isolada, sem usar dados reais como fixture |
| Setores | Criar/editar campos completos; manter detalhe por ID após renomeação; filtros por nome/apelido/função e grupos de status; resumo e navegação para ficha sintética; confirmação de inativação com vínculos |
| Funções | Agrupar por setor e “Sem setor”; editar; bloquear exclusão em uso inclusive fora da página carregada; exclusão lógica sem apagar histórico; opções ativas e ausência de funções/setores fantasmas |
| Validação | Nome vazio/duplicado normalizado, setor inexistente/inativo, campo extra, formato legado, versão antiga e requisição repetida; regras adicionais explicitadas, sem mudanças silenciosas |
| Segurança | Anônimo negado; perfil sem permissão negado na API e por registro/campo; autor adulterado ignorado/negado; sessão C1 independente; nenhum segredo no bundle ou log |
| Atomicidade | Falha de auditoria/outbox reverte cadastro; replay não duplica; crash antes/depois do COMMIT não perde operação |
| Offline/persistência | VM isolada da internet, login autorizado, CRUD e consultas; reiniciar janela, API e PostgreSQL; dados/fila preservados; não confundir central parado com teste completo de aplicativo offline |
| Integração sintética | Dois dispositivos C2, versões, dependências, conflitos e ACK perdido após expandir contrato; sem Supabase |
| Não interferência | Release/health e hashes operacionais iguais antes/depois; nenhum restart 8080; nenhum endpoint operacional chamado pelo laboratório |

Nenhum desses testes funcionais novos foi executado agora: a autorização desta entrega é de auditoria/preparação. Checks efetivamente realizados: HTTP health, hashes de assets e cópias, comparação de fontes, referências/histórico Git, bundle verify e isolamento inicial do worktree. Não houve build ou teste que reinicia C1/C2.

## 7. Bloqueios e próximos passos

- Não existe bloqueio de fonte React oficial: 340/340 arquivos recuperados. Permanece a ressalva de proveniência do build e o overlay de runtime a revisar.
- Produção contém componentes de Redes Sociais, mas a operação completa da API social/provedores não foi validada; credenciais externas não foram procuradas ou divulgadas.
- CentralDelivery e candidatos R2/recuperação em branches divergentes não fazem parte automaticamente da versão oficial; decidir seleção sem regredir a base.
- Login/permissões seguros offline, instalador e backup externo ainda não estão implementados/homologados para o produto completo. Backup de preservação desta auditoria fica no mesmo disco.
- O proprietário confirmou sessão autorizada C1, mas ainda falta confirmação explícita do ciclo criar/consultar/editar em navegador real.
- A vulnerabilidade anônima Supabase previamente reportada continua bloqueio para sincronização operacional. A auditoria atual não leu records anonimamente nem alterou RLS; esquema/políticas reais e correção controlada continuam necessários.
- C1/C2 precisam expansão de contrato e autorização por domínio; os testes anteriores não homologam automaticamente Setores/Funções.

Próxima etapa recomendada: autorizar implementação do adaptador e endpoints **somente de laboratório** para Setores/Funções oficiais, com fixtures e testes acima, nesta branch isolada. Preservar 8080 até aceite posterior explícito.
