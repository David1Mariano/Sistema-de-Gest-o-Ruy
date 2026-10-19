# Contratos únicos de integração — Etapa 1

Versão documental `RUY-INTEGRATION-CONTRACTS/1`, 19/10/2026. Base RC3 `db99024`; branch `agente-5-auditoria-integracao-20261019`. Este contrato preserva a autoridade D1/C2/PostgreSQL; não habilita módulos, migra dados ou autoriza rede, providers, produção ou Supabase. Mudanças posteriores neste contrato exigem nova revisão e testes.

## 1. Autoridade e compatibilidade

- O aplicativo Windows continua usando `lab/d1/client.mjs`, seus adaptadores e aliases de `lab/d1/vite.config.mjs`. A fachada web `src/api/base44Client.js` não é substituída pelo backendSelection/localApiClient do Agente 2.
- Registro local, outbox, versão e auditoria são gravados pela transação D1 existente. A central valida o comando e confirma efeitos de negócio antes de emitir recibo. ACK de metadados ou sucesso HTTP isolado não significa sincronização operacional liberada.
- Continuam válidos `D1LAB/1` (envelope), `D1BUS/1` (projeção) e seus checks de identidade/workspace/cursor/hash. `operationalSyncEnabled` permanece false.
- Não copiar schemas genéricos do Agente 4 nem a infraestrutura PostgreSQL experimental do Agente 3. Não criar outro login, banco autoritativo, ledger ou fila paralela.

## 2. Autenticação e sessão — ativo

| Item | Contrato único |
| --- | --- |
| Login | POST `/api/d1/login`, JSON login/password; sem CSRF anterior. Não grava senha/token no browser. |
| Sessão | Cookie `ruy_d1_lab`, HttpOnly, SameSite=Strict, Path=/api/d1, Max-Age=28800. Sessão SQL também expira e pode ser revogada. Não é bearer em sessionStorage. |
| Consulta | GET `/api/d1/me` devolve usuário/papel e CSRF, mantidos em memória; identidade efetiva é sempre revalidada pelo servidor. |
| Logout | POST `/api/d1/logout` com CSRF; só limpar sessão por sucesso ou resposta 401 do servidor. Falha de rede/5xx não comprova logout. |
| Expiração | 401, inclusive com JSON inválido, invalida a sessão D1 em memória e notifica a UI pelo evento `d1-session-expired`. Não troca backend nem abre login cloud. |
| Troca de usuário | O contador de geração e a limpeza de caches D1 existentes impedem aplicação de resposta de outra sessão. Intenção de resultado desconhecido permanece identificável pelo mesmo UUID. |
| Permissão | O frontend não concede acesso. Servidor valida usuário ativo e papel em cada comando. O ensaio desta etapa usa admin/viewer sintéticos; não amplia papéis de negócio. |

O cookie não usa Secure no laboratório HTTP loopback atual. Isso não é uma política aprovada para LAN: transporte entre máquinas depende de HTTPS/mTLS provisionado, topologia e homologação próprias. Credenciais de produção não são aceitas como preparação de laboratório.

## 3. Transporte — ativo, melhoria pontual adaptada do Agente 2

`lab/d1/http-transport.mjs` é chamado pela função request já existente, sem alterar suas rotas ou fachadas. Só aceita caminhos relativos sob `/api/d1`; recusa URL absoluta, escape de diretório, barra invertida, controles e fragmento. Fetch usa same-origin e redirect:error. Escritas são JSON com `X-CSRF-Token`, exceto login. Não há fallback para cloud/IndexedDB/PGlite ou reenvio automático.

O prazo padrão é 30 segundos e cobre fetch **e leitura do JSON**, mesmo quando um mock não respeita AbortSignal. Encerrar a espera não desfaz uma transação que o servidor já possa ter confirmado. Após timeout o operador deve conferir fila/recibo antes de reenviar explicitamente.

