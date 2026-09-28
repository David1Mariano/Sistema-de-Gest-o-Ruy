-- PROPOSTA PARA REVISÃO. NÃO EXECUTADA. Não executar nesta fase de inventário.
-- Aplicação manual somente após aprovar migração e provisionar operadores.
-- Não altera bucket, RLS, grants de records, auth.users ou Employees.
-- Pré-requisitos administrados no servidor em app_metadata:
--   legacy_auth_user_id = ID legado revisado e vinculado de forma única
--   system_role = admin ou super_admin
--   employee_payment_access = true
-- Nunca copiar claims de user_metadata/localStorage nem permitir edição pelo cliente.
-- Sem claims, estas policies negam o acesso mesmo para authenticated.
-- Autoriza operadores financeiros explicitamente aprovados a compartilhar anexos
-- do piloto entre computadores. Não limita leitura apenas ao uploader.
-- Path exato: EmployeePayment/{id definitivo do pagamento}/{uuid}.{extensão}
-- A existência/autorização do registro deve ser validada também na camada records,
-- cujas policies permanecem pendentes de auditoria. O path não prova essa existência.

begin;

create policy "ruy_employee_payment_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'anexos'
  and (select auth.uid()) is not null
  and coalesce((select auth.jwt())->'app_metadata'->>'legacy_auth_user_id', '') <> ''
  and (select auth.jwt())->'app_metadata'->>'system_role' in ('admin', 'super_admin')
  and (select auth.jwt())->'app_metadata'->>'employee_payment_access' = 'true'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = 'EmployeePayment'
  and (storage.foldername(name))[2] <> ''
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'pdf')
);

create policy "ruy_employee_payment_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'anexos'
  and (select auth.uid()) is not null
  and coalesce((select auth.jwt())->'app_metadata'->>'legacy_auth_user_id', '') <> ''
  and (select auth.jwt())->'app_metadata'->>'system_role' in ('admin', 'super_admin')
  and (select auth.jwt())->'app_metadata'->>'employee_payment_access' = 'true'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = 'EmployeePayment'
  and (storage.foldername(name))[2] <> ''
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'pdf')
);

commit;
-- Não há UPDATE/DELETE: substituição usa objeto novo (sem upsert), depois salva
-- referência; arquivo anterior permanece intacto. Limpeza será etapa autorizada.
-- Revogar claims exige renovação/expiração do JWT; signed URLs já emitidas
-- continuam utilizáveis até expirar. Usar TTL curto e revisar policies futuras
-- pois policies permissivas adicionais podem ampliar acesso por OR.
