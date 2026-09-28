# Auditoria e plano de autenticação única — 24/09/2026

Somente auditoria/preparação. Nenhuma migração, execução de SQL administrativo,
criação de auth.users, gravação de senha, Employee ou pagamento realizada.
Este plano substitui a proposta anterior de autenticação adicional do piloto:
o destino é UMA sessão Supabase Auth, UMA tela /login, sem duas autoridades.

## Inventário consultado por REST

Consulta com projeção dos cinco campos solicitados + ID físico; sem ler senhas.
HTTP 200, Content-Range 0-0/1. Um AuthUser visível:

| AuthUser.id | email | full_name | role | status |
|---|---|---|---|---|
| user_mue4z0jq_uqs0ty | caldodecanadoruy1977@gmail.com | caldodecanadoruy1977 | admin | ausente/null |

ID físico igual a data.id. Total administrativo ainda depende da consulta SQL:
RLS pode ocultar registros; não equivale a inventário de auth.users ou sessões ativas.
Roles reconhecidas pelo código: admin, super_admin, manager, gerente e user.
Role encontrada nos dados visíveis: admin (1).

## Fluxo atual e problemas relevantes

- base44Client liga auth a localAuth e entidades a cloudDb (configurado).
- /login chama loginViaEmailPassword e redireciona. localAuth lista AuthUser,
  compara senha com uma constante compartilhada no cliente; pode atualizar o
  campo legado durante login. Essa função NÃO foi executada nesta auditoria.
- Sessão: gr_local_session = {userId} no localStorage. Token retornado local-{id};
  setToken não faz nada. Sem expiração/JWT/validação de sessão no servidor.
- localAuth.me lista usuários, seleciona pelo ID local e remove o campo de senha
  do objeto devolvido. Não impõe status ativo. isAuthenticated apenas verifica
  presença da sessão. Não usar essas garantias como base de RLS.
- AuthContext chama me na montagem, mantém usuário/autenticação em memória e
  ProtectedRoute decide a renderização. Erro de rede vira estado desautenticado.
- useCurrentUser mantém cache de módulo, sem invalidação em logout/troca de conta;
  useUserRole deriva permissões desse cache. Controles de interface não são RLS.
- logout remove só gr_local_session; redirecionamento opcional. AuthContext não
  aguarda operação assíncrona nem limpa query cache. Espelhos de usuários ficam.
- Cadastro: /register, OTP gerado/verificado no navegador; pending no localStorage;
  Web3Forms pode expor código demonstrativo. Primeiro usuário vira admin baseado
  na lista visível ao cliente. Não transportar essa regra ao Supabase Auth.
- Recuperação atual não envia recuperação real: resetPasswordRequest retorna ok;
  resetPassword rejeita. ForgotPassword também mascara falha de transporte.
- cloudDb usa apikey pública e Authorization Bearer da MESMA chave, sem JWT.
  list/filter busca todos os registros da entidade e filtra no cliente. Há migração
  automática de IndexedDB para records na inicialização; localAuth também tenta
  migrar usuários locais. Esses caminhos devem ser desativados na migração de Auth,
  não reexecutados com privilégios de usuário autenticado sem revisão.
- Não há backend/Edge Function de autenticação no repo. Infraestrutura remota
  eventualmente fora do repo: NÃO VALIDADO. OAuthConsent.jsx usa rotas /api/apps/.../mcp
  legada, não montada pelo App atual; não é uma ponte Auth/Storage pronta.

## Estado administrativo do Storage (confirmado pelo proprietário)

anexos existe, public=false, file_size_limit=15728640, MIME JPEG/PNG/WEBP/PDF.
storage.objects tem zero policies. NoSuchBucket via chave pública é ausência de
visibilidade, não evidência de inexistência. Autorização de upload já testada:
HTTP 400/status interno 403, AccessDenied, RLS violation. Nenhum objeto enviado.

## Gate obrigatório: records

Executar MANUALMENTE scripts/inspect-records-auth.sql no SQL Editor do projeto
wvcvveqdkecsoygtilop e retornar resultados. É transação read only: RLS/FORCE RLS,
policies, ACL incluindo PUBLIC, grants efetivos anon/authenticated por tabela e
coluna, USAGE no schema e inventário administrativo AuthUser sem senhas.

