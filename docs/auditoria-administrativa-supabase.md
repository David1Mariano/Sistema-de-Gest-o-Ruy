# Auditoria Administrativa — Segurança Supabase Pro

**Projeto:** `wvcvveqdkecsoygtilop`
**Repositório:** `https://github.com/David1Mariano/Sistema-de-Gest-o-Ruy`
**Branch:** `preparacao/windows-oficial-20261015`
**Último commit:** `8da0eb03faf8460a9a1899eb9bc4c5a468d3afcf`
**Produção:** `http://localhost:8080/` — permanece intacta.

**Status:** Nenhuma alteração operacional executada. Apenas preparação de consultas, SQL de correção proposto e roteiro para aprovação.

---

## 1. Revisão do SQL proposto (`scripts/proposed-records-security.sql`)

### 1.1 Revogação de grants para `authenticated` impede acessos legítimos?

**Sim, há risco.** O bloco 2 do SQL proposto executa:

```sql
revoke all on table public.records from public;
revoke all on table public.records from anon;
revoke all on table public.records from authenticated;
```

Isso remove TODOS os privilégios diretos da tabela para `authenticated`. Em seguida, as policies RLS são criadas para `authenticated`. No PostgREST/Supabase, o fluxo é:

1. Verificar privilégio de tabela (GRANT)
2. Verificar RLS policies

Quando `revoke all from authenticated` é aplicado, o papel `authenticated` perde privilégios diretos na tabela. As policies RLS criadas depois (`to authenticated`) permitem operações condicionadas, mas **alguns clientes do PostgREST podem falhar se não houver pelo menos um GRANT de uso na tabela**, mesmo que uma policy RLS permita.

**Recomendação:** Em vez de `revoke all from authenticated`, manter `grant select on public.records to authenticated` (mínimo para leitura) e deixar as policies RLS controlarem o acesso real. A revogação deve ser aplicada apenas a `anon` e `public`, que não devem ter nenhum privilégio.

### 1.2 As quatro policies atendem às operações reais?

| Operação | Policy | Cobertura |
|----------|--------|-----------|
| SELECT usuário comum | `ruy_records_select_owner` | ✅ Registros onde `owner_id = legacy_auth_user_id` |
| SELECT admin | `ruy_records_select_admin` | ✅ Todos os registros |
| INSERT usuário comum | `ruy_records_write_owner` (with_check) | ✅ Apenas onde é owner |
| INSERT admin | `ruy_records_write_admin` (with_check) | ✅ Todos |
| UPDATE usuário comum | `ruy_records_write_owner` (using + with_check) | ✅ Apenas onde é owner |
| UPDATE admin | `ruy_records_write_admin` (using + with_check) | ✅ Todos |
| DELETE usuário comum | `ruy_records_write_owner` (using) | ✅ Apenas onde é owner |
| DELETE admin | `ruy_records_write_admin` (using) | ✅ Todos |

**Observação:** As policies `for all` com `using` + `with_check` cobrem INSERT/UPDATE/DELETE. Para INSERT, apenas `with_check` é avaliado (não há linha antiga). Para UPDATE, ambos. Para DELETE, apenas `using`. Isso está correto.

**Gap:** Não há restrição por entidade. Um usuário comum pode escrever em `FinancialExpense`, `AccountsPayable`, etc., desde que seja o `owner_id`. O `authAdapter.js` também não restringe por entidade. Isso é consistente com o app atual, mas deve ser consciente.

### 1.3 Usuários admin/funcionários identificados por claims confiáveis?

**Sim.** O `authAdapter.js` (linhas 44-46) exige:
- `app_metadata.legacy_auth_user_id`
- `app_metadata.system_role`

Esses claims vêm do JWT assinado pelo Supabase Auth (`user.app_metadata`), que é confiável e não pode ser falsificado pelo cliente. As policies SQL usam `current_setting('request.jwt.claims', true)`, que no PostgREST contém o decoded JWT. Isso é compatível.

### 1.4 Campo `owner_id` corresponde ao identificador realmente utilizado?

**Não confirmado.** O `authAdapter.js` consulta `records?entity=eq.AuthUser&id=eq.${meta.legacy_auth_user_id}` (linha 51), ou seja, busca por `id` dentro do `data` jsonb da entidade `AuthUser`. O campo `data->>'owner_id'` é usado nas policies propostas como isolamento de registros.

