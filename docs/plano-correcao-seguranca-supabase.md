# Plano de Correção de Segurança — Supabase Pro

**Projeto:** `wvcvveqdkecsoygtilop`
**Repositório:** `https://github.com/David1Mariano/Sistema-de-Gest-o-Ruy`
**Branch:** `preparacao/windows-oficial-20261015`
**Último commit:** `8da0eb03faf8460a9a1899eb9bc4c5a468d3afcf`
**Produção:** `http://localhost:8080/` — permanece intacta durante toda esta auditoria.

---

## 1. Estado real da vulnerabilidade

### O que está exposto

| Item | Detalhe |
|------|---------|
| Tabela exposta | `public.records` (tabela genérica com todas as entidades: Employee, FinancialExpense, AccountsPayable, Vale, etc.) |
| Vetor de exposição | REST do Supabase (`/rest/v1/records?entity=eq.X`) via chave pública `anon` |
| Registros antigos identificados | ~1.067 (contagem histórica, pode não estar atual — não reimprimir) |
| Dados sensíveis na tabela | colaboradores, pagamentos, despesas, vales, recibos, anexos |
| Chave anon no código | `src/lib/cloudConfig.js` (publishable key, visível no frontend) |

### Condições agravantes

- Não há `.env.local`: a configuração do Supabase vem direto de `cloudConfig.js` com URL e anon key hardcoded.
- `base44Client.js` usa `cloudDb` quando `isCloudConfigured()` retorna verdadeiro, o que acontece porque `cloudConfig.url` e `cloudConfig.key` estão preenchidos.
- Sem RLS auditado: não há confirmação de que policies restritivas estejam ativas em `public.records`.
- Storage bucket `anexos`: existe, `public=false`, mas **zero policies** em `storage.objects` (conforme `scripts/proposed-payment-storage-policies.sql`).
- `scripts/inspect-records-auth.sql` existe mas nunca foi executado no SQL Editor (não há evidência de execução).

### O que NÃO está exposto (conforme código)

- O `authAdapter.js` já exige `app_metadata.legacy_auth_user_id` e `app_metadata.system_role` antes de qualquer operação de dados (HTTP 403 caso contrário).
- Login via `loginViaEmailPassword` requer sessão válida e perfil vinculado.
- Usuários inativos/bloqueados são rejeitados no `me()` (HTTP 403).
- `register`, `verifyOtp`, `resendOtp`, `loginWithProvider` estão desabilitados (`notAvailable`).
- Sincronização real com Supabase continua desativada (app roda em modo local por padrão quando não configurado).

---

## 2. Tabelas e serviços expostos

| Serviço/Recurso | Estado | Risco |
|-----------------|--------|-------|
| `public.records` (REST) | Exposta via chave anon | Crítico — dados administrativos acessíveis anonimamente se RLS não estiver ativo |
| `storage.buckets` (`anexos`) | `public=false`, zero policies | Médio — anexos podem ser acessíveis se não houver policy de storage |
| Supabase Auth | Funcionando (login ativo) | Baixo — auth não é o problema, é o RLS/grants |
| PostgREST | Exposto via REST | Depende de RLS/grants |

---

## 3. Policies e grants problemáticos (pendentes de confirmação via SQL Editor)

Não há evidência de que `scripts/inspect-records-auth.sql` tenha sido executado. Os itens abaixo precisam ser confirmados pelo administrador no SQL Editor do Supabase:

| Item | Comando de verificação | O que esperar se vulnerável |
|------|----------------------|------------------------------|
| RLS em `public.records` | `select relrowsecurity from pg_class...` | `false` ou `relforcerowsecurity = false` |
| Policies em `public.records` | `select * from pg_policies where tablename='records'` | Policies com `USING (true)` ou ausentes |
| Grants para `anon` | `aclexplode` on `public.records` | `PUBLIC` ou `anon` com `SELECT/INSERT/UPDATE/DELETE` |
| Policies em `storage.objects` | `select * from pg_policies where schemaname='storage'` | Zero policies ou policies permissivas |

---

## 4. Modelo real de usuários e permissões

Conforme `src/lib/authAdapter.js` (já implementado no app):

| Papel | Critério (app_metadata) | Acesso |
|-------|------------------------|--------|
| `super_admin` | `system_role = 'super_admin'` | Todos os registros (leitura e escrita) |
| `admin` | `system_role = 'admin'` | Todos os registros (leitura e escrita) |
| `user` | `system_role = 'user'` + `legacy_auth_user_id` | Apenas registros com `data->>'owner_id' = legacy_auth_user_id` |
| `employee_payment_access` | `employee_payment_access = true` | Acesso a módulos de pagamento/vale |
| Usuário sem claims | Ausência de `legacy_auth_user_id` ou `system_role` | Rejeitado com HTTP 403 no `me()` |
| Usuário inativo/bloqueado | `status in ('inativo','inactive','disabled','bloqueado')` | Rejeitado com HTTP 403 no `me()` |

### Relacionamento com registros

