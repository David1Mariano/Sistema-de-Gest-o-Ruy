# API antiga 18080 — procedimento preparado, não executado

Inventário de 17/10/2026: loopback 18080, node.exe PID 22292, início em 16/10/2026 às 15:30:46 -03:00; script identificado `server/local/start.mjs`. Pai powershell.exe PID 21840; ancestral codex.exe PID 23252. A cadeia identifica a sessão de origem, mas não comprova que seu terminal ainda possa receber entrada. Nenhum sinal foi enviado.

1. Executar `powershell -NoProfile -File scripts/d1-lab/inspect-legacy-api.ps1`. Conferir porta, PID, data de criação e cadeia de processos. O script é somente leitura e não imprime argumentos ou credenciais. Não confiar apenas no número de PID, que pode ser reutilizado.
2. O operador deve localizar o terminal da sessão Codex de origem, conferir que ele iniciou esta API e preservar seu registro de execução. Se não localizar o terminal ou um canal normal comprovado, manter a API e continuar em 18092. Não usar Stop-Process, taskkill, fechamento do terminal, reinicialização do computador ou sinal para um grupo de processos.
3. **Somente após autorização explícita para a parada**, enviar Ctrl+C uma vez no terminal confirmado. Aguardar o encerramento normal e a mensagem do aplicativo; se não concluir, preservar o processo e investigar. Não repetir Ctrl+C como tentativa de forçar saída. O encerramento por stdin/pipe da versão nova não pode ser presumido na antiga.
4. Conferir novamente que a porta 18080 foi liberada e que o processo original terminou, comparando também sua data de criação. Se continuar escutando ou aparecer outro PID, não ocupar a porta. Registrar resultado e autorização, sem segredos.
5. Somente depois da confirmação de parada, preparar o supervisor novo com configuração privada do banco **de laboratório** e verificar o destino antes de iniciá-lo. Não reutilizar configuração operacional por conveniência. O supervisor deve recusar porta ocupada e lock ativo.
6. No supervisor novo, usar `restart` ou `shutdown` pela entrada padrão controlada; EOF também encerra o filho. Registrar PID, revisões, healthcheck sanitizado e liberação de lock. Não aplicar esses comandos à sessão antiga sem comprovar suporte.

A suíte de supervisão em 18092 verifica porta ocupada, exclusão por lock, reinício normal, EOF e shutdown. Isso não comprova um canal de encerramento para PID 22292. Produção 8080 permanece fora deste procedimento. A substituição da 18080 está pendente.
