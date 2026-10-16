# Windows / D1 / C2 — resultado da integração de laboratório

Data: 16/10/2026. **Sistema não liberado para operação.** Somente dados fictícios; sincronização operacional permanece desativada. Produção 8080, Supabase operacional, main e bancos existentes preservados. Sem deploy, merge, push ou migration operacional.

## Matriz de aceitação

| Fluxo | Resultado | Evidência / limite |
| --- | --- | --- |
| Formulário Windows de colaborador | APROVADO | Executável empacotado: topo 50 px, base 768 px, viewport 788 px; rolagem automática. |
| Cadastro de colaborador pela UI Windows | APROVADO | Nome e admissão fictícios, INSERT confirmado no PostgreSQL. |
| Edição pela UI Windows | APROVADO | Nome alterado, versão incrementada. |
| Consulta após recarregar a UI | APROVADO | Registro editado reapareceu após reload. |
| Exclusão autorizada D1 pela UI | APROVADO | Palavra EXCLUIR, rechecagem no servidor, tombstone v3 e três eventos de auditoria. |
| Permissão efetiva no servidor | APROVADO | Viewer apresentado como admin no objeto de chamada foi negado pelo papel persistido; confirmação ausente e versão obsoleta recusadas. |
| Vínculos e rollback | APROVADO | Vínculo local bloqueia exclusão; falha injetada não deixa tombstone, fila ou auditoria parcial. |
| Idempotência e duplicidades | APROVADO | UUID repetido retorna replay; conteúdo/versionamento adulterado é recusado; resposta perdida após commit não duplica. |
| Exclusão offline concorrente com vínculo remoto | APROVADO | Central recusa exclusão conflitante, mantém cadastro e vínculo; proposta local permanece em conflito, sem apagar dados. Resolução é revisão explícita, sem sobrescrita automática. |
| Windows → D1 → API integrada → C2 → PostgreSQL → peer | APROVADO | Dados produzidos pelo executável real, central v3, tombstone no peer e três operações reconhecidas; gateway em 18092. |
| Carregamento da integração na porta 18080 | PENDENTE | Listener antigo PID 22292 continuou presente na última sondagem; não foi encerrado à força. Código pronto, mas execução nessa porta não comprovada. |
| Sessões/consistência após reiniciar API | APROVADO | B/C2 e gateway reiniciados de forma controlada; dados e recibos preservados. |
| Reinício PostgreSQL após esta última integração | PENDENTE | Não reiniciado cluster compartilhado nesta rodada. Reinício D1 foi aprovado na rodada anterior; não equivale a revalidar o contrato novo após restart do servidor. |
| Backup/restore D1 pós-integração | APROVADO | Restore novo preservou tombstone Windows, v3, três auditorias/recibos, fila e 12 tabelas de recuperação. |
| Backup/restore central C2 | APROVADO | Dump com snapshot consistente, AES-256-GCM, chave DPAPI, tombstone e recibos conferidos em banco novo. |
| Dois Windows físicos | PENDENTE | Usuário confirmou que a segunda máquina não está disponível. Nenhum outro computador acessado. |
| Desconexão/reconexão física | PENDENTE | Rede da empresa intacta; perdas e retomadas são injetadas em processos de teste. |
| Lint, builds e regressões | APROVADO | Detalhes abaixo. |
| Liberação operacional / sincronização real | PENDENTE | Exige resolver pendências e aceite completo; nenhuma ativação realizada. |

## Alterações concretas

Código Windows: `C:/Users/Pichau/gestao-ruy-windows-oficial-20261015`.

- `lab/d1/dialog.jsx`: limite de altura por estilo explícito (`calc(100dvh - 32px)`), overflow vertical e overscroll contido. Corrige o formulário sem depender da geração de utilitários CSS do pacote antigo; produção não alterada.
- `server/d1-lab/employee-delete.mjs`: admin ativo consultado no banco, escopo por proprietário, confirmação, CAS, UUID/hash e lock por ator; vínculo em documentos/histórico/eventos bloqueia exclusão. Conteúdo original preservado em JSON, `_deleted=true` e timestamp gerados no servidor. Tombstone, outbox e auditoria na mesma transação.
- Listas ocultam tombstones; edição/recriação do mesmo ID é recusada. Validações de RH/pagamentos recusam novos vínculos com colaborador excluído.
- `sync-contract.mjs`, `sync.mjs` e `d1-central.mjs`: propagação explícita do tombstone, rechecagem das referências no estado central resultante, conflito de dependência remota, prevenção de ressurreição e shadow de mudanças incompatíveis. Sem apagar WAL, tabelas, registros ou outbox.
- Adaptadores e diálogo exclusivos D1 usam precheck do servidor e EXCLUIR; erro mantém o diálogo aberto. Retry mantém intenção/UUID e suporta fingerprints de create/update anteriores à atualização.
- Portas auxiliares 18091 (Windows/D1) e 18092 (gateway de teste) e perfil Electron separado são usados somente com opt-in sintético. Nenhuma troca silenciosa de porta em uso normal.

Código da API local: `C:/Users/Pichau/gestao-ruy-test-isolado`.