Não há proposta de policy de records nesta fase. Analisar SELECT/INSERT/UPDATE/
DELETE separadamente, regras TO anon/authenticated/public e expressões auth.uid.
Trocar cabeçalho pode negar operações ou ampliar visibilidade. SELECT que omita
linhas também altera saldos/relatórios sem erro HTTP. Testar módulos financeiros,
Employee, RH, Produção, Ponto, Compras e transações encadeadas antes da troca.
AuthUser não pode expor campos sensíveis nem aceitar autopromoção/escrita de role.

## Identidade e autorização propostas

Preservar AuthUser.id legado (texto). auth.users.id terá seu próprio UUID.
Vínculo administrado, único e imutável pelo cliente: app_metadata.legacy_auth_user_id
do usuário Supabase, após conferir e-mail verificado e conta legada. Não vincular
automaticamente por e-mail enviado pelo cliente, nem inferir admin pelo primeiro login.
O provisionamento deve rejeitar duplicidade de vínculo/conta. Uma tabela de vínculo
com UNIQUE/FK é alternativa futura se claims não bastarem; não criada nesta etapa.

Adaptador me retorna perfil compatível {id legado, auth_user_id UUID, email,
full_name, role, status}. Para autorização, usar system_role e permissão de piloto
administradas em app_metadata, jamais user_metadata ou role editável no JSON.
Auditar/restringir perfil em records; papel legado pode permanecer para compatibilidade
visual, mas deve ser reconciliado e não ser autoridade independente. Papel ausente,
vínculo inválido ou conta desabilitada: negar acesso, sem fallback local.
Status nulo atual não prova inatividade; aprovação administrativa define quem migrar.

## Mudanças futuras por arquivo

| Arquivo | Mudança planejada |
|---|---|
| src/lib/supabaseClient.js (novo) | Cliente único, sessão persistida/refresh, somente chave pública |
| src/lib/supabaseAuthAdapter.js (novo) | Compatibilidade me/login/logout/registro/recuperação; vínculo seguro |
| src/api/base44Client.js | Trocar auth pelo adaptador; preservar entidades; revisar migração automática |
| src/lib/cloudDb.js | JWT atual por requisição; sem fallback anon em erro; gate de policies |
| src/lib/localAuth.js | Retirar do fluxo ativo; impedir replay/migração de usuários locais |
| src/lib/AuthContext.jsx | Restauração e eventos Auth; logout aguardado; limpar caches/estado |
| src/lib/useCurrentUser.js | Consumir contexto ou invalidar cache por sessão |
| src/lib/useUserRole.js | Consumir papel validado; manter nomes de permissões |
| src/components/ProtectedRoute.jsx | Revisar loading/erro, vínculo ausente/conta desabilitada |
| src/pages/Login.jsx | Mesmo /login, chamar adaptador, erro controlado de provider |
| src/pages/Register.jsx | Remover senha compartilhada/OTP local; convite no piloto, sem auto-admin |
| src/pages/ForgotPassword.jsx | Recuperação Supabase; erro de serviço sem enumerar contas |
| src/pages/ResetPassword.jsx | Callback de recuperação real, updateUser; remover token legado |
| src/lib/emailSender.js | Desacoplar de Auth; não alterar outras integrações |
| src/lib/paymentProof.js | Upload autenticado/assinatura; preservar parser legacy |
| src/components/rh/PaymentForm.jsx | ID definitivo, upload, persistência de metadados; preservar anterior |
| src/components/rh/PaymentProof.jsx | Manter modal/Blob; integrar estado de autorização/assinatura |
| src/pages/FichaColaborador.jsx | Revisar integração do piloto; não alterar Employee |
| src/App.jsx | Revisar callback de recuperação e registro, mantendo /login único |
| package.json/package-lock.json | Se aprovado, adicionar SDK Supabase compatível, sem upgrades gerais |
| testes/docs/env de exemplo | Cobrir contrato do adaptador, restauração, troca/logout e erros |

Manter auth.me(), loginViaEmailPassword(), logout(), useAuth(). setToken pode
permanecer como compatibilidade sem aceitar token local/arbitrário. register/verifyOtp/
resendOtp precisam adaptar semântica ao Supabase; não prometer equivalência ao OTP local.
O piloto será por convite, sem cadastro público com acesso automático a records.

## Policies propostas (não executadas)

