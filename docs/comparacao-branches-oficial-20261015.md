# Compara??o local ? refer?ncia oficial 9d7e59e

Data: 15/10/2026. Somente refs locais, sem fetch. Contagens n?o representam qualidade nem ordem cronol?gica das fun??es. Arquivos s?o diferen?as entre as pontas, n?o lista de recursos automaticamente recuper?veis. Worktrees de outros agentes n?o foram alterados; altera??es n?o commitadas deles n?o foram inventariadas.

| Branch | Commit | S? oficial | S? branch | Arquivos diferentes | Frontend |
| --- | --- | ---: | ---: | ---: | ---: |
| agente-1 | 48fd752 | 97 | 1 | 211 | 100 |
| agente-1-estoque-fase4 | 77712d7 | 70 | 0 | 157 | 74 |
| agente-2 | fdcad74 | 68 | 12 | 191 | 86 |
| agente-2-hover-gastos-dark | 986c55e | 38 | 0 | 113 | 52 |
| agente-2-tema-claro-escuro | 1ca1348 | 52 | 0 | 126 | 55 |
| agente-3 | f3be62b | 81 | 1 | 170 | 78 |
| agente-3-funcoes-delete | 2bcfa1d | 75 | 0 | 163 | 74 |
| agente-3-integracao-filtro-categoria | bb3eca1 | 5 | 0 | 44 | 29 |
| agente-3-setores | 468420a | 77 | 0 | 165 | 75 |
| agente-4 | 8509a83 | 95 | 0 | 177 | 84 |
| agente-4-anexos-unificados | c643586 | 38 | 0 | 111 | 51 |
| agente-4-comprovante-preview | 72c3efe | 43 | 0 | 122 | 54 |
| agente-5-fix-loader-financeiro | 10cd2d9 | 49 | 0 | 122 | 54 |
| agente-5-perf-gastos | 27c8805 | 46 | 0 | 115 | 53 |
| agente-5-persistencia-rascunhos | daca65d | 60 | 0 | 137 | 61 |
| agente-5-retomada-local | a55ff31 | 6 | 14 | 58 | 29 |
| agente-financeiro-consolidado | 988936f | 65 | 0 | 148 | 69 |
| agente-financeiro-freelancer-categorias | 58ea38c | 68 | 1 | 151 | 70 |
| agente-financeiro-gastos-estabilidade | 510304d | 68 | 1 | 154 | 72 |
| agente-financeiro-resumo-categorias | 399b3d1 | 68 | 2 | 149 | 69 |
| agente-redes-sociais | 5fbb883 | 20 | 0 | 61 | 38 |
| agente-rh-exclusao-segura-sem-dependencias | 91c600b | 34 | 0 | 104 | 47 |
| backup-agente-2-dc202f1 | dc202f1 | 96 | 6 | 218 | 102 |
| chalk-form | 9d7e59e | 0 | 0 | 0 | 0 |
| codex-dashboards-indicadores-v2 | 7d0e589 | 2 | 0 | 6 | 4 |
| codex-fix-dashboards-indicadores | b7408be | 35 | 1 | 80 | 29 |
| codex-fix-filtro-categoria-gastos | fda4097 | 35 | 1 | 105 | 47 |
| codex-storage-r2 | 78f0f74 | 5 | 2 | 59 | 33 |
| codex-storage-r2-base64-flows | 78f0f74 | 5 | 2 | 59 | 33 |
| fix-test-financeiro-data-deterministica | 0130264 | 32 | 0 | 104 | 47 |
| fix/anexos-unificados | 76bf59c | 45 | 0 | 115 | 53 |
| integracao-anexos-main | af50b6c | 37 | 0 | 111 | 51 |
| integracao-filtro-categoria-gastos | bf2eac5 | 6 | 2 | 44 | 29 |
| integracao-hover-dark-main | 04a744e | 35 | 0 | 109 | 50 |
| main | 9d7e59e | 0 | 0 | 0 | 0 |
| merge-fix-data | a9f4818 | 6 | 0 | 48 | 32 |
| merge-rh-exclusao | 84cab05 | 33 | 0 | 104 | 47 |
| shimmer-pyjama | eecb450 | 67 | 0 | 147 | 66 |

A branch de prepara??o foi criada depois desta captura, no mesmo commit oficial, sem diferen?as.

## Arquivos diferentes HEAD agente-3 ? oficial

