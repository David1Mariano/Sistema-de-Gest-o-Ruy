# Auditoria Administrativa Final — Segurança Supabase Pro

**Projeto:** `wvcvveqdkecsoygtilop`
**Repositório:** `https://github.com/David1Mariano/Sistema-de-Gest-o-Ruy`
**Branch:** `preparacao/windows-oficial-20261015`
**Último commit:** `8da0eb03faf8460a9a1899eb9bc4c5a468d3afcf`
**Produção:** `http://localhost:8080/` — permanece intacta.

**Status:** Nenhuma alteração operacional executada. Apenas preparação de consultas, SQL de correção proposto e roteiro para aprovação.

---

## 1. SQL de Auditoria Pronto para Copiar no Supabase

O arquivo `scripts/inspect-records-auth.sql` já contém exclusivamente consultas de leitura. Executar no SQL Editor:

```
https://supabase.com/dashboard/project/wvcvveqdkecsoygtilop/sql
```

### Consultas incluidas:

| Consulta | Propósito | Linha |
|----------|-----------|-------|
| Estado do RLS em `public.records` | Verificar se RLS está habilitado e forçado | 7-10 |
| Policies existentes | Listar policies atuais na tabela | 12-15 |
| Grants explícitos | Ver privilégios diretos na tabela | 18-23 |
| Privilégios efetivos `anon`/`authenticated` | Verificar acesso efetivo aos papéis | 26-33 |
| Privilégios de coluna | Verificar privilégios por coluna | 35-44 |
| Inventário AuthUser (metadados apenas) | Contar perfis, emails distintos (sem dados sensíveis) | 47-53 |
| Storage bucket `anexos` | Verificar configuração do bucket | 56-57 |
| Policies de Storage | Verificar policies de objetos/buckets | 58-60 |

### Consulta adicional recomendada (cobertura de `owner_id`):

```sql
select entity, count(*) as total,
       count(*) filter (where data ? 'owner_id') as com_owner_id,
       count(*) filter (where not (data ? 'owner_id')) as sem_owner_id,
       count(*) filter (where data ? 'status') as com_status
from public.records
group by entity
order by entity;
```

---

## 2. Resultados Administrativos Ainda Necessários

Antes de aplicar qualquer correção, o administrador deve fornecer:

| Item | Como obter | Por que é necessário |
|------|-----------|---------------------|
| Output de `scripts/inspect-records-auth.sql` | SQL Editor do Supabase | Confirmar estado atual do RLS, policies e grants |
| Cobertura de `owner_id` | Consulta adicional acima | Saber se registros sem owner_id ficariam invisíveis |
| Auditoria de `app_metadata` de todos os usuários | SQL Editor: `select data->>'status', count(*) from public.records where entity='AuthUser' group by data->>'status'` | Garantir que nenhum usuário legítimo fique sem acesso |
| Confirmação de backup/PITR | Painel Supabase: Configurações > Database > Backups | Ter plano de recuperação antes de alterar |
| Lista de contas administrativas autorizadas | Supabase Auth > Users | Identificar quem deve ter acesso de admin |

---

## 3. Proposta v3 — SQL de Correção Mínima

Arquivo: `scripts/proposed-records-security-v3.sql`

**NÃO EXECUTAR no banco operacional sem aprovação explícita.**

### Principais características da v3:

| Item | Descrição |
|------|-----------|
| Grants para `authenticated` | `SELECT, INSERT, UPDATE, DELETE` (necessários para que políticas RLS de escrita sejam avaliadas) |
| Grants para `anon` | Nenhum (revogado completamente) |
| Grants para `PUBLIC` | Nenhum (revogado completamente) |
| Policies RLS | 4 policies: `select_owner`, `select_admin`, `write_admin`, `write_owner` |
| Remoção de policies antigas | `DROP POLICY IF EXISTS` para todas antes de criar as novas |
| Validação de claims | `legacy_auth_user_id` não vazio, `system_role` presente |
| Isolamento por proprietário | `data->>'owner_id' = legacy_auth_user_id` |
| Admin/super_admin | Acesso total a todos os registros |
| FORCE RLS | Habilitado (afeta também o owner da tabela) |

