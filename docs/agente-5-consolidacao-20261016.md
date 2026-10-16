# Consolidação Agente 5 — 16/10/2026

Este relatório atualiza os estados dos relatórios anteriores. Sistema ainda sem liberação operacional.

| Fluxo | Resultado | Evidência e limite |
| --- | --- | --- |
| Cadastro, edição, consulta e exclusão Windows | APROVADO | Executável experimental real na rodada anterior; não repetido visualmente nesta consolidação. |
| D1 → API → C2 → PostgreSQL | APROVADO | 11 verificações em 18092, repetidas antes e depois do reinício. Clientes programáticos nesta rodada. |
| Permissões, conflitos, idempotência, rollback e auditoria | APROVADO | Contratos contra PostgreSQL real; falhas de transporte simuladas. |
| Reinício PostgreSQL isolado e persistência | APROVADO | Cópia física exclusiva em 55437, PID 22856 → 16532; registro sintético idêntico. Fonte 55436/PID 21380 preservada. |
| Backup/restore depois do reinício | APROVADO | Restore novo: 12 tabelas, 1850 operações pendentes, sentinela e anexo/hash conferidos; sincronização desativada. Backups existentes preservados. |
| Backup/restore central C2 | APROVADO | AES-GCM/DPAPI, tombstone e recibos restaurados; corrupção recusada; API não apontada ao restore. |
| API nova em 18080 | PENDENTE | Listener antigo PID 22292 permanece; nenhuma interrupção realizada. |
| Dois Windows físicos e reconexão de rede | PENDENTE | Segunda máquina não confirmada. Nenhuma rede desconectada. |
| Lint, builds e regressões | APROVADO | Build padrão e D1; 5 testes health/cliente/aliases; 61 testes de regressão, estoque 121 verificações. Avisos de Browserslist/chunks sem erro. |
| Liberação operacional | PENDENTE | Troca supervisionada da API, ensaio físico autorizado e aceite completo necessários. |

## API 18080 e substituição

Árvore verificada: node.exe 22292 → PowerShell 21840 → codex.exe 23252 → VS Code. MainWindowHandle=0, sessão 1: o terminal de origem é um executor oculto do Codex; não foi possível identificar uma aba interativa específica. Comando: node server/local/start.mjs.

Aguardar confirmação do responsável de encerramento normal e sondar novamente. `scripts/d1-lab/start-approved-18080.mjs` exige `--normal-stop-confirmed` e recusa porta ocupada. O teste sem confirmação recusou execução. O supervisor oferece stdin `restart`/`shutdown`, com relay de laboratório explícito e configuração protegida fora do Git. Não matar processos nem iniciar nessa porta antes da confirmação. O supervisor existente não foi reiniciado nesta rodada.

## Reinício isolado e repetição

Foi feita cópia via pg_basebackup exclusivamente do laboratório marcado, sem recriar o cluster original. A recuperação automática avançou até aceitar conexões. O executor inicial ficou aguardando um canal herdado; foi realizado shutdown fast normal somente da cópia. O executor terminou com ECONNREFUSED e a retomada com stdio ignorado concluiu start/restart/persistência. Sem pg_resetwal, initdb, remoção de WAL, encerramento forçado ou reinício do computador.

Fixture preservada: `e5aaec701010f607`, diretório privado `LOCALAPPDATA/GestaoRuy/agente5-restart-e5aaec701010f607`, porta 55437. Para repetir, definir `RUY_D1_ALLOW_TESTS=1` e `RUY_D1_RESTART_FIXTURE=e5aaec701010f607`. Com o cluster parado normalmente, executar `scripts/d1-lab/test-agente5-resume-restart.mjs`; depois integração, postrestart-backup e central-backup do mesmo diretório. O teste de criação original recusa porta ocupada e nunca recria uma cópia existente.

## Consolidação e limites

Checkout: `C:/Users/Pichau/gestao-ruy-agente5-consolidado`. Branch exclusiva `agente-5-consolidacao-windows-d1-c2-20261016`, baseada na preparação Windows. A API necessária está em `lab/c2-runtime`, com imports relativos, sem dependência de outro checkout. Dependências financeiras/anexos desse runtime não significam homologação nem habilitação desses módulos. A guarda visual distingue persistência local de sincronização operacional.

[Evidência resumida](evidencias/agente5-consolidacao-20261016.json) e [roteiro de dois Windows](agente-5-roteiro-dois-windows.md). Logs brutos, bancos, backups, credenciais e executáveis permanecem fora do Git. Os relatórios anteriores são históricos, com seus caminhos originais.

Uso assistido somente no laboratório com dados fictícios: colaboradores e ensaios de sincronização/backup. Dados reais, financeiro, estoque, produção, anexos operacionais e sincronização real continuam bloqueados até homologação específica. Produção 8080, Supabase e main preservados; sem deploy ou migrations operacionais.

Ap�s os testes, a c�pia 55437 foi parada normalmente com pg_ctl -m fast, com checkpoint conclu�do. Seus arquivos e bancos foram preservados; a fonte 55436 e a API 18080 permaneceram nos mesmos PIDs.
