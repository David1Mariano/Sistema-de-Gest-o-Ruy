# Produção local — Gestão Ruy

## Endereços e estado da instalação

- Projeto: `C:\Users\Pichau\Sistema-de-Gest-o-Ruy`.
- DEV: `http://localhost:5173`, Vite/HMR existente, preservado.
- Produção: `http://ADM-RUY:8080`, servidor HTTP Node independente, sem Vite.
- Hostname auditado: `ADM-RUY`; IPv4 em 25/09/2026: `192.168.1.106/24`, Ethernet.
- O hostname e HTTP foram testados **nesta máquina**. Acesso por outro computador ainda depende do teste abaixo.
- Atalho no Desktop de Pichau: **Sistema de Gestão Ruy**.
- Início automático instalado: ao login de **Pichau**, oculto, com supervisor que reinicia o servidor após falha.
- Boot antes de login / continuidade após logout: **pendente de tarefa administrativa**. Não confundir o atalho de Inicializar com serviço de boot.
- Nenhum DNS, roteador, regra de firewall, política de execução global ou configuração Supabase foi alterado.

## O que fica isolado

Os arquivos publicados ficam em `%LOCALAPPDATA%\GestaoRuy\producao`, fora do projeto:

```text
producao/
  active.json                  versão atual e anterior
  releases/<versao>/site/       HTML, CSS, JS compilados e assets
  releases/<versao>/manifest.json  hashes internos, não servidos
  runtime/                     cópia independente do servidor e supervisor
  logs/server.log              log operacional
```

O servidor lê apenas arquivos declarados no manifesto do build. Não serve o
projeto, `.env`, `.git`, `src`, `node_modules`, mapas de código ou scripts
administrativos. Não faz proxy de APIs, autenticação ou banco. Conexões HTTP são
aceitas somente de loopback e da mesma sub-rede IPv4 privada de uma interface
local. Nenhuma porta foi encaminhada no roteador.

Alterar `src/`, executar `npm run dev` ou `npm run build` (saída normal `dist/`)
não altera produção. O processo de produção usa uma cópia do próprio servidor;
até editar `scripts/production/server.mjs` não modifica o processo instalado.

O build usa a configuração Supabase já existente no projeto. **Os dados continuam
compartilhados**: testar gravações no DEV pode afetar os dados vistos na produção.
Só o frontend foi separado. Nada foi copiado, migrado ou alterado no banco.
Como 5173 e 8080 são origens diferentes, a sessão do navegador não é transferida;
faça login na nova URL normalmente. Login e fluxos funcionais precisam de
validação do usuário; os testes desta instalação verificam a infraestrutura.

## Publicar uma nova versão

Somente após decisão explícita de publicar e validação manual no DEV:

```powershell
Set-Location 'C:\Users\Pichau\Sistema-de-Gest-o-Ruy'
npm.cmd run prod:publish
npm.cmd run prod:status
```

`prod:publish` executa todos os `scripts/test-*.mjs`, lint e `npm run build` com
saída exclusiva em uma nova pasta de release. Valida os assets e hashes, rejeita
arquivos indevidos e credenciais privadas reconhecíveis e só então troca
`active.json` por renomeação atômica. Teste/lint/build/validação com falha não
troca a versão ativa. Um lock impede duas publicações simultâneas.

O HTML original possui uma referência a `/manifest.json` sem arquivo correspondente;
a publicação remove apenas esse link quebrado da cópia compilada, sem editar o
HTML de desenvolvimento. Os assets usam `/releases/<versao>/...`. Builds antigos
são mantidos, permitindo que abas já abertas continuem carregando seus assets.
O usuário recebe a nova versão ao atualizar/abrir a página, sem HMR em produção.

O comando publica o **estado atual do diretório**, inclusive mudanças ainda sem
commit. Não faz commit, pull, reset, migração ou atualização automática.
Mantenha o código estável durante testes/build. Nenhum watcher publica alterações.

Se uma interrupção de energia deixar `publish.lock`, confirme que o PID registrado
nele não está publicando antes de remover **somente esse arquivo**. Não limpe
releases automaticamente: elas sustentam rollback e abas abertas. Uma pasta de
release sem manifesto pode ser sobra de build interrompido; não é versão ativa.

## Iniciar, consultar e voltar à versão anterior

```powershell
npm.cmd run prod:start
npm.cmd run prod:status
npm.cmd run prod:rollback
```

`prod:start` inicia o supervisor oculto e verifica `/__health`. Não encerra nenhum
processo se a porta estiver ocupada. `prod:rollback` valida a versão anterior e
troca o apontamento sem reiniciar o servidor; não altera dados. Na primeira
publicação ainda não há versão anterior. Depois de um rollback, a versão retirada
passa a ser a anterior, permitindo retornar a ela pelo mesmo comando.

Logs: `%LOCALAPPDATA%\GestaoRuy\producao\logs\server.log`. O supervisor reinicia
seu filho após cinco segundos em caso de falha e arquiva o log acima de 5 MB na
próxima partida. Não existe monitoramento remoto. A máquina ligada, rede e energia
continuam sendo necessários; não foi alterada a política de suspensão do Windows.

## Inicialização automática no Windows