- `server/local/d1-relay.mjs` e integração no `api.mjs/start.mjs`: rotas `/api/local/d1/push` e `/api/local/d1/changes`, desativadas por padrão. Transporte servidor-servidor com Bearer por dispositivo, sem cookies/Origin, destino fixo de loopback, limite de corpo, timeout e erros sem credenciais. Central continua autorizando actor/device/workspace e validando o envelope completo.
- `server/sync-lab/integration-central.mjs` no checkout Windows expõe o contrato C2 atualizado em 18090, exclusivamente sobre `ruy_c2_central`/55435. Reutiliza o PostgreSQL sintético existente; não inicializa schema. Mantém a API antiga 18086 intacta.
- Fluxo testado: Windows em 18091 grava D1/55436; envio explícito passa pelo gateway (18092), contrato central em 18090 e PostgreSQL central/55435; outro banco de dispositivo recebe a mudança. Não são espelhos automáticos entre `local_records` e `d1_central_records`: preserva-se o namespace/protocolo D1LAB/1, com rota dedicada.

## Evidências verificáveis

No checkout Windows, em `logs/`:

- `agente5-employee-ui-20261016.json`: primeiro ensaio real do executável; colaborador `56a82ab9-eab5-447e-bec0-0095333cfebe` criado/editado/excluído, três auditorias. Capturas de temas associadas preservadas.
- `agente5-employee-ui-final-20261016.json`: repetição aprovada no pacote reconstruído; colaborador `9e7d0724-22fc-47b3-a3e5-90f3dd0e6958`, tombstone v3, formulário dentro da janela.
- `agente5-windows-chain-20261016.json`: fila do primeiro executável reconhecida pela central; v3, três ACKs, workspace e peer preservados. Envio explicitamente executado depois de fechar a janela prova durabilidade da fila; não foi envio operacional automático.
- `agente5-integration-18092.json`: 11 verificações de integração, incluindo referências tardias e conflito de exclusão/vínculo remoto. Peer final: `ruy_d1_peer_b9b3db7d6327eba2`. O ensaio Windows anterior usou `ruy_d1_peer_b7321672fd5b091f`.
- `agente5-integrated-backup-20261016.json`: restore D1 `ruy_d1_restore_32e2c4e46ed2e4a5`, 1832 operações, 13 anexos, 12 tabelas de recuperação, tombstone/ACKs/auditoria conferidos. Retenção 365 com quantidade pré-verificada preservou os backups existentes.
- `agente5-central-backup-20261016.json`: restore central `ruy_c2_restore_5a3e107088e29a25`. Arquivo AES-GCM e chave DPAPI ficam no diretório privado C2. SHA-256 do arquivo criptografado: `0ce7e1d23a981985527c9bc29f401fd4afa952b256d8a2f475f565df86f00e89`. Nenhuma API foi iniciada apontando ao restore.

Artefato experimental: `artifacts/agente5-integration-20261016/win-unpacked/Ruy-Agente5-Lab.exe`. É pacote experimental local; não foi instalado por cima de G/H nem publicado. Teste real de UI não equivale a instalação NSIS, Windows limpo ou duas máquinas físicas.

Validações aprovadas: lint em ambas as cópias; build padrão em ambas; build D1; empacotamento Electron; B/C2 com banco `ruy_local_test_run_1792177952697`; dois testes de health; testes de cliente/aliases (3, incluindo retomada de intenção anterior à atualização); regressões de exclusão de funcionário/estoque/comprovantes (61 testes, zero falhas; estoque 121/121). Avisos de Browserslist/chunks permanecem; não impediram os builds. Nenhuma mudança de dependência solicitada por esses avisos.

## Pendência exata de 18080 e retomada

Apesar da mensagem inicial de encerramento, a sondagem voltou a encontrar 127.0.0.1:18080/PID 22292 e 18087/PID 12536. A orientação posterior foi continuar somente os testes isolados; esses processos foram preservados. Não há aprovação de troca efetiva do listener antigo.

Quando o responsável confirmar a liberação de 18080, sondar novamente; não matar o PID. Com a porta livre, o teste `scripts/d1-lab/test-agente5-integration.mjs` pode ser executado com `RUY_D1_ALLOW_TESTS=1` e `RUY_INTEGRATION_API_PORT=18080`. O teste abre e fecha seu próprio gateway, usando apenas bancos sintéticos. Depois, a API persistente de laboratório pode ser iniciada na cópia C2 com RUY_LOCAL_CONFIG protegido, RUY_LOCAL_PORT=18080, RUY_D1_BRIDGE_TEST=1 e RUY_D1_CENTRAL_TEST_PORT=18090, através de `scripts/local-api-supervisor.mjs`. Na API D1 de laboratório, o opt-in e RUY_D1_BRIDGE_TEST_ORIGIN=http://127.0.0.1:18080 selecionam esse transporte. Não habilitar essa configuração para dados operacionais.

Nenhum segredo deve ir em CLI/relatório. Provisionamento de actor/workspace/dispositivo continua explícito, limitado a fixtures. Serviço permanente, HTTPS e sincronização empresarial não foram ativados.

## Uso assistido e bloqueios

**Candidatos a uso assistido somente em laboratório com dados fictícios:** cadastro, edição, consulta e exclusão por tombstone de colaboradores; precheck de vínculos; revisão da fila/conflitos; ensaio de backup/restore. Setores/funções e configurações mantêm a situação anterior de homologação assistida, sem ampliar o escopo nesta rodada.

**Continuam bloqueados para operação:** sincronização real, uso com colaboradores reais, troca da versão 8080, duas máquinas, transporte empresarial, resolução de conflitos por decisão de negócio, recuperação em outro Windows/custódia externa da chave e habilitação dos módulos financeiro/estoque/produção/RH ampliado/anexos. Não se libera o sistema por aprovação de um fluxo isolado.
