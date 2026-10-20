# I5 R3 — isolamento Windows, 20/10/2026

Estado: candidata preparada para homologação supervisionada. Instalador NÃO executado; uso operacional não autorizado.

## Causa e correção

A R2 fixava o fixture `e5aaec701010f607`, a porta 18091 e o cluster 55437 da I5. O desktop aceitava reutilizar uma API saudável sem comprovar sua propriedade. Somente o perfil Electron era distinto.

A R3 usa `i5r3-20261020`: API 18103, PostgreSQL 55443, dados em `%LOCALAPPDATA%/GestaoRuy/installation-i5r3-20261020`, perfil `%APPDATA%/SistemaGestaoRuy-i5r3-20261020`. O laboratório paralelo usa `i5r3-peer-20261020`, API 18104 e cluster 55444. Ambos usam o nome de banco `ruy_d1_disposable`, em clusters fisicamente independentes. Nenhum dado, senha ou chave foi copiado da I5.

O appId R3 e o perfil definem a identidade e o lock de instância exclusivos. O primeiro lançamento comum vincula o caminho canônico do executável via DPAPI; outra localização com o mesmo namespace é recusada. Os modos explícitos de teste de janela/login não registram essa vinculação permanente. Cópias adicionais devem receber outro namespace aprovado; não basta copiar o executável.

O provisionamento cria somente um diretório inexistente, com ACL do usuário, cluster novo, credenciais aleatórias e arquivos DPAPI próprios. Os certificados de laboratório ficam em `installation-tls.dpapi`, sem instalação em repositórios Windows. A geração requer PostgreSQL 17 e o OpenSSL já instalado em `C:/Program Files/Git/usr/bin/openssl.exe`; esta dependência externa deve ser conferida antes do provisionamento em outro Windows. Os certificados não ativam transporte entre máquinas. A sincronização operacional continua desligada.

Cada API é criada por `utilityProcess`, recebe um identificador aleatório por execução e responde com identidade de instalação/PID. O desktop exige correspondência com o filho que iniciou. Porta ocupada é recusada; não há adoção automática de processos. Heartbeats limitam a vida da API quando o pai deixa de supervisioná-la. O supervisor limita retentativas e mantém falhas bloqueadas quando não pode recuperar com segurança.

O fechamento aguarda backup, solicita parada por IPC e aguarda a saída do filho. PostgreSQL é parado normalmente apenas quando o app o iniciou, depois da API. Processos de outras instalações não são alvos. Falta de confirmação mantém o fechamento pendente; não existe fallback de encerramento forçado no controlador. O timeout legado de subprocessos de backup permanece preexistente, não foi acionado nestes ensaios e requer revisão futura para uma garantia geral de ausência de força.

## Evidências

| Ensaio | Resultado e limite |
| --- | --- |
| Regressões de contrato, visibilidade, permissões e encerramento | 19/19; testes automatizados com mocks onde aplicável |
| Catálogos, autenticação, permissões, versão e rollback | 1/1 contra PostgreSQL R3 e API HTTP real de teste |
| Estado visual de sincronização | 2/2, sem banco |
| Dois clusters novos | Credenciais, certificados, identidades e diretórios distintos |
| Persistência | Ambos após `pg_ctl restart -m fast`, sem alteração de cluster anterior |
| Backup/recuperação | Arquivos cifrados próprios; restauração em bancos novos de cada cluster e conferência de registro sintético |
| APIs D1 simultâneas | Processos Electron utility reais, portas distintas, parada/reinício próprios, expiração de heartbeat e preservação do peer |
| Executável R3 empacotado | Janela, segundo clique, minimização, posição fora da tela, login sintético duas vezes e fechamento normal aprovados |
| Encerramento do pacote | API e PostgreSQL iniciados pelo app encerrados; portas livres após cada execução |
| Falhas | Inicialização sintética e porta ocupada recusadas; serviço ocupante preservado |
| Atalho Windows | `.lnk` temporário em `logs/i5r3`, para `win-unpacked`, com argumento de teste; janela e shutdown confirmados. Não equivale ao atalho definitivo instalado |
| Duas aplicações simultâneas | Uma empacotada e outra Electron em desenvolvimento, no mesmo Pichau; login e saída normal. Não são dois Windows físicos |
| Lint/build | Lint, frontend e D1 concluídos; avisos de tamanho de chunks no Vite |
| Pacote | 13 dependências, fontes/ASAR conferidos, fuses preservados e ausência de arquivos privados conhecidos |
| Preservação | 25 backups originais e cópias, DPAPI anteriores e dez WIP Etapa A conferidos por SHA-256 |

