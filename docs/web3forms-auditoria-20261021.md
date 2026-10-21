# Web3Forms existente — auditoria de 21/10/2026

**Confirmação real de e-mail: BLOQUEADA. Não aprovada para operação.**
Google Cloud/Gmail OAuth suspenso por instrução do proprietário. Nenhum serviço
foi contratado e nenhuma nova configuração Google foi executada nesta etapa.

## Implementação recuperada

- `src/lib/emailSender.js`, introduzido em `e3b0676` e presente nos checkpoints
  `d0ffbb8` e `220a12c`: envio pelo navegador, chave incorporada no frontend e
  campos `to`/`replyto` tratados incorretamente como escolha de destinatário.
- O `localAuth.js` antigo gerava/validava OTP no navegador e permitia código
  demonstrativo. Esses caminhos não foram restaurados.
- Foram pesquisadas as referências Git locais/remotas após fetch, 31 worktrees
  e scripts em `C:/temp`. Não foi localizado outro adaptador backend Web3Forms
  nessas fontes. Isso não prova inexistência em arquivos fora delas.
- O proprietário confirmou formulário ativo e endereço correto. A chave coincide
  com a configuração antiga; seu valor não é incluído neste documento ou em código novo.

## Limitação comprovada

A [documentação oficial de HTTP 403](https://docs.web3forms.com/getting-started/troubleshooting)
informa que chamadas por servidor exigem plano pago e liberação do IP pelo suporte.
O [exemplo oficial de backend](https://web3forms.com/blog/nextjs-server-actions-contact-form)
repete essa exigência. Não é correto prometer o conjunto **Web3Forms gratuito +
chave somente no backend** como uma integração atualmente suportada.

A [FAQ oficial](https://docs.web3forms.com/getting-started/faq) esclarece que a chave
envia para um endereço associado. `replyto` não altera esse destinatário. O
[autoresponder](https://docs.web3forms.com/getting-started/pro-features/autoresponder)
é pago e não deve ser confundido com envio transacional arbitrário para todos os
usuários. Portanto, nem mesmo um teste bem-sucedido no endereço do proprietário
aprovaria automaticamente cadastro por e-mail para qualquer pessoa.

### Teste real

- Executado com a configuração existente, somente no laboratório 55483/18133,
  em banco de autenticação novo e separado, sem cadastros empresariais.
- A tentativa instrumentada retornou **HTTP 403**, corpo não JSON.
- Diagnóstico GET mostrou servidor Cloudflare, título `Just a moment...` e
  desafio de navegador. Nenhum cookie de desafio foi extraído ou reaproveitado.
- A API local respondeu 503, sem mostrar OTP. Aceitação pelo provedor e entrega
  não foram confirmadas. A chave não foi declarada inválida.
- Após a falha: zero contas ativas, verificadas ou aprovadas; zero sessões;
  código invalidado; somente HMAC armazenado. Nenhuma promoção ou acesso foi concedido.
- O helper fechou sua própria API e conexões normalmente. Não houve encerramento forçado.

**Não repetir tentativas para contornar o bloqueio, simular navegador, mover a
chave para o frontend, contratar plano ou trocar de serviço automaticamente.**
Uma eventual exceção oficial do fornecedor teria de ser comprovada antes de novo
teste backend. Até isso ser resolvido, envio e confirmação permanecem bloqueados.

## Correção preparada, sem ativação operacional

- `server/d1-lab/web3forms-mail.mjs`: endpoint HTTPS oficial, sem redirecionamento,
  timeout, erro sanitizado e destinatário fixo. HTTP 200 exige `success: true`;
  aceitação não é prova de entrega.
- `identity-profile.mjs`: utiliza somente a configuração Web3Forms confirmada
  do backend. A seleção ativa de Gmail/Resend foi retirada; seus arquivos anteriores
  permanecem preservados, sem execução.
- `identity.mjs`: mantém scrypt, sessões, aprovação administrativa e permissões.
  Destinatário não suportado é recusado antes de criar a conta.
- OTP continua gerado e validado no servidor: seis dígitos, dez minutos, cinco
  tentativas, HMAC, consumo único e reenvio limitado. Falha de envio invalida o OTP.
- `src/lib/emailSender.js`: chave e envio direto retirados. Fachada legada recusa
  envio no navegador; nenhum consumidor ativo desse arquivo foi localizado.
- Configuração antiga e checkpoint preservados fora do Git, com acesso restrito.
  A candidata backend fica em `web3forms-candidate.dpapi`. Não foi criado um perfil
  confirmado de entrega nem ativado o serviço no aplicativo instalado.
- `serve-web3forms-proof.mjs`: helper opt-in para laboratório e confirmação manual
  pela página local. Falha produz resultado negativo, sem liberar usuário.

## Testes e preservação

| Verificação | Resultado |
|---|---|
| Adaptador e bloqueio de destinatário não suportado | 7/7 aprovados, transporte simulado |
| Autenticação, expiração, cinco tentativas, permissões e interface Electron | 23/23 aprovados, e-mail simulado |
| Estoque, produção e financeiro transacional | 15 fluxos aprovados em PostgreSQL sintético |
| Lint, build web e build D1 | Aprovados |
| Chave nos novos fontes/bundles frontend | Zero ocorrências em 340 arquivos verificados |
| Envio real Web3Forms pelo backend | Reprovado: HTTP 403 |
| Recebimento e confirmação real | Pendentes, não aprovados |

Os testes simulados não substituem recebimento e confirmação de mensagem real.
Dados históricos, ensaios de migração anteriores, instalações, perfis, backups,
DPAPI existentes e WIP da Etapa A não foram substituídos. Não houve importação
operacional, deploy, merge, alteração da produção 8080 ou instalação nova.
O instalador definitivo continua condicionado aos critérios da
[missão Windows](missao-final-ruy-20261021.md), além do bloqueio de e-mail acima.
