# Auditoria dos dashboards

Base: `04a744e267d89fcde68ff012a4cc45dfb0094944` (origin/main). Branch: `codex-fix-dashboards-indicadores`.

## Diagnóstico antes da implementação

Nenhuma leitura/gravação do banco real foi executada. **NR** significa não recebido nesta sessão; não significa zero. Os três valores abaixo são evidência fornecida pelo usuário, não uma consulta independente. Sem os quatro registros e o período da captura não é possível classificar individualmente seus subtotais como errados. Fixtures serão identificadas separadamente.

| Tela | Card | Entity/Fonte | Cálculo esperado / escopo | Valor recebido | Valor exibido |
|---|---|---|---|---|---|
| Financeiro | Saídas pagas (usuário: Saídas gerais) | FinancialExpense | soma amount, status pago, date do início do mês até hoje | NR | R$ 1.154,05 informado; label na base é Saídas pagas |
| Financeiro | Pagamentos de pessoas | FinancialExpense | soma classification=pagamento_colaborador no período, não somar EmployeePayment vinculado novamente | NR | zero informado, pode ser legítimo |
| Financeiro | Diárias de motoboy | EmployeePayment | pago + diaria_motoboy, net_amount; payment_date/work_date/reference_start | NR | zero não comprovado |
| Financeiro | Insumos | FinancialExpense | compra_insumo, amount no período | NR | zero pode ser legítimo |
| Financeiro | Vales/adiantamentos | FinancialExpense | adiantamento_colaborador no período; Vale do RH ainda não lançado não entra | NR | zero pode ser legítimo |
| Financeiro | Pendentes | FinancialExpense | status pendente no período | NR | zero pode ser legítimo |
| Financeiro | Pagos sem comprovante | FinancialExpense | pago sem proof_url nem storage_path | NR | bug: só considerava proof_url |
| Financeiro | Lançamentos no período | FinancialExpense | não cancelados, date no período | NR | 4 informado |
| Financeiro | Gastos por categoria | FinancialExpense | soma amount agrupada; mesmo universo de lançamentos | NR | Despesa operacional R$ 1.154,05 informado |
| Gastos | Total / categorias / quantidades | FinancialExpense | filterExpenses + totalOf + summarizeByCategory; filtros próprios visíveis | NR | NR; agregadores corretos, cache pode estar antigo |
| Pagamentos | Resumo por colaborador / histórico | EmployeePayment, Employee, Vale, Consumption | período financeiro; descontos somente pendente/registrado | NR | fase inicial pode usar dependências vazias |
| Vales financeiro | Vales do RH / lançado | Vale | histórico não cancelado, financial_expense_id indica saída lançada | NR | NR; histórico proposital |
| Contas a pagar | Total pendente / vencidas / vencem hoje / próximos 7 dias | AccountsPayable | abertos, due_date relativo a hoje; cards independentes da busca/status da tabela | NR | NR |
| Recorrentes | Recorrências ativas / próximos 30 dias / valor previsto ativo | RecurringExpense | status ativo, next_due_date, soma amount de ativos | NR | NR |
| Fechamento diário | Saídas pagas / pessoas / sem comprovante / pendências | FinancialExpense, AccountsPayable | paid_date ou date no dia; pessoas inclui logística e adiantamento; contas até a data | NR | erro de proof_url apenas também presente |
| Fechamento de Caixa | resumos de fechamento | FechamentoCaixa | datas/status do painel; não confundir com FinancialExpense | NR | NR |
| Sangrias / Caixas & Delivery | totais dos movimentos / divergência | Sangria, CashMovement | filtros dos respectivos painéis, movementTotals | NR | NR |
| Direção Hoje | Receita líquida / despesas / saldo | Revenue, FinancialExpense | date hoje, não cancelado, receita-despesa | NR | NR |
| Direção Hoje | Faltas e ocorrências / colaboradores ativos | Absence, Employee | hoje não cancelado; ativos exclui desligado/inativo (inclui afastado/férias, contrato existente) | NR | NR |
| Direção mês | Receita acumulada / despesas / resultado / pessoal | Revenue, FinancialExpense, EmployeePayment | mês atual; pessoal por payment_date; resultado receita-despesa | NR | NR |
| Direção | Advertências | Warning confirmado no RH e Ficha | **ausente na base**; escopo não estabelecido; proposta mês atual como RH, todas situações cadastradas | NR | não existe card nesta revisão |
| Direção caixa | Entradas / saídas / saldo / divergências | CashMovement | hoje, movementTotals; também receita/sangria oficiais e contagem de fechamentos | NR | NR |
| Direção projeção | Saldo atual / entradas previstas / saídas previstas / saldo projetado | FinancialAccount, AccountsReceivable, AccountsPayable | contas não inativas; previsão hoje até +30 dias; saldo+entradas-saídas | NR | NR |
| Direção DRE | Bruta / descontos e taxas / líquida / despesas / resultado / margem | Revenue, FinancialExpense | mês atual; margem resultado/líquida | NR | NR |
| Direção alertas | Vencidas / estoque crítico / produção pendente / experiência vencendo | AccountsPayable, InventoryItem, ProductionOrder, Employee | vencimento antes hoje; estoque <= mínimo; ordens planejadas hoje; experiência próximos 15 dias | NR | NR |
| Direção canais | Receita por canal | Revenue | source_type, mês atual | NR | NR |
| RH | Ativos / afastados / total / novos no mês | Employee | setor/status; ativo ou em_experiencia; afastado; length; created_date mês | NR | cálculos corretos; erro de carga pode mostrar zeros |
| RH | Trabalhando / folga / faltas / atrasos hoje | Schedule, Absence | hoje e colaboradores filtrados; trabalho ativo; falta/nao_justificada/atraso ativos | NR | NR |
| RH | Vales pendentes (quantidade e valor auxiliar) | Vale | pendentes dos colaboradores filtrados | NR | valor auxiliar ignora filtros: incorreto |
| RH | Advertências no mês | Warning | date mês atual + colaboradores filtrados, inclui pendente/tratada/cancelada | NR | contrato existente, não histórico |
| RH | Atenção / documentos | EmployeeDocument, Employee, Schedule, Absence, Warning, Vale | alertas derivados; documento faltando é ausência de documento do colaborador | NR | NR |
| Colaboradores | lista | Employee | busca, setor, função, status | NR | sem cards adicionais |
| Ficha colaborador | faltas / atrasos / vales / advertências / avaliações / ponto | Absence, Vale, Warning, Evaluation, TimeRecord | colaborador; advertências histórico exceto cancelada; demais escopos próprios do resumo | NR | NR |
| Advertências | lista de ocorrências | Warning | rangeFor, categoria/status; padrão mês | NR | NR; não é o painel Direção |
| Vales RH | Total / pendente / colaboradores com vale | Vale | período/setor/status/colaborador; soma amount e colaboradores distintos | NR | cards exibem zero durante carga |
| Home | Escalados / presentes / faltas / atrasos / folgas | Schedule, TimeRecord | hoje; buildDayRows/summarizeRows; presentes inclui encerrados | NR | NR |
| Ponto | Escalados / presentes / atrasados / ausentes / intervalo / encerrados / folga / incompletos | Schedule, TimeRecord | dia selecionado; summarizeRows | NR | NR |
| Escalas / ocorrências frequência | cobertura / listagem | Schedule, Absence | datas e filtros próprios; sem outro dashboard global | NR | NR |
| Estoque | Itens ativos / abaixo mínimo / valor estimado / movimentos | InventoryItem, StockMovement | ativo; saldo <= mínimo; saldo*custo médio; movimentos carregados | NR | catch retorna [] em falha: incorreto |
| Produção diário | Produção / perdas / sobras / registros | DailyProduction | mesma lista filtrada por data/produto/responsável/busca; perdas array ou legado | NR | cálculo e memos coerentes; loader distingue falha |
| Produção ordens / fichas | listas / custos | ProductionOrder, ProductionProduct, RecipeIngredient | sem indicadores globais extras | NR | NR |
| Compras | Compras e valor no mês / aguardando / recebidas | Purchase | mês em date; aguardando/recebidas por status | NR | NR; cards antes da carga |
| Receitas | Bruta / líquida / a receber / divergências | Revenue, AccountsReceivable, ManualReconciliation | histórico; recebíveis abertos; status divergente | NR | catch retorna []: incorreto |
| Receitas fluxo/DRE | Entradas / saídas / saldo; bruto / taxas / despesas / resultado / categorias | Revenue, FinancialExpense, CardReceivable, DeliverySettlement | mês selecionado; caixa recebido/pago; DRE competência | NR | NR; mesmo risco de falha mascarada |
| Relatório financeiro | Líquida / despesas / taxas / resultado / categorias | Revenue, FinancialExpense, CardReceivable, DeliverySettlement | período selecionado; despesas não canceladas | NR | NR; loading nunca termina em falha |
| Funções / Setores | totais e vínculos de cadastros | JobRole, Sector, Employee | contadores das listas e vínculos, sem novo agregado financeiro | NR | NR |