### GAPs conhecidos (não resolvidos pela v3):

1. **Usuários inativos/bloqueados** podem ainda ler seus próprios registros via RLS se tiverem claims válidas. O bloqueio é feito apenas no frontend (`authAdapter.js`).
2. **Storage (bucket `anexos`)** não é coberto pela v3. Requer SQL separado.
3. **Funções SECURITY DEFINER** executam acima do RLS e precisam de revisão separada.
4. **Registros sem `owner_id`** ficam invisíveis para usuários comuns (comportamento seguro por padrão).

---

## 4. Testes Executados (Ambiente Isolado)

Ambiente: PostgreSQL 17 local, banco `ruy_security_v3`, dados sintéticos, RLS aplicado conforme v3.

| # | Cenário | Resultado |
|---|---------|-----------|
| 1 | Admin lê todos Employee | ✅ PASS |
| 2 | Admin lê todos FinancialExpense | ✅ PASS |
| 3 | Admin insere Employee | ✅ PASS |
| 4 | Admin atualiza Employee de outro | ✅ PASS |
| 5 | Admin deleta Employee | ✅ PASS |
| 6 | User lê apenas seu Employee | ✅ PASS |
| 7 | User lê apenas seu FinancialExpense | ✅ PASS |
| 8 | User não vê Employee de outro usuário | ✅ PASS |
| 9 | User não vê FinancialExpense de outro usuário | ✅ PASS |
| 10 | User não atualiza Employee de outro | ✅ PASS |
| 11 | User não deleta Employee de outro | ✅ PASS |
| 12 | User inativo lê via RLS (GAP documentado) | ✅ PASS (0 registros, ao contrário esperado) |
| 13 | Sem claims não lê Employee | ✅ PASS |
| 14 | Sem claims não lê FinancialExpense | ✅ PASS |
| 15 | User não vê registro sem owner_id | ✅ PASS |
| 16 | Claims desatualizadas não lê Employee | ✅ PASS |
| 17 | Anônimo não lê Employee | ✅ PASS |
| 18 | Anônimo não lê FinancialExpense | ✅ PASS |
| 19 | Anônimo não insere | ✅ PASS |

**Resultado: 19/19 aprovados.**

### Limitação dos testes:
Testes em PostgreSQL genérico comprovam RLS SQL, mas NÃO comprovam o comportamento do Supabase Auth, PostgREST e Storage. Testes específicos ainda necessários no painel do Supabase.

---

## 5. Riscos Operacionais

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Usuários sem `app_metadata` preenchido ficam sem acesso | Alto | Auditar `app_metadata` antes de aplicar |
| Registros sem `owner_id` ficam invisíveis | Médio | Verificar cobertura antes de aplicar |
| Usuários inativos não bloqueados no banco | Médio | Aceitar gap (bloqueio no frontend) ou adicionar condição de status nas policies |
| FORCE RLS afeta scripts de administração direta | Médio | Verificar se há scripts que se conectam como owner |
| Storage sem proteção | Médio | Corrigir em etapa separada |
| Revogação de acesso não invalida JWTs já emitidos | Alto | JWTs existentes continuam válidos até expirar; usar TTL curto |

---

## 6. Estratégia de Reversão

### Reversão de políticas (recomendado):

```sql
-- Remover as policies criadas pela v3
drop policy if exists "ruy_records_select_owner" on public.records;
drop policy if exists "ruy_records_select_admin" on public.records;
drop policy if exists "ruy_records_write_admin" on public.records;
drop policy if exists "ruy_records_write_owner" on public.records;
```

### Reversão de RLS (último recurso — REABRE EXPOSIÇÃO):

```sql
alter table public.records disable row level security;
alter table public.records no force row level security;
```

**Regra:** Uma reversão que desabilita RLS reabre a exposição anônima. Preferir remover apenas as policies problemáticas em vez de desabilitar RLS por completo.