Não há evidência no código de que TODOS os registros usem `data->>'owner_id'` consistentemente. Alguns registros legados podem não ter esse campo, ou usar outro nome. Isso precisa ser confirmado no SQL Editor antes de aplicar.

**Recomendação:** Adicionar ao PRÉ-CHECK uma consulta para verificar a existência do campo `owner_id` nos registros:

```sql
select entity, count(*), count(*) filter (where data ? 'owner_id') as com_owner_id
from public.records
group by entity;
```

### 1.5 Usuários inativos continuam bloqueados no banco?

**Não.** As policies RLS propostas NÃO filtram por `data->>'status'`. Um usuário inativo (`status = 'inativo'`, `'disabled'`, `'bloqueado'`) com claims válidos no JWT ainda pode ler seus próprios registros via RLS.

O bloqueio de inativos é feito APENAS no frontend (`authAdapter.js` linhas 69-72). No banco, não há proteção.

**Recomendação:** Adicionar condição de status nas policies de seleção, OU aceitar que o bloqueio é apenas no frontend. Para segurança em profundidade (defense in depth), recomenda-se adicionar:

```sql
and (data->>'status') !~* '(inativo|inactive|disabled|bloqueado)'
```

porém isso exige que TODOS os registros tenham o campo `status`, o que pode não ser verdade para entidades não-usuário. **Registrado como gap conhecido.**

### 1.6 Policies permissivas existentes poderiam liberar acesso?

**Sim.** Se existirem policies anteriores com `USING (true)` ou aplicáveis a `anon`, elas são adicionadas (OR lógica) às novas policies. Uma policy permissiva existente manteria o acesso aberto mesmo após a correção.

**Recomendação:** Antes de criar as novas policies, remover todas as policies existentes em `public.records`:

```sql
drop policy if exists "ruy_records_select_owner" on public.records;
drop policy if exists "ruy_records_select_admin" on public.records;
drop policy if exists "ruy_records_write_admin" on public.records;
drop policy if exists "ruy_records_write_owner" on public.records;
-- E quaisquer outras policies existentes, listadas pelo PRÉ-CHECK 2
```

### 1.7 `FORCE ROW LEVEL SECURITY` tem efeitos sobre outras conexões?

**Sim.** `ALTER TABLE ... FORCE ROW LEVEL SECURITY` força RLS mesmo para o owner da tabela. No Supabase, o owner de `public.records` é tipicamente `postgres` ou um role de administração. Isso significa:

- Conexões administrativas diretas (psql, scripts de admin) como owner ficarão sujeitas a RLS.
- Se alguma integração ou script se conecta como owner e precisa acessar todos os registros sem filtro, ele será afetado.

No contexto Supabase/PostgREST, isso é desejável. Mas deve-se verificar se há scripts ou integrações que se conectam diretamente como owner e precisam de acesso irrestrito.

### 1.8 INSERT, UPDATE, DELETE com USING e WITH CHECK corretos?

| Policy | USING | WITH CHECK | Comentário |
|--------|-------|------------|------------|
| `ruy_records_select_owner` | ✅ | N/A (SELECT) | OK |
| `ruy_records_select_admin` | ✅ | N/A (SELECT) | OK |
| `ruy_records_write_admin` | ✅ | ✅ | OK para todos |
| `ruy_records_write_owner` | ✅ | ✅ | OK para todos |

**Observação:** Para `ruy_records_write_owner`, o `with_check` verifica que o NOVO registro (ou o registro após UPDATE) tem `owner_id = legacy_auth_user_id`. Isso impede que um usuário mude o `owner_id` de um registro para outro usuário. Bom.

### 1.9 Modelo compatível com PostgREST?

**Sim.** `current_setting('request.jwt.claims', true)` é o mecanismo padrão do PostgREST/Supabase para acessar claims do JWT. As policies são avaliadas no nível do banco, após autenticação pelo PostgREST.

### 1.10 Buckets e objetos privados do Storage possuem controles?

**Não.** O SQL proposto NÃO toca Storage. O script de inspeção (`scripts/inspect-records-auth.sql` linhas 56-60) consulta o bucket `anexos` e suas policies, mas não aplica nenhuma correção. O Storage precisa de auditoria e políticas separadas.