- Cada registro em `public.records` tem `data->>'owner_id'` que indica o proprietário.
- `AuthUser` registros têm `data->>'id' = legacy_auth_user_id` (próprio perfil).
- Não há multi-tenant (não existe `merchant_id`, `unit_id` ou `tenant_id`).
- O isolamento é por `owner_id`, não por organização.

---

## 5. SQL de correção proposto (NÃO APLICAR no operacional)

Arquivo: `scripts/proposed-records-security.sql`

O SQL proposto:

1. Habilita RLS forçado em `public.records`
2. Revoga todos os grants diretos para `public`, `anon` e `authenticated`
3. Cria 4 policies restritivas:
   - `ruy_records_select_owner`: usuário vê apenas seus registros (owner_id)
   - `ruy_records_select_admin`: admin/super_admin vê todos
   - `ruy_records_write_admin`: admin/super_admin escreve tudo
   - `ruy_records_write_owner`: usuário escreve apenas seus registros
4. Não cria policy para `anon` (requisições sem JWT são negadas)

**Não executar no banco operacional sem aprovação explícita.**

---

## 6. Resultados de testes isolados (PostgreSQL descartável)

Ambiente de teste criado localmente (PostgreSQL 17, banco `ruy_security_test`), com dados sintéticos e RLS aplicado conforme o SQL proposto.

| # | Teste | Resultado |
|---|-------|-----------|
| 1 | Usuário anônimo não lê Employee | ✅ PASS |
| 2 | Usuário anônimo não lê FinancialExpense | ✅ PASS |
| 3 | Usuário anônimo não insere registros | ✅ PASS |
| 4 | Usuário autenticado sem claims não lê | ✅ PASS |
| 5 | Admin lê todos os registros Employee | ✅ PASS |
| 6 | Admin lê todos os registros FinancialExpense | ✅ PASS |
| 7 | Usuário comum lê apenas seu Employee | ✅ PASS |
| 8 | Usuário comum lê apenas seu FinancialExpense | ✅ PASS |
| 9 | Usuário inativo não vê Employee de outro | ✅ PASS |
| 10 | Usuário comum não atualiza Employee de outro | ✅ PASS |
| 11 | Usuário comum não deleta Employee de outro | ✅ PASS |
| 12 | Admin atualiza qualquer Employee | ✅ PASS |

**Resultado: 12/12 aprovados. Modelo de RLS validado.**

### Limitação dos testes

Testes em PostgreSQL genérico comprovam o comportamento de RLS SQL, mas NÃO comprovam o comportamento do Supabase Auth, PostgREST e Storage. Testes específicos ainda necessários no painel do Supabase:
- Teste de acesso anônimo via REST (`/rest/v1/records` com chave anon, sem JWT)
- Teste de login administrativo via Supabase Auth
- Teste de arquivos privados no Storage (bucket `anexos`)

---

## 7. Riscos para login e telas

| Risco | Mitigação |
|-------|-----------|
| Login quebrado | O `authAdapter.js` já valida claims antes de qualquer consulta. O SQL de correção não altera auth.users. |
| Telas de cadastro | Nenhuma alteração no schema. Telas continuam funcionando se RLS permitir. |
| Usuários existentes | `legacy_auth_user_id` e `system_role` devem estar preenchidos em `app_metadata`. Usuários sem esses claims ficarão sem acesso (já é o comportamento atual do `authAdapter.js`). |
| Financeiro/RH | `employee_payment_access` é verificado no `me()`. RLS não afeta essa verificação de aplicação. |
| Vales e RH | As telas de Vales e RH dependem de `owner_id` nos registros. Se o campo não estiver preenchido em registros existentes, o usuário não verá nada (comportamento seguro por padrão). |

---

## 8. Situação dos backups e restauração

### Opções no Supabase Pro

| Opção | Status | Ação necessária |
|-------|--------|-----------------|
| Backup automático (diário) | Desconhecido | Verificar no painel do Supabase |
| PITR (Point-in-Time Recovery) | Desconhecido | Verificar se está disponível e habilitado no plano Pro |
| Backup lógico (`pg_dump`) | Não executado | Preparar script de backup lógico antes da correção |

**Não afirmar que existe backup seguro apenas porque a organização utiliza Supabase Pro.** O administrador deve confirmar no painel.

### Plano de backup antes da correção

1. Exportar schema completo (`pg_dump --schema-only`)
2. Exportar policies e grants atuais (`pg_dump` com `--no-owner --no-privileges` ou consultas ao `pg_policies`)
3. Fazer backup dos dados de `public.records` se possível (dados reais — apenas leitura, sem modificar)
4. Salvar o SQL de rollback (ver seção 9)

---

## 9. Plano de rollback

### Rollback de políticas

```sql
-- Remover as policies propostas (restaura o estado anterior, que pode ser inseguro)
drop policy if exists "ruy_records_select_owner" on public.records;
drop policy if exists "ruy_records_select_admin" on public.records;
drop policy if exists "ruy_records_write_admin" on public.records;
drop policy if exists "ruy_records_write_owner" on public.records;
```