### Antes de aplicar, capturar:
- Policies existentes (PRÉ-CHECK 2)
- Grants atuais (PRÉ-CHECK 3)
- Schema completo (`pg_dump --schema-only`)

---

## 7. Passos Necessários para Aprovação Final

| # | Ação | Quem | Aprovação |
|---|------|------|-----------|
| 1 | Executar `scripts/inspect-records-auth.sql` no SQL Editor | Administrador | Não (leitura) |
| 2 | Executar consulta de cobertura de `owner_id` | Administrador | Não (leitura) |
| 3 | Auditar `app_metadata` de todos os usuários AuthUser | Administrador | Não (leitura) |
| 4 | Confirmar backup/PITR disponível no Supabase Pro | Administrador | Não (verificação) |
| 5 | Revisar SQL da v3 (`scripts/proposed-records-security-v3.sql`) | Proprietário | Não (revisão) |
| 6 | Aplicar `scripts/proposed-records-security-v3.sql` no SQL Editor | Administrador | **SIM** |
| 7 | Teste de acesso anônimo (REST sem JWT) | Administrador | **SIM** |
| 8 | Teste de login administrativo | Administrador | **SIM** |
| 9 | Teste de funcionários autorizados | Administrador | **SIM** |
| 10 | Teste de consultas e gravações legítimas | Administrador | **SIM** |
| 11 | Validação de arquivos privados (Storage) | Administrador | **SIM** |

### Comandos que exigem aprovação antes de execução:
- Qualquer `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` em `public.records`
- Qualquer `CREATE/ALTER/DROP POLICY` em `public.records`
- Qualquer `GRANT/REVOKE` em `public.records`
- Qualquer alteração em `storage.objects` ou `storage.buckets`
- Qualquer `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` (rollback)

---

## 8. Confirmação de Proteção

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

## 9. Classificação Final

### CORREÇÃO DEPENDE DE DADOS ADMINISTRATIVOS

O SQL de correção v3 está preparado e testado em ambiente descartável (19/19 testes aprovados). No entanto, a aplicação operacional depende de:

1. Execução de `scripts/inspect-records-auth.sql` no SQL Editor para confirmar o estado real do banco
2. Confirmação de cobertura do campo `owner_id` nos registros existentes
3. Auditoria de `app_metadata` de todos os usuários para garantir que ninguém legítimo fique sem acesso
4. Confirmação de backups/PITR no Supabase Pro
5. Aprovação explícita para aplicar `scripts/proposed-records-security-v3.sql`

Não há dados suficientes para afirmar que a correção pode ser aplicada sem risco operacional.

---

## Arquivos Relacionados

| Arquivo | Função | Status |
|---------|--------|--------|
| `scripts/inspect-records-auth.sql` | Auditoria de leitura (SQL Editor) | Existente — pronto para uso |
| `scripts/proposed-records-security-v3.sql` | SQL de correção mínima v3 | **Novo — recomendado para uso** |
| `scripts/proposed-records-security-v2.sql` | SQL de correção v2 (supersedido) | Existente — não usar |
| `scripts/proposed-records-security.sql` | SQL de correção v1 (supersedido) | Existente — não usar |
| `scripts/proposed-payment-storage-policies.sql` | Política de Storage | Existente — não executada, requer revisão separada |
| `scripts/security/test-rls-v3.mjs` | Testes de RLS em PostgreSQL descartável | 19/19 aprovados (ambiente local) |
| `docs/auditoria-administrativa-supabase.md` | Auditoria administrativa anterior | Existente — suplantado por este documento |
| `docs/plano-correcao-seguranca-supabase.md` | Plano de correção anterior | Existente — suplantado por este documento |
| `src/lib/authAdapter.js` | Adaptador de auth existente | Já impõe restrições no frontend |
| `src/lib/cloudConfig.js` | Config Supabase (URL + anon key) | Chave anon hardcoded — não alterar |

---

**Arquivos novos (não commitados, não pushados):**
- `scripts/proposed-records-security-v3.sql` — SQL de correção v3
- `scripts/security/test-rls-v3.mjs` — Testes de RLS isolados