**Recomendação:** Criar SQL separado para Storage (anexos privados), aplicando políticas que restrinjam INSERT/SELECT a usuários autenticados com claims válidos.

---

## 2. Consultas Administrativas para SQL Editor

O arquivo `scripts/inspect-records-auth.sql` já contém exclusivamente consultas de leitura. Ele está pronto para uso no SQL Editor:

```
https://supabase.com/dashboard/project/wvcvveqdkecsoygtilop/sql
```

### 2.1 Verificações prévias (PRÉ-CHECK)

As consultas abaixo devem ser executadas ANTES de qualquer correção. Todas são somente leitura e não exportam dados sensíveis pessoais:

| Consulta | Propósito | Arquivo |
|----------|-----------|---------|
| RLS ativo em `public.records` | Verificar se RLS já está habilitado | `inspect-records-auth.sql` linha 7-10 |
| Policies existentes | Listar policies atuais na tabela | `inspect-records-auth.sql` linha 12-15 |
| Grants explícitos | Ver quem tem privilégio direto na tabela | `inspect-records-auth.sql` linha 18-23 |
| Privilégios efetivos `anon`/`authenticated` | Verificar acesso efetivo aos papéis | `inspect-records-auth.sql` linha 26-33 |
| Privilégios de coluna | Verificar privilégios por coluna | `inspect-records-auth.sql` linha 35-44 |
| Inventário AuthUser (metadados apenas) | Contar perfis, emails distintos (sem dados sensíveis) | `inspect-records-auth.sql` linha 47-53 |
| Storage bucket `anexos` | Verificar configuração do bucket | `inspect-records-auth.sql` linha 56-57 |
| Policies de Storage | Verificar policies de objetos/buckets | `inspect-records-auth.sql` linha 58-60 |

### 2.2 Consulta adicional recomendada (não existe ainda)

Verificar consistência do campo `owner_id` antes de aplicar políticas:

```sql
select entity, count(*) as total,
       count(*) filter (where data ? 'owner_id') as com_owner_id,
       count(*) filter (where data ? 'status') as com_status
from public.records
group by entity
order by entity;
```

### 2.3 Instruções para o administrador

1. Acessar o SQL Editor do Supabase: `https://supabase.com/dashboard/project/wvcvveqdkecsoygtilop/sql`
2. Copiar o conteúdo de `scripts/inspect-records-auth.sql`
3. Executar (somente leitura)
4. Salvar o resultado para comparação pós-correção
5. Executar a consulta adicional de `owner_id` para confirmar cobertura
6. Apenas após revisar os resultados, considerar aplicar `scripts/proposed-records-security.sql` com as correções apontadas na seção 4

---

## 3. Roteiro de Validação de Backup

### 3.1 O que confirmar no painel do Supabase

| Item | Onde verificar | O que esperar |
|------|---------------|---------------|
| Backup automático diário | Configurações > Database > Backups | Último backup com data/hora recente |
| PITR (Point-in-Time Recovery) | Configurações > Database > Backups | "Habilitado" se contratado no plano Pro |
| Retenção de backup | Configurações > Database > Backups | Período de retenção (ex: 7 dias) |
| Possibilidade de restauração | Configurações > Database > Backups | Botão de restore disponível |

### 3.2 Procedimento de recuperação se login for bloqueado

1. Usar o SQL Editor do Supabase para executar SQL diretamente (bypassa o app)
2. Restaurar policies anteriores se necessário (capturar antes da correção)
3. Se precisar desabilitar RLS emergencialmente:
   ```sql
   alter table public.records disable row level security;
   alter table public.records no force row level security;
   ```
4. Recriar grants se necessário:
   ```sql
   grant select on public.records to authenticated;
   ```

### 3.3 Backup lógico recomendado antes da correção

```bash
# Esquema completo
pg_dump --schema-only --dbname=<connection-string> > schema_backup.sql

# Policies e grants atuais
psql -d <db> -c "SELECT * FROM pg_policies WHERE tablename='records';" > policies_before.sql
psql -d <db> -c "SELECT * FROM information_schema.role_table_grants WHERE table_name='records';" > grants_before.sql
```

**Não executar restauração no banco operacional.**

---

## 4. Revisão de Segurança — Discrepâncias e Gaps

### 4.1 Discrepâncias entre modelo implementado e dados reais

