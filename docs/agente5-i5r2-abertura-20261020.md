# I5 R2 — abertura Windows corrigida — 20/10/2026

Candidata **A5-I5-R2-20261020 / 0.5.2-rc.2**, restrita à homologação no Pichau previamente provisionado. Base Git `edf2f53`, branch `agente-5-auditoria-integracao-20261019`. Alterações preparadas no worktree de integração; nenhuma substituição de arquivos instalados, reinstalação, deploy, merge ou encerramento forçado. O PID 32000 não foi alterado.

## Correções

- Entrada específica `i5-entry.cjs`: valida revisão, caminho e marcador sintético e configura **apenas o próprio processo** antes de importar a política de transporte. O atalho não exige VS Code, Node externo ou variáveis manuais. Ambiente conflitante é recusado. O mecanismo D1 continua validando vínculo com a máquina, DPAPI, host, banco, porta e PGDATA. Não cria um laboratório ausente automaticamente.
- Perfil e appId R2 exclusivos; não reutiliza nem apaga os perfis I5/RC3/0.2/G/H. Esta candidata continua dependendo do laboratório autorizado 55437/18091; não é um provisionador universal para outro Windows.
- `revealWindow`: mostra, restaura e foca a janela. Reposiciona sua barra de título quando nenhum monitor conectado permite alcançá-la. Aplicado após carregar a janela, em ativação e segunda instância. Uma segunda execução durante a inicialização não impede a exibição ao terminar o carregamento.
- O primeiro backup deixa de bloquear a criação da janela. Inicia após a janela carregar, em segundo plano, usando o mecanismo único existente. A R2 pede `preserveExisting:true`: não faz expurgo local/externo de backups existentes, sem mudar a configuração global. As outras chamadas mantêm o comportamento anterior por padrão.
- Logs JSONL sanitizados em `%APPDATA%\SistemaGestaoRuy-Agente5-I5R2-Homolog\startup.jsonl`: revisão, PID, evento, fase e classe/código de erro. Não registram senha, cookie, token, SQL, conteúdo de arquivo, mensagem bruta ou stack. Falha no logger não amplia permissões.
- Watchdog de inicialização e falha antes da criação da janela terminam pelo fluxo controlado e deixam evidência. Erros da candidata retornam código 1 após a limpeza. Falhas reais fora do ensaio exibem aviso ao usuário.
- A janela não é destruída antes de completar o fechamento. Backup ou API própria sem confirmação no prazo mantêm a janela e mostram a pendência; não há fallback para kill no controlador Electron. O serviço registra o receptor de shutdown antes dos imports assíncronos, preservando uma solicitação antecipada.

## Matriz de validação

| Teste | Resultado | Evidência / limite |
| --- | --- | --- |
| Ambiente do atalho sem RUY_* | APROVADO | Executável empacotado e atalho Windows temporário, sem argumentos nem variáveis manuais. Apenas o processo experimental recebe o ambiente. |
| Janela criada e visível | APROVADO | Electron real `packaged=true`; tela de login conferida visualmente por Computer Use. |
| Segunda execução / janela oculta | APROVADO | Ensaio oculta a própria janela e executa o mesmo EXE sem RUY_*; a janela existente reaparece. Segundo lançamento pelo atalho temporário não duplica a janela. |
| Minimização | APROVADO | Métodos reais Electron minimizam e restauram a própria janela. |
| Fora da área visível | APROVADO no ensaio | Posição extrema solicitada e janela recolocada na área útil; casos de vários monitores também em unidade. Não houve desconexão física de monitor. |
| Falha sem criar janela | APROVADO | Falha sintética antes do ambiente e ambiente conflitante: logs sanitizados e código de saída 1. Não se apagou perfil para testar. |
| Fechamento normal | APROVADO no app | Processo de teste encerrou normalmente; fechamento pela interface/Alt+F4 conferido. API 18091 existente foi reutilizada e não foi encerrada. |
| Espera por API própria / backup lento | APROVADO em unidade e IPC sintético | Sem resposta, devolve pendência e não invoca kill. UtilityProcess real recebeu shutdown antes de terminar os imports e encerrou servidor HTTP sintético com código 0. Encerramento completo da API D1/SQL própria continua PENDENTE enquanto 18091 pertence à I5 antiga. |
| Persistência | APROVADO SQL | Conexão fechada/reaberta em banco novo sintético, com documentos, estoque, ledger, outbox e auditoria iguais. Não equivale a reboot/reinstalação. |
| Backup e restore | APROVADO | Backup cifrado/restauração em banco novo; teste adicional com retain=2 preservou hashes dos 23 backups existentes e verificou 17 tabelas na restauração. |
| Regressões | APROVADO no escopo revalidado | Histórico: 844/844; repetição no clone: 842/844 inicialmente, duas suposições de fixtures corrigidas e os dois arquivos reaprovados em 4/4 verificações. Mais 12 testes finais de inicialização/visibilidade/espera aprovados. Não se alega uma única execução final 845/845. |
| Lint / builds | APROVADO | ESLint e builds web/D1; avisos de tamanho de chunks mantidos. |
| NSIS instalado / atalho definitivo R2 | PENDENTE | NSIS gerado e inspecionado, mas não executado. Testes usaram `win-unpacked` e atalho temporário em logs, sem alterar os atalhos instalados. |