## Causas e classificação

- C/G: `8b488ea` permite primeira renderização antes das outras fontes; cards nunca receberam disponibilidade por alias.
- G: `27c8805` cria SWR que só muda cache, não estado; fases seguintes reaplicam fase0 antiga; falhas de fase1 são descartadas.
- C: refresh seletivo passa Promise para `safe`, mas `safe` chama fn(): TypeError capturado como falha permanente. O incremento global de sequência nesses refreshes ainda cancela fases de entidades independentes.
- D: `a3274c6` remove sort/limit ao reconstruir fontes. Visão usa comparação integral de date enquanto Gastos corta YYYY-MM-DD; comprovante diverge em storage_path.
- F: valor auxiliar de vales RH não acompanha filtro do contador.
- H: classificações vazias ou diferentes não autorizam inferir salário/insumo/vale pelo nome da categoria. Os zeros específicos não são erros comprovados.
- A: não encontrada regra CSS ocultando valores. Memos financeiros incluem arrays corretos.
- E: aliases Financeiro confirmados em base44Client; implementação real é Supabase/localDb, não SDK Base44. Não há alteração Base44 específica nesta tarefa.

Estratégia: resumo financeiro puro usando regras de Gastos, transição incremental por alias, SWR com entrega ao React, estados loading/error/ready; preservar fases/cache/dedupe e regras de negócio. Direção consultar Warning separadamente e explicitar mês; outros painéis somente corrigir falhas comprovadas de disponibilidade e filtro. Nenhuma mudança em banco, estoque transacional, anexos ou tema.