| Falha | Resultado da escrita | Comportamento |
| --- | --- | --- |
| Validação/CSRF/prazo inválido antes de fetch | not_sent | Nenhum envio realizado. |
| HTTP 4xx | rejected | Preserva status/code/operationId; 401 invalida sessão. 402 não muda backend. |
| Falha de rede, timeout após fetch, 5xx ou sucesso sem JSON válido | unknown | Não considerar gravado nem desfeito; preservar intenção e UUID existentes. |
| Falha de leitura | not_applicable | Não é confirmação de mutação. |
| Resposta de outra geração de sessão | d1SessionChanged | Recusar resultado; uma escrita pode ter sido confirmada na sessão anterior. |

A classificação conserva o código HTTP efetivamente conhecido, inclusive se a leitura do corpo falhar. O mapa de intenções em memória da proposta A2 não foi importado: a proteção durável continua no cliente D1 e nos recibos/hash do servidor. Mesmo UUID com conteúdo diferente é recusado pelo servidor. Nenhum callback transacional é reexecutado automaticamente.

O adaptador mTLS da ponte mantém seu contrato atual; não foi substituído por este helper de navegador. Certificado, token, deviceId, actorId e workspaceId continuam vinculados e guardados em DPAPI; CA/hostname e TLS 1.3 permanecem verificados. Browser não recebe chave privada nem token da ponte. Nenhum tráfego para provider foi habilitado.

## 4. Anexos — contrato D1 preservado; testes do Agente 4 reaproveitados

- POST `/api/d1/attachments`: ID de anexo e operationId estáveis, registro **já salvo**, entidade permitida e recordVersion atual. Não importar o fluxo de arquivo órfão vinculado a ID reservado antes de salvar.
- Corpo exato: id, operationId, recordId, recordVersion, entity, filename, mediaType, sha256, bytes (base64 canônico). Sem campos extras, caminho físico, URL remota ou credenciais.
- Limite permanece 512 KiB, com nomes FICTICIO e texto sintético no laboratório. JPEG/PNG/WebP/PDF/texto mantêm validação de extensão, assinatura/tipo, tamanho, SHA-256 e autorização. Não ampliar para 15 MiB nesta etapa.
- Envio/busca/listagem/cache usam os endpoints D1 existentes e a identidade da sessão. Recibo valida identidade, vínculo, tamanho e hash. Falha preserva UUID/fila; repetição é resolvida pelos recibos existentes, sem segundo armazenamento.
- Download local permitido no Electron somente em `/api/d1/attachments/:id/download`, mesma origem e sem query/token/fragmento. Sessão e permissão são revalidadas. Tombstone/revogação impedem leitura conforme contrato atual.
- **TTL:** não existe URL pública assinada neste contrato. A autorização expira com a sessão SQL/cookie (8 h) e pode ser revogada antes; o conteúdo não é eliminado ao expirar a sessão. URL assinada de cinco minutos do Agente 4 não é um mecanismo adicional a importar. Hash não substitui autenticação.
- Fila/cache e bytes continuam no PostgreSQL de laboratório e no mecanismo de backup existente. Não instalar `/api/anexos`, `anexosAuth`, `ruy-anexo://`, login/token em sessionStorage ou arquivos/metadados paralelos em disco.

Nesta etapa foram adicionados **testes** das verificações úteis do Agente 4 contra o mecanismo já existente. Não se realizou a Etapa 3 de incorporação de novas regras/fluxos, exclusão de anexos, mudança de armazenamento ou servidor de produção.

## 5. Delivery — modelo canônico definido, implementação reservada à Etapa 4

Delivery permanece ausente das allowlists D1/C2 e recusado pela API/envelope. Não se adiciona rota à UI, seed DEMO, Edge Function, webhook, worker, tabela ou migration nesta etapa. A definição abaixo é o alvo único para futura implementação autorizada; não descreve endpoints já funcionais.

### Identidade e estados