Os scripts históricos de catálogo dependiam de API fixa 18087, e o teste de status assumia ausência de anexos. Ajustados somente os testes: servidor HTTP próprio em porta efêmera ligado ao mesmo pool, e bancos novos com/sem schema de anexos. Nenhuma regra de autenticação, sincronização ou negócio foi relaxada. Não houve nova execução indiscriminada da suíte com retenção capaz de excluir backups antigos.

Uma primeira versão do teste de persistência finalizava o pool duas vezes; corrigido o cleanup e repetido com sucesso. As falhas iniciais de fixtures não são contadas como aprovação. As diferenças de teste estão registradas nos logs e hashes das evidências.

## Instalador

`artifacts/agente5-integracao5r2-20261020/Sistema-Ruy-A5-I5-R2-20261020-Setup.exe`

SHA-256: **`50a38c8f1bc11b9798cb335ffcb884bfa8119584e0969fc450926070e28c0235`**.

Tamanho: 111.999.657 bytes. ASAR SHA-256 `aecd6b1632ec9cdd0bd9d3971b3194efacef095d7c9207d4d5f2e658b523fe7a`.

Conferidos os fontes desktop/D1, SQL e bundle contra o pacote; 13 dependências de produção; arquivos privados conhecidos ausentes; fuses de RunAsNode/NODE_OPTIONS/inspector CLI desativados e criptografia de cookies ativa. Não assinado. Não desativar ou contornar Defender, SmartScreen ou avisos para instalá-lo.

O instalador I5 anterior mantém SHA-256 `70ac60a6676b2ad084523fd6822b1dde33f6a13579395f0f7456c4d8ef898cc1`. A instalação antiga mantém seu ASAR `a6413ac2f5ded1efb13eeb0523ef68c2be8cc8eb14f58326eafd62e7bb39ac24`. A R2 tem nome, output, versão, perfil, appId e atalho diferentes. Não foi instalado serviço, alterado firewall ou certificado.

## Processo atual e risco de dados

PID **32000** reidentificado como o EXE I5 instalado no diretório autorizado, com início UTC `2026-10-19T23:00:01.936Z`; não foi reutilizado nem encerrado. API antiga 18080/PID 22292 e PostgreSQL preservados.

No banco sintético, a fotografia de metadados mostra 1 operação pendente e 5 conflitos D1/C2, além de entradas históricas sem confirmed_at. Esses totais abrangem o laboratório, não podem ser atribuídos exclusivamente ao PID 32000. Nenhuma transação aberta foi visível à consulta daquele instante. O conteúdo não salvo em memória da janela inacessível permanece desconhecido; não se declara risco zero para encerramento forçado.

Os DPAPI e backups anteriormente registrados mantiveram hashes; dez arquivos WIP Etapa A e HEAD original db99024 preservados. Foi criada cópia local separada, com ACL privada e SHA-256 verificado, de 25 arquivos cifrados, em `artifacts/i5r2-preservacao-20261020-b65ffcc7228040d98cc0ebfcd217ac94`. Isso não é mídia independente nem autorização para remover os originais. A política do processo I5 antigo não foi alterada; revisar sua retenção antes de uma troca futura.

## Procedimento seguro de substituição futura

1. Obter autorização própria para instalar a R2; esta entrega apenas gera a candidata. Conferir novamente hash, PID/horário, fila, backup em andamento, espaço e ACL. Não inferir autorização de força ou de reinstalação.
2. Verificar os backups cifrados e a cópia protegida. Registrar estado e hashes, sem exportar credenciais. Se houver operação/backup em andamento, aguardar sua conclusão; conteúdo não salvo precisa de avaliação específica.
3. Encerrar a I5 antiga somente por mecanismo expressamente autorizado. A tentativa normal anterior falhou; não repetir força ou atingir filhos/API/PostgreSQL por conveniência. Sem mecanismo aprovado, manter a instalação antiga intacta e a R2 separada.
4. Instalar interativamente, sem elevação, em diretório novo, por exemplo `%LOCALAPPDATA%\Programs\Sistema-Ruy-I5R2-Homologacao-20261020`. Conferir a pasta efetiva apresentada pelo NSIS, que pode incluir a subpasta do produto. Preservar I5, 0.2.0, G e H. Não sobrepor nem desinstalar nesta autorização.
5. Usar o novo atalho **Sistema Ruy - I5 R2 Homologacao**, sem shell/VS Code/variáveis globais. Confirmar revisão R2, perfil próprio, login sintético e serviço de laboratório correto. Se 18091 estiver ocupada, não encerrar seu dono automaticamente.
6. Com a API anterior liberada por procedimento autorizado, comprovar o ciclo completo de API própria e shutdown; repetir login, persistência, backup e restore em banco novo e abrir/fechar pelo atalho definitivo instalado.
7. Só após esses aceites decidir a troca do atalho usado pelo operador. Instalação limpa em outro Windows, dois computadores/rede real, certificados independentes e aprovação operacional continuam pendentes. Não ativar sincronização operacional nem usar dados reais.

[Evidências sanitizadas](evidencias/agente5-i5r2-abertura-20261020.json). Nenhum commit/push desta rodada é apresentado como concluído; os fontes estão preparados no worktree de integração para revisão.
