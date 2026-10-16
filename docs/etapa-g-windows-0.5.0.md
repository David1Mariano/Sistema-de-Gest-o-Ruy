# Etapa G — aplicativo Windows experimental 0.5.0

16/10/2026. Branch `preparacao/windows-oficial-20261015`, HEAD `8da0eb0`.
Alterações F e arquivos herdados preservados; nenhum arquivo de `src/` alterado.
Sem commit, merge, push, deploy ou alteração do Supabase operacional.

## Pacote e comportamento

Instalador: `artifacts/windows-lab-0.5.0/Sistema-Gestao-Ruy-Lab-0.5.0-Setup.exe`.
NSIS x64 por usuário, sem assinatura. `appId=br.ruy.gestao.laboratorio.g`, produto
`Sistema de Gestão Ruy Lab G`, atalhos “Sistema de Gestão Ruy — Homologação G”.
Saída e identidade próprias, sem sobrescrever os instaladores 0.1/0.2/0.3.

Electron/Node/pg, interface D1, módulos F e SQL de laboratório são empacotados.
PostgreSQL 17 x64 completo é dependência separada, selecionada na primeira execução.
Não exige Node/npm/Git no destino. A preparação cria cluster privado e administrador
fictício `@example.invalid`, com senha escolhida pelo operador, hash scrypt e
credenciais PostgreSQL protegidas por DPAPI/ACL. Não cria serviço Windows.

Na reabertura, o app valida marcador/máquina/cluster, inicia o PostgreSQL privado
se necessário e verifica identidade e escuta loopback. A API local é iniciada pelo
Electron quando não existe outra API D1 validada. A ampliação do contrato F de um
laboratório anterior é transacional, somente no D1 marcado, sem apagar registros.
Preparação parcial/diretório de outra máquina é preservado e recusado.

Dados continuam fora da pasta de instalação. NSIS não remove AppData ao desinstalar.
PostgreSQL privado pode continuar ativo após fechar o app; depois de reboot será
iniciado ao abrir pelo atalho. Não há serviço ou inicialização permanente no logon.
Portas exclusivamente loopback: PostgreSQL 55436 e API 18087; não usa a produção 8080.

Nova tela de preparação usa sandbox, isolamento de contexto, CSP, preload com duas
ações específicas e validação de remetente/frame/URL de IPC. A interface oficial
continua sem Node e sem acesso privilegiado. Isso não homologa autorização offline
empresarial/revogação nem segurança para dados reais.

## Backup

Menu Laboratório permite escolher destino externo posteriormente, criar backup e
validar restauração em banco novo isolado. A cópia criptografada é comparada por
SHA-256 e uma falha externa mantém a cópia local. Destino não é presumido/configurado
para o usuário pelos testes. Retenção local/agendamento existentes preservados;
agendamento somente enquanto o app está aberto, sem remoção automática de cópias
externas. Recuperação da chave DPAPI em outro Windows permanece bloqueada.
Nunca é declarado `externalProtected=true` somente por copiar o arquivo.

## Validação e alcance

Os testes usam dados fictícios e bancos marcados. A preparação nova foi exercitada
em outro diretório de perfil **no mesmo Windows**, com banco PostgreSQL real,
reinício do processo e simulação de contrato anterior, preservando cadastro/fila.
Esse perfil não representa outra máquina nem outro usuário de segurança do Windows.

Instalação NSIS na pasta `artifacts/windows-installation-g-0.5.0`, atualização,
desinstalação e reinstalação foram exercitadas no mesmo host. SHA-256 do ASAR
instalado coincide com o pacote final. Atalhos da área de trabalho e menu Iniciar
foram lidos/verificados. Snapshots de banco, incluindo histórico RH e fila, foram
comparados antes/depois de instalar/desinstalar/reinstalar. Os testes dos formulários
acrescentam fixtures próprias entre essas comparações, sem apagar dados anteriores.

O binário instalado abriu os formulários F e Produção/Financeiro, iniciou seu
PostgreSQL/API após parada exclusiva do laboratório e manteve renderer sem Node.
A verificação do artefato confirmou arquivos de setup/SQL/módulos, ausência de
arquivos `.env`/DPAPI/backups e ausência de endpoint Supabase no frontend compilado.
Isso é inspeção de empacotamento, não uma auditoria completa de segurança.

| Verificação | Resultado |
|---|---|
| Preparação em perfil sintético novo / atualização de contrato | Aprovada, mesmo Windows |
| Binário empacotado/instalado: RH e Produção/Financeiro | Aprovados com API própria e sandbox |
| NSIS, atalhos, update, remoção e reinstalação | Aprovados em diretório de laboratório no mesmo Windows |
| Backup configurável, hash, falha externa e restore isolado | Aprovados no laboratório |
| Domínio Produção/Financeiro | 17 cenários de regressão |
| Pagamentos em lote no backend | 7 cenários de regressão |
| RH F | 12 cenários de regressão, sem reimplementar o módulo |
| Ponte D1/C2 | 17 cenários de regressão, somente central sintética |
| Guarda de lote legado / indicador / criptografia / aliases / retry | Suítes específicas de laboratório |
| Lint dos arquivos alterados | Aprovado |
| Lint geral | Reprova somente no parsing herdado de `scripts/security/test-emergency-fix.mjs:41`, preservado |
| Builds oficial/D1 e NSIS | Aprovados, sem publicação operacional |
| Typecheck | 485 diagnósticos preexistentes, zero novos, exit 2 mantido |
| Outro computador/VM Windows | **Não realizado** |
| Reboot do Windows | **Não realizado**, para preservar o host operacional |
| Primeira tela de preparação em outro Windows/Windows limpo | **Pendente de aceite manual** |

Evidências e hashes finais: `evidencias-etapa-g-windows.json`.
Logs completos em `logs/`, ignorados pelo Git. Roteiro:
[outro Windows](etapa-g-roteiro-outro-windows.md); ficha:
[aceite independente](etapa-g-ficha-homologacao.md), entregue pendente.

## Matriz e limite dos lotes

Setores/Funções e os contratos F estão locais; Colaboradores, Estoque, Produção e
Financeiro têm os fluxos portados já testados, mas continuam parcialmente offline
como módulos completos. Fotos/anexos privados, estornos, conciliação global e
demais rotinas de RH não são liberados por empacotar a aplicação.

A inspeção confirmou que a interface de múltiplos pagamentos continua bloqueada
e que o lote legado de vales/adiantamentos ainda usava chamadas separadas. O build
D1 agora injeta uma guarda nesse caminho antes de qualquer escrita. A fonte
operacional não foi modificada; o build falha se o ponto de guarda mudar. Lotes
pela tela são classificados como indisponíveis, apesar do backend agregado testado.
Não se apresenta teste da API como homologação desse formulário.

## Bloqueios de uso diário

Outro Windows/Windows limpo, reboot, atualização interrompida, assinatura,
autorização offline empresarial, recuperação independente da chave, anexos,
resolução assistida de conflitos, módulos incompletos e gates gerais de qualidade.
RLS/grants/Auth/Storage do Supabase ainda precisam de aprovação própria.
A fila D1/C2 é preservada, sem provisionar central/token na instalação e sem
ativar sincronização operacional. A nuvem continua dependente de confirmações
verificáveis; gravação local não representa confirmação remota.

A produção 8080 foi preservada, saudável na release
`20261015T155237724Z-d597121d`. Nenhum dado operacional foi alterado e nenhum
serviço permanente foi instalado. O pacote continua **exclusivo de homologação**.
