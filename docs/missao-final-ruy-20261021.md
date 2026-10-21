# Consolidação Windows — evidências de 21/10/2026

**Estado: desenvolvimento e homologação isolada. Entrega definitiva NÃO aprovada.**

Base: `f151f8a`, branch `agente-5-auditoria-integracao-20261019`.
As alterações anteriores, incluindo o trabalho do Cline e arquivos não rastreados,
foram copiadas antes da edição para uma pasta privada em
`%LOCALAPPDATA%/GestaoRuy/pontos-recuperacao`, com 14 hashes conferidos.
Os dez arquivos da Etapa A coincidem com o manifesto da auditoria anterior.

## Correções e limites

- O Dashboard Windows redirecionava explicitamente `/` para `/setores`.
  Agora possui tela própria e indicadores de cadastros obtidos pelo servidor.
  Esses indicadores não representam conciliação financeira ou saldo de estoque.
- `localAuth.js` ainda referenciava uma constante removida. Esse arquivo não é
  o autenticador utilizado pelo Electron: o build D1 utiliza sua API e a versão
  hospedada utiliza o adaptador oficial. O armazenamento de credenciais e OTP
  no navegador foi retirado desse caminho legado, que agora recusa autenticação.
  Nenhum perfil instalado ou armazenamento antigo foi alterado.
- Contas individuais reutilizam `lab_users`, `lab_sessions` e `lab_audit`.
  Não há segundo banco de senhas. O módulo novo exige provisionamento explícito,
  fica desativado nas instalações antigas e não modifica seus esquemas.
- Novas senhas usam scrypt N=131072, r=8, p=1, salt aleatório e comparação
  constante. A derivação é limitada a duas execuções simultâneas. O verificador
  preserva compatibilidade com hashes scrypt existentes, sem importar AuthUser.
- Cadastro inicia como viewer inativo. Confirmar e-mail não concede acesso.
  Aprovação, alteração de função e revogação são verificadas e auditadas pelo
  servidor; sessões da conta são revogadas quando suas permissões mudam.
- Códigos: seis dígitos criptográficos, dez minutos, cinco tentativas,
  uso único, hash HMAC com segredo do servidor e reenvio mínimo de um minuto.
  Não são devolvidos pela API nem exibidos como alternativa a falha de envio.
- Login individual: cinco tentativas por identificador/endereço em 30 minutos,
  com limitação adicional por origem. Sessões HttpOnly/SameSite, CSRF, expiração
  e revogação continuam no mecanismo existente.
- Administrador inicial exige token local aleatório, expirável e de uso único,
  além de e-mail previamente confirmado. Não existe promoção do primeiro cadastro.
  Não há redefinição administrativa sem verificar a identidade por código.

## Gmail — integração preparada, envio real pendente

O proprietário autorizou a configuração OAuth. Nenhuma senha do Gmail foi pedida.
O navegador não está conectado à ferramenta desta sessão:
`Browser is not available: iab`. A configuração da conta pelo navegador precisa
ser assistida até que haja uma superfície de navegação disponível.

O cliente OAuth deve ser do tipo aplicativo para computador, em projeto Google
autorizado, com Gmail API e consentimento configurados. Solicitar somente
`openid`, `email` e `https://www.googleapis.com/auth/gmail.send`.
Não solicitar leitura de mensagens, acesso total à caixa ou service account.

`scripts/d1-lab/authorize-gmail.mjs` implementa navegador oficial, PKCE S256,
state aleatório, retorno loopback temporário, confirmação do endereço remetente
e persistência DPAPI CurrentUser. Exige arquivo OAuth selecionado localmente;
não recebe segredos pelo chat. Não sobrescreve autorização existente.
Executar somente com consentimento do responsável e namespace de desenvolvimento:

```powershell
$env:RUY_D1_INSTALLATION='final-dev-20261021'
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_TEST_API_PORT='18133'
$env:RUY_GMAIL_BROWSER_CONSENT='1'
node scripts/d1-lab/authorize-gmail.mjs '<arquivo OAuth local>' '<remetente autorizado>'
```

O serviço exige `identity-service.dpapi`, com purpose
`RUY_INDIVIDUAL_IDENTITY_DEV`, installationId correspondente, pepper aleatório
de 32 bytes e mail.provider `gmail-oauth-dpapi`. A autorização Google fica em
`gmail-oauth.dpapi` no diretório exclusivo dessa instalação. O esquema
`identity.sql` só pode ser provisionado em banco novo autorizado. Não há aplicação
automática desse esquema em bancos existentes. Sem configuração, a inicialização
recusa o perfil ou o envio falha fechado; não há confirmação demonstrativa.

**Ainda obrigatório:** receber um código real, confirmá-lo no aplicativo, testar
reenvio, redefinição, expiração e recuperação administrativa com a conta autorizada.
Aceitação HTTP do provedor não comprova entrega. Os testes atuais simulam o transporte.

