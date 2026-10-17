# RC2 — correções dos bloqueios da RC1 (17/10/2026)

Base b09b9d8; branch agente-5-consolidacao-windows-d1-c2-20261016. Candidata **0.5.1-rc.2 / A5-RC2-20261017**, exclusivamente para homologação assistida com dados sintéticos. **Não liberada para operação.** Este documento substitui os resultados de saldo global, confirmação financeira e interface de anexos da RC1.

## Matriz

| Fluxo | Resultado | Evidência e alcance |
| --- | --- | --- |
| Estoque central e projeção D1/C2 | APROVADO em laboratório | Movimentos, saldo, custo e versão aplicados transacionalmente na central e projetados em ambos os clientes SQL, através de mTLS/API 18092. Consumo e estorno convergiram para 10000. |
| Produção multiefeito | APROVADO em laboratório | Entradas/saídas do mesmo OperationalEvent são atômicas; comando inválido reverte saldo, cursor e recibo. Documento diário e seus eventos separados não constituem uma única transação distribuída; não se declara esse aceite operacional. |
| Concorrência de estoque | APROVADO com clientes simulados | Duas propostas usam a mesma versão: primeira confirma, segunda conflita sem consumir saldo outra vez. Proposta rejeitada fica preservada; ACK perdido retoma o mesmo UUID. |
| Financeiro distribuído | APROVADO no escopo experimental | Débito/crédito em cash/bank com lançamentos balanceados, fundos suficientes e vínculo entre pagamento/título e despesa. Replay, folha do mesmo funcionário/período, mesmo título e mesma nota do fornecedor com UUID diferente não debitam duas vezes. Não executa pagamentos bancários externos. |
| Financeiro: contas próprias e reversões | PENDENTE | financial_account_id sem mapeamento e alteração/cancelamento de liquidação são recusados; faltam contrato explícito de contas e estorno. Deduplicação sem chave comum de obrigação não identifica semanticamente toda despesa manual semelhante. |
| Integridade e recuperação de sincronização | APROVADO em laboratório | Projeção adulterada não avança cursor nem aplica saldo; retry íntegro recupera. Snapshot legado sem efeitos confirmados não vira confirmação de negócio. Conflito nunca é descartado automaticamente. |
| Anexos: interface Windows | APROVADO em Pichau | Seleção de registro salvo/arquivo, fila, envio, consulta remota, cache, visualização segura de texto e download autenticado. Corrigidos cancelamento geral de downloads pelo Electron e corrida de seleção de registros. |
| Anexos: segurança e falhas | APROVADO em laboratório | Hash, sessão/CSRF, admin, workspace, certificado/token, limite 512 KiB. Viewer, token revogado, corrupção e colisão recusados; falha/ACK perdido não duplicam objeto/auditoria. |
| Persistência após reinício PostgreSQL | APROVADO na cópia descartável 55437 | Quatro bancos novos, digest idêntico antes/depois do restart normal; três filas e três caches. Fonte 55436 não reiniciada. Cópia parada normalmente e preservada. |
| Backup e restauração | APROVADO em destinos sintéticos novos | Dump cifrado, envelope de chave e pg_restore preservaram fila, bytes, recibos, saldos, movimentos, contas e projeções. Não equivale ao assistente de restauração independente em outro Windows. |
| Compatibilidade e supervisão | APROVADO em laboratório | 11 casos de integração anterior e cinco de porta ocupada, lock, restart, EOF e shutdown. API antiga preservada. |
| Lint/build/regressões | APROVADO | Lint; build padrão e D1; 70 testes automatizados (inclui estoque 121/121 em sua suíte); 19 cenários integrados. Contagens de suítes não são casos independentes somáveis. |
| Instalador RC2 | APROVADO para homologação | NSIS gerado; 13 dependências, fontes críticas e ausência de arquivos privados conferidas no ASAR. Sem assinatura. Manifesto contém hash; resultado do executável empacotado está no JSON de evidências. |
| Dois Windows, instalação limpa/reinstalação/reboot | PENDENTE | Segunda máquina não identificada/autorizada; não foi acessada outra máquina. |
| Desconexão/reconexão física e LAN | PENDENTE | Falha de conexão injetada no serviço TLS pertencente ao teste; rede da empresa intacta. Loopback continua padrão. |
| Substituição da API 18080 | PENDENTE | PID 22292 preservado; canal de parada normal ainda não comprovado. Nenhum kill nem ocupação da porta. |

## Mudanças e limites de implantação