O instalador sem administrador cria o atalho de Desktop e um atalho em Inicializar
do usuário, usando Windows Script Host para abrir o supervisor sem console:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\production\install-windows.ps1
```

`RemoteSigned` vale apenas para esse processo; não altera a política global nem
contorna políticas de domínio. A pasta Inicializar só atua depois do login de
Pichau. Não foi realizado reboot/logout durante a instalação para preservar o Vite.

Para funcionar **desde o boot, sem login, e continuar após logout**, abrir PowerShell
**como administrador da mesma conta Pichau** e executar:

```powershell
Set-Location 'C:\Users\Pichau\Sistema-de-Gest-o-Ruy'
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\production\install-windows.ps1 -BootTask
```

Cria `GestaoRuy-Producao` no Agendador, com gatilho de inicialização, sem limite de
duração, reinício em falha e execução do servidor com privilégio limitado. Usa S4U,
sem guardar senha; o servidor lê arquivos locais, não compartilhamentos SMB nem
arquivos EFS. A instalação recusa sobrescrever tarefa existente e remove apenas
o atalho de login criado por este instalador para evitar duplicidade. O processo
atual não é encerrado; a tarefa valerá no próximo boot. Após reiniciar em horário
combinado, verificar `Get-ScheduledTask -TaskName GestaoRuy-Producao`,
`Get-ScheduledTaskInfo -TaskName GestaoRuy-Producao` e a URL a partir de um cliente.
Não foi instalada nesta sessão sem elevação.

Referências: [principal de tarefa](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal)
e [tipos de logon/S4U](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype).

## Rede: validação em outro computador

Na mesma rede da empresa, abrir `http://ADM-RUY:8080`. Para diagnóstico, executar
no PowerShell **do cliente**, não no servidor:

```powershell
[System.Net.Dns]::GetHostAddresses('ADM-RUY')
Test-NetConnection ADM-RUY -Port 8080
(Invoke-WebRequest 'http://ADM-RUY:8080/__health' -UseBasicParsing -TimeoutSec 10).Content
```

O último comando deve responder `service: gestao-ruy-production`. Se falhar:

- IP atual funciona e hostname não: falha de resolução de nomes no cliente/rede.
- Nem IP nem hostname funcionam, mas servidor responde localmente: investigar
  firewall, isolamento de clientes no Wi-Fi, VLANs/sub-redes ou serviço indisponível.
- Nome resolve para IP diferente do atual: cache/registro de nome desatualizado.

Essas são hipóteses de diagnóstico, não resultados de um teste remoto já feito.
Não dá para afirmar a causa exata sem o resultado do cliente. O perfil Público
observado e a resolução local não comprovam que o nome funcione em toda a rede.

Se a rede não resolver nomes de forma confiável, a alternativa estável é uma
**reserva DHCP para este computador e um registro DNS local** apontando o nome
para essa reserva, configurados pelo responsável pelo roteador/DNS. Se o roteador
não oferecer DNS local, usar a reserva DHCP e uma entrada `hosts` nos clientes.
Ambas exigem autorização/administração; nada disso foi feito. Usar o IPv4 dinâmico
atual em `hosts` sem reserva não resolve o problema de estabilidade.

## Firewall

A auditoria encontrou Ethernet em perfil **Public** e duas regras existentes
`Node.js JavaScript Runtime` permitindo o programa em todas as portas e endereços
remotos nesse perfil. Foram preservadas para não arriscar o Vite utilizado.
Elas provavelmente já permitem 8080; somente o teste do cliente confirma a
conectividade efetiva. O servidor novo rejeita requisições fora da sub-rede local.

Se for necessária uma regra explícita, o administrador pode usar esta regra
restrita à interface atual, programa, TCP 8080 e sub-rede local:

```powershell
New-NetFirewallRule -Name 'GestaoRuy-8080-LAN' `
  -DisplayName 'Gestao Ruy - Producao LAN TCP 8080' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 `
  -Program 'C:\Program Files\nodejs\node.exe' `
  -RemoteAddress LocalSubnet -InterfaceAlias 'Ethernet' `
  -Profile Public,Private -EdgeTraversalPolicy Block
```

Inclui Public porque esse é o perfil atual; não altera o perfil da rede. Se a
interface mudar para Wi-Fi, revisar `InterfaceAlias` com o administrador.
Uma regra restrita adicional **não restringe as regras amplas existentes**.
O responsável deve revisar essas regras em janela combinada, preservando o acesso
necessário ao DEV; nenhuma foi desativada. Não liberar 8080/5173 no roteador.
Referência: [New-NetFirewallRule / LocalSubnet](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule).

## Atalho nos clientes

Depois de confirmar o hostname nesse cliente: Desktop → Novo → Atalho →
`http://ADM-RUY:8080` → nome **Sistema de Gestão Ruy**. Também é possível copiar
o arquivo `.url` criado no Desktop do servidor. Não usar `localhost` nos clientes.

## Manutenção e reversão da instalação

Nenhum pacote npm novo foi instalado. Não houve alteração de Auth, RLS ou dados.
Para desativar autostart ao login, remover somente `GestaoRuy-Producao.lnk` da pasta
Inicializar do usuário. Se a tarefa de boot tiver sido instalada, desabilitá-la
pelo Agendador. Identificar o supervisor/servidor pelo caminho
`GestaoRuy\producao\runtime` antes de encerrá-los; nunca encerrar todos os
processos Node, pois isso também derrubaria o Vite.

Atualizar a infraestrutura do servidor é manutenção separada: o publicador não
sobrescreve arquivos runtime existentes. Planejar parada apenas da produção,
guardar a cópia anterior, atualizar runtime e conferir saúde. Publicações normais
de frontend não precisam dessa parada.
