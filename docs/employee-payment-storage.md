# Piloto EmployeePayment: bloqueio de autorização

> Histórico. O proprietário confirmou administrativamente bucket privado anexos,
> limite 15728640, JPEG/PNG/WEBP/PDF e zero policies em storage.objects.
> A proposta de login adicional abaixo foi substituída pelo plano de sessão única
> em `auth-migration-audit.md`. Não implementar dois logins.

Inspeção em 24/09/2026. Projeto efetivamente servido pelo Vite:
`wvcvveqdkecsoygtilop.supabase.co`. Nenhuma configuração de Storage ou Auth
foi alterada. Nenhum objeto ou pagamento foi criado.

## Evidência obtida com a credencial do frontend

- `GET /storage/v1/bucket/anexos`: HTTP 400, corpo com statusCode 404,
  `NoSuchBucket`. `GET /storage/v1/bucket`: HTTP 200, `[]`.
  Metadados administrativos não confirmados; essas respostas não contradizem
  a criação informada pelo usuário, pois a consulta exige permissão.
- `GET /auth/v1/user`: HTTP 401, `no_authorization`, exige Bearer válido.
- `localAuth.loginViaEmailPassword` devolve `local-${user.id}`, não um JWT
  emitido pelo Supabase. Não há integração Supabase Auth utilizável no código.
- Não há backend/Edge Function implementado no repositório para autorizar
  anexos. Infraestrutura remota eventualmente existente: NÃO VALIDADO.
- `POST /storage/v1/object/upload/sign/anexos/EmployeePayment/diagnostico-permissoes/b349bec1-6756-40b8-99be-6a1db690e2b0.pdf`:
  HTTP 400, statusCode 403, `AccessDenied`, `new row violates row-level security policy`.
  Esta operação solicita autorização; nenhum byte de arquivo foi enviado.
- Assinatura de leitura do mesmo caminho inexistente: HTTP 400, statusCode
  404, `NoSuchKey`. Nenhuma signed URL retornada. Não prova leitura autorizada.
- Consulta de EmployeePayment: HTTP 200, `[]`. Não há pagamento de teste
  visível com essa credencial. Não se pode concluir ausência absoluta sob RLS.

## Próximo passo administrativo, somente leitura

No SQL Editor do projeto acima, executar `scripts/inspect-payment-storage.sql`
e fornecer os resultados. Não enviar service_role, senhas ou tokens.
Precisamos confirmar `public = false`, limite em bytes, MIME types e policies.
Não recriar o bucket nem liberar acesso a anon para tornar essa consulta visível.

## Menor caminho seguro proposto (ainda não implementado)

O login atual não fornece identidade verificável para RLS. Acrescentar uma
Edge Function que apenas aceite `local-{id}` também não resolveria isso:
esse identificador não prova autenticação.

Uma opção restrita ao piloto é uma autenticação Supabase Auth adicional para
os operadores autorizados a comprovantes, mantendo o restante do localAuth
intacto por enquanto. Isso exige autorização do proprietário antes de implementar.

No Supabase:

1. Habilitar/convidar apenas contas de operadores autorizados (AuthUser não é
   Employee). Não criar usuários a partir dos 58 colaboradores.
2. Definir autorização administrativa verificável: por exemplo, claim em
   `app_metadata` administrada no servidor, ou ACL administrada e protegida
   por RLS. Não confiar em `user_metadata`, localStorage ou papel enviado pelo cliente.
3. Revisar policies existentes e conceder INSERT/SELECT em `storage.objects`
   somente a operadores autorizados, bucket `anexos`, prefixo EmployeePayment,
   pagamentos/escopo permitidos. O mesmo escopo deve permitir acesso em outro
   computador autorizado. Não conceder DELETE/UPDATE para o piloto inicialmente.
4. Auditar autorização dos metadados financeiros em `records` para o piloto.
   Não presumir que regras de papel do frontend protegem alterações no JSON.

No código, após aprovação e confirmação das policies, posso implementar:

1. Sessão Supabase Auth do operador com restauração/renovação de JWT e logout;
   validar a autorização no servidor/RLS, nunca só na interface.
2. Upload com JWT, sem upsert, em `EmployeePayment/{idDefinitivo}/{uuid}.{ext}`.
   Para registros existentes, usar seu ID; para novos, definir um ID definitivo
   usado tanto no path quanto na criação do registro, sem salvar pagamento
   financeiro provisório apenas para obter um ID.
3. Validar MIME/conteúdo e limite antes da rede. Após upload confirmado,
   persistir storage_path, file_name, mime_type, file_size no JSON data.
   Preservar proof_url legado; não persistir signed URL ou Blob URL.
4. Na leitura, assinar o path com JWT, verificar resposta/Content-Type e usar
   o preview já existente. Erros HTTP/RLS/objeto ausente devem aparecer.
5. Se salvar o pagamento falhar, preservar referência antiga. Não excluir
   o objeto anterior; aceitar órfão do upload novo até limpeza futura autorizada.
6. Usar pagamento de teste indicado/autorizado, sem alterar valores reais.
   Validar JPG/PNG/WEBP/PDF, F5, sessão reaberta e outro computador autorizado.

## Validação atual

Testes Node verificam conversão legada, Blob URL, MIME/bytes, HTTP de teste,
erros, extensão e limite. Isso não valida upload no Supabase nem renderização.
Navegador integrado indisponível: console, renderização e F5 NÃO VALIDADOS.

Referências oficiais:
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/reference/javascript/v1/storage-getbucket