A = adicionado no oficial; M = modificado; D = removido. Inclui somente hist?rico commitado.

- M: .gitignore
- A: docs/auditoria-dashboards.md
- D: docs/contrato-integracao-estoque-producao-agente3.md
- A: docs/redes-sociais.md
- M: index.html
- M: package-lock.json
- M: package.json
- A: scripts/bootstrap-social-admin.mjs
- A: scripts/check-employee-delete-integrity.mjs
- A: scripts/check-social-access-schema.mjs
- A: scripts/check-social-config.mjs
- A: scripts/check-stock-integrity.mjs
- A: scripts/dashboard-page-harness.mjs
- A: scripts/dashboard-render-harness.mjs
- A: scripts/diag-alias-hook.mjs
- A: scripts/diag-gastos-pipeline.mjs
- A: scripts/diag-loader-real.mjs
- A: scripts/diag-perf-antes-depois.mjs
- A: scripts/diag-perf-cenarios.mjs
- A: scripts/diag-perf-decomposicao.mjs
- A: scripts/diag-perf-escala.mjs
- A: scripts/diag-perf-loader.mjs
- A: scripts/diag-perf-payload.mjs
- A: scripts/diag-startup-bundle.mjs
- A: scripts/fixtures/dashboard-data.mjs
- A: scripts/proposed-social-account-access.sql
- A: scripts/proposed-social-manychat.sql
- A: scripts/proposed-social-schema.sql
- A: scripts/stock-harness.mjs
- A: scripts/test-attachment-normalizer.mjs
- A: scripts/test-attachment-preview.mjs
- A: scripts/test-dashboard-direcao.mjs
- A: scripts/test-dashboard-fases.mjs
- A: scripts/test-dashboard-financeiro.mjs
- A: scripts/test-dashboard-page.mjs
- A: scripts/test-dashboard-rh.mjs
- A: scripts/test-drafts-integration.mjs
- A: scripts/test-drafts.mjs
- A: scripts/test-employee-delete.mjs
- A: scripts/test-financeiro-estabilidade.mjs
- A: scripts/test-financeiro-filtro-categoria.mjs
- A: scripts/test-financeiro-freelancer.mjs
- A: scripts/test-financeiro-gastos-existentes.mjs
- A: scripts/test-financeiro-integrado.mjs
- A: scripts/test-financeiro-loader.mjs
- A: scripts/test-financeiro-perf.mjs
- A: scripts/test-financeiro-prefetch.mjs
- A: scripts/test-financeiro-resumo-categorias.mjs
- A: scripts/test-funcoes.mjs
- A: scripts/test-manychat.mjs
- A: scripts/test-rafts-draft-categoria.mjs
- A: scripts/test-sectors.mjs
- A: scripts/test-social-access-admin.mjs
- A: scripts/test-social-access-store.mjs
- A: scripts/test-social-account-access.mjs
- A: scripts/test-social-ai-central.mjs
- A: scripts/test-social-ai-host.mjs
- A: scripts/test-social-ai.mjs
- A: scripts/test-social-bootstrap.mjs
- A: scripts/test-social-integrado.mjs
- A: scripts/test-social-repository.mjs
- A: scripts/test-social.mjs
- A: scripts/test-stock-item-delete.mjs
- A: scripts/test-stock.mjs
- A: scripts/test-theme-cobertura.mjs
- A: scripts/test-theme-comportamento.mjs
- A: scripts/test-theme-inventario.mjs
- A: scripts/test-theme-superficies.mjs
- A: scripts/test-theme.mjs
- A: server/social/accountAccessStore.mjs
- A: server/social/accountAdmin.mjs
- A: server/social/accountAdminStore.mjs
- A: server/social/adminHandler.mjs
- A: server/social/ai.mjs
- A: server/social/aiAuth.mjs
- A: server/social/aiBackend.mjs
- A: server/social/aiCloud.mjs
- A: server/social/aiHandler.mjs
- A: server/social/aiHost.mjs
- A: server/social/aiOllama.mjs
- A: server/social/audit.mjs
- A: server/social/manychat.mjs
- A: server/social/manychatIngress.mjs
- A: server/social/outbox.mjs
- A: server/social/providerBase.mjs
- A: server/social/providers.mjs
- A: server/social/repository.mjs
- A: server/social/service.mjs
- A: server/social/socialApi.mjs
- A: server/social/webhook.mjs
- M: src/App.jsx
- M: src/components/Layout.jsx
- M: src/components/direcao/DirectionMetric.jsx
- M: src/components/escala/DuplicarEscala.jsx
- M: src/components/escala/EscalaPadrao.jsx
- A: src/components/financeiro/CategoryDigest.jsx
- M: src/components/financeiro/DailyExpenseForm.jsx
- M: src/components/financeiro/DailyExpenseHistory.jsx
- M: src/components/financeiro/DailyExpensesPanel.jsx
- M: src/components/financeiro/ExpenseCategoryManager.jsx
- A: src/components/financeiro/FinancialOverviewCards.jsx
- A: src/components/financeiro/FinancialStat.jsx
- M: src/components/ponto/RegistroRapido.jsx
- M: src/components/producao/ProductionOrderDialog.jsx
- M: src/components/relatorios/FinancialSummary.jsx
- M: src/components/rh/AttachmentPreview.jsx
- A: src/components/rh/EmployeeDeleteDialog.jsx
- M: src/components/rh/EmployeeForm.jsx
- M: src/components/rh/SectorForm.jsx
- A: src/components/shared/DraftNotice.jsx
- A: src/components/social/CommentPanel.jsx
- A: src/components/social/ManyChatCard.jsx
- A: src/components/social/SocialAccessAdmin.jsx
- A: src/components/social/SocialChart.jsx
- A: src/components/social/SocialMessages.jsx
- A: src/components/social/SocialWorkspace.jsx
- M: src/index.css
- A: src/lib/attachmentViewer.js
- M: src/lib/dailyExpenses.js
- M: src/lib/directionMetrics.js
- A: src/lib/draftConfig.js
- A: src/lib/draftStore.js
- A: src/lib/employeeDelete.js
- M: src/lib/expenseCategories.js
- A: src/lib/financeiroLoad.js
- A: src/lib/financeiroPrefetch.js
- A: src/lib/financialDashboard.js
- M: src/lib/navigation.js
- A: src/lib/paymentRecipients.js
- M: src/lib/pontoData.js
- A: src/lib/rhDashboardMetrics.js
- M: src/lib/rhUtils.js
- A: src/lib/roleUtils.js
- A: src/lib/sectorUtils.js
- A: src/lib/social/accountAccess.js
- A: src/lib/social/aiCategories.js
- A: src/lib/social/aiClient.js
- A: src/lib/social/client.js
- A: src/lib/social/domain.js
- A: src/lib/social/integrations.js
- A: src/lib/stockItemUtils.js
- M: src/lib/stockService.js
- M: src/lib/supabaseClient.js
- A: src/lib/theme/ThemeProvider.jsx
- A: src/lib/usePersistentDraft.js
- A: src/lib/usePrefetchFinanceiro.js
- M: src/main.jsx
- M: src/pages/Advertencias.jsx
- M: src/pages/Compras.jsx
- M: src/pages/Configuracoes.jsx
- M: src/pages/Consumo.jsx
- M: src/pages/Direcao.jsx
- M: src/pages/Escalas.jsx
- M: src/pages/Estoque.jsx
- M: src/pages/FichaColaborador.jsx
- M: src/pages/Financeiro.jsx
- M: src/pages/Funcionarios.jsx
- M: src/pages/Funcoes.jsx
- M: src/pages/Home.jsx
- M: src/pages/OcorrenciasFrequencia.jsx
- M: src/pages/Ponto.jsx
- M: src/pages/RH.jsx
- M: src/pages/ReceitasFinanceiras.jsx
- A: src/pages/RedesSociais.jsx
- M: src/pages/RelatorioFinanceiro.jsx
- M: src/pages/Relatorios.jsx
- M: src/pages/Setores.jsx
- M: src/pages/Vales.jsx
- A: supabase/migrations/20260929010000_estoque_client_token_unico.sql
- A: supabase/migrations/20260929010100_estoque_rpc_transacional.sql