Ocorrências corrigidas: consulta de PGDATA com papel restrito passou a usar o administrador do próprio laboratório; verificação do restore passou a usar conexão administrativa exclusiva ao banco restaurado. Uma chamada inicial usou o caminho errado da configuração Vite; o build D1 foi refeito com `lab/d1/vite.config.mjs`.

O teste histórico de supervisão foi recusado por ausência do opt-in, antes de iniciar serviços; não foi habilitado contra laboratório existente. A tentativa inicial de regressão de banco encontrou o cluster R3 parado; catálogo foi repetido com sucesso após iniciá-lo. O caso PostgreSQL do teste histórico de sync-status depende do fixture de portas antigas e continua pendente de adaptação; suas duas verificações puras passaram. Não se declara a suíte completa aprovada.

Evidência versionada: `docs/evidencias/agente5-i5r3-isolamento-20261020.json`. Logs detalhados e arquivos privados permanecem ignorados em `logs/i5r3` e nos diretórios de laboratório. O isolamento é por instalação do mesmo usuário Windows; não constitui uma barreira contra o próprio usuário Pichau.

## Candidata e instalação futura

Versão `0.5.2-rc.3`, revisão `A5-I5-R3-20261020`.

Instalador: `artifacts/agente5-integracao5r3-20261020/Sistema-Ruy-A5-I5-R3-20261020-Setup.exe`.

SHA-256: `e7b85f8b3df44a1a9d3d26435854e6f94a9d67b681f8b2e6ca493a7e08cb52dd`.

Sem assinatura digital. Instaladores I5 e R2 preservados. Nenhum instalador, banco, certificado privado, DPAPI ou backup é versionado.

1. Obter autorização específica para instalar. Conferir novamente hash, identidade dos processos anteriores, ausência de backups/gravações e pré-requisitos locais. Não encerrar a I5 anterior.
2. Executar `scripts/d1-lab/preflight-i5r3.mjs` com `RUY_D1_ALLOW_TESTS=1`, `RUY_D1_INSTALLATION=i5r3-20261020` e `RUY_D1_TEST_API_PORT=18103` apenas no processo de pré-verificação. O app configura essas variáveis sozinho; não criar variáveis globais.
3. O preflight disponível valida um laboratório R3 já provisionado no Pichau, porta API livre, credenciais, identificação de certificados e lock de backup ausente. Não é um provisionador para outro Windows nem substitui análise de transações/processos em andamento.
4. Instalar interativamente e sem elevação em `%LOCALAPPDATA%/Programs/Sistema-Ruy-I5R3-Homologacao-20261020`, conferindo o destino efetivo exibido pelo NSIS. Não aceitar sobrescrita, desinstalação de outra versão ou bypass de SmartScreen/Defender.
5. Usar somente o novo atalho `Sistema Ruy - I5 R3 Homologacao`. Conferir caminho, perfil, API 18103 e PGDATA 55443. O primeiro lançamento comum vincula esse caminho ao namespace R3.
6. Testar login sintético, segundo clique, minimizar/restaurar, fechar/reabrir, persistência e recuperação em banco novo. Se houver erro de propriedade ou conflito, interromper e preservar arquivos/processos. Não apagar DPAPI, locks ou perfis para contornar a falha.

Permanecem pendentes: instalação interativa da R3 e atalho definitivo, Windows limpo, segundo computador físico, reconexão real, provisionamento mTLS entre máquinas, recuperação independente e aceite operacional. Não foi executado deploy, merge, migração operacional ou sincronização real.