Limite: listagens possuem limites de 200–1500 e cloudDb consulta records sem paginação. Totais acima desses limites precisam de auditoria de paginação própria; não afirmar completude histórica sem dados reais.


## Inventário complementar por componente

Os valores recebidos/exibidos reais de cada linha abaixo são **NR/NR** (não houve acesso ao banco). A coluna de cálculo descreve o contrato lido no código; não constitui confirmação dos valores atuais de produção.

| Tela / componente | Card | Fonte | Cálculo / escopo |
|---|---|---|---|
| Financeiro / PayablePanel | Total pendente | AccountsPayable | soma amount em status diferente de pago/cancelado |
| Financeiro / PayablePanel | Vencidas | AccountsPayable | abertos com due_date anterior a hoje |
| Financeiro / PayablePanel | Vencem hoje | AccountsPayable | abertos com due_date igual a hoje |
| Financeiro / PayablePanel | Próximos 7 dias | AccountsPayable | abertos após hoje até hoje+7 |
| Financeiro / RecurringPanel | Recorrências ativas | RecurringExpense | status ativo, quantidade |
| Financeiro / RecurringPanel | Próximos 30 dias | RecurringExpense | ativos com next_due_date entre hoje e hoje+30 |
| Financeiro / RecurringPanel | Valor previsto ativo | RecurringExpense | soma amount de todos ativos |
| FechamentoCaixaPanel | Total vendido hoje | FechamentoCaixa | soma cash_sales+pix_total+debit_total+credit_total+ifood_total+food99_total+brendi_total+other_payments; date hoje |
| FechamentoCaixaPanel | Total em dinheiro | FechamentoCaixa | cash_sales hoje |
| FechamentoCaixaPanel | Total em PIX | FechamentoCaixa | pix_total hoje |
| FechamentoCaixaPanel | Total em cartões | FechamentoCaixa | debit_total+credit_total hoje |
| FechamentoCaixaPanel | Total de sangrias | FechamentoCaixa | withdrawals_total hoje, não somar Sangria novamente |
| FechamentoCaixaPanel | Diferença total | FechamentoCaixa | difference hoje; filtro da tabela não altera esses cards do dia |
| SangriaPanel | Total no período | Sangria | não cancelados da lista filtrada por busca; apesar do rótulo, não existe seletor de período nesta aba |
| SangriaPanel | Sangrias hoje | Sangria | amount de hoje, não canceladas, independente da busca |
| SangriaPanel | Registros | Sangria | quantidade não cancelada da lista filtrada |
| CashMovementKpis | Entradas totais | CashMovement | movementTotals(filtered).entries, source/data/channel/status |
| CashMovementKpis | Saídas / sangrias | CashMovement | movementTotals(filtered).exits |
| CashMovementKpis | Saldo calculado | CashMovement | movementTotals(filtered).balance |
| CashMovementKpis | Divergências / alertas | CashMovement | quantidade divergent e total difference |
| CashDirectionSummary | Entradas / Saídas / Saldo / Divergência | CashMovement | mesma função movementTotals, todos sources na data selecionada; por conta via account_allocations |
| Direção / DirectionMetric | Receita líquida | Revenue | net_amount de hoje, não cancelado |
| Direção / DirectionMetric | Despesas | FinancialExpense | amount de hoje, não cancelado |
| Direção / DirectionMetric | Saldo do dia | Revenue e FinancialExpense | receita de hoje menos despesas de hoje |
| Direção / DirectionMetric | Faltas e ocorrências | Absence | date hoje, status diferente de cancelado; não é Warning |
| Direção / DirectionMetric | Receita acumulada | Revenue | net_amount mês atual |
| Direção / DirectionMetric | Despesas acumuladas | FinancialExpense | amount mês atual |
| Direção / DirectionMetric | Resultado estimado | Revenue e FinancialExpense | líquido menos despesas do mês |
| Direção / DirectionMetric | Custo com pessoal | EmployeePayment | net_amount do mês por payment_date, não cancelado; preservado o contrato diferente das classificações do razão |
| Direção / DirectionMetric novo | Advertências no mês | Warning | countMonthlyWarnings: date mês atual, todas situações, todos colaboradores; não é total histórico |
| Direção / DirectionCashFlow | Entradas lançadas | CashMovement | movementTotals dos registros de hoje |
| Direção / DirectionCashFlow | Saídas lançadas | CashMovement | exits de hoje |
| Direção / DirectionCashFlow | Saldo operacional | CashMovement | entries-exits hoje |
| Direção / DirectionCashFlow | Divergências | CashMovement | difference hoje |
| Direção / DirectionCashFlow | Receitas oficiais / Sangrias oficiais / Fechamentos hoje | Revenue / Sangria / FechamentoCaixa | hoje, não cancelados nas duas primeiras; quantidade na terceira |
| Direção / CashProjection | Saldo atual | FinancialAccount | soma current_balance de contas não inativas |
| Direção / CashProjection | Entradas previstas | AccountsReceivable | net_amount abertos, expected_date hoje até +30 dias |
| Direção / CashProjection | Saídas previstas | AccountsPayable | amount abertos, due_date hoje até +30 dias |
| Direção / CashProjection | Saldo projetado | três fontes anteriores | atual+entradas-saídas |
| Direção / DreSummary | Receita bruta | Revenue | gross_amount mês atual |
| Direção / DreSummary | Descontos e taxas | Revenue | discount_amount+fee_amount mês atual |
| Direção / DreSummary | Receita líquida / despesas operacionais / resultado gerencial | Revenue / FinancialExpense | mesmos valores mensais do buildDirectionMetrics |
| Direção / DreSummary | Margem | agregados mensais | resultado/receita líquida ×100; zero se receita zero |
| Direção / DirectionAlerts | Contas vencidas | AccountsPayable | abertos antes de hoje |
| Direção / DirectionAlerts | Estoque crítico | InventoryItem | não inativo, current_stock <= minimum_stock |
| Direção / DirectionAlerts | Produção pendente | ProductionOrder | hoje, status planejada |
| Direção / DirectionAlerts | Experiência vencendo | Employee | experience_end hoje até +15 dias, exceto desligado/inativo |
| Direção / DirectionAlerts | Total de alertas | quatro contagens anteriores | soma, não quantidade distinta de entidades |
| Direção / DirectionChannels | Receita por canal | Revenue | source_type, net_amount do mês |
| Consumo RH | Total consumido / colaboradores | Consumption | filtros período/status/colaborador, soma amount e agrupamento por nome existente |
| Relatórios de frequência | Dias previstos / trabalhados / faltas / atrasos / minutos de atraso / saídas antecipadas / incompletos | Employee, Schedule, TimeRecord, Absence | filtros período/setor/unidade/colaborador; computeMetrics e isIncomplete |
| Setores | Total / ativos / afastados / desligados e funções | Employee, Sector | employeesOfSector, sectorEmployeeSummary, sectorFunctionSummary; vínculo real por ID/nome legado |

