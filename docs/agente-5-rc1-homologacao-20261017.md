# RC1 — homologação de 17/10/2026

Base: 4bb4289, branch exclusiva agente-5-consolidacao-windows-d1-c2-20261016. Candidata **0.5.1-rc.1 / A5-RC1-20261017**, restrita à homologação. **Não é versão operacional aprovada.** Este relatório substitui os estados de transferência de anexos e provisionamento do relatório anterior.

## Matriz de homologação

| Fluxo | Resultado | Evidência / limite |
| --- | --- | --- |
| API antiga 18080 | PENDENTE | Continua PID 22292. Nenhum encerramento ou substituição; canal normal ainda não identificado. |
| Supervisão da API nova | APROVADO no laboratório | Repetidos 5 cenários: ocupação TCP, lock exclusivo, restart, EOF e shutdown. Recuperação de falha/lock antigo foi aprovada na rodada anterior. |
| D1 → mTLS → API 18092 → C2 → PostgreSQL → peer | APROVADO com clientes simulados | Provisionamento DPAPI por ator/dispositivo/workspace, certificados distintos e TLS 1.3; fila real atravessou o transporte e foi aplicada ao peer em bancos novos. Nenhuma LAN foi ativada. |
| Anexos: envio, recibo, download e cache offline | APROVADO no laboratório | Upload imutável, vínculo a registro/versionamento, hash SHA-256, limite 512 KiB, MIME/assinatura/nome, fila persistida e cache verificado. API local com sessão/CSRF; certificado/token no transporte; autorização admin e workspace na central. |
| Anexos: falha e duplicidade | APROVADO no laboratório | Offline mantém UUID pendente; perda de ACK após commit gera replay, um objeto e uma auditoria de upload. Colisão de identidade, corrupção de origem/cache, viewer, token revogado e workspace diferente recusados. |
| Anexos: recuperação | APROVADO em bancos sintéticos | Dumps cifrados/restaurados em bancos novos preservaram fila/cache/bytes/recibo. Envelope portátil com chave recuperada, frase errada e corrupção recusadas. Não equivale a restore em outro Windows. |
| Anexos: interface de seleção/transferência | PENDENTE | Rotas e funções de laboratório implementadas/testadas; ainda falta ligar e homologar a experiência completa de anexar/sincronizar arquivos nas telas Windows. Não há ativação automática. |
| Produção e estoque: transações locais e snapshots | APROVADO no laboratório | Baixa/estorno/replay e snapshots passaram por TLS; diário cancelado chegou ao peer. |
| Estoque/produção: saldo global entre dispositivos | REPROVADO para liberação | A conserva saldo 10000 após consumo/estorno; B recebe snapshots, mas não recebe saldo operacional (zero linhas). O contrato não aplica o evento ao ledger global/peer. pendingBusiness permanece positivo e businessConfirmed=false. |
| Financeiro: agregados/versionamento | APROVADO no laboratório | Gasto/pagamento vinculado, rollback antes do commit, replay e edição concorrente: central mantém 14,01, proposta perdedora 13,37 permanece em B como conflito, sem sobrescrita. |
| Financeiro: confirmação operacional distribuída | PENDENTE / BLOQUEANTE | Recibo de snapshot não é confirmação de pagamento/ledger global; transações externas não foram executadas. Não habilitar como financeiro operacional. |
| Persistência após restart PostgreSQL | APROVADO exclusivamente na cópia 55437 | PID 23840 → 6368; digest idêntico em quatro bancos, incluindo três filas e três caches. Fonte 55436 não reiniciada. A cópia foi parada normalmente ao final e preservada. |
| Executável RC1 em Pichau | Ver evidência de smoke | Pacote desempacotado submetido a UI/login/colaborador/estoque/produção/financeiro; não equivale a instalação limpa nem dois Windows. Resultado final está no JSON de evidências. |
| Instalador RC1 | GERADO, não assinado | NSIS por usuário, AppId/perfil de homologação exclusivos. Fontes críticas e 13 dependências PostgreSQL conferidas no ASAR; nenhum arquivo privado empacotado. |
| Instalação limpa, reboot e reinstalação em B | PENDENTE | Segunda máquina ainda não identificada/autorizada. Não houve acesso a outro computador. |
| Desconexão/reconexão física | PENDENTE | Falhas injetadas em processos; rede da empresa intacta. |
| Lint, build e regressões | APROVADO | Builds padrão/D1; 69 regressões, estoque 121/121; integração anterior 11/11; transporte anterior 6/6; nova suíte integrada 12/12. Contagens de suítes não devem ser somadas como casos independentes. |

## Implementação e limites

