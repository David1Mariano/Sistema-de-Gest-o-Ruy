# Etapa H — autonomia local da família 0.5.0

16/10/2026, branch `preparacao/windows-oficial-20261015`, HEAD preservado `8da0eb0`.
Alterações herdadas F/G e arquivos não rastreados preservados. Sem dados reais,
Supabase, serviços permanentes, commit, push ou deploy.

## Identificação e grau de independência

O instalador G original permanece intacto, SHA-256
`8e5d24d7b7319fad0705141fd9d40c0201c427fc04d70f72ea2d401979e32e2d`.
As correções H são entregues separadamente em
`artifacts/windows-lab-0.5.0-h1/Sistema-Gestao-Ruy-Lab-0.5.0-H1-Setup.exe`.
Versão 0.5.0, revisão de pacote H1, appId `br.ruy.gestao.laboratorio.h`, atalhos
“Sistema de Gestão Ruy — Homologação H”. Não confundir o pacote G preservado com H1.
Instalador H1: 111.877.285 bytes, SHA-256
`4e65feaa43612911494863f1f6689dc868960e1c86fdc8b6f73029ece9937c91`.

Autonomia **local de laboratório**, com Electron/Node/pg empacotados e PostgreSQL
17 x64 separado. Não precisa de checkout, npm/Git, hostname ADM-RUY ou autenticação
Supabase para os contratos portados. Dados/credenciais ficam no LocalAppData do
usuário, com marcador da máquina e identidade própria. Não exige serviço permanente.
O instalador experimental não possui assinatura digital de publicação.

Isso não comprova independência operacional completa: Windows limpo/10/11 em outro
host, reboot real, destino físico externo, autorização empresarial offline,
recuperação operacional e módulos não portados continuam pendentes.

## Problemas encontrados e correções

1. **Falso verde da central sintética.** O indicador só admite confirmação operacional
   quando o modo e a autorização operacional estão explicitamente habilitados, além
   dos recibos/cursor/pull e ausência de pendências/falhas. O backend desta versão
   continua `operationalSyncEnabled=false`, portanto não mostra verde, inclusive
   após ACKs da central D1/C2. Testes da ponte foram atualizados para essa regra.
2. **API encerrada exigia reabrir o app.** Supervisor recupera serviços privados,
   serializa tentativas e para após três falhas. Serviço inesperado não é encerrado
   nem tratado como API válida. Há tentativa manual no menu após esgotamento.
3. **Limite curto do PostgreSQL após crash.** O ensaio brusco revelou sincronização
   do diretório de dados levando cerca de 75 segundos, excedendo os 30 segundos
   anteriores. Partida agora é assíncrona, com espera limitada de até 180 segundos
   por fase e verificação de prontidão; não dispara outra partida enquanto espera.
   `fsync` e commits duráveis foram mantidos. Não houve limpeza de banco para acelerar.
4. **Única recuperação da chave via DPAPI.** Exportação opcional `.ruykey`, com
   AES-256-GCM e scrypt de parâmetros fixos, protegida por frase não persistida.
   A restauração pode usar backup/chave de outra identidade, exclusivamente em banco
   novo isolado, sem trocar credenciais/chave atual nem ativar fila/dispositivo.
5. **Retenção externa ausente.** Cópias H usam subpasta por identidade. A rotação só
   remove arquivos excedentes que autenticam com a chave e pertencem à mesma origem.
   Cópias estranhas/corrompidas e arquivos G fora dessa pasta não são descartados.

Menus de chave/restore usam janela isolada com CSP, sandbox e validação de remetente,
frame e URL de IPC. Nenhuma chave PostgreSQL ou de backup é entregue ao frontend.
Interface oficial e contratos RH F foram preservados, sem alterações em `src/`.

Arquivos desta etapa: `desktop/main.mjs`, `supervisor.mjs`, `autonomy-smoke.mjs`,
`lab-menu.mjs`, `recovery.mjs`, `recovery.html`, `recovery-preload.cjs`,
`recovery-renderer.js` e `electron-builder-h.cjs`; `server/d1-lab/bootstrap.mjs`,
`backup.mjs`, `key-envelope.mjs`; `lab/d1/sync-state.mjs`; `eslint.config.js`;
testes `scripts/d1-lab/test-h-{artifact,installed,recovery,units}.mjs` e ajustes
de expectativas nos testes de sincronização/ciclo Windows; documentação README/H.
Os demais arquivos F/G e de segurança herdados não representam novas entregas H.

## Ensaios e evidências

Evidências finais em `evidencias-etapa-h-windows.json`. Os ensaios de escrita usam
PostgreSQL real sintético e APIs de laboratório; nenhum banco existente é apagado.

- Chave: frase correta, frase incorreta, corrupção, parâmetros fixos e limites.
- Restore com origem/destino de UUIDs diferentes, em perfis diferentes no mesmo
  Windows: fila, anexo e 12 tabelas verificados, chave DPAPI de destino inalterada.
  Frase incorreta recusada antes de criar banco; ativação/sincronização bloqueadas.
- Retenção externa: três cópias sintéticas, retenção dois, uma antiga autenticada
  removida; destino físico independente não testado nem configurado para o usuário.