O ACK da central agora distingue recebimento de metadados e efeitos de negócio confirmados. A central recompõe os efeitos a partir do comando, não aceita result_json como autoridade, e grava ledger, recibo e metadados na mesma transação. Locks/versionamento impedem gasto concorrente do mesmo saldo. Nos clientes, snapshot validado aplica saldos/movimentos/contas somente com fila limpa e sem sombras de conflito; caso contrário guarda o estado central e preserva a proposta local. A quota copiada do saldo é uma capacidade **provisória offline**, não uma reserva exclusiva: a confirmação central pode rejeitar propostas concorrentes.

businessConfirmed é confirmação experimental, não autorização operacional. operationalSyncEnabled permanece false. Central nova usa business=true somente no laboratório; instâncias antigas não são convertidas e recibos legados não são promovidos silenciosamente. A recuperação de conflito ainda exige revisão supervisionada; falta fluxo operacional de reconciliação. O histórico de unidade de estoque é preservado e troca de unidade após movimentos é recusada.

Anexos exigem registro previamente salvo e admin; UI dedicada no menu Anexos. Não há arquivo solto sem vínculo, exclusão de anexo nem auditoria completa de cada leitura. Transferência/cache revalidam integridade e autorização. Download do Electron é limitado à rota autenticada local específica; navegação e downloads externos continuam bloqueados. Flags RUY_D1_ATTACHMENTS_LAB e RUY_D1_MTLS_LAB dependem de opt-in de testes; instalação não ativa schemas, central, credenciais ou LAN.

Schemas foram aplicados em bancos novos ruy_d1_rc_* e ruy_c2_rc_*, mais tabelas experimentais na cópia descartável ruy_d1_disposable/55437 após conferir marcador e PGDATA. Fonte 55436 não foi migrada para os novos schemas de negócio/anexos. Nenhum banco operacional, Supabase ou dado pessoal foi consultado. Fixtures usam provisionamento owner de laboratório; falta homologar serviço final com privilégio mínimo. Produção 8080 não foi alterada, iniciada ou interrompida.

## Bloqueios para liberação definitiva — ordem e gravidade

1. **Crítico:** obter segundo Windows autorizado, topologia e janela; validar aplicativo nos dois computadores, concorrência, certificados próprios, rotação/revogação/expiração e reconexão real. Não abrir portas internas nem PostgreSQL à internet.
2. **Crítico:** concluir reconciliação supervisionada de propostas rejeitadas, contas financeiras próprias/estornos e aceites de agregados de produção; homologar permissões e papel final do serviço. Não habilitar financeiro real com base nestes testes sintéticos.
3. **Alto:** instalação limpa, reboot, reinstalação e restauração independente com provisionamento/chaves próprias no Windows B. Validar identidade, relacionamentos, anexos e ausência de duplicidades após recuperação.
4. **Alto:** identificar canal normal da API antiga e efetuar substituição supervisionada somente depois da parada confirmada. Não usar encerramento forçado.
5. **Crítico:** aceite operacional explícito após os critérios; decidir assinatura/distribuição. RC2 permanece restrita à homologação.

Para uso assistido em laboratório: cadastro/consulta/edição/exclusão autorizada de colaboradores; estoque/produção/financeiro no escopo acima e anexos sintéticos com operador. Nenhuma funcionalidade foi liberada para dados reais ou sincronização operacional.

## Repetição e evidências

Executar sequencialmente, nunca compartilhando as portas entre suítes:

- `node scripts/d1-lab/test-agente5-rc2-transfer.mjs` com RUY_D1_ALLOW_TESTS=1 e RUY_D1_TEST_API_PORT=18091: cria bancos novos, testa 19 cenários e encerra apenas servidores próprios.
- `node scripts/d1-lab/test-agente5-rc2-postgres.mjs` com o opt-in e RUY_D1_RESTART_FIXTURE=e5aaec701010f607: recusa porta 55437 ocupada, confere PGDATA, repete integração/backup e compara digest após restart; para somente a cópia.
- `node scripts/d1-lab/test-agente5-rc2-windows.mjs` no mesmo fixture: interface Electron real em Pichau. RUY_A5_RC2_EXECUTABLE aponta ao executável RC2 desempacotado para validar o pacote; sem essa variável usa fontes.
- `node scripts/d1-lab/test-agente5-rc2-artifact.mjs`: compara fontes/dependências e recusa arquivos privados no ASAR; calcula SHA-256 do NSIS.

Logs, certificados, chaves, dumps e capturas privadas não entram no Git. [Manifesto e resultados](evidencias/agente5-rc2-20261017.json), [instalação RC2](agente-5-rc2-instalacao.md), [roteiro dos dois Windows](agente-5-roteiro-dois-windows.md). Nenhum merge, deploy ou ativação operacional realizado.