### Contratos e ambiguidades mantidos

- Saídas pagas não equivale a todos os gastos: pendentes compõem categorias/quantidade, mas não saídas pagas. A relação correta é total das categorias = total dos não cancelados; pago+pendente = total somente quando esses são os únicos status.
- Categorias não são classificações. Não inferir compra_insumo, pagamento_colaborador ou adiantamento_colaborador a partir de texto livre, beneficiary_id, employee_id ou nomes. Nenhum alias fictício foi acrescentado.
- Warning inclui cancelada no contador mensal do RH existente. O novo card mensal da Direção segue esse contrato e explicita “todas as situações”. Ficha do colaborador continua histórico exceto cancelada. A pergunta de escopo foi enviada; sem resposta, foi aplicada essa suposição documentada.
- As datas são datas de negócio: FinancialExpense.date; EmployeePayment.payment_date com os fallbacks já existentes. Não substituir por created_date. A Visão usava UTC para hoje, mas Gastos registra data local: foi reutilizado todayISO, sem mudar fuso global.
- Visão usava mês até hoje sem controles visíveis; os valores iniciais foram mantidos e os controles desse período agora são explícitos. Gastos conserva seus filtros próprios. Comparações entre abas exigem selecionar o mesmo intervalo; Vales financeiro continua histórico.
- Não foi encontrada regressão de Warning no histórico de Direcao.jsx de origin/main: a fonte e o card não existiam nessa revisão. É uma inclusão solicitada, não restauração comprovada de um contador anterior.
- Produção usa a mesma lista filtrada e memos completos; não houve mudança nos cálculos, baixa de estoque ou ordens.

