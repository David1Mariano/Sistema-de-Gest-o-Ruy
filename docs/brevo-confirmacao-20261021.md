# Brevo: confirmação individual em laboratório

Estado: implementação preparada; envio, recebimento e confirmação reais PENDENTES.
Nenhum envio real foi feito nesta etapa. Não habilitar produção nem a R4 instalada.

## Contrato preservado

O adaptador `server/d1-lab/brevo-mail.mjs` usa somente POST HTTPS no endpoint
oficial, com `api-key` no cabeçalho do backend. Sem dependências adicionais,
redirecionamento, fallback de provedor ou retentativa automática de envio ambíguo.
HTTP 201 com `messageId` significa aceitação, nunca recebimento comprovado.
Erros expõem apenas código estável e status HTTP, sem corpo do provedor.

O serviço de identidade existente continua gerando e validando os códigos:
HMAC no banco, dez minutos, cinco tentativas, consumo único e limite de reenvio.
Verificar e-mail não aprova conta nem atribui privilégios. Sessões e aprovação
administrativa permanecem no mesmo mecanismo.

## Provisionamento supervisionado (ainda não executado)

1. Responsável entra/cria conta gratuita na Brevo, sem contratar planos.
2. Cadastra e verifica o remetente no painel oficial. Confirmar que o envio
   transacional foi ativado. Endereço Gmail não permite autenticar o domínio
   gmail.com; verificar eventual substituição de remetente feita pela Brevo.
3. Cria chave API para o aplicativo, nunca chave SMTP, sem compartilhá-la no chat.
4. Somente após orientação, executa interativamente, sem elevação:
   `powershell.exe -NoProfile -File scripts/d1-lab/provision-brevo.ps1`.
   A chave é digitada localmente com entrada oculta e protegida por DPAPI do
   usuário atual, no diretório de laboratório existente. Sem sobrescrita.
5. Após os testes automatizados, o agente executa `serve-brevo-proof.mjs`
   exclusivamente com namespace `final-dev-20261021`, porta 18133, PG 55483,
   `RUY_D1_ALLOW_TESTS=1`, `RUY_D1_TEST_API_PORT=18133` e
   `RUY_BREVO_REAL_PROOF=1`. O helper cria banco novo apenas de autenticação.
   Somente o destinatário previamente autorizado pode receber nesse ensaio.
6. Responsável recebe o código e o informa na página local, nunca no chat.
   Só a confirmação efetiva no servidor grava `brevo-confirmed.dpapi`.
   A conta continua pendente de aprovação; o helper encerra normalmente em dez
   minutos ou após confirmação. Não modifica `identity-service.dpapi`.
7. A ativação posterior usa referência `mail.provider=brevo-dpapi` no perfil
   protegido, preservando o pepper existente. Não recriar contas/sessões.
   O carregador normal recusa perfil sem comprovação de entrega/validação.

Se a conta estiver bloqueada, o remetente não for aceito ou o e-mail não chegar,
registrar a limitação, sem contornar proteções nem contratar plano.

## Resultados desta alteração

- 13 testes do adaptador com transporte simulado: APROVADOS.
- 23 regressões de autenticação: APROVADAS, PostgreSQL isolado e Electron de
  desenvolvimento; caixa postal simulada. Não equivalem a entrega real.
- Lint, build principal e build D1: APROVADOS. Avisos existentes de tamanho
  dos bundles e base Browserslist desatualizada, sem falha.
- Dez arquivos WIP originais: hashes preservados.
- Manifesto histórico original: 136 arquivos íntegros, 1.186 registros e
  59 anexos; nenhuma alteração nas fontes.
- Cadastro Brevo, verificação do remetente, chave protegida e prova real:
  PENDENTES da etapa manual do responsável.

## Referências oficiais verificadas

- https://developers.brevo.com/docs/send-a-transactional-email
- https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans
- https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders

O plano gratuito documenta 300 envios diários e e-mails transacionais. Isso
não comprova ativação da conta, aceitação do remetente ou entrega na caixa postal.