## Hist?rico exclusivo de branches divergentes

Commits exclusivos podem ser equivalentes a mudan?as integradas por outro caminho; analisar diffs e testes antes de selecionar qualquer patch.

### agente-1

- 48fd752 Corrige estoque, movimentacoes e gastos diarios

### agente-2

- fdcad74 chore(stock): check passa a proibir saldo em InventoryItem.update
- d4b870a Merge remote-tracking branch 'origin/main' into agente-2
- c8f3a43 chore(delivery): normalize migration timestamps
- 8c77569 Merge remote-tracking branch 'origin/main' into agente-2
- 0181dc2 Merge remote-tracking branch 'origin/main' into agente-2
- e2b9652 merge: sync agente-2 with main 8608ea2
- dc202f1 feat(delivery): evolve operational attendance center
- a61195d feat: adiciona persistencia segura ao atendimento delivery
- a748737 feat: cria base da Central de Delivery e contratos de atendimento IA
- 43b7227 fix: alinha delivery distribuido aos contratos oficiais iFood
- b34dde0 Merge origin/main em agente-2 preservando delivery e producao local
- 765c2ed feat: prepara integracoes seguras de delivery

### agente-3

- f3be62b docs(agente-3): contrato de integracao estoque-producao (encerramento documental)

### agente-5-retomada-local

