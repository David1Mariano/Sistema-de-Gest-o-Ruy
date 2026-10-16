# Retomada Windows offline-first — 16/10/2026

Este ciclo consolida evidências e corrige o indicador. Não conclui o aplicativo
completo nem libera o laboratório para operação diária.

## Base confirmada

- Checkout: `C:\Users\Pichau\gestao-ruy-windows-oficial-20261015`.
- Branch: `preparacao/windows-oficial-20261015`; HEAD: `8da0eb0`.
- Arquivos de auditoria, SQL proposto e `scripts/security/` já estavam não
  rastreados; foram preservados. Nenhum commit, push, merge ou deploy.
- Produção: `/__health` confirmou serviço `gestao-ruy-production` e release
  `20261015T155237724Z-d597121d` antes e depois dos ensaios.
- Laboratório validado pelo marcador `RUY_D1_SYNTHETIC_ONLY`, vinculado à máquina,
  PostgreSQL `127.0.0.1:55436`, banco `ruy_d1_disposable`, API `18087`.
  Contagem inicial: 270 registros sintéticos D1 e 856 entradas pendentes na
  outbox legada. Essa contagem não representa o estado de ACK da ponte C2.

## Matriz real

“Offline completo e testado” abaixo se restringe ao contrato explicitamente
descrito, com dados sintéticos. Não equivale ao módulo empresarial inteiro.

| Funcionalidade | Estado | Evidência e limite |
|---|---|---|
| Cadastros locais e auxiliares | Parcialmente offline | Teste de catálogo aprovado: permissões, versões, dados pessoais, rollback e fila; ficha completa e todos os caminhos visuais não homologados neste ciclo |
| Pagamento documental em lote | Offline completo e testado no contrato D1 | 7 cenários: agregado pagamento/despesa, replay, rollback, limite 50, entidade, reinício e backup; não executa pagamento bancário |
| Vales, consumo de colaboradores e demais RH | Bloqueado por dependência | Ainda dependem de agregados e integração próprios; não liberar por chamadas parciais |
| Produtos/estoque | Parcialmente offline | Cadastro e baixas/devoluções de produção transacionais revalidados; saldo global entre máquinas não homologado |
| Ficha, diário e consumo de produção | Offline completo e testado no contrato D1 | Receita versionada, perdas, prévia, baixa única e cancelamento atômico; 17 cenários de domínio incluem esses fluxos |
| Financeiro | Parcialmente offline | Gastos, pagamentos, receitas, títulos e conferência locais testados; estornos, fechamento global, conciliação e relatórios completos pendentes |
| Vendas e delivery | Parcialmente offline | Documento financeiro de cartão/delivery com recebível testado; atendimento, canais externos e operação de vendas não integrados ao laboratório |
| Configurações e relatórios | Parcialmente offline | Rotas oficiais locais existentes; todas as fontes, exportação e impressão não revalidadas |
| Arquivos e anexos privados | Bloqueado por dependência | Backup de arquivos sintéticos existe; upload nas telas e sincronização de anexos não implementados |
| Ponte D1↔C2 | Offline completo e testado no protocolo sintético | 15 cenários em dois bancos simulados e central local; preserva IDs, recibos, conflitos e fila, sem reaplicar baixas |
| Supabase operacional | Bloqueado por segurança | Sincronização real permanece desativada; nenhuma migration, grant, Auth ou Storage alterados |
| Integrações externas de atendimento/pagamento | Somente online | Não foram portadas nem habilitadas para execução offline |
| Electron/instalador | Parcialmente offline | Pacote existente 0.3.0; não foi reconstruído ou instalado neste ciclo; depende do laboratório previamente preparado |
| Autenticação e autorização | Parcialmente offline | Contas/papéis sintéticos locais; autorização empresarial assinada, expiração e revogação pendentes |
| Backup | Parcialmente offline | Dump consistente, criptografia e restore isolado revalidados; destino externo e recuperação independente da chave pendentes |

## Correção entregue

O status da API deixava `pendingFiles: 0` fixo apesar de não existir protocolo de
anexos. Agora informa `pendingFiles: null` e `attachmentsState: not-implemented`.
O painel informa explicitamente que as pendências de anexos são desconhecidas.
O check de operações se refere exclusivamente aos recibos de operações; não
certifica anexos, backup ou liquidação financeira. O destino continua identificado
como central de testes local.

A confirmação verde também exige contadores inteiros não negativos, data válida
e cursor inteiro não negativo, além das verificações anteriores de recibos e pull.
Pendências de negócio, conflitos e falhas continuam impedindo confirmação.

Arquivos alterados neste ciclo:

- `server/d1-lab/sync.mjs`: contrato honesto do estado de anexos.
- `lab/d1/sync-state.mjs`: validação da confirmação e texto de anexos.
- `lab/d1/SyncStatus.jsx`: estado dos anexos no painel oficial do build D1.
- `scripts/d1-lab/test-sync-status.mjs`: nova regressão, incluindo leitura PostgreSQL.
- `scripts/d1-lab/test-windows-cycle.mjs`: fixture com contadores completos.
- Este relatório.

## Validação executada

- Status/anexos: 3 testes aprovados.
- Ciclo Windows/backup: 5 testes aprovados, incluindo dump/restore real isolado.
- Catálogo: 1 teste integrado aprovado.
- Domínio: 17 cenários aprovados, incluindo reinício real de PostgreSQL/API e restore.
- Pagamentos em lote: 7 cenários aprovados.
- Ponte D1↔C2: 15 cenários aprovados, incluindo ACK perdido, crash, conflito,
  lease vencido, reinício e snapshots sem duplicação de efeito financeiro/estoque.
- Lint dos arquivos alterados e `git diff --check`: aprovados.
- Build oficial e build D1: aprovados; somente artefatos locais, sem publicação.
- Lint geral: bloqueado por erro preexistente de parsing em
  `scripts/security/test-emergency-fix.mjs:41` (arquivo não rastreado preservado).
- Typecheck: exit 2, 485 diagnósticos; log local ignorado pelo Git em
  `logs/retomada-20261016-typecheck.log`.

Os ensaios de escrita usaram somente bancos sintéticos marcados e guardas de rede.
Não houve teste visual novo, instalação, reboot de Windows ou duas máquinas físicas.
As evidências históricas de instaladores não são reapresentadas como validação
do código alterado neste ciclo. O pacote disponível continua **0.3.0**, embora o
HEAD contenha o avanço de backend de lote identificado como 0.4.0 no commit.

## Continuidade necessária

1. Completar vales/consumo de colaboradores com agregados transacionais,
   idempotência, permissão e testes de rollback antes de integrar as telas.
2. Homologar todos os caminhos de RH e pagamentos em lote na interface original.
3. Implementar anexos locais privados com manifesto, fila durável, limites,
   autorização e recuperação; depois transporte na central sintética.
4. Completar estornos, conciliação e resolução assistida de conflitos entre máquinas.
5. Configurar destino externo de backup e custódia da chave, validar restauração
   em outro Windows. O agendamento atual só funciona enquanto Electron está aberto.
6. Corrigir gates gerais, provisionar PostgreSQL no instalador experimental,
   validar atualização interrompida, Windows limpo e paridade visual por módulo.
7. Somente após aprovação de RLS/grants/Auth/Storage, projetar a conexão operacional
   ao Supabase. Não considerar recibo C2 como autorização de acesso à nuvem real.

A produção 8080 foi preservada. Nenhum dado real foi copiado ou alterado e nenhum
serviço definitivo foi instalado. Dados reais ainda não têm proteção de backup
operacional validada por este laboratório.