scripts/proposed-payment-storage-policies.sql define apenas INSERT e SELECT,
TO authenticated, bucket anexos, prefixo EmployeePayment, duas pastas, extensão
permitida, JWT com vínculo legado e system_role admin/super_admin + permissão
employee_payment_access=true. Não concede a todo usuário recém-cadastrado.
Escopo financeiro compartilhado entre operadores aprovados, não apenas uploader.
UPDATE/DELETE desnecessários: novo arquivo usa UUID novo, sem upsert. Não é uma
policy de autorização de records; verificar integridade e acesso do pagamento no gate.

## Ordem da migração após aprovação

1. Receber SQL de inspeção; aprovar matriz de acesso de records, sem aplicar defaults.
2. Snapshot privado de configurações/policies/perfis e revisão de duplicidades; nada
   de exportar senhas legadas para repo ou importar a senha compartilhada no Auth.
3. Configurar Auth/SMTP/URLs de callback; convidar somente operadores reais aprovados.
   Eles definem senha individual pelo provedor. Inicialmente preservar o admin inventariado.
4. Administrar vínculo/roles/claims; aplicar manualmente policies Storage revisadas
   e eventuais mudanças records APENAS após auditoria e aprovação separada.
5. Implementar adaptador/client/contexto e cortar autoridade local em uma única troca.
   Não usar duas sessões nem retornar ao anon quando JWT falhar. Limpar apenas as
   chaves de autenticação antigas, sem apagar IndexedDB ou dados da aplicação.
6. Testar Auth e matriz CRUD com contas aprovadas; invalidar cache React Query e
   useCurrentUser em signout/troca de conta. Não reaproveitar perfil da sessão anterior.
7. Pilotar upload em registro de teste autorizado. Gerar ID definitivo uma vez antes
   do upload para novo pagamento, persistir mesmo ID após sucesso. Campos no JSON:
   storage_path/file_name/mime_type/file_size; proof_url legado preservado.
8. Assinar no clique (TTL curto, por exemplo 60s), verificar HTTP/Content-Type,
   apresentar Blob; nunca armazenar signed URL. Upload novo -> salvar -> manter antigo
   até limpeza futura. Falha de persistência deixa novo órfão identificado, não perda.
9. Validar JPG/PNG/WEBP/PDF, nome acentuado, .exe e >15MB, F5, reabertura, outro PC;
   também conta não autorizada, JWT vencido e objeto ausente. Nada de pagamentos reais.

## Recuperação/logout

Recuperação: resetPasswordForEmail com redirect aprovado /reset-password, tratar
fluxo de recuperação do SDK e updateUser; manter UX sem enumerar e-mails e exibir
falha de transporte. Localhost e IP de rede são origens distintas; links/armazenamento
não compartilham sessão. Usar URL canônica estável e HTTPS para implantação.

Logout: await signOut(scope local) para dispositivo; ação explícita global para
todos. Limpar estado/caches. Revoga refresh tokens; JWT já emitido continua válido
até exp. Signed URLs emitidas também vivem até TTL. Revogação imediata exigiria
checagem server-side adicional, fora do mínimo. Não afirmar revogação imediata.

## Rollback

Antes do corte: não há mudança de runtime a desfazer nesta auditoria.
Depois: desativar novos uploads, preservar objetos/metadados/IDs, reverter apenas
mudanças aprovadas do aplicativo e das policies criadas (por nome), manualmente.
Não apagar auth.users, Employees, pagamentos ou buckets. Não reabrir anon nem
restaurar senha compartilhada automaticamente. Se rollback seguro exigir isso,
usar manutenção até correção, mantendo dados preservados. Invalidar sessões conforme
escopo e TTL; não restaurar gr_local_session como bypass. Validar ponto de restauração.

## Riscos e bloqueios

Policies/grants de records ainda desconhecidos; permissão de AuthUser sensível;
senha compartilhada e OTP local não são autenticação segura; admin pelo primeiro
cadastro/lista visível; cache de usuário sem limpeza; migrações automáticas podem
reescrever dados; vínculos duplicados; convites/e-mails; claims/policies inconsistentes;
JWT/signed URL ainda válidos após revogação; órfãos por falha intermediária.
Não houve inspeção funcional de sessão no navegador nem teste de nova autenticação.

Fontes oficiais:
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/auth/signout
- https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail
