# Etapa H2 — homologação independente preparada

16/10/2026. **Aprovada a revalidação local de laboratório; independência real em
outro Windows, reboot real e backup físico externo continuam pendentes.** Nenhum
acesso a segundo Windows ou destino externo foi fornecido nesta execução.

## Preservação e instalador

Pasta `C:\Users\Pichau\gestao-ruy-windows-oficial-20261015`, branch
`preparacao/windows-oficial-20261015`, HEAD
`8da0eb03faf8460a9a1899eb9bc4c5a468d3afcf`. Os 515 arquivos herdados rastreados e
não ignorados foram comparados por hash antes/depois: nenhum mudou. Alterações
H1/F/G e arquivos de segurança foram preservados, incluindo todo `src/`.

Não houve recompilação ou nova versão do aplicativo. O instalador **0.5.0 H1**
original, 111.877.285 bytes, continua com SHA-256
`4e65feaa43612911494863f1f6689dc868960e1c86fdc8b6f73029ece9937c91`.
Instaladores anteriores não foram sobrescritos. O instalador não é assinado.

Pacote transportável:
`artifacts/windows-h2-homologacao-2026-10-16T08-46-16-806Z.zip`.
SHA-256: `b5bdc8f35d0e13de4d40915e461e25af36aaab0bfe858b6a30790a71428e9a13`.
Arquivo lateral `.zip.sha256.txt` disponível. O ZIP contém exatamente sete arquivos:
instalador H1, roteiro, ficha inicial pendente, três scripts PowerShell e manifesto
de hashes. Nenhum banco, backup, chave, `.env`, `.dpapi`, runtime de desenvolvimento
ou credencial foi incluído. O conteúdo extraído foi testado sem checkout/npm/Git.

## Resultados H2

| Teste executado nesta etapa | Resultado |
|---|---|
| H1 real: instalação isolada, atalho Windows, API/PostgreSQL próprios | Aprovado no mesmo Windows |
| Login offline, criar/consultar/editar, queda da API e PostgreSQL | Aprovado com bloqueio de rede do renderer |
| Fila/versões/idempotência após falhas e encerramento | Aprovado; duas operações conservadas |
| Desinstalação/reinstalação e snapshot dos dados | Aprovado sem testes concorrentes |
| Formulários RH oficiais, histórico, desconto, cancelamento e filtros | Aprovados no H1 instalado |
| Ciclo Windows, criptografia, supervisor, clientes e backups | 16/16 |
| Domínio Estoque/Produção/Financeiro e restore | 17/17 |
| Vales/Consumo, permissões, persistência e restore | 12/12 |
| Pacote, extração ZIP, adulteração, hashes e coleta local | 9/9 |
| Chave portátil e restore entre perfis/identidades sintéticas | Aprovado no mesmo Windows |
| API anônima e origem estrangeira | Recusadas com 401/403 |
| API/PostgreSQL expostos em rede pública | Não; listeners observados somente 127.0.0.1 |
| Parser PowerShell e lint dos novos scripts JS | Aprovados |
| Typecheck comparado linha por linha com H1 | Mesmos 485 diagnósticos, zero novos/removidos |
| Lint geral | Mesmo erro herdado `scripts/security/test-emergency-fix.mjs:41` |
| Builds | H1 existente preservado; não recompilado em H2 |
| Outro Windows/reboot físico/internet desligada fisicamente | Pendentes |
| Interação manual dos diálogos e paridade visual integral | Pendentes na matriz por módulo |

São 54 verificações nas quatro suítes contadas, além dos ensaios de instalação e
recuperação entre perfis. A ponte sintética D1/C2 de 17 cenários permanece evidência
histórica H1; não foi reexecutada como suíte completa H2. Recuperação da fila após
crash e ausência de confirmação operacional foram novamente verificadas no H1.

Evidências: [JSON H2](evidencias-etapa-h2-windows.json). Logs de cada execução em
`logs/etapa-h2/`, sem senhas, frases ou credenciais. Os ensaios de escrita usam
exclusivamente contas e registros sintéticos no PostgreSQL de laboratório.

## Backup e recuperação

Nova origem sintética criada em perfil isolado e restaurada com chave portátil
protegida em banco novo: 12 tabelas, anexo e operação pendente conferidos. Testes
recusaram frase incorreta antes de criar banco, mantiveram DPAPI do destino e
validaram retenção externa de três cópias para duas. A ativação do banco recuperado
e a sincronização permaneceram bloqueadas. Isso ocorreu no **mesmo Windows**.