Anexos usam tabelas novas de laboratório: fila/cache locais, objetos/recibos/auditoria centrais. Bytes ficam em bytea, na mesma transação do objeto/recibo; não há janelas de rename de arquivo contra commit SQL. São imutáveis; rejeição/conflito preservam a proposta local. Leitura verifica novamente papel ativo, registro e workspace, além do hash. Exclusão/tombstone do registro impede acesso; não apaga o objeto. Viewer não pode fazer transferências nesta política experimental. A auditoria implementada registra upload, sem payload pessoal; não se declara auditoria completa de cada download.

O backup padrão passou a reconhecer fila/cache no estado de recuperação quando as tabelas existem. A nova suíte usa pg_dump de bancos novos com cifragem/envelope e pg_restore em destinos novos, verificando os dados; não é teste do assistente de recuperação Windows em outra máquina. Não há migration automática de tabelas novas na inicialização. Rotas locais exigem RUY_D1_ATTACHMENTS_LAB=1 e RUY_D1_ALLOW_TESTS=1; o padrão continua desativado. Instalar o cliente não instala schema, servidor central, certificados ou transporte LAN.

provision-tls.mjs lê configuração privada, valida certificado/chave/validade, vínculo do usuário admin ativo, deviceId real do banco e workspace; grava sync-tls-UUID.dpapi com criação exclusiva. synchronizeD1 usa esse provisionamento apenas com RUY_D1_MTLS_LAB=1 e opt-in sintético. Não sobrescreve credenciais existentes; rotação requer procedimento supervisionado. O bloqueio de rede do Electron só permite TLS loopback 18443 em opt-in. A allowlist LAN ainda não foi aberta: cadastro de um IP privado não autoriza tráfego do Windows por si só.

Os schemas foram executados apenas em bancos novos ruy_d1_rc_* e ruy_c2_rc_* dos clusters marcados como sintéticos. Nenhuma migration ocorreu em banco operacional ou em banco existente. As suítes usam papéis de laboratório/owner para provisionar fixtures, o que não homologa o papel final de serviço com privilégio mínimo. Bancos e arquivos privados de teste foram preservados.

O primeiro empacotamento RC falhou com EBUSY ao gravar os fuses do executável. Foi confirmado que o arquivo estava livre e o build foi repetido sem encerrar processos; somente o pacote concluído e verificado é a candidata. Avisos de Browserslist/chunks/coletor de dependências permanecem; o ASAR foi conferido contra as fontes e dependências efetivamente necessárias.

## Bloqueios para liberação definitiva, em ordem

1. **Crítico:** implementar a autoridade transacional central de movimentos/quotas/ledger e aplicar os efeitos de negócio em peers. O teste de saldo global reprovou este requisito; não basta trocar o indicador de status ou tratar ACK como confirmação.
2. **Crítico:** homologar política de permissões, reconciliação e comandos financeiros globais com o papel final de serviço. Não habilitar pagamentos reais.
3. **Alto:** concluir a interface de anexos, sua integração aos documentos e o fluxo de provisionamento/rotação no produto; o protocolo/rotas atuais são experimentais.
4. **Crítico:** identificar B, autorizar topologia e janela; testar transporte completo pelo aplicativo, certificados próprios/expiração/revogação/rotação, queda/reconexão física e concorrência nos dois Windows. Manter loopback até lá.
5. **Alto:** instalação limpa, reboot, reinstalação e restauração independente em B, com identidade/chaves próprias, além do aceite do papel de serviço e do pacote não assinado conforme a política de distribuição.
6. **Alto:** localizar canal de encerramento normal da API antiga, confirmar parada e comprovar a troca supervisionada da 18080.
7. **Crítico:** aceite operacional explícito após todos os critérios. Nenhuma liberação realizada.

## Repetição e evidências

No checkout consolidado, definir RUY_D1_ALLOW_TESTS=1 e RUY_D1_TEST_API_PORT=18091. Executar scripts/d1-lab/test-agente5-rc-transfer.mjs: cria bancos sintéticos novos, usa temporariamente 18091/18092/18094 e TLS loopback, encerra seus serviços normalmente e preserva os bancos. Não rodar em paralelo com outras suítes nessas portas.

Para reinício PostgreSQL, usar exclusivamente o fixture descartável preservado com RUY_D1_RESTART_FIXTURE=e5aaec701010f607 e test-agente5-rc-postgres.mjs. Recusa 55437 ocupada, confere PGDATA, executa a suíte, compara estado depois do restart e para a cópia normalmente. Não reinicia a fonte ou o computador.

Logs brutos/certificados/dumps/configurações permanecem privados, fora do Git. [Evidências resumidas](evidencias/agente5-rc1-20261017.json). [Instruções de instalação](agente-5-rc1-instalacao.md). [Roteiro de dois Windows](agente-5-roteiro-dois-windows.md).

Produção 8080, Supabase e dados reais preservados. Sem deploy ou merge. O pacote só pode ser usado em homologação assistida com dados fictícios.
