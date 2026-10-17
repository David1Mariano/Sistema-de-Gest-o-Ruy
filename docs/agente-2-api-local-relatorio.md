# Agente 2 — recuperação e barreiras de segurança

Data: 08/10/2026 (America/Sao_Paulo).

## A. Identificação

- Worktree: `C:\Users\Pichau\gestao-ruy-agente-2`.
- Branch: `agente-2`.
- HEAD inicial e final: `fdcad742ad0b2345ed3ecd9aac5b9a5bce9c8318`.
- Nenhum commit, push, troca de branch ou integração.
- Status final esperado (este relatório incluído):

```text
 M src/api/base44Client.js
 M src/pages/Compras.jsx
 M src/pages/Financeiro.jsx
?? docs/agente-2-api-local-relatorio.md
?? scripts/test-local-api.mjs
?? src/lib/backendSelection.mjs
?? src/lib/localApiAuth.js
?? src/lib/localApiClient.js
?? src/lib/localHttpTransport.mjs
?? src/lib/localPgDb.js
```

## B. Recuperação

README lido antes de alterações. Os seis arquivos citados pelo usuário existiam: três modificados e três não rastreados. Não havia testes específicos do cliente HTTP local. `server/local/`, `authMode.mjs`, `localSession.mjs` e `LocalSessionHome.jsx` não foram encontrados neste worktree. Nenhum outro worktree foi lido ou copiado.

Falhas comprovadas: seleção por sessão, fallback síncrono para IndexedDB, `transact()` com até seis envios e reexecução do callback após 409, cliente de entidade assíncrono incompatível com chamadas síncronas das páginas, ausência de Purchase/PurchaseItem na fachada, origem padrão loopback inadequada aos demais computadores, logout sem verificação de sucesso, inspeção inútil do cookie de sessão HttpOnly e ausência de timeout.

As alterações anteriores de Compras/Financeiro (erros de upload) foram preservadas sem novas edições. PGlite foi preservado sem alteração. Não houve abertura de arquivos de segredos, exportação, importação ou acesso a bancos de navegadores.

## C. Implementação

Arquivos editados nesta execução: `src/api/base44Client.js`, `src/lib/localApiAuth.js`, `src/lib/localApiClient.js`. Arquivos adicionados: `src/lib/backendSelection.mjs`, `src/lib/localHttpTransport.mjs`, `scripts/test-local-api.mjs` e este relatório.

- A fachada resolve o backend pela escolha explícita existente `gr_data_backend`: `local-api` (LOCAL) ou `supabase` (NUVEM). Sessão não participa dessa decisão. Valores antigos `auto`, `indexeddb`, `pglite` e ausência de escolha causam `MODE_REQUIRED`, sem apagar dados ou converter preferências silenciosamente.
- `setDataBackend()` aceita apenas os dois modos e recarrega a página para descartar identidades/caches capturados. Nenhuma expiração ou erro altera a preferência.
- Fachadas estáveis de entidades consultam o modo em cada chamada, incluindo referências capturadas durante importação de módulos.
- A fábrica de entidades locais retorna objeto síncrono, com métodos compatíveis. Purchase/PurchaseItem estão preservados.
- `transact()` local não reexecuta callbacks nem envia CRUD: bloqueia por ausência de comando transacional comprovado. As demais operações de dados e uploads locais também bloqueiam antes de qualquer envio. Lotes vazios não simulam sucesso e exclusões não silenciam erros.
- A origem provisória utiliza a origem da página ou configuração explícita; o padrão de loopback foi removido. Endereçamento real, CORS e cookies dependem de B/C1.
- O transporte genérico implementa AbortController, timeout incluindo leitura do corpo, erro antes do envio, HTTP 401/403/409/402/5xx, resposta inválida e resultado desconhecido de escrita. Não há retry automático.

**Contratos verificados:** interfaces frontend e uso dos métodos nas páginas/serviços existentes. **Nenhum contrato HTTP B/C1 foi comprovado.** Os formatos e endpoints recuperados permanecem provisórios atrás de bloqueios incondicionais. Não remover os bloqueios simplesmente configurando uma URL.

`backendSelection.mjs` é uma barreira provisória sobre a preferência já existente, não a implementação final de `authMode.mjs` de C1. O seletor visual não foi inventado: sua integração está bloqueada pela dependência C1.

## D. Segurança