- a55ff31 recuperacao: registra bloqueio HTTP 402 (egress quota) no teste de anexos; 59 objetos identificados mas nao validados
- 196452a recuperacao: 7.7 registra resultados Q0-Q6, classificacao da causa e criterio de staging do orfao
- e896210 recuperacao: 7.7 registra autorizacao limitada do diagnostico + conferencia read-only pre-execucao
- 7956df4 recuperacao: diagnostico read-only do orfao EmployeePayment->FinancialExpense (nao executado) + registro 7.7
- 1979197 correcoes no script de verificacao de download dos anexos (revisao)
- bc6841d recuperacao: etapa 3 integridade relacional ampliada (4a/4b/4c) + espelho staging + registro 7.5
- 429380b recuperacao: procedimento de verificacao de download dos anexos (nao executado) + registro Etapa 2 storage
- 708beb5 recuperacao: etapa 2 ajustada — A3/A4 separados, size defensivo em C4/C5, prefixos por classe/md5
- 3a664a3 recuperacao: etapa 4 exporta records sem AuthUser + AuthUser redigido (checksums insensiveis a ordem)
- d587530 recuperacao: etapas 2-3 (social/auth/anexos) + staging local com validacao (nao executado)
- 7f7fd88 inventario: script etapa 1 (somente leitura) para SQL Editor do Supabase
- b083d32 docs: plano de recuperacao Supabase para PostgreSQL local (somente investigacao)
- bf2eac5 Integra a main atual (inclui a correcao temporal da suite de gastos)
- 3c72e3e Corrige o filtro de categoria de Gastos e do Historico

### agente-financeiro-freelancer-categorias

- 58ea38c Financeiro: freelancer no seletor e corrige tela branca ao criar categoria

### agente-financeiro-gastos-estabilidade

- 510304d fix(financeiro): impede lista de gastos piscar em cada refresh

### agente-financeiro-resumo-categorias

- 399b3d1 Financeiro: resumo por categoria no Histórico de Gastos
- 58ea38c Financeiro: freelancer no seletor e corrige tela branca ao criar categoria

### backup-agente-2-dc202f1

- dc202f1 feat(delivery): evolve operational attendance center
- a61195d feat: adiciona persistencia segura ao atendimento delivery
- a748737 feat: cria base da Central de Delivery e contratos de atendimento IA
- 43b7227 fix: alinha delivery distribuido aos contratos oficiais iFood
- b34dde0 Merge origin/main em agente-2 preservando delivery e producao local
- 765c2ed feat: prepara integracoes seguras de delivery

### codex-fix-dashboards-indicadores

- b7408be fix: sincroniza indicadores com cargas incrementais e fontes reais

### codex-fix-filtro-categoria-gastos

- fda4097 Corrige o filtro de categoria de Gastos e do Historico

### codex-storage-r2

- 78f0f74 feat(armazenamento): ativa o R2 por feature flag no EmployeePayment
- f0fc148 feat(armazenamento): prepara a migracao de anexos do Supabase Storage para o Cloudflare R2

### codex-storage-r2-base64-flows

- 78f0f74 feat(armazenamento): ativa o R2 por feature flag no EmployeePayment
- f0fc148 feat(armazenamento): prepara a migracao de anexos do Supabase Storage para o Cloudflare R2

### integracao-filtro-categoria-gastos

- bf2eac5 Integra a main atual (inclui a correcao temporal da suite de gastos)
- 3c72e3e Corrige o filtro de categoria de Gastos e do Historico
