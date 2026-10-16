# Roteiro independente — 0.5.0 revisão H1

**Estado: pendente em outro Windows e pendente de reboot real.** Não usar dados
reais. Executar em Windows 10/11 x64 separado do computador operacional; registrar
qual versão foi usada. Não reiniciar ADM-RUY nem desligar sua rede.

## Preparação

1. Levar o instalador `Sistema-Gestao-Ruy-Lab-0.5.0-H1-Setup.exe`, `SHA256SUMS.txt`
   e este roteiro. Conferir `Get-FileHash -Algorithm SHA256` antes de executar.
2. Preparar PostgreSQL **17 x64 completo**, com bin/lib/share e runtimes exigidos
   pela distribuição. Não instalar serviço permanente sem aprovação. Node/Electron/
   pg já estão no aplicativo; o destino não precisa de npm/Git/checkout.
3. Instalar por usuário em pasta exclusiva de homologação. Confirmar atalhos com
   sufixo **Homologação H**, distintos de G e da aplicação operacional.
4. Abrir pelo ícone. Se não houver D1, selecionar pasta bin do PostgreSQL e criar
   conta `@example.invalid` e senha local de pelo menos 12 caracteres. Não copiar
   cluster, `.dpapi`, `.env` ou credenciais do computador de desenvolvimento.
   Diretórios existentes/parciais devem ser preservados e diagnosticados.

## Autonomia e reinício

5. Entrar, criar setor/função/colaborador fictícios, vale e consumo. Usar prefixo
   FICTICIO, conferir filtros, valores, vínculos e histórico. Executar somente
   contratos já portados; não tentar contornar bloqueios de lotes/anexos/estornos.
6. Anotar registros e pendências; fechar e abrir pelo atalho. Entrar novamente com
   a conta já autorizada. Conferir os mesmos registros e operações pendentes.
7. Desligar internet **somente nessa máquina**. Repetir consulta/criação/edição,
   login autorizado e fechamento/reabertura. A nuvem não deve ficar verde: a
   sincronização operacional está desativada, mesmo que uma central de testes
   confirme transporte.
8. Reiniciar o Windows de homologação. Sem internet, abrir pelo ícone, entrar e
   conferir registros/fila. PostgreSQL/API devem iniciar sem serviços permanentes.
   Depois de falha brusca, aguardar a recuperação: o banco pode precisar de mais
   de 30 segundos para sincronizar dados. Não apagar postmaster.pid/cluster, não
   executar init novamente e não desabilitar fsync para acelerar.
9. Usar “Laboratório → Tentar recuperar serviços locais” se o limite automático
   for atingido. Registrar falha, estado do título da janela e tempo de recuperação.
   Não encerrar processos postgres indiscriminadamente. Ensaios de crash devem
   ser executados pelo responsável técnico somente no cluster sintético marcado.

Dados ficam em `%LOCALAPPDATA%\GestaoRuy\etapa-d1-lab`, vinculados à máquina e ao
usuário. PostgreSQL/API escutam somente 127.0.0.1:55436/18087. Não abrir firewall
público. A API própria encerra com o app; PostgreSQL pode continuar como processo
privado. Após reboot, é iniciado ao abrir o aplicativo, sem serviço/autostart.

## Backup, chave e recuperação

10. Escolher um destino protegido em **outro dispositivo físico**, por exemplo
    mídia externa sob custódia definida. Nenhum destino físico foi escolhido ou
    validado por esta execução. Outra pasta no mesmo C: não protege contra perda
    desse disco. Validar permissões e disponibilidade do destino com o responsável.
11. Menu “Laboratório → Configurar destino de cópia do backup”. Criar backup
    criptografado e conferir hash. As cópias H ficam na subpasta `ruy-d1-<deviceId>`.
    Retenção externa padrão acompanha a local; `externalRetain` no arquivo privado
    `backup-settings.json` permite 2–365 cópias. Apenas arquivos antigos autenticados
    da mesma identidade são elegíveis à rotação. Corrompidos/estranhos são preservados
    para revisão. Cópias G na raiz do destino não são removidas por essa rotação.
12. “Laboratório → Exportar chave de recuperação protegida”: selecionar `.ruykey`
    fora do diretório privado e escolher uma frase forte com pelo menos 16 caracteres.
    A frase não é armazenada. Guardá-la por meio independente dos arquivos e do PC.
    Não substituir a única chave válida, não guardar frase em scripts/argumentos/logs.
13. “Laboratório → Testar restauração isolada do último backup” valida o arquivo
    local. A seguir, no Windows de destino preparado, usar “Restaurar backup externo
    em banco isolado”: selecionar `.ruybak`, `.ruykey` e informar a frase.
14. Conferir nome `ruy_d1_restore_*`, 12 tabelas verificadas, anexos e fila. O banco
    ativo não deve ser substituído. O banco recuperado **não é ativado** e mantém
    a sincronização bloqueada; reconciliar origem, permissões e fila antes de qualquer
    plano de ativação. Frase incorreta deve falhar sem criar banco.
15. Simular indisponibilidade apenas do destino de cópia, sem remover o disco do
    cluster. Falha deve ser informada e backup local preservado. Retenção local e
    agendamento durante uso do app continuam; não há backup agendado com app fechado.

Uma chave exportada não é prova de recuperação. Aprovar proteção somente após
restauração com os arquivos custodiados no ambiente de destino e validação da
independência física. O laboratório mantém `externalProtected=false`.

## Instalação e atualização

16. Com app fechado, registrar identidade, quantidades, histórico e fila. Desinstalar
    apenas o produto H e reinstalar. Não apagar AppData. Conferir os dados anteriores.
    Nunca escolher diretório da produção. Atualização interrompida continua pendente.

## Ficha de aceite — preencher no destino

| Item | Resultado inicial | Evidência/observações |
|---|---|---|
| Windows 10 x64 | Pendente | |
| Windows 11 x64 independente | Pendente | |
| SHA-256, instalação e atalhos H | Pendente | |
| Dependências e permissões sem serviço permanente | Pendente | |
| Primeiro login e login offline já autorizado | Pendente | Não registrar senha |
| Cadastros, edição, histórico e fila | Pendente | |
| Fechar/reabrir sem perda | Pendente | |
| Reboot real e abertura pelo ícone, sem internet | Pendente | |
| Recuperação após falha controlada | Pendente | |
| Nenhum check verde operacional | Pendente | |
| Destino físico independente e permissões | Pendente | |
| Backup, retenção e chave sob custódia | Pendente | |
| Restore isolado em outro Windows | Pendente | |
| Desinstalação/reinstalação e atualização | Pendente | |
| Uso diário com dados reais | Bloqueado | Gates técnicos e de segurança pendentes |

Responsável/data/hora:

Máquina/VM e versão do Windows:

Falhas e passos para reprodução:

Critérios não executados:

Decisão: aprovado apenas em laboratório / reprovado / pendente.
