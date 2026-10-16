# Homologação Windows / D1 / C2 — 16/10/2026

Status: integração preparada, liberação operacional BLOQUEADA. Nenhum deploy, merge, push, migration operacional, conexão Supabase ou habilitação de sincronização operacional.

## Ambientes e compatibilidade

Código C2/18080: C:/Users/Pichau/gestao-ruy-test-isolado. Windows/D1: C:/Users/Pichau/gestao-ruy-windows-oficial-20261015. Alterações preexistentes nesses diretórios foram preservadas; não houve cópia em massa nem merge entre repositórios.

| Aspecto | C2 local / 18080 | D1 Windows / ponte |
| --- | --- | --- |
| Destino | PG 55432, ruy_local_test_* | D1 PG 55436, ruy_d1_disposable; central C2 de sincronização PG 55435 / API 18086 |
| HTTP | /api/local, cookie ruy_local_session | /api/d1 em 18087; central usa /d1 e token por dispositivo/workspace |
| Armazenamento | local_records/local_pending/local_audit | d1_records/lab_outbox/lab_audit e sidecars d1_sync_* |
| Versões | baseVersion e versão do registro; update substitui conteúdo validado | _version local e versão remota separadas; payload parcial mesclado; envelope D1LAB/1 |
| Escopo | autorização por papel/entidade | owner_id por usuário local; binding actor/device/workspace explícito |
| Funcionários | CRUD e tombstone com confirmação/dependências | catalogSave permite somente create/update; exclusão não contratada |
| Referências | JobRole usa sector | D1 usa sector_id/sector_name; sincronização trata agregados/cascatas |

Conclusão: a ponte D1LAB/1 funciona com o servidor sync-lab C2; NÃO é ligação direta à API local 18080. Não apontar a outbox D1 para essa API. Antes da integração comum, definir explicitamente a autoridade de dados, mapear identidade/escopo, versões, patch versus substituição, referências e tombstones; preservar UUID e hash da intenção original. Não converter recibo de transporte em confirmação de pagamento/saldo global. Não mapear usuários por e-mail automaticamente.

## Evidências novas reais

- Cluster D1 marcado RUY_D1_SYNTHETIC_ONLY foi iniciado, sem init/recriação. Recuperação automática progrediu por mais de 120 s e concluiu às 15:44:46 -03. Não foi interrompida pelo timeout do script. Central de teste também concluiu recuperação.
- Executável já instalado artifacts/windows-installation-lab/Sistema de Gestão Ruy.exe rodou --lab-smoke com API empacotada própria: packaged=true, authenticated=true, nodeExposed=false, abertura das páginas originais de colaboradores/configurações, estoque criado pela tela e verificado no banco (2000 milésimos). Evidência: Windows/logs/agente5-installed-20261016.json e capturas associadas.
- Inspeção adicional via Computer Use: login com conta admin recém-criada e inteiramente sintética; página de colaboradores abriu sem registros desse usuário. Formulário apresentou conteúdo acima/abaixo da janela na instalação antiga, impedindo concluir com confiança o cadastro pela UI. Foi preenchido rascunho fictício, sem declarar gravação. A tentativa de inspecionar instalação G 0.5.0 encontrou mudanças de foco/minimização e aviso de interação do usuário; nenhum aceite visual de G foi inferido. Senha temporária da fixture não foi impressa; arquivo temporário removido. Conta/rascunho sintéticos preservados.
- D1 test-catalog: saída 0, teste aprovado de contratos, permissões, projeção de campos pessoais, versões, rollback e resposta perdida.
- Ponte D1/C2: 17 verificações aprovadas com PostgreSQL/HTTP reais, dois bancos de dispositivos, central em loopback, IDs/vínculos preservados, outbox não duplicada, ACK perdido, recibo adulterado, conflito com shadow, token/identidade inválidos, worker encerrando por falha injetada após recibo (exit 77), lease e retomada. Eventos de negócio permanecem provisórios. Banco peer preservado: ruy_d1_peer_fddcf585fe2e0f13. Evidência: Windows/logs/d1-c2-bridge-evidence.json.
- Harness scripts/d1-lab/test-agente5-bridge.mjs derivado do teste existente: omite stop/start da API e compara SHA-256 do active.json de produção. Motivo: teste original exigia produção 8080 disponível, que recusou conexão; produção não foi iniciada. Nenhum encerramento forçado da API. Rótulo original de saída mencionava API; neste ensaio somente PostgreSQL foi reiniciado. A versão do harness foi corrigida para explicitar isso.
- Reinício controlado SOMENTE do cluster D1 descartável em 55436: pg_ctl fast stop / start. Log: desligado às 15:46:09, pronto às 15:46:12. Filas, registros, recibos e conflitos dos dois bancos conferidos após reinício. Cluster dev-core/55432 e serviço Windows operacional não reiniciados.
- Backup real criptografado e restore em banco novo ruy_d1_restore_edc8165d56efd812: 1814 operações da fila, 13 anexos e 12 tabelas de recuperação verificadas; bytes do anexo sintético novo idênticos. Corrupção e chave errada recusadas. syncEnabled=false no restore. Retenção 365 com verificação prévia de quantidade evitou remover backups existentes. Sem destino externo configurado neste ensaio. Evidência: Windows/logs/agente5-backup-20261016.json. Não comprova recuperação em outro computador nem custódia externa da chave.
- C2 B/C2 reexecutado após alterações: saída 0; banco ruy_local_test_run_1792176238775 preservado. Funcionário criado/editado/consultado/inativado/reativado, exclusão autorizada com tombstone e bloqueio de dependências, viewer negado no servidor, campos adulterados, conflito 409, replay, rollback e auditoria. Sessão/dados persistiram após reinício da API sintética. Esses testes não são cliques na instalação Windows.

