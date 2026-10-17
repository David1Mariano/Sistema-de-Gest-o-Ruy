# Preparação para homologação — 17/10/2026

Base: commit 5ca4434, branch agente-5-consolidacao-windows-d1-c2-20261016. Esta rodada não executa deploy, merge, push, mudanças de rede ou troca da API 18080.

## Bloqueios e ordem recomendada

| Ordem | Gravidade | Bloqueio | Critério para resolver |
| --- | --- | --- | --- |
| 1 | Alta | API antiga 18080 ainda no PID 22292 | Identificar canal original de controle e obter confirmação de encerramento normal; depois comprovar porta livre. Não matar processo ou fechar VS Code indiscriminadamente. |
| 2 | Alta | Supervisão precisa de aceite completo de ciclo de vida | Validar início, restart, shutdown, perda do terminal/canal de controle, indisponibilidade do banco, limite de tentativas e recuperação de lock sem processos órfãos. O código atual trata comandos stdin e sinais, mas não define encerramento no EOF de stdin. |
| 3 | Crítica para ensaio físico | Transporte somente loopback e segunda máquina ausente | Identificar máquina B e responsável; aprovar topologia isolada, autenticação por dispositivo, origem/TLS e janela de teste. Não abrir firewall/listen nem alterar rede agora. |
| 4 | Crítica para módulos | Cobertura D1/C2 de colaboradores não homologa comandos financeiros, estoque, produção ou anexos | Executar a matriz por módulo abaixo em Windows real, banco sintético e API integrada; conferir efeitos e invariantes nos dois clientes. |
| 5 | Alta | Pacote/recuperação em outra máquina ainda não comprovados | Instalação experimental limpa, provisionamento independente, backup transferido e restore com custódia autorizada da chave, sem copiar DPAPI/identidade de Pichau. |
| 6 | Crítica para liberação | Aceite operacional completo ausente | Reunir evidências dos itens anteriores e autorização explícita; manter sincronização operacional desativada até lá. |

## Evidências atuais e limites

Repetição desta rodada: 11/11 verificações em 18092 aprovadas, PostgreSQL D1 55436 e central 55435, dados fictícios, novo peer ruy_d1_peer_46667083e84bcc01. Gateway abriu/fechou no teste e não ficou como serviço. Health, autorização, rollback, tombstone, replay, resposta perdida, conflito de vínculo e persistência após reinício da API passaram. Clientes e falhas de rede foram programáticos, não dois computadores físicos. Relatório local: logs/agente5-integration-18092.json.

Regressões desta rodada: 66 testes aprovados, zero falhas, em test-g-financial-guard, test-production, test-payment-proof, test-payable-attachment, test-attachment-normalizer e test-attachment-preview. test-production testa o servidor/publicação em diretórios temporários e portas efêmeras; não é teste da fabricação de produtos nem deploy real. Estes resultados não equivalem a módulos homologados no Windows/API/PostgreSQL. Saída local: logs/agente5-modulos-20261017.txt.

Listener 18080 continua em 127.0.0.1/PID 22292, node server/local/start.mjs; pai PowerShell 21840, executor Codex 23252 dentro do VS Code. A aba/handle de controle original não foi localizada com segurança. Não existe endpoint administrativo de encerramento comprovado para essa versão antiga.

Aprovações históricas de 16/10: UI no executável experimental real em Pichau; integração dos registros dessa UI; restart PostgreSQL somente na cópia descartável 55437 com sentinela persistida; restaurações D1/C2 com auditoria, recibos e anexo/hash. Esses testes não foram repetidos visualmente nem em outra máquina nesta rodada. Ver relatório de consolidação e JSON de evidências, que preservam os identificadores.

## Compatibilidade dos módulos

A compatibilidade confirmada é de contrato/isolamento e do fluxo de colaboradores. sync-contract.mjs aceita os campos de cadastros e snapshots versionados dos domínios, mas isso não prova a execução dos efeitos de negócio remotamente. O relay /api/local/d1 é servidor-servidor, opt-in, Bearer e loopback; não converte automaticamente d1_central_records em local_records ou no repositório financeiro. Em start.mjs, createLocalServer não recebe finance nem attachmentStore. A presença dos arquivos desses módulos em lab/c2-runtime satisfaz imports, não os habilita.

