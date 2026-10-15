# Ciclo de desenvolvimento Windows offline-first — 15/10/2026

**Entrega experimental, não liberação operacional do aplicativo completo.**
Branch preservada: `preparacao/windows-oficial-20261015`.
HEAD preservado: `9d7e59ea59239f1ab25c0abbc346420d83e3783d`.
Não houve commit, merge, push, deploy ou modificação do Supabase original.

## Base e preservação

Confirmados antes do desenvolvimento: 8080 HTTP 200, release
`20261015T155237724Z-d597121d`, D1 em 18087/55436, C1 em 18083 e central C2
em 18086. Hash SHA-256 inicial do manifesto operacional:
`a82921aa86895848c34dadd9d22d0ad0c329e295a81b5d9b28e3822fd3846ddc`.
Verificação final e evidências de pacote em `evidencias-ciclo-windows-20261015.json`.

Todos os arquivos `src/` e as dependências da aplicação oficial permanecem
intactos. Alterações locais anteriores de .gitignore/ESLint, documentos, laboratório
D1/D1.1 e scripts não rastreados foram preservados. Novas alterações foram feitas
nesses componentes isolados, não na release, no runtime 8080 ou em outros worktrees.
O aceite D1.1 no navegador informado pelo proprietário é mantido como evidência;
não substitui o novo aceite do instalador e dos módulos posteriores.

## Funcionalidades e estado real

| Fase | Implementação neste ciclo | Limite |
|---|---|---|
| A | Revalidação PostgreSQL/API D1, cascata, versões, replay e reinício | Não migrados dados reais |
| B | Electron, janela própria, NSIS por usuário, ícone/atalhos, runtime isolado, bloqueio de navegação, verificação de dependências | PostgreSQL 17/cluster D1 ainda precisam de preparação; não é instalador completo para Windows limpo |
| C | Setores/Funções oficiais; tela oficial de Colaboradores e Configurações com persistência local; contratos de categorias, fornecedores e produtos sem saldo | Ficha completa, fotos, exclusão física, demais rotinas de RH e telas de fornecedores/produtos ainda não integradas |
| D | Motor preparatório de consumo por cotas, produção atômica, versão, idempotência, auditoria e partidas balanceadas em centavos | Somente schemas sintéticos de teste; nenhuma rota/tela crítica habilitada |
| E | Código C2 reaproveitado e testado: A↔central↔B, outbox/inbox, recibos, conflito, lease e retomada | Protocolo demonstrativo genérico; não consome a fila D1 nem Supabase; anexos privados ainda pendentes |
| F | Indicador no Topbar do build isolado, detalhes, polling e backup separado | Verde só com recibos e pull verificados; D1 continua desativado/pending ou unknown |
| G | Dump consistente, AES-GCM, retenção, anexos sintéticos e restore em banco novo; agendamento durante uso do Electron | Destino externo/chave de recuperação entre máquinas e proteção de perda física pendentes |