- Supervisor: recuperação serializada, limite de tentativas e bloqueio de serviço
  inesperado. O primeiro ensaio integrado encontrou o timeout descrito acima;
  não foi declarado aprovado e motivou a correção e nova validação.
- Instalação H isolada, abertura via atalho usando Shell do Windows e instrumentação
  de ensaio. Não se declara clique físico ou paridade visual completa a partir disso.
- Falhas de internet são simuladas por bloqueio de rede do processo/renderer;
  a conexão física do computador operacional não é desligada.
- O teste de instalação também detectou que o NSIS termina a remoção em processo
  temporário após o primeiro processo sair. O observador agora aguarda até 120
  segundos e exige remoção real do ASAR; não basta código de saída zero.
- Uma comparação de preservação foi invalidada por execução concorrente de uma
  regressão sintética. Essa tentativa não conta como aprovação; o resultado final
  exige nova execução sem testes concorrentes. Logs intermediários foram mantidos.

Resultados finais e hashes devem ser consultados no JSON de evidências. Logs
detalhados, inclusive dos ensaios intermediários, ficam em `logs/`, ignorados pelo Git.

| Verificação | Resultado |
|---|---|
| Domínio: estoque, produção, financeiro e atomicidade | 17/17 |
| Pagamentos em lote: API transacional e duplicidade | 7/7 |
| Vales/consumo: autorização, histórico, persistência e restore | 12/12 |
| Ponte sintética D1/C2: idempotência, conflitos, crash e RH | 17/17 |
| Ciclo Windows, backup, supervisor, criptografia e clientes | 16/16 |
| Chave portátil/restore entre perfis sintéticos | Aprovado, 12 tabelas, fila e anexo |
| Auditoria do pacote H1 | Aprovada |
| Builds oficial/D1 e empacotamento NSIS H1 | Aprovados |
| Lint dos arquivos H | Aprovado |
| Lint geral | Bloqueio herdado de parsing no script de segurança |
| Typecheck | 485 diagnósticos herdados, zero novos |
| Instalação/atalho/crash/desinstalação/reinstalação H | Aprovados no mesmo Windows, pasta isolada |
| Outro Windows, reboot real e disco físico externo | Pendentes |

O ciclo final sem concorrência validou os formulários oficiais de vale/consumo,
edição, cancelamento, histórico, filtros e vínculo de desconto. API própria e
PostgreSQL iniciaram pelo atalho; após falhas bruscas o mesmo usuário entrou
offline e encontrou o registro na versão 2. As duas operações mantiveram hash
`2b90819b15102a4ad46b70dd704a08d4752c9b1c1d75f58993a3515da42e1298`.
Após desinstalação/reinstalação, o snapshot de dados permaneceu
`52011829ccd4e569f207c96215fb287895415e758eb058494d7c3d6851836bfa`.
O backup final está `local-only`, com 1.332 operações sintéticas pendentes e
destino externo não configurado. Não há confirmação remota operacional.

## Dependências e pendências

PostgreSQL 17 x64 completo e runtimes da distribuição, Windows x64 compatível,
PowerShell/DPAPI e permissões locais de usuário. Diretórios existentes de outra
máquina não são clonados: validar transferência usando chave/restore isolado.

Nenhum segundo Windows foi disponibilizado; nenhuma reinicialização do Windows foi
executada neste host operacional. Procedimento reproduzível e ficha pendente em
[homologação independente](etapa-h-homologacao-independente.md).

Setores/Funções e contratos portados de Colaboradores, Estoque, Produção, Financeiro,
Vales/Consumo continuam locais. Os módulos como um todo ainda são parciais; lotes
pela tela, anexos privados integrados, estornos, conciliação global e resolução
assistida de conflitos permanecem limitados/bloqueados. RLS/grants/Auth/Storage
operacionais não foram alterados. Login local sintético não equivale à autorização
empresarial offline completa, com expiração/revogação homologadas.

Destino externo real ainda depende de escolha/custódia. Restore entre perfis no
mesmo Windows não substitui restauração em outro Windows ou perda física de disco.
Não se declara proteção de dados reais: `externalProtected` permanece falso.
Backup agendado continua restrito ao período em que o app está aberto.
O backend de chave/backup/restore foi exercitado de ponta a ponta; a interação
manual dos novos diálogos nativos e o fechamento/reabertura com login pela pessoa
no computador de destino ainda fazem parte da ficha de aceite. A comparação de
snapshots após fechar/desinstalar/reinstalar não substitui esse aceite visual.

Lint dos arquivos alterados e builds são exigidos. Lint geral mantém o erro herdado
em `scripts/security/test-emergency-fix.mjs:41`; typecheck mantém 485 diagnósticos
preexistentes, sem novos. Nenhuma verificação foi desabilitada.

Produção 8080 preservada na release `20261015T155237724Z-d597121d`, com manifesto
`a82921aa86895848c34dadd9d22d0ad0c329e295a81b5d9b28e3822fd3846ddc`.
O aplicativo continua exclusivo de laboratório, sem liberação para uso diário.
