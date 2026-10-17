# Resolução dos bloqueios — 17/10/2026

Branch exclusiva: agente-5-consolidacao-windows-d1-c2-20261016. Este relatório substitui os estados de supervisão e de UI do relatório de pré-homologação. **Não há liberação operacional.**

## Resultado por fluxo

| Fluxo | Estado | O que foi efetivamente comprovado |
| --- | --- | --- |
| Supervisão da API nova | APROVADO no laboratório | 5 cenários reais em 18092: porta TCP ocupada recusada, duplicidade/lock, restart normal, EOF do pai, shutdown e novo início. Health real com PostgreSQL sintético. |
| Recuperação de falhas e locks | APROVADO no laboratório | 3 cenários: banco sintético inexistente seguido de correção recupera; falha persistente atinge limite; lock preexistente preservado. Nenhum processo encerrado à força. |
| API antiga 18080 | PENDENTE | Continua PID 22292, pai PowerShell 21840, executor Codex 23252 no VS Code. Sem canal normal localizado para a versão em memória. Nenhuma intervenção nesse processo. |
| Transporte criptografado | APROVADO localmente / PENDENTE entre máquinas | 6 verificações HTTPS real TLS 1.3/mTLS com upstream HTTP sintético; certificado/token vinculados, certificados ausentes/não confiáveis recusados, rotas internas bloqueadas, indisponibilidade saneada. Não é teste TLS completo da fila D1 contra C2 nem teste LAN. |
| D1 → gateway → C2 → PostgreSQL | APROVADO no laboratório | 11 verificações repetidas em 18092 com clientes programáticos e PostgreSQL real. Sem habilitar sincronização operacional. |
| Estoque e transações | APROVADO localmente | 6 cenários HTTP/SQL: movimento atômico, replay, concorrência com um sucesso/um conflito, consumo/produção, rollback, partidas em centavos e autorização no servidor. |
| Domínios de produção e financeiro | APROVADO localmente | 15 cenários HTTP/SQL: receita, histórico/CAS, ordem/diário, baixa/estorno, gasto/pagamento vinculado, títulos, caixa, cartão/delivery, recorrência e permissões. Não há pagamento bancário real. |
| Executável Windows empacotado | APROVADO em Pichau | UI React real: login, colaborador criado/editado/recarregado/excluído com 3 auditorias, item com saldo 2000, produção com baixa para 1000, gasto 12,34, receita, recebível/cartão e relatório financeiro. Execução automatizada do pacote desempacotado, não instalação NSIS. |
| Encerramento do Electron | APROVADO no smoke | Processo principal envia shutdown ao utilityProcess, que fecha HTTP/pool e sai normalmente. Duas execuções encerraram com código 0; 18091 livre ao final. Nenhum kill utilizado nesses ensaios. |
| Persistência após fechar/reabrir | APROVADO no laboratório | 3 verificações SQL depois de ambas as execuções: saldo do primeiro ator preservado, saldo do segundo persistido, tombstone v3 preservado. Não equivale a reboot/reinstalação. |
| Instalador NSIS | GERADO para homologação | AppId, perfil/atalhos exclusivos; não assinado. 13 dependências PostgreSQL e ausência de arquivos privados verificadas no ASAR. Instalação não executada. |
| Anexos D1 entre dispositivos | PENDENTE / BLOQUEANTE | syncStatus ainda declara attachmentsState=not-implemented. Testes de utilitários e backup não provam upload/download, autorização e transferência integrada. |
| Dois Windows, rede física e reinstalação | PENDENTE / BLOQUEANTE | Máquina B ausente; rede da empresa preservada; sem copiar identidade/DPAPI ou executar desconexões. |

## Correções realizadas

- Supervisor verifica a ocupação por bind TCP em vez de inferir pelo sucesso de HTTP; grava PID/porta no lock exclusivo; não remove locks antigos automaticamente. Trata EOF/erro de stdin, comandos por linha e reinício planejado sem consumir o limite de falhas. Registra início, saída/código/sinal, shutdown e limite de tentativas, sem payloads/credenciais.
- API filha também encerra no EOF do pai. O serviço Electron recebe shutdown por IPC e aguarda fechamento de HTTP/pool; a saída normal do app aguarda o serviço e o backup em curso.
- O primeiro empacotamento revelou dependências pg ausentes apesar do exit 0 do builder. A configuração A5 passou a incluir explicitamente a árvore completa de dependências de produção. O pacote corrigido foi reconstruído e executado com sucesso. Avisos do coletor de dependências permanecem, mas os 13 pacotes foram verificados e o runtime SQL real passou.
- Testes por módulo abrem somente a API própria 18091, criam atores fictícios novos e não executam migrations, restart ou exclusão de bancos. Não são os testes antigos que reiniciam o laboratório compartilhado.

## Inicialização e encerramento supervisionados

No PowerShell dedicado, com configuração protegida e banco ruy_local_test_* em 55432, definir RUY_D1_ALLOW_TESTS=1, RUY_LOCAL_PORT=18092 e RUY_LOCAL_CONFIG com o caminho privado. Executar `node lab/c2-runtime/scripts/local-api-supervisor.mjs`. Opcionalmente, somente para a ponte sintética já preparada, definir RUY_D1_BRIDGE_TEST=1 e RUY_D1_CENTRAL_TEST_PORT=18090. Não iniciar se 18092 estiver em teste/ocupada.

Digitar `restart` ou `shutdown` e aguardar término/health, além de conferir PID/listener. EOF do canal encerra normalmente a filha. A perda abrupta do Windows/encerramento externo do processo principal não é equivalente a EOF e ainda exige ensaio; lock remanescente exige revisão humana de PID/porta antes de remoção. Se a filha não responder, preservar logs/processos: não escalar para kill ou remoção automática de lock. Os logs preservam metadados de saída, não stderr bruto com possível informação sensível.