## Rede: o que foi simulado

Transporte disponível: APIs reais de loopback e PostgreSQL reais. Internet indisponível/402, perda de resposta e reconexão: injeção/interceptação no processo de teste; Windows não teve adaptador, firewall ou conexão global desligados. Dois dispositivos são bancos/clientes distintos no mesmo Windows, não duas máquinas físicas. O aplicativo instalado autenticou e gravou localmente com a conexão do Windows inalterada. Não se declara ciclo completo de funcionário na instalação durante queda física de Internet.

## Healthcheck e supervisão preparados

Na cópia C2 isolada:

- server/local/api.mjs: GET /api/local/health, SELECT 1, 200 {status:ok} ou 503 {status:unavailable}, sem banco/versão/usuários/erros/credenciais, Cache-Control no-store. Mantém guardas de origem e método.
- server/local/start.mjs: portas de laboratório restritas a 18080/18089, loopback; shutdown controlado por pipe do pai, além dos sinais existentes.
- scripts/local-api-supervisor.mjs: configuração restrita a ruy_local_test_* em 55432, lock exclusivo por porta, recusa listener existente, logs JSONL sem credenciais, backoff de reinício limitado a cinco tentativas, comandos de stdin restart/shutdown. Nunca inicia/para PostgreSQL, nunca instala serviço Windows. Lock residual após interrupção abrupta exige inspeção, sem remoção automática. Não há ainda política de retenção dos logs nem watchdog de travamento de processo.
- scripts/test-local-health.mjs: 2 aprovados (200/503 simulados, segredo não vazado).
- scripts/test-local-supervisor.mjs: partida real, SELECT 1 via health, reinício controlado e encerramento da API em 18089 aprovados. Log confirma PIDs distintos 12504 e 13088, saídas 0. Falha abrupta e esgotamento do backoff não foram injetados nesta rodada.

Uso futuro no laboratório, sem executar sobre listener ocupado: definir RUY_LOCAL_CONFIG com caminho protegido; executar node scripts/local-api-supervisor.mjs. Padrão 18080; RUY_LOCAL_PORT=18089 para ensaio. Enviar restart ou shutdown por stdin. A API 18080 preexistente não foi encerrada nem substituída; portanto o novo healthcheck ainda depende de reinício controlado desse processo para aparecer nessa porta. O endpoint foi comprovado na API nova em 18089 e em testes HTTP isolados. Não foi instalado autostart permanente.

## Verificações e liberação

Lint e build passaram nas duas cópias; C2, health, supervisor, catálogo D1 e ponte aprovados. Build com avisos de Browserslist antigo e chunks grandes. Nenhuma publicação. Testes e implementações novos permanecem locais, sem commit/merge/push.

Podem avançar para homologação assistida em laboratório: cadastro/consulta de colaboradores, setores/funções e configurações. Estoque teve smoke real de cadastro, mas isso não libera movimentações completas. RH ampliado, financeiro, produção, compras e anexos não estão certificados por esta rodada.

Bloqueios antes da liberação: corrigir/verificar formulário na versão instalada alvo e concluir criar/editar/consultar funcionário pela UI; definir exclusão D1 com dependências, tombstone, auditoria e propagação antes de habilitá-la; implementar/validar ponte de contrato se 18080 for a API definitiva; ciclo de desconexão/reconexão no aplicativo real; duas máquinas físicas; revisão de autorização offline e revogação; custódia/restore externo e RPO/RTO; supervisão definitiva, HTTPS/rede e aceite por módulo. Sincronização operacional segue desativada.
