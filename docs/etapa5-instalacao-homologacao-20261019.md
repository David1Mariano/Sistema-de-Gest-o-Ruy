# Candidata I5 — instalação e homologação supervisionada

19/10/2026. Identificação **A5-I5-20261019**, versão **0.5.2-rc.1**, Windows x64. Uso exclusivamente sintético; sem aprovação operacional.

## Artefato e verificação

No worktree `C:\Users\Pichau\gestao-ruy-integracao-auditoria-20261019`:

`artifacts/agente5-integracao5-20261019/Sistema-Ruy-A5-I5-20261019-Setup.exe`

SHA-256: `70ac60a6676b2ad084523fd6822b1dde33f6a13579395f0f7456c4d8ef898cc1`.

Tamanho: 111.997.128 bytes. Instalador NSIS por usuário, sem elevação obrigatória, sem execução automática após instalar e sem exclusão de AppData ao desinstalar. **Não assinado**: política de distribuição e assinatura ainda depende de aceite. Não orientar usuários a contornar bloqueios de segurança.

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'artifacts/agente5-integracao5-20261019/Sistema-Ruy-A5-I5-20261019-Setup.exe'
```

Conferir o hash antes de copiar ou executar. O instalador, o diretório `win-unpacked`, os certificados, os bancos e os backups não pertencem ao Git. O relatório público registra hashes e resultados sanitizados.

## Limites do que foi testado

Foi executado o aplicativo **empacotado extraído em `win-unpacked`**, usando o mesmo ASAR incluído no NSIS. Isso comprova carregamento das dependências, API utility process, login e fluxos descritos na matriz. Não comprova execução do instalador, atalhos, desinstalação, reinstalação, Windows limpo ou reboot do sistema operacional. Nenhuma segunda máquina ou VM limpa autorizada foi disponibilizada.

A candidata tem appId próprio e perfil `SistemaGestaoRuy-Agente5-I5-Homolog`, distinto da RC3. Os dados D1 ficam no laboratório provisionado, não nesse diretório de instalação. O perfil ainda herda ACL do Windows atual; a revisão final das permissões por usuário/serviço continua pendente.

## Inicialização no Pichau já provisionado

A I5 recusa a inicialização comum antes de abrir o ambiente: exige opt-in sintético, fixture `e5aaec701010f607` e API auxiliar 18091. A identidade da máquina, o marcador e PGDATA são conferidos pelo mecanismo D1 existente. Não apontar para 55435/55436, 18080 ou produção 8080. Não copiar os arquivos DPAPI de Pichau para outra máquina.

Os comandos abaixo destinam-se **somente ao laboratório existente no Pichau**, com portas livres e acompanhamento. Não iniciam sincronização operacional nem habilitam Delivery:

```powershell
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_RESTART_FIXTURE='e5aaec701010f607'
$env:RUY_D1_TEST_API_PORT='18091'
& '.\artifacts\agente5-integracao5-20261019\win-unpacked\Sistema Ruy - Integracao 5 Homologacao.exe'
```

Não utilizar esses comandos como provisionamento de outro Windows. A instalação limpa independente permanece bloqueada até existir máquina autorizada, provisionamento próprio revisado e janela de homologação. As flags Delivery de teste só são usadas pelos runners isolados; `operationalSyncEnabled` permanece falso.

Fechar pela janela do aplicativo. O aplicativo solicita shutdown da sua API por mensagem e aguarda a saída; não deve encerrar serviços de terceiros. Se a saída normal falhar, preservar o log e os PIDs identificados, sem comandos globais ou encerramento forçado. A API antiga 18080 permanece fora desse procedimento.

## Roteiro para Windows B ou VM limpa

1. Registrar máquina, responsável, versão Windows, usuário de teste e autorização. Sem acesso remoto ou alteração da rede por inferência.
2. Confirmar hash e política de assinatura. Instalar por usuário em diretório próprio, sem sobrepor instalação anterior; conferir arquivos, atalhos e permissões.
3. Provisionar laboratório independente, com banco sintético, identidade e chaves próprias. Revisar instalação PostgreSQL, papel de execução, conta de backup, ACL e proteção DPAPI. O provisionamento independente da I5 ainda exige validação; não reutilizar dados/chaves de Pichau.
4. Gerar certificados de homologação distintos por máquina. Conferir CA, SAN, validade, identidade/token, expiração, revogação e rotação. Conservar loopback até autorização explícita do transporte entre máquinas; nunca expor PostgreSQL ou portas internas à internet.
5. Repetir login/permissões, colaborador, estoque/produção, financeiro homologado, anexos e Delivery sem pagamento. Registrar UUIDs sintéticos, versões, recibos e hashes; não registrar senha, cookie ou chave privada.
6. Fechar e reabrir; reiniciar o Windows somente na janela autorizada; comparar dados e fila. Validar instalação, reinstalação e preservação do laboratório. Não desinstalar software ou apagar perfis existentes automaticamente.
7. Criar backup cifrado e cópia independente protegida; registrar SHA-256, guardar a chave portátil separadamente. Restaurar em **novo** banco descartável com identidade própria e sincronização desativada; comparar documentos, histórico, ledgers, anexos, fila e recibos. Nunca restaurar sobre banco existente.
8. Com autorização da janela de rede, repetir duas máquinas, desconexão/reconexão real, concorrência, ACK perdido, conflito e retomada. Até lá, os testes são simulados com HTTP/TLS/SQL reais em loopback.
9. Preencher critérios de aceite e revisão de segurança. Estornos RH vinculados, financeiro Delivery e funcionalidades externas continuam bloqueados. Exigir autorização operacional separada antes de qualquer uso real.

Matriz e bloqueios: [consolidação I5](relatorio-integracao-etapa5-20261019.md). Roteiro anterior complementar: [dois Windows](agente-5-roteiro-dois-windows.md).