| Item | Estado no código | Estado no banco (desconhecido) | Ação |
|------|-----------------|-------------------------------|------|
| Campo `owner_id` em registros | Assumido nas policies | Não confirmado | Executar consulta de cobertura |
| Campo `status` em registros | Usado no authAdapter (frontend) | Não confirmado | Executar consulta de cobertura |
| `legacy_auth_user_id` em app_metadata | Exigido pelo authAdapter | Não confirmado para todos os users | Auditar app_metadata dos usuários |
| `system_role` em app_metadata | Exigido pelo authAdapter | Não confirmado para todos os users | Auditar app_metadata dos usuários |

### 4.2 Gaps identificados

1. **Usuários inativos não bloqueados no banco** — apenas no frontend. Gap de defense in depth.
2. **Revogação de grant para `authenticated`** — pode quebrar clientes PostgREST que precisam de privilégio mínimo. Recomendado manter `grant select`.
3. **Storage sem políticas** — bucket `anexos` sem proteção de RLS. Precisa de SQL separado.
4. **Registros sem `owner_id`** — usuários não veriam nada (safe by default), mas pode quebrar operações legítimas.
5. **FORCE RLS afeta owner da tabela** — scripts de administração direta podem ser impactados.

### 4.3 Proposta SQL corrigida (não executar)

As seguintes alterações devem ser feitas no `scripts/proposed-records-security.sql` antes de qualquer aplicação:

**Alteração A — Manter grant mínimo para authenticated:**

Substituir:
```sql
revoke all on table public.records from authenticated;
```
Por:
```sql
grant select on table public.records to authenticated;
revoke insert, update, delete on table public.records from authenticated;
```

**Alteração B — Remover policies existentes antes de criar:**

Adicionar antes do bloco de criação:
```sql
drop policy if exists "ruy_records_select_owner" on public.records;
drop policy if exists "ruy_records_select_admin" on public.records;
drop policy if exists "ruy_records_write_admin" on public.records;
drop policy if exists "ruy_records_write_owner" on public.records;
-- Remover QUALQUER outra policy existente listada pelo PRÉ-CHECK 2
```

**Alteração C — Consulta de cobertura de owner_id (pré-check adicional):**

```sql
select entity, count(*) as total,
       count(*) filter (where data ? 'owner_id') as com_owner_id
from public.records
group by entity;
```

**Alteração D — Nota sobre Storage:**

Adicionar nota de que Storage requer SQL separado e não está escopo desta correção.

---

## 5. Relatório Final

### 5.1 Grants que precisam ser preservados para usuários autenticados

| Privilegio | Motivo |
|------------|--------|
| `SELECT` on `public.records` | Necessário para leitura via PostgREST (mesmo com RLS) |
| `USAGE` on schema `public` | Necessário para acessar a tabela |

### 5.2 Grants de `anon` que devem ser removidos

Todos. O papel `anon` não deve ter nenhum privilégio em `public.records`:

```sql
revoke all on table public.records from anon;
revoke all on table public.records from public;
```

### 5.3 Policies que precisam ser criadas ou revisadas

| Policy | Operação | Condição |
|--------|----------|----------|
| `ruy_records_select_owner` | SELECT | `owner_id = legacy_auth_user_id` OU próprio AuthUser |
| `ruy_records_select_admin` | SELECT | `system_role in ('admin','super_admin')` |
| `ruy_records_write_admin` | INSERT/UPDATE/DELETE | `system_role in ('admin','super_admin')` |
| `ruy_records_write_owner` | INSERT/UPDATE/DELETE | `owner_id = legacy_auth_user_id` |

**Antes de criar:** remover todas as policies existentes que possam ser permissivas.

### 5.4 Impacto esperado sobre login e módulos

| Módulo | Impacto |
|--------|---------|
| Login (`loginViaEmailPassword`) | Nenhum — não depende de RLS na tabela records |
| `me()` / validação de perfil | Pode falhar se RLS bloquear leitura de `AuthUser` do próprio usuário. A policy `ruy_records_select_owner` cobre isso (condição `entity = 'AuthUser' and id = legacy_auth_user_id`). |
| Telas de cadastro/consulta | Funcionam apenas para registros onde o usuário é owner |
| Telas administrativas | Funcionam para admin/super_admin |
| Usuários inativos | Bloqueados no frontend (403), mas não no banco (gap) |
| Storage (anexos) | Não afetado por este SQL — requer correção separada |