### Rollback de RLS

```sql
-- Desabilitar RLS (VOLTA À EXPOSIÇÃO — usar somente em caso crítico)
alter table public.records disable row level security;
alter table public.records no force row level security;
```

### Regras de rollback

- Um rollback de permissões **não deve reabrir indiscriminadamente a exposição anônima**. Se houver rollback, deve-se restaurar apenas as policies anteriores (se existiam) e não conceder grants abertos a `anon`.
- Antes de qualquer rollback, capturar o estado atual das policies para restauração seletiva.

---

## 10. Etapas para correção no Supabase Pro (plano de aplicação controlada)

| Etapa | Ação | Requer aprovação |
|-------|------|-----------------|
| 1 | Conferir backup recuperável (pg_dump schema + policies) | Não (verificação) |
| 2 | Identificar contas administrativas autorizadas (app_metadata) | Não (verificação) |
| 3 | Capturar permissões atuais (RLS, grants, policies) | Não (verificação) |
| 4 | Executar `scripts/inspect-records-auth.sql` no SQL Editor | Não (somente leitura) |
| 5 | Validar correção em ambiente representativo (testes isolados) | Não (feito localmente) |
| 6 | Aplicar `scripts/proposed-records-security.sql` no SQL Editor | **SIM** |
| 7 | Teste de acesso anônimo (REST sem JWT) | **SIM** |
| 8 | Teste de login administrativo | **SIM** |
| 9 | Teste de funcionários autorizados | **SIM** |
| 10 | Teste de consultas e gravações legítimas | **SIM** |
| 11 | Validação de arquivos privados (Storage) | **SIM** |
| 12 | Monitoramento de erros e bloqueios | Não (observação) |
| 13 | Procedimento de recuperação em caso de falha | Não (plano definido) |

### Comandos que exigem aprovação antes de execução

- Qualquer `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` em `public.records`
- Qualquer `CREATE/ALTER/DROP POLICY` em `public.records`
- Qualquer `GRANT/REVOKE` em `public.records`
- Qualquer alteração em `storage.objects` ou `storage.buckets`
- Qualquer `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` (rollback)

---

## 11. Evidências necessárias para autorização final

O administrador deve fornecer:

1. Resultado de `scripts/inspect-records-auth.sql` executado no SQL Editor (captura de tela ou cópia do output)
2. Confirmação de que PITR/backups estão ativos no Supabase Pro
3. Lista de contas administrativas com `app_metadata` preenchido (legacy_auth_user_id, system_role)
4. Confirmação de que nenhum usuário legítimo ficará sem acesso após a correção (auditar `app_metadata` de todos os usuários)

---

## 12. Confirmação de proteção

| Item | Status |
|------|--------|
| Produção 8080 não alterada | ✅ Confirmado — nenhuma operação no banco operacional |
| Banco Supabase operacional não modificado | ✅ Nenhum SQL executado no real |
| Cadastros reais preservados | ✅ Nenhum dado apagado ou modificado |
| Saldos financeiros/estoque reais preservados | ✅ Nenhuma escrita no operacional |
| Serviços instalados preservados | ✅ Nenhuma alteração de infraestrutura |
| Componentes offline-first (D1, C2, Etapa E, 0.4.0) preservados | ✅ Nenhuma alteração nestas etapas |
| Nenhum push/merge/deploy automático | ✅ Conforme restrições |

---

## 13. Classificação final

### CORREÇÃO DEPENDE DE DADOS ADMINISTRATIVOS

O SQL de correção está preparado e testado em ambiente descartável (12/12 testes aprovados). No entanto, a aplicação operacional depende de:

1. **Execução de `scripts/inspect-records-auth.sql` no SQL Editor** para confirmar o estado real do banco (RLS, policies, grants atuais).
2. **Confirmação de backups/PITR** no Supabase Pro.
3. **Auditoria de `app_metadata`** de todos os usuários para garantir que ninguém legítimo fique sem acesso.
4. **Aprovação explícita** para aplicar `scripts/proposed-records-security.sql`.

Não há dados suficientes para afirmar que a correção pode ser aplicada sem risco operacional. A classificação é: **depende de dados administrativos**.

---

## Arquivos relacionados

| Arquivo | Função |
|---------|--------|
| `scripts/inspect-records-auth.sql` | Auditoria de leitura (SQL Editor) — já existia |
| `scripts/proposed-records-security.sql` | SQL de correção mínima — **novo, criado nesta sessão** |
| `scripts/proposed-payment-storage-policies.sql` | Política de Storage — já existia (não executada) |
| `scripts/security/test-rls.mjs` | Testes de RLS em PostgreSQL descartável — **novo, criado nesta sessão** |
| `src/lib/authAdapter.js` | Adaptador de auth existente — já impõe restrições de aplicação |
| `src/lib/cloudConfig.js` | Configuração Supabase (URL e anon key hardcoded) |
| `src/lib/cloudDb.js` | Camada de acesso ao Supabase via REST |