- Pedido próprio: UUID do pedido + operationId criado antes do envio. Importado: identidade única `(provider, merchantId, externalId)` e UUID interno. IDs de itens são estáveis e pertencem ao mesmo agregado.
- Provider canônico: `own`, `ifood`, `99food`, `whatsapp`. `food99` do A1 precisa de conversão explícita para `99food`, sem duplicar canal. Balcão/retirada/consumo local são modalidades do canal próprio, não novos providers.
- Estado de pedido canônico: placed → confirmed → preparing → ready → dispatched → concluded, com cancelamento permitido apenas pelas regras transacionais do servidor. Retirada/consumo local não exigem dispatched. Estado recebido do A1 não comprova pagamento: situação financeira permanece separada.
- Nenhum estado de provider é convertido cegamente. Eventos desconhecidos são retidos para revisão, sem avançar pedido, estoque ou financeiro.

### Operações e atomicidade

O futuro adaptador deve usar o padrão `/api/d1/domain/command`: operationId, entity, id, baseVersion, action e data. `DeliveryOrder` continuará recusado até a implementação completa. A criação futura deve enviar pedido e itens juntos em **um** comando, sem Order.create + Item.bulkCreate + Audit.create separados. Ações de transição/cancelamento serão incluídas somente na Etapa 4 e não constituem autorização de uso agora.

Uma transação deve validar autorização, escopo de loja/workspace, UUID/hash, versão, itens, dinheiro e transição, e gravar pedido, itens, outbox, auditoria e resultado idempotente. Qualquer falha reverte o conjunto. Mesmo UUID/intenção retorna resultado original; UUID com conteúdo diferente ou versão antiga falha. Duplo clique, resposta perdida e consulta/reenvio explícito devem usar os recibos existentes, sem criar um segundo ledger.

Dinheiro: BRL em centavos inteiros seguros; quantidade em milésimos inteiros positivos. Total da linha é quantidadeMilli × unitCents / 1000 com arredondamento half-up por linha, calculado por aritmética inteira; bruto é soma das linhas. Desconto/taxas/entrega devem ser explícitos, não negativos e limitados pelo comando. Taxas hardcoded de demonstração (como 27%) não são valor oficial do provider nem entrada automática no caixa.

Pedido/faturamento/recebível/liquidação são conceitos separados. `DeliverySettlement` já existente é agregado financeiro, não outra tabela de pedidos. Confirmação de pedido não movimenta dinheiro ou estoque implicitamente. Qualquer efeito composto futuro precisa do comando D1 autorizado correspondente, com deduplicação por obrigação; não contabilizar resumo A1 e A2 duas vezes.

Autorização inicial conservadora: admin ativo no workspace de laboratório, validado no servidor. Papéis de atendimento/cozinha e dados de clientes por loja dependem de contrato adicional antes de habilitar telas. Provider, mensagens, IA e catálogos externos exigem autorização própria; Supabase operacional permanece fora desta integração.

## 6. Compatibilidade, limites e próximos gates

Os testes desta etapa verificam a API D1 real em banco sintético novo da cópia descartável 55437, transporte HTTP loopback e TLS sintético, além das regressões existentes. Não há migrations no 55436, nem conexão SQL ao 55435 nos testes novos. Provisionamento de fixtures lê configurações seladas de laboratório sem imprimir seus valores; não usa credenciais operacionais.

Os checklists de concorrência/rollback A3 permanecem como referência; nenhum hunk de estoque/produção, manifesto de produção ou infra PG experimental foi integrado. Todas as alterações WIP da Etapa A permanecem fora desta branch. Não se executa teste/probe desse WIP nem se anuncia o estorno RH como concluído.

Pendentes: autorização da Etapa 2; etapas 3/4 de integração efetiva; Delivery real atômico; aceites por papel/loja; dois Windows/VM limpa; reconexão física; instalação e restauração independentes; aceite final de permissões/certificados e liberação operacional. Os testes de backend desta etapa não equivalem a nova homologação visual Windows ou a novo instalador. O instalador RC3 anterior não contém estas alterações de transporte.