Para 18080, aguardar o canal/responsável original e confirmação de encerramento normal. Só então conferir porta livre e executar `node scripts/d1-lab/start-approved-18080.mjs --normal-stop-confirmed`. Não usar esse script para encerrar a versão antiga nem presumir confirmação a partir da passagem do tempo.

## Transporte entre máquinas preparado, não ativado

`server/sync-lab/mtls-transport.mjs` fornece gateway HTTPS e cliente com validação de CA/hostname, TLS mínimo 1.3 e certificado de cliente obrigatório. A allowlist vincula fingerprint SHA-256 a token de dispositivo. Somente push e changes D1 são encaminhados ao gateway interno fixo 127.0.0.1:18092, com limite de corpo/timeout. PostgreSQL e demais rotas não são expostos. HTTP local permanece apenas entre serviços de loopback; o enlace entre máquinas usa HTTPS.

`start-mtls.mjs` exige RUY_D1_ALLOW_TESTS=1 e RUY_MTLS_CONFIG privado. Configuração: host (padrão 127.0.0.1), keyFile, certFile, caFile e devices [{fingerprint,token}]. Tokens/certificados privados nunca entram no repositório, pacote ou linha de comando. O listener TLS usa 18443. Só admite IP privado explícito com --authorized-private-lab; não executar esse opt-in até autorização da topologia/janela. Nunca usar 0.0.0.0, port forwarding, PostgreSQL remoto ou rejectUnauthorized=false.

Cada Windows precisa de identidade, token e certificado próprios; emitir com SAN/validade/EKU adequados por canal aprovado. Retirar bindings/certificados revogados e reiniciar controladamente; validar expiração/revogação/rotação e falha de hostname antes de homologar. O teste atual usa certificados efêmeros de um dia em diretório privado temporário e upstream de teste. O adaptador sendLabTLS pode ser usado na função request injetável de synchronizeD1; provisionamento automático e ligação desse transporte ao fluxo normal do aplicativo ainda precisam de implementação/homologação. Nenhuma sincronização automática foi ativada.

## Instalador e instalação limpa

Artefato local: artifacts/agente5-homolog-20261017/Sistema-Ruy-A5-Homolog-20261017-Setup.exe. Revisão A5-HOMOLOG-20261017, AppId br.ruy.gestao.agente5.homologacao, perfil SistemaGestaoRuy-Agente5-Homolog. SHA-256 consta na evidência JSON. Não distribuir como versão operacional. Esse pacote contém D1 e suas telas; não instala central C2, gateway TLS, certificados ou PostgreSQL de produção. O primeiro provisionamento exige binários/cluster de laboratório autorizados e configuração individual; não reutilizar a pasta privada de Pichau na máquina B.

Na máquina B autorizada, registrar Windows/arquitetura/hash, instalar por usuário em diretório exclusivo, provisionar conta fictícia e identidade nova. Testar CRUD, fechar/reabrir, reboot controlado da máquina de laboratório, desinstalar/reinstalar sem apagar dados, conferir persistência e restaurar backup sintético em destino novo usando envelope/chave de recuperação autorizados. Validar passphrase incorreta/corrupção e ausência de chave, relações/anexos/outbox/recibos/auditoria. Não copiar DPAPI de outro usuário e não ligar sync do restore automaticamente. Estes testes permanecem pendentes. [Roteiro dos dois Windows](agente-5-roteiro-dois-windows.md).

## Verificações e evidências

Lint e builds padrão/D1 aprovados. Regressões: 64 testes, incluindo envelope criptográfico de recuperação, supervisão desktop, exclusão, estoque e comprovantes (estoque 121/121). Health/cliente/aliases: 5 aprovados. Os 66 testes complementares do relatório anterior continuam históricos, não devem ser somados como testes distintos desta rodada.

Scripts novos test-agente5-supervision/failures/mtls/operations/domain/packaged-persistence estão em scripts/d1-lab. Exigem opt-in; operations/domain exigem RUY_D1_TEST_API_PORT=18091. Executar suites que usam 18092 sequencialmente. Logs e capturas ficam localmente em logs/; [evidência resumida versionável](evidencias/agente5-resolucao-20261017.json) não contém segredos.

## Ordem para liberação definitiva

1. **Alta:** localizar canal normal da API antiga, fazer troca supervisionada e comprovar versão nova em 18080.
2. **Crítica:** provisionar transporte mTLS por dispositivo no aplicativo, testar o caminho D1/C2 completo por TLS e depois em dois Windows autorizados. Manter loopback até lá.
3. **Crítica:** demonstrar que movimentos/efeitos de estoque, produção e financeiro mantêm as invariantes centrais entre dispositivos; snapshots/recibos não bastam como confirmação global de negócio.
4. **Crítica:** implementar/homologar transferência e autorização de anexos D1; hoje não implementadas no sincronismo.
5. **Alta:** instalação limpa, reinstalação, reboot e restore com custódia/provisionamento independentes em B; fechamento abrupto do pai e recuperação de locks com revisão humana.
6. **Crítica:** aceite operacional explícito após matriz completa.

Pronto para uso assistido **somente no laboratório sintético**: colaboradores, telas locais de estoque/produção/financeiro testadas, supervisão e ensaios de recuperação. Nenhum módulo é declarado liberado para dados reais ou sincronização operacional. Sem deploy, merge, alteração de produção 8080/Supabase ou migrations operacionais.