Escolha técnica: Electron reaproveita Node/pg e React sem adicionar Rust e
WebView2 ao laboratório; custo é pacote/runtime maior e atualizações Chromium.
Tauri 2 permanece alternativa se footprint justificar portar/empacotar o backend.
Referências consultadas: [segurança Electron](https://github.com/electron/electron/blob/main/docs/tutorial/security.md),
[pré-requisitos Tauri](https://v2.tauri.app/start/prerequisites/).

## Correções e contratos importantes

- Hash de replay da renomeação inclui o impacto confirmado. Payload diferente
  com mesmo UUID é rejeitado, inclusive após execução anterior.
- Transporte preserva UUID/envelope em erro de rede, 408, 429 ou 5xx; não transforma
  resposta desconhecida em nova operação. Troca de usuário invalida respostas
  em voo e limpa cache. Payload de colaborador não fica no localStorage: apenas
  metadados e fingerprint; o mesmo formulário precisa ser reconstituído no retry.
- API impõe papel e escopo, não aceita owner/role no formulário, incrementa versão
  e grava cadastro/outbox/auditoria atomicamente. Campos financeiros/saldo não
  entram no contrato de cadastro de produto.
- Colaboradores: escrita/admin local, documentos FICTICIO, data e referências
  validadas; projeção de dados sensíveis aplicada também ao endpoint legado e
  retornos/replays de cascata. Papéis D1 de teste ainda não são o contrato completo
  de autorização offline da empresa nem concessões assinadas com expiração.
- Cada usuário mantém escopo próprio no laboratório. Isso não implementa ainda
  compartilhamento organizacional de cadastros entre usuários/dispositivos.
- O motor crítico nunca declara pagamento externo ou saldo global confirmado.
  Cotas e versões impedem consumo acima da concessão nos cenários testados;
  emissão/distribuição de concessões e reconciliação real ainda precisam projeto.

## Testes

| Verificação | Resultado |
|---|---|
| Lint oficial + novos módulos abrangidos pela configuração | Aprovado |
| Build oficial (dist somente) | Aprovado |
| Build D1 com telas oficiais adicionais | Aprovado |
| Suíte oficial `scripts/test-*.mjs` | 773 aprovados, zero falhas |
| D1 API real | 27 verificações aprovadas |
| D1.1 renomeação | 13 cenários aprovados |
| Edição de setor / feedback | `SECTOR_EDIT_OK` e `SAVE_FEEDBACK_OK` |
| Windows/indicador/criptografia/replay/dump+restore | 5 testes aprovados |
| Catálogos e autorização/dados pessoais/rollback | 1 teste integrado aprovado, múltiplas assertions |
| Transporte 5xx e troca de sessão | 1 teste aprovado |
| Aliases relativos e contexto único offline | 1 teste aprovado |
| Motor crítico PostgreSQL real | 1 teste integrado aprovado, múltiplas assertions |
| C2 A/B/central PostgreSQL e APIs reais | 21 verificações aprovadas |
| Typecheck oficial | Reprovado: 1.442 diagnósticos existentes, `src/` intacto |

Logs em `logs/` ignorados pelo Git. A guarda de rede bloqueou saída externa nos
processos de testes; não houve desligamento da rede física do Windows. Reinícios
foram restritos aos clusters/APIs sintéticos identificados; Windows não reiniciado.
Ensaios de instalador e screenshots constam nas evidências finais, sem alegar
homologação de toda a interface, impressão, downloads ou dois computadores reais.

Instalação experimental NSIS, abertura do executável instalado, desinstalação e
reinstalação na pasta `artifacts/windows-installation-lab`: aprovadas. ASAR instalado
confere por SHA-256 com o build. Identidade, 138 registros sintéticos e 240 pendências
permaneceram iguais durante o ensaio de remoção/reinstalação; testes posteriores
podem acrescentar fixtures. O atalho novo tem sufixo Laboratório; o `.url` original
foi preservado. Nenhum serviço permanente foi instalado.

Smoke Electron empacotado com API própria: aprovado (`apiOwned=true`), login real,
renderer sem Node, indicador pendente e rotas oficiais de Colaboradores e
Configurações abertas. Outra execução aprovou o binário instalado com API existente.
O teste visual encontrou e corrigiu imports relativos que escapavam dos aliases
e recebiam o contexto Auth original vazio; teste de regressão cobre essa resolução.
As capturas de janela oculta mostraram frames atrasados e não foram aceitas como
comparação visual claro/escuro. Esse aceite permanece pendente, sem repetir
capturas indefinidamente ou declarar paridade com base somente em DOM.

Na evolução do backup, o teste detectou falta de privilégios em schemas de motores
de teste e colisão do schema public no destino vazio. Corrigidos escopo do dump e
restauração exclusivamente em banco novo. A suíte correspondente passou depois
das correções; não foram ampliadas permissões do aplicativo para contornar testes.

## Arquivos

- `desktop/`: package/lock próprios, main/service/policy, ícone e README.
- `lab/d1/`: adaptador, entrada, alias Vite, Topbar, SyncStatus, regra de estados e
  stub cloud-disabled. Componentes oficiais continuam em `src/` sem alterações.
- `server/d1-lab/`: catálogo/contratos, backup, motor crítico; ajustes de API,
  projeção de colaboradores e replay em entities.
- `scripts/d1-lab/`: preparação de catálogo, backup e novos testes; ajuste do
  teste de renomeação para verificar a conta admin antes não utilizada.
- `server/local-lab/{core,environment}.mjs`, `server/sync-lab/`, `scripts/sync-lab*`:
  cópia revisada dos núcleos B/C1/C2 existentes na agente-3; sem copiar a antiga
  aplicação simplificada. Novos testes usam os clusters sintéticos já marcados.
- `.gitignore`, `eslint.config.js`, esta documentação e guia de backup.

## Bloqueios e próximo passo operacional

Não ativar sincronização original antes de corrigir e homologar RLS, grants,
autenticação, escopos e Storage com autorização própria. Não embutir service_role
no instalador nem reutilizar tokens estáticos C2 como autenticação definitiva.

Faltam integração da fila D1 ao contrato central por domínio, sincronização de
anexos, políticas de autorização offline/revogação, demais telas/módulos,
paridade visual completa, PostgreSQL provisionado no instalador, assinatura,
Windows limpo/atualizações, duas máquinas físicas e recuperação externa da chave.
O typecheck também precisa de correção antes de um gate operacional completo.

Próximo passo: homologar este instalador **em VM Windows descartável**, completar
provisionamento local e a matriz de telas/cadastros, depois integrar os contratos
centrais sintéticos. Não substituir 8080 nem copiar dados reais para o laboratório.