Fontes técnicas: [OWASP — senhas](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[Google — OAuth desktop](https://developers.google.com/identity/protocols/oauth2/native-app),
[Google — envio Gmail](https://developers.google.com/workspace/gmail/api/guides/sending).

## Dados reais preservados e ensaio operacional

O manifesto original de 136 arquivos foi relido: tamanhos e SHA-256 coincidem.
Nenhum novo download, atualização Supabase ou importação na R4 ocorreu.

| Entidade | Registros |
|---|---:|
| Employee | 63 |
| Sector / JobRole | 6 / 17 |
| FinancialExpense / EmployeePayment | 168 / 134 |
| Vale / Consumption | 56 / 86 |
| Absence / Warning | 8 / 6 |
| AccountsPayable / FechamentoCaixa | 4 / 4 |
| ExpenseCategory | 5 |
| InventoryItem / StockMovement | 1 / 1 |
| AuditLog | 627 |
| **Total de negócio** | **1.186** |

AuthUser redigido permanece separado, sem ser uma credencial ativa.
Os arquivos disponíveis não contêm entidades históricas de pedidos Delivery,
clientes ou produção diária. Não foram inventados registros para essas entidades.

`scripts/recuperacao/rehearse-operational-history.mjs` restaura o arquivo cifrado
validado em banco NOVO `ruy_operational_trial_<identificador>`, no cluster de
recuperação loopback 55463. Confere identidade/PGDATA, projeto, hash do backup,
contagens e payloads antes de preparar as tabelas atuais.

- 86 documentos em `d1_records`, 1.100 em `d2_catalog`.
- Recebimentos de importação relacionam ID canônico, entidade, ID legado e SHA-256.
- Valores e referências legadas permanecem exatos. Relações canônicas estão em
  `history.references`; não se deve confundir o ID legado com UUID operacional.
- Há 382 referências confirmadas e uma ausente: pagamento cancelado preservado.
- 59 anexos, 2.928.141 bytes, todos conferidos; 54 vinculados e cinco em quarentena.
- Nenhum handler operacional é chamado: zero efeitos em estoque, financeiro,
  eventos operacionais e outbox.
- Importação transacional, falha injetada após 50 registros, replay idempotente
  e proteção SQL contra alteração de documentos históricos.
- Backup AES-256-GCM, chave própria DPAPI, restauração em banco novo e nova
  conferência de registros, arquivo original e 59 hashes de conteúdo.

O proprietário técnico inativo das linhas é metadado de isolamento, não usuário
recuperado nem conta apta a login. Não há cadastros sintéticos de negócio nesse banco.
Credenciais e relatórios privados ficam em `recuperacao-real`, fora do Git.

Para repetir somente em laboratório autorizado:

```powershell
node scripts/recuperacao/rehearse-operational-history.mjs '<diretório do ensaio validado>'
```

Cada execução cria destino independente; não apaga ou reutiliza banco anterior.
Não usar esse comando para ativação operacional. O relatório por execução indica
as pendências. A conciliação financeira é feita em SQL decimal, sem valores em logs.

**Bloqueio de ativação:** adaptar e homologar as referências nas telas operacionais
e a política de acesso ao acervo por usuários individuais. Não basta apontar a R4
para esse banco. O acervo é imutável neste ensaio; não está habilitado para editar,
pagar, estornar ou movimentar documentos antigos. Saldo histórico não foi convertido
automaticamente em movimento ou saldo operacional novo.

## Consulta histórica no Electron

Perfil independente `history-view-dev-20261020`, autenticação sintética exclusiva
55473 e fonte histórica de leitura no cluster 55463. A API normal usa 18123;
os testes atuais usam 18124, sem interromper o processo anterior.

O leitor PostgreSQL tem credenciais próprias, default read-only e nenhuma
permissão DML nas tabelas/views históricas. Perfil e concessões por usuário,
entidade, auditoria e anexo são protegidos por DPAPI. Auditoria requer concessão
explícita e administrador. A API recusa escritas e todas as operações D1/C2.

A tela oferece pesquisa, filtro, paginação, ficha com campos legíveis, valores
originais, histórico relacionado e download autorizado com SHA-256. JSON original
é apenas conferência adicional. Anexos sem vínculo não são disponibilizados.
Isso não equivale à migração dos cadastros para as telas operacionais.

## Testes reproduzíveis e classificação

| Verificação | Resultado | Tipo |
|---|---|---|
| 22 verificações de identidade, incluindo interface | APROVADO | PostgreSQL/HTTP e Electron de desenvolvimento; transporte de e-mail simulado |
| 16 verificações da API histórica | APROVADO | Fonte real isolada; permissões, totais, anexos e mutações recusadas |
| Consulta e download na interface histórica | APROVADO | Electron de desenvolvimento, sem instalação NSIS |
| 15 fluxos de domínio | APROVADO | PostgreSQL/HTTP, dados sintéticos exclusivos |
| Estoque | 121/121 | Harness em memória; não confundir com Windows instalado |
| Financeiro integrado | 9/9 | Testes automatizados de contrato/comportamento |
| Exclusão RH | 39/39 | Testes automatizados |
| Rascunhos | 60/60 | Testes automatizados |
| Delivery / contratos pós-R3 | 4/4 e 4/4 | Contratos; não comprovam integração externa |
| Importação, rollback, replay, arquivo e backup/restauração | APROVADO | Banco novo com dados reais isolados |
| Lint e builds web/D1 | APROVADO | Compilação; não aprovação operacional |
| Reinício PostgreSQL exclusivo 55483 | APROVADO | Parada smart, partida e fingerprints preservados; somente dados sintéticos |
| E-mail real / código recebido | PENDENTE | OAuth e confirmação pelo responsável |
| Instalador final / Windows limpo / reinstalação | PENDENTE | Nenhuma instalação alterada nesta missão |
| Dois Windows / reconexão física / multiestação | PENDENTE | Segunda máquina e janela autorizadas |

Os números acima são por suíte e tipo de evidência. Não somar asserções de harness,
fluxos HTTP e casos `node:test` como uma única cobertura de módulos ou usuários.
As contagens históricas 86/97 de relatórios anteriores não são reutilizadas como
resultado desta execução.

Exemplos de execução (definir primeiro o namespace correspondente):

```powershell
# Ambiente sintético NOVO de autenticação: API 18133, PostgreSQL 55483
$env:RUY_D1_INSTALLATION='final-dev-20261021'
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_TEST_API_PORT='18133'
$env:RUY_IDENTITY_ACCEPTANCE='1'
# Opcional: caminho absoluto de electron.exe DE DESENVOLVIMENTO
$env:RUY_IDENTITY_ELECTRON_EXE='<electron.exe>'
node scripts/d1-lab/test-identity.mjs
node scripts/d1-lab/test-agente5-domain.mjs
node scripts/d1-lab/test-final-restart.mjs # exige API 18133 desligada; nunca usa parada forçada

# Fonte histórica independente, nunca um perfil instalado
$env:RUY_D1_INSTALLATION='history-view-dev-20261020'
$env:RUY_D1_TEST_API_PORT='18123'
$env:RUY_HISTORY_ACCEPTANCE='1'
$env:RUY_HISTORY_PROFILE_ID='<identificador do perfil DPAPI>'
node scripts/d1-lab/test-history-readonly.mjs
$env:RUY_ELECTRON_TEST_EXE='<electron.exe de desenvolvimento>'
node scripts/d1-lab/test-history-electron.mjs
```

Testes de identidade criam banco sintético independente a cada execução. Os testes
Electron fecham suas próprias janelas normalmente. Nenhum processo antigo é alvo.

## Matriz dos módulos e ordem de conclusão

1. **Autenticação:** código e testes locais aprovados; entrega real de e-mail,
   provisionamento definitivo e recuperação administrativa precisam de homologação.
2. **Colaboradores, setores e funções:** mecanismos D1 preservados; acervo de 63/6/17
   conciliado no ensaio. Falta uso das telas normais com vínculos migrados e conta final.
3. **Estoque e produção:** fluxos atômicos, saldo insuficiente, confirmação,
   cancelamento e replay passaram na regressão HTTP sintética. Falta homologação
   completa da interface final e aprovação de saldos de abertura reais.
4. **Financeiro e RH monetário:** regressões passaram, mas nenhuma operação real
   foi executada. Falta homologar interface, migração, permissões e conciliação final.
5. **Ponto, escalas, folha, ausências e advertências:** telas web existentes não
   comprovam portabilidade D1. O conjunto de rotas Windows ainda não atende todo
   esse escopo; não declarar esses módulos operacionais.
6. **Anexos:** consulta histórica e integridade aprovadas; cinco arquivos permanecem
   em quarentena. Associação final nas telas e autorização individual precisam aceite.
7. **Delivery:** contratos e regressões internas disponíveis; pagamentos e provedores
   externos permanecem desativados. Não anunciar iFood/99Food integrados.
8. **Windows/instalador:** somente desenvolvimento nesta missão. Candidata final,
   registro NSIS, instalação limpa, atualização sem perda e restauração independente
   só poderão receber aprovação após fechar os bloqueios anteriores.

Não foi produzido um instalador identificado como definitivo com esses bloqueios.
Não houve deploy, merge, alteração Supabase, migração definitiva, sincronização real
ou substituição de instalação R4. A ativação continua dependente do aceite expresso.