O coletor classificou a pasta de teste no disco local como `same-disk-rejected`.
A verificação de cópia confere SHA-256 e formato do envelope; não declara que
decriptou ou restaurou. Cópias divergentes, uso do mesmo arquivo como duas cópias
e envelope inválido foram recusados. A decriptação/autenticação real é verificada
pela restauração do aplicativo, não apenas pelo hash ou extensão do arquivo.

Backup final: `local-only`, hash
`e6aa1299826af8c69ec0bd87b1666f11f2081e6bb64e2b175c9daf74fa5abd28`,
2.138.018 bytes e 1.395 operações sintéticas na fila. **Destino externo não
configurado; proteção física não aprovada; `externalProtected=false`.** Não houve
escolha implícita de unidade nem redução de retenção do perfil herdado. Backup
agendado continua apenas enquanto o aplicativo está aberto.

## Dependências e roteiro no outro Windows

Windows 10/11 x64 a homologar, PowerShell/DPAPI, PostgreSQL 17 x64 completo
(`bin/lib/share` e runtimes da distribuição), permissões locais de usuário e
armazenamento com espaço. Electron traz Chromium/Node/pg; não exige instalação
separada de WebView2, npm ou Git. Não há novo serviço permanente ou regra pública
de firewall. Dados por máquina/usuário em `%LOCALAPPDATA%\GestaoRuy\etapa-d1-lab`.

[Roteiro completo](etapa-h2-roteiro.md), também `LEIA-ME-H2.md` no ZIP:

1. Conferir hashes e preparar PostgreSQL; instalar H1 em pasta isolada e abrir pelo
   ícone. Coletar estado antes/depois, conferir 401/403 e listeners de loopback.
2. Criar dados FICTICIO e registrar IDs, versões e pendências. Fechar/reabrir,
   testar login e edição sem internet, conferir histórico e fila.
3. Obter autorização específica para reiniciar **o Windows de destino**. Registrar
   estado antes, reiniciar manualmente, abrir pelo atalho sem internet e conferir
   registros/fila. Comparar fingerprint da máquina e horário do boot nas coletas.
4. Escolher dispositivo físico independente com custódia. Configurar pelo menu,
   exportar chave protegida, comparar hashes e restaurar em ambiente isolado,
   conferindo anexos/fila. Guardar frase fora de logs/fichas/CLI e separada dos
   arquivos. Não ativar a fila restaurada ou substituir banco existente.
5. Testar reinstalação sem apagar AppData e preencher ficha com responsável,
   resultado e evidência de cada item. Enviar somente evidências sintéticas
   revisadas, nunca cluster, credenciais, backup ou chave.

Os scripts só observam e gravam JSONs próprios: não instalam, reiniciam, param
serviços, abrem portas ou modificam credenciais/bancos. Seus resultados mantêm
aceite funcional/manual e proteção externa pendentes. A ficha não pré-aprova itens.

## Módulos, nuvem e bloqueios operacionais

Nenhum módulo novo foi iniciado. Interface/arquivos H1 foram preservados por hash;
formulários RH, Colaboradores e Estoque também foram exercitados no binário, com
regressões de domínio. Isso não comprova comparação visual completa de todas as
telas. A matriz do roteiro delimita contratos locais e operações bloqueadas.

Setores/Funções e contratos portados de Colaboradores, Estoque, Produção,
Financeiro, Vales e Consumo continuam locais. Módulos completos permanecem
parciais: lote legado de vale/adiantamento pela tela, anexos privados integrados,
estornos, conciliação global e resolução assistida de conflitos têm limitações.
Não houve pagamento externo ou movimentação operacional de caixa/estoque.

Supabase operacional continua desativado; RLS/Auth/Storage e bancos reais não
foram alterados. Nuvem não confirma sincronização operacional. Login sintético
local não comprova autorização empresarial offline/revogação global homologadas.
Uso diário permanece bloqueado por esses itens, recuperação operacional,
homologação independente e gates de qualidade existentes. Nenhuma verificação foi
desabilitada para obter aprovação.

Produção **8080 preservada e saudável**, release
`20261015T155237724Z-d597121d`, manifesto
`a82921aa86895848c34dadd9d22d0ad0c329e295a81b5d9b28e3822fd3846ddc`,
iguais antes/depois. Nenhum reboot do ADM-RUY, exclusão de banco existente,
instalação definitiva, deploy, commit, merge, push ou migração de dados reais.

Arquivos novos H2: este relatório, roteiro/JSON H2, `build-h2-package.mjs`,
`test-h2-package.mjs` e `h2/{Verify-Package,Collect-H2,Test-BackupCopy}.ps1`
em `scripts/d1-lab/`. Todos os arquivos herdados permanecem inalterados.