- Seleção: nenhuma chamada pela fachada LOCAL migra para NUVEM ou IndexedDB; HTTP 402 da nuvem não modifica o modo.
- Sessões: login/logout/me locais bloqueados antes do envio. Não se simula logout concluído. Não há identidade local autenticada nem armazenamento de senha/token/segredo em localStorage. Não se lê o cookie de sessão HttpOnly.
- CSRF: transporte genérico exige token antes de escritas e envia `credentials: include`. Cookie/header relatados ainda não são contrato validado. SameSite, CORS, troca real de usuário e rotação de CSRF não foram testados contra B/C1.
- Idempotência: transporte mantém vínculo em memória entre identificador e destino/método/bytes do corpo, recusando conteúdo diferente antes do envio. Identificador acompanha erros. Isso é uma proteção de frontend, não substitui o ledger persistente do servidor e não sobrevive a recarga.
- Reenvio idêntico foi testado somente no transporte genérico: não há autorização para repetir uma operação empresarial no servidor desconhecido. Reconciliação de resultado desconhecido continua bloqueada.
- Conflitos: preserva status e código recebido; códigos sintéticos `VERSION_CONFLICT` e `IDEMPOTENCY_COLLISION` dos testes NÃO definem os códigos reais de B.
- Operações financeiras/estoque/produção: não há envio local, duplicação por retry ou sequência parcial local.
- **Limite de isolamento:** `AuthContext.jsx`, Login e caminhos diretos de anexos/delivery continuam vinculados ao Supabase. Não foram modificados para concorrer com C1 nem para assumir trabalho de outros agentes. Portanto não se comprova isolamento global da aplicação no modo LOCAL; somente a fachada de dados foi protegida. O modo LOCAL não deve ser habilitado para operação empresarial.

## E. Testes executados

| Comando/suíte | Aprovados | Reprovados | Natureza |
| --- | ---: | ---: | --- |
| `node --test scripts/test-local-api.mjs` | 46 | 0 | 43 testes unitários/fronteiras e 3 HTTP reais em servidor sintético loopback |
| `node scripts/test-daily-expenses.mjs` | 77 | 0 | Regressão com fixtures/mocks |
| `npm.cmd run test:stock` | 121 | 0 | Serviço real contra harness em memória |
| `npm.cmd run check:stock` | 19 | 0 | Autotestes e inspeção estática de integridade |
| `npm.cmd run test:delivery` | 66 | 0 | Mocks e PGlite descartável em memória |
| `node scripts/test-stock-item-delete.mjs` | 28 | 0 | Regressão de exclusão e vínculos |
| `node scripts/test-production.mjs` | 5 | 0 | Servidor e arquivos sintéticos em diretório temporário |
| `node scripts/test-payment-proof.mjs` | 13 | 0 | Fixtures e HTTP sintético |
| `node scripts/test-payable-attachment.mjs` | 8 | 0 | Fixtures/adaptadores |
| `npm.cmd run lint` | passou | 0 | Configuração existente |
| `npm.cmd run build` | passou | 0 | Vite; sem publicação |
| `git diff --check` | passou | 0 | Aviso de conversão LF/CRLF, sem erro |

Lint e build foram repetidos após ajustes no código de runtime. Depois foram adicionados apenas três testes HTTP isolados e documentação; a suíte local final passou com 46 testes.

O lint do projeto exclui `src/lib` e não cobre o cliente HTTP/fachada; não confundir lint verde com auditoria desses arquivos. Testes executam os módulos reais por imports de teste, substituindo dependências externas, sem apresentar mocks de endpoints como especificação comprovada.

Build emitiu avisos de Browserslist desatualizado, chunk acima de 500 kB e importação dinâmica/estática do mesmo módulo. As suítes de despesas/anexos emitiram ruído de dep-scan do Vite apesar de exit 0; o build final passou. Não foram feitas alterações fora do escopo para silenciar avisos.

Os testes antigos de delivery usam `new PGlite()` em memória e SQL de fixtures; NÃO comprovam PostgreSQL central, não alteram Supabase e não mudam o backend do navegador. Testes de produção usam diretórios temporários, não a produção ADM-RUY.

### Cobertura dos 22 requisitos