## Implementação e evidência

`financialDashboard.js` centraliza o resumo, disponibilidade e transição incremental. Reutiliza filterExpenses, totalOf, summarizeByCategory e hasExpenseProof. `FinancialOverviewCards` renderiza o mesmo resumo; `FinancialStat` foi extraído sem mudar classes. `FinancialSummary` reutiliza o total e as categorias para relatório.

`Financeiro.jsx` mantém render/proxima/resto. Cada resposta modifica só seus aliases; erros anteriores persistem até sucesso da mesma fonte. Versões por alias impedem que refresh de gastos cancele pagamentos ou que resposta antiga sobrescreva nova. Refreshes seletivos concorrentes são deduplicados. SWR entrega a promise de revalidação ao estado e revisões protegem o cache de respostas antigas. Sort/limit declarados voltam a ser repassados. Loading/erro são resolvidos por dependência; falha não apaga a última lista válida.

Direção consulta Warning em paralelo com o conjunto já existente, tem disponibilidade própria para o novo card e subscription de Warning. `rhDashboardMetrics.js` compartilha a regra mensal e corrige o valor auxiliar de vales para o mesmo conjunto filtrado do contador.

As demais mudanças são gates de leitura: RH, Estoque, Compras, Receitas, Vales, Consumo, Ficha, Advertências, Ocorrências, Relatórios, Funções, Setores, Home e Ponto preservam arrays e mostram erro explícito. Home/Ponto compartilham o tratamento no hook usePontoData. Não houve refatoração de layouts ou de gravações.

### Fixture financeira, não dados reais