| Módulo | Evidência existente | Validação real ainda necessária para liberação |
| --- | --- | --- |
| RH/colaboradores | UI real em uma máquina; D1/C2/PostgreSQL e conflitos aprovados | Dois Windows com identidades distintas; sessão/revogação, reconexão física, fila após reiniciar app e consultas sem campos privados conforme papel. |
| Estoque | Cadastro InventoryItem no contrato; regressões locais históricas | Entrada/saída/ajuste/reserva e unidade/precisão; saldo concorrente e impedimento de duplicidade; atomicidade do movimento/evento/outbox; ausência de saldo negativo conforme regra; recebimento em B e reconciliação depois de restart/restore. |
| Produção | Snapshots de receita, ordem e produção diária no contrato | Confirmar/cancelar lote com receita congelada, consumo/estorno de insumos, perdas/rendimento, vínculos e auditoria; replay sem nova baixa e conflito de consumo nos dois dispositivos; recuperação sem estoque divergente. |
| Financeiro | Snapshots no contrato e implementação de comandos separada; guarda de lote legado | Definir autoridade entre snapshot e comando transacional antes de integrar; pagar/cancelar/estornar, centavos, vínculo folha/vale/consumo/contas, dupla submissão e concorrência; permissões no servidor, fechamento/reabertura, conciliação e restore preservando auditoria. Não executar pagamento real. |
| Anexos | Anexo sintético conferido em backup/restore; utilitários de comprovante | Store e rotas explicitamente configurados em laboratório; upload/download autorizado por registro/usuário, limites e tipo/hash, arquivo ausente/corrompido, retry sem duplicidade, vínculo após sync e restauração em outra máquina com chave disponível. URL em snapshot não comprova transferência do arquivo. |

## Procedimento supervisionado preparado

1. Responsável abre um PowerShell dedicado e visível no checkout consolidado, registra branch/commit, porta, PID do supervisor/filho, caminho da configuração protegida (sem conteúdo) e operador. Manter terminal aberto; não iniciar com executor oculto ou job desacompanhado.
2. Antes de qualquer início, conferir listener e destino sintético. A 18080 deve permanecer intacta até confirmação de encerramento normal pelo canal original. Sem canal seguro identificado, manter pendência e continuar testes em 18092.
3. Após confirmação e porta livre, usar node scripts/d1-lab/start-approved-18080.mjs --normal-stop-confirmed. O script recusa ausência da confirmação e porta ocupada. A configuração deve apontar a banco ruy_local_test_* de laboratório, nunca ao banco operacional. Não exibir seu conteúdo. Este comando está preparado, não executado nesta rodada.
4. Conferir health GET /api/local/health (apenas status), autenticação sintética e persistência. Registrar started/exit/restart_limit no api-supervisor.jsonl privado. Não registrar tokens, senhas ou payloads pessoais.
5. Para reinício, digitar restart no terminal dedicado; aguardar saída normal do filho e health da nova instância. Para finalizar, digitar shutdown, aguardar supervisor terminar e confirmar porta livre. Não usar Stop-Process, taskkill, encerramento do VS Code ou reboot.
6. Se shutdown não concluir, preservar processos/logs e investigar conexões abertas; não escalar para encerramento forçado. Se lock existir, verificar PID/listener/operador antes de qualquer intervenção; não apagar lock automaticamente para tentar iniciar outra instância.
7. Antes de adotar supervisão persistente, corrigir e testar explicitamente a perda de stdin/terminal e logs de falha do filho: hoje stdout/stderr do filho são ignorados e o supervisor registra somente saída/código/sinal. Manter esse aceite pendente em vez de afirmar que processos órfãos já estão prevenidos.

## Dois Windows

Aplicar o [roteiro preparado](agente-5-roteiro-dois-windows.md), condicionado à máquina B, topologia e janela autorizadas. Nenhuma desconexão, acesso a outra máquina, alteração de firewall ou cópia de credenciais foi executada. Cada instalação deve ter identidade e provisionamento próprios. Registrar hashes do pacote, versão/IDs/operações, conflitos preservados e resultado de restore por fluxo.

Somente laboratório assistido com dados sintéticos pode avançar. Nenhum dos quatro módulos acima está liberado operacionalmente por esta revisão.

Estado Git verificado: HEAD e branch remota no mesmo 5ca443417033a3ef2970493d1586f53aef4fd868. Este novo roteiro permanece local, sem commit/push nesta rodada; a implementação consolidada anterior está sincronizada.