| Requisito | Evidência/limite |
| --- | --- |
| 1–2: LOCAL/NUVEM explícitos | Resolver e fachada testados; seletor visual C1 bloqueado |
| 3: sessão expirada | HTTP 401 não altera seleção; sessão real C1 bloqueada |
| 4–5: conexão/indisponibilidade | Unitários e HTTP loopback; sem fallback |
| 6–7: 402/sem fallback | Fachada alterna explicitamente, 402 não muda preferência |
| 8–11: 401/403/409/versão | Status e códigos preservados no transporte; servidor B não validado |
| 12: reutilização de ID | Mesmo ID com corpo/destino diferente bloqueado antes do envio |
| 13–14: resposta perdida/timeout | HTTP real sintético e mocks; resultado desconhecido; uma tentativa |
| 15: logout | Bloqueio real antes do envio; logout servidor não executado |
| 16: CSRF | Token obrigatório e header/cookies de fetch testados; browser/B/C1 bloqueados |
| 17: usuários | Adapters separados sem identidade compartilhada; troca real de usuários bloqueada |
| 18–19: financeiro/estoque | Callback e escrituras locais bloqueados; sem duplicação |
| 20: IndexedDB | Fachada não abre/apaga banco; armadilhas no teste; bases reais nunca acessadas |
| 21: interfaces | Fábrica síncrona e dez métodos, Purchase/PurchaseItem preservados |
| 22: operação não suportada | Erro 501/LOCAL_CONTRACT_UNAVAILABLE/not_sent, sem simular sucesso |

**Não executados:** integração API Node/PostgreSQL B, autenticação C1 real, cookies HttpOnly/SameSite/CORS em navegador, permissões reais, reconciliação durável/idempotência servidor, transações empresariais locais, homologação visual do fluxo de modos. Motivo: arquivos/contratos e ambiente isolado correspondentes indisponíveis. Não houve teste contra dados empresariais.

## F. Pendências e coordenação

- Agentes 1/5: disponibilizar por coordenação autorizada os contratos/código B/C1; não copiar ou integrar worktrees automaticamente.
- Confirmar métodos, rotas, envelopes, filtros/ordenação/paginação, registro/versionamento, IDs, nomes das entidades, retornos de confirmação e erros. Atualmente todos os endpoints relatados permanecem não comprovados, inclusive dependências/auditoria de colaborador.
- Confirmar login/logout/me, escolha de modo, identidade, retorno do login, CSRF, cookies, CORS e permissões. Integrar a fachada ao `authMode.mjs` real e retirar a barreira provisória somente após revisão.
- Agentes 3/5: fornecer comandos atômicos de pagamentos/despesas/estoque/produção/compras com ledger de idempotência e consulta segura de resultado. Não há endpoint transacional confirmado neste worktree.
- Agente 4: integrar anexos/comprovantes e recuperação sem caminhos diretos de nuvem no modo LOCAL.
- Integrar UI de escolha e AuthContext com C1; auditar chamadas diretas Supabase em todos os módulos. Preservar sessões e fluxos NUVEM, validar troca de usuário e descarte de caches.

## G. Riscos antes de integração à main

Sem escolha explícita, chamadas de dados agora falham com MODE_REQUIRED. Isso é proposital para impedir gravação em banco errado, mas impede usar este patch isoladamente como release. LOCAL está integralmente bloqueado na fachada; não é integração operacional.

O código recuperado ainda contém formatos provisórios atrás de bloqueios. Remover um bloqueio sem substituir esses formatos pelos contratos reais reintroduz os riscos de versão, confirmação e autenticação. O transporte não realiza reconciliação e sua proteção de ID só existe no processo atual. O servidor precisa garantir idempotência persistente, transações e autorização.

As regressões aprovadas usam interfaces isoladas e não homologam o login/modos da aplicação completa. Requerem revisão e testes integrados após disponibilização de B/C1. Não integrar à main nem publicar esta entrega como sistema funcional local.

## H. Conclusão e retomada

**Concluído:** recuperação; remoção do fallback da fachada; escolha independente da sessão; interface síncrona; entidades preservadas; remoção do retry de transact; bloqueios antes de operações não comprovadas; transporte HTTP testado; regressões, lint e build.

**Parcial:** seleção LOCAL/NUVEM (sem UI C1), tratamento HTTP (transporte validado, API real bloqueada), autenticação (barreiras, não integração) e idempotência (proteção em memória, sem contrato/ledger confirmado).

**BLOQUEADO:** autenticação C1, uso efetivo do PostgreSQL central, comandos transacionais, contratos HTTP, reconciliação, isolamento global de nuvem e homologação de navegador. A fase não satisfaz todos os critérios de aceitação.

Pronto para revisão das barreiras e testes; **não pronto para integração funcional nem produção**. Último bloco concluído: testes locais 46/46, regressões aprovadas, lint/build finais aprovados e relatório salvo. Nenhum dado real alterado; nenhuma migration em banco real, deploy, commit ou push. Aguardar autorização para a próxima etapa de coordenação.