| Card | Esperado | Recebido pelo agregador / renderizado no teste |
|---|---:|---:|
| Total não cancelado | 1.000,00 | 1.000,00 |
| Saídas pagas | 700,00 | 700,00 |
| Pagamentos de pessoas | 200,00 | 200,00 |
| Diárias de motoboy | 100,00 | 100,00 |
| Insumos | 300,00 | 300,00 |
| Vales/adiantamentos | 400,00 | 400,00 |
| Pendentes | 300,00 | 300,00 |
| Sem comprovante | 1 | 1 |
| Lançamentos no período | 4 | 4 |
| Categorias | Operação 100; Pessoas 600; Insumos 300 | igual |
| Warning mês setembro, dois colaboradores | 3, incluindo cancelada, excluindo agosto | 3 |

Teste da página real executa hooks com dispatcher em memória e renderiza JSX real via React SSR. Fixtures substituem entities por funções de leitura; não há rede/banco. Cobre expenses primeiro, payments depois, refresh seletivo entre fases, erros, recuperação e SWR tardio. Não é teste DOM/navegador: a conexão Browser retornou nenhuma instância disponível.

## Limitações de evidência

1. Sem leitura autenticada dos quatro lançamentos da captura: não é possível afirmar quais classificações individuais possuem, nem que os zeros relatados eram todos incorretos.
2. Não houve comparação visual light/dark em navegador. Classes/arquivos de tema foram preservados e regressões automatizadas executadas.
3. Limites de listagem e paginação do cloudDb são preexistentes; não foi alterado o banco nem a estratégia global de consulta. Não afirmar cobertura histórica acima desses limites sem uma auditoria de volume real.
4. Agrupamentos antigos de Vales/Consumo por nome e diferenças de escopo entre painéis foram mantidos; não houve mudança sem evidência dos registros.

## Validação final automatizada

32 arquivos de teste aprovados. 607 verificações reportadas pelos runners (testes Node e verificações do harness de estoque/produção; unidades distintas, discriminadas abaixo). Sem falhas.

| Suíte | Aprovados | Falhas |
|---|---:|---:|
| `test-attachment-normalizer.mjs` | 17 | 0 |
| `test-attachment-preview.mjs` | 22 | 0 |
| `test-daily-expenses.mjs` | 77 | 0 |
| `test-dashboard-direcao.mjs` | 3 | 0 |
| `test-dashboard-fases.mjs` | 5 | 0 |
| `test-dashboard-financeiro.mjs` | 5 | 0 |
| `test-dashboard-page.mjs` | 2 | 0 |
| `test-dashboard-rh.mjs` | 2 | 0 |
| `test-drafts-integration.mjs` | 32 | 0 |
| `test-drafts.mjs` | 28 | 0 |
| `test-fase2a.mjs` | 7 | 0 |
| `test-financeiro-estabilidade.mjs` | 16 | 0 |
| `test-financeiro-freelancer.mjs` | 20 | 0 |
| `test-financeiro-gastos-existentes.mjs` | 14 | 0 |
| `test-financeiro-integrado.mjs` | 9 | 0 |
| `test-financeiro-loader.mjs` | 12 | 0 |
| `test-financeiro-perf.mjs` | 14 | 0 |
| `test-financeiro-prefetch.mjs` | 12 | 0 |
| `test-financeiro-resumo-categorias.mjs` | 23 | 0 |
| `test-funcoes.mjs` | 11 | 0 |
| `test-payable-attachment.mjs` | 8 | 0 |
| `test-payment-proof.mjs` | 13 | 0 |
| `test-production.mjs` | 5 | 0 |
| `test-rafts-draft-categoria.mjs` | 8 | 0 |
| `test-sectors.mjs` | 27 | 0 |
| `test-stock-item-delete.mjs` | 28 | 0 |
| `test-stock.mjs` | 121 | 0 |
| `test-theme-cobertura.mjs` | 10 | 0 |
| `test-theme-comportamento.mjs` | 10 | 0 |
| `test-theme-inventario.mjs` | 12 | 0 |
| `test-theme-superficies.mjs` | 16 | 0 |
| `test-theme.mjs` | 18 | 0 |


Gates: `npm.cmd run lint` exit 0; `npm.cmd run build` exit 0; `git diff --check` exit 0. Build conserva avisos de tamanho de chunk, import estático/dinâmico e Browserslist desatualizado; não são falhas e não houve atualização de dependências.

O teste legado `gastos-existentes` usa a fixture histórica já existente de 23 registros, não uma contagem atual do banco. Sua referência de setembro era passada num terceiro argumento ignorado; foi corrigida para o segundo objeto de opções. As outras quatro asserções textuais alteradas acompanham as funções novas; os testes de comportamento novos executam o caminho real da página, incluindo memos e subscriptions.