### 5.5 Consultas administrativas prontas

Todas em `scripts/inspect-records-auth.sql` (somente leitura). Executar no SQL Editor do Supabase antes de qualquer correção.

### 5.6 Situação dos backups

| Item | Status |
|------|--------|
| Backup automático | Não confirmado — verificar no painel |
| PITR | Não confirmado — verificar no painel |
| Backup lógico pré-correção | Não executado — preparar antes de aplicar |

### 5.7 Testes adicionais necessários

1. **Supabase Auth:** Testar login com usuário admin e usuário comum via interface do app
2. **PostgREST anônimo:** Tentar acessar `/rest/v1/records` com chave anon, sem JWT — deve retornar 401/403
3. **PostgREST autenticado:** Testar SELECT/INSERT/UPDATE/DELETE com JWT de usuário comum e admin
4. **Storage:** Tentar acessar objetos no bucket `anexos` sem autorização
5. **Usuário inativo:** Tentar login com usuário inativo — deve ser bloqueado pelo authAdapter (403)

### 5.8 Condições exatas para aplicar a correção

Todas devem ser verdadeiras antes de aplicar `scripts/proposed-records-security.sql`:

1. [ ] PRÉ-CHECK 1 executado: confirmar estado atual do RLS
2. [ ] PRÉ-CHECK 2 executado: listar policies existentes (para remoção)
3. [ ] PRÉ-CHECK 3 executado: listar grants atuais
4. [ ] Consulta de cobertura de `owner_id` executada: confirmar que a maioria dos registros tem o campo
5. [ ] Auditoria de `app_metadata`: confirmar que todos os usuários legítimos têm `legacy_auth_user_id` e `system_role`
6. [ ] Backup confirmado: backup lógico ou PITR disponível
7. [ ] Aprovação explícita do proprietário para aplicar no banco operacional
8. [ ] Janela de manutenção: aplicação em horário de baixo impacto
9. [ ] Plano de rollback testado: saber como remover as policies se algo falhar

---

## 6. Confirmação de proteção

| Item | Status |
|------|--------|
| Produção 8080 não alterada | ✅ Nenhuma operação no banco operacional |
| Banco Supabase operacional não modificado | ✅ Nenhum SQL executado no real |
| Cadastros reais preservados | ✅ Nenhum dado apagado ou modificado |
| Saldos financeiros/estoque reais preservados | ✅ Nenhuma escrita no operacional |
| Serviços instalados preservados | ✅ Nenhuma alteração de infraestrutura |
| Componentes offline-first (D1, C2, Etapa E, 0.4.0) preservados | ✅ Nenhuma alteração nestas etapas |
| Nenhum push/merge/deploy automático | ✅ Conforme restrições |

---

## 7. Classificação final

### CORREÇÃO DEPENDE DE DADOS ADMINISTRATIVOS

O SQL de correção está preparado (12/12 testes de RLS aprovados em ambiente descartável), mas a aplicação operacional depende de:

1. Execução de `scripts/inspect-records-auth.sql` no SQL Editor para confirmar o estado real do banco
2. Confirmação de cobertura do campo `owner_id` nos registros existentes
3. Auditoria de `app_metadata` de todos os usuários
4. Confirmação de backups/PITR no Supabase Pro
5. Aprovação explícita para aplicar as políticas

Não há dados suficientes para afirmar que a correção pode ser aplicada sem risco operacional.

---

## Arquivos relacionados

| Arquivo | Função | Status |
|---------|--------|--------|
| `scripts/inspect-records-auth.sql` | Auditoria de leitura (SQL Editor) | Existente — pronto para uso |
| `scripts/proposed-records-security.sql` | SQL de correção mínima | **Requer ajustes (seção 4.3)** |
| `scripts/proposed-payment-storage-policies.sql` | Política de Storage | Existente — não executada, requer revisão separada |
| `scripts/security/test-rls.mjs` | Testes de RLS em PostgreSQL descartável | 12/12 aprovados (ambiente local) |
| `docs/plano-correcao-seguranca-supabase.md` | Plano completo anterior | Suplantado por este documento |
| `src/lib/authAdapter.js` | Adaptador de auth existente | Já impõe restrições no frontend |
| `src/lib/cloudConfig.js` | Config Supabase (URL + anon key) | Chave anon hardcoded — não alterar |