Performance: primeira fase permanece FinancialExpense para Visão/Gastos; nenhuma espera global de 15 fontes foi reintroduzida. Prefetch, TTL, SWR e dedupe permanecem em memória. Não foram medidos tempos de rede real nesta sessão.

Preservação: nenhum arquivo de AttachmentPreview, normalizador, zoom, download, impressão, CSS de tema, migrations, configuração de produção ou camada de gravação foi alterado. Os testes de produção usam ambiente temporário; não houve publicação real. As mudanças em Financeiro alteram leitura/agregação/apresentação; os handlers existentes de gravação não foram executados nesta tarefa.

## Entrega da branch

- Base origin/main: `04a744e267d89fcde68ff012a4cc45dfb0094944`.
- Branch: `codex-fix-dashboards-indicadores`.
- Worktree: `C:/Users/Pichau/gestao-ruy-dashboards`.
- Commit e HEAD exatos: informados na resposta de entrega e disponíveis em `git log -1` desta branch.
- Integração/publicação: não executadas; não autorizadas nesta etapa.
- Riscos restantes: volume/paginação preexistente, escopo mensal de Warning assumido e documentado, ausência de validação visual em navegador e de conferência autenticada dos quatro registros citados.

As conclusões sobre refletir registros dizem respeito à fonte e ao comportamento validado do código. Não constituem certificação dos números atualmente visíveis na produção.

DADOS EXISTENTES FORAM PRESERVADOS: SIM — nenhuma operação no banco.

CARDS FINANCEIROS REFLETEM OS DADOS REAIS: SIM — fontes existentes, sem totais hardcoded; agregação e atualização validadas em fixtures. Valores individuais de produção não aferidos.

ADVERTÊNCIAS DA DIREÇÃO REFLETEM OS REGISTROS REAIS: SIM — leitura de Warning, mês atual conforme RH, com loading/erro próprios; quantidade atual de produção não aferida.

OUTROS INDICADORES AUDITADOS: SIM — mapa acima; zeros legítimos e contratos diferentes preservados.

PRONTO PARA INTEGRAR NA MAIN: SIM — gates e regressões verdes, com as limitações de evidência documentadas; não integrado.

## Arquivos alterados

- `docs/auditoria-dashboards.md`
- `scripts/dashboard-page-harness.mjs`
- `scripts/dashboard-render-harness.mjs`
- `scripts/fixtures/dashboard-data.mjs`
- `scripts/test-dashboard-direcao.mjs`
- `scripts/test-dashboard-fases.mjs`
- `scripts/test-dashboard-financeiro.mjs`
- `scripts/test-dashboard-page.mjs`
- `scripts/test-dashboard-rh.mjs`
- `scripts/test-financeiro-estabilidade.mjs`
- `scripts/test-financeiro-gastos-existentes.mjs`
- `scripts/test-financeiro-loader.mjs`
- `scripts/test-financeiro-perf.mjs`
- `src/components/financeiro/FinancialOverviewCards.jsx`
- `src/components/financeiro/FinancialStat.jsx`
- `src/components/relatorios/FinancialSummary.jsx`
- `src/lib/directionMetrics.js`
- `src/lib/financeiroPrefetch.js`
- `src/lib/financialDashboard.js`
- `src/lib/pontoData.js`
- `src/lib/rhDashboardMetrics.js`
- `src/pages/Advertencias.jsx`
- `src/pages/Compras.jsx`
- `src/pages/Consumo.jsx`
- `src/pages/Direcao.jsx`
- `src/pages/Estoque.jsx`
- `src/pages/FichaColaborador.jsx`
- `src/pages/Financeiro.jsx`
- `src/pages/Funcoes.jsx`
- `src/pages/Home.jsx`
- `src/pages/OcorrenciasFrequencia.jsx`
- `src/pages/Ponto.jsx`
- `src/pages/RH.jsx`
- `src/pages/ReceitasFinanceiras.jsx`
- `src/pages/RelatorioFinanceiro.jsx`
- `src/pages/Relatorios.jsx`
- `src/pages/Setores.jsx`
- `src/pages/Vales.jsx`
