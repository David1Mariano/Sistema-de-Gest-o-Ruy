# Migração de arquivos: Supabase Storage → Cloudflare R2

> Etapa 1 — **auditoria e preparação segura**.
> Nenhum dado real foi alterado, nenhum arquivo foi copiado, nenhum objeto foi
> apagado, nenhuma credencial existe no repositório.

---

## 1. Estado da cópia física (informado pelo proprietário, já validado)

| Item | Valor |
|---|---|
| Origem | Supabase Storage, bucket `anexos` |
| Destino | Cloudflare R2, bucket `ruy-gestao-arquivos`, prefixo `anexos/` |
| Validação | `rclone`: **33 matching files, 0 differences** |

Os bytes já estão no R2 com o **caminho preservado**. Nada foi copiado de novo
nesta etapa e nada foi apagado — no Supabase nem no R2.

---

## 2. Mapa de todo uso de Storage no código

Toda a leitura de anexo do sistema passa por **um** carregador
(`src/lib/paymentProof.js`) e **um** visualizador
(`src/components/rh/AttachmentPreview.jsx`). Não existe segunda porta de
entrada.

### 2.1 Bucket encontrado

`PAYMENT_PROOF_BUCKET = 'anexos'` (`src/lib/paymentProof.js`) — **bucket único**,
confirmado no código e em `docs/auth-migration-audit.md`. Não existe outro
bucket, nem pasta solta fora dele. `scripts/inspect-payment-storage.sql`
consulta o bucket real (somente leitura) e `docs/auth-migration-audit.md`
registra: privado (`public=false`), `file_size_limit=15728640`, MIME
JPEG/PNG/WEBP/PDF.

### 2.2 Caminho real gravado

```
storage_path = {Entidade}/{id do registro}/{uuid}.{ext}
```

Exemplo real: `EmployeePayment/pay_123/1e8664e1-ecf0-4078-b68c-909cb97ab144.jpg`.
O objeto no bucket fica em `anexos/EmployeePayment/pay_123/<uuid>.jpg`.

Como a cópia para o R2 preservou o caminho sob o prefixo `anexos/`, a tradução
é uma linha, e está em `r2ObjectKey()`:

```
chave R2 = "anexos/" + storage_path
```

`storage_path` **não é uma coluna**: é uma chave dentro do `data` jsonb da
tabela genérica `records`, gravada junto de `file_name`, `mime_type` e
`file_size`.

### 2.3 Entidade × campo × fluxo

| Entidade | Campo | Grava como | Lê como | Bucket | Exclui arquivo? |
|---|---|---|---|---|---|
| `EmployeePayment` | `proof_url` | base64 (legado) ou vazio | `PaymentProof` → `AttachmentPreview` | — / `anexos` | **não** |
| `EmployeePayment` | `storage_path` | `uploadPaymentProof` (bucket `anexos`) | signed URL + `Blob` | `anexos` | **não** |
| `FinancialExpense` (gasto diário) | `proof_url` | `uploadFileLocal` → **base64** | `ExpenseAttachment` → `AttachmentPreview` | — | **não** |
| `FinancialExpense` | `invoice_url` | `uploadFileLocal` → **base64** (nota fiscal) | `ExpenseAttachment` | — | **não** |
| `FinancialExpense` | `storage_path` | leitura compatível | signed URL + `Blob` | `anexos` | **não** |
| `AccountsPayable` | `document_url` | `uploadFileLocal` → **base64** | `PayableAttachment` | — | **não** |
| `AccountsPayable` | `proof_url` | `uploadFileLocal` → **base64** (baixa) | `PayableAttachment` | — | **não** |
| `AccountsPayable` | `storage_path` | leitura compatível | signed URL + `Blob` | `anexos` | **não** |
| `Vale` | `proof_url` | `uploadFileLocal` → **base64** | `AttachmentPreview` (prefixo `Vale`) | — | **não** |
| `Employee` | `photo_url` | `uploadFileLocal` → **base64** (data URL) | `<img src>` direto | — | **não** |
| `EmployeeDocument` | `file_url` | `uploadFileLocal` → **base64** | apenas "arquivo anexado ✓" | — | **não** |
| `Purchase` (compras) | `invoice_url` (NF) | `uploadFileLocal` → **base64** | `AttachmentPreview` | — | **não** |

Prefixos de pasta já existentes no Supabase: `EmployeePayment` (único gravado
pelo sistema hoje), `FinancialExpense`, `AccountsPayable`, `Vale`, `Purchase`,
`EmployeeDocument` — todos em `ATTACHMENT_PREFIXES`.

**Nenhum fluxo de exclusão de arquivo existe hoje.** Excluir registro apaga a
linha, nunca o objeto. Isso foi mantido (ver §7).

### 2.4 Onde o Storage é chamado de fato

`grep supabase.storage|storage.from(` → **2 ocorrências**, ambas em
`src/lib/paymentProof.js` (defaults de `uploadPaymentProof` e
`loadPrivatePaymentProof`). Não há outro lugar. Nenhum componente React fala
S3/Storage.

---

## 3. Base64 legado (dentro do próprio registro)

`base44.integrations.Core.UploadFile` resolve para `uploadFileLocal`
(`src/lib/localDb.js`), que **converte o arquivo em data URL e devolve
`{ file_url }`**. Quem grava o resultado em `proof_url` grava o arquivo inteiro
dentro do jsonb do registro.

Consequências reais, e é por isso que o R2 importa:

- o payload da tabela `FinancialExpense` cresce com o arquivo;
- o comprovante viaja inteiro em toda leitura de lista;
- `document_number`/anexo de compra vive igual;
- o R2 **não** corrige isso sozinho: enquanto `uploadFileLocal` continuar
  sendo o destino dos uploads de gasto/conta/vale/documento/foto, novos
  arquivos continuam nascendo em base64.

**Fluxos que ainda aceitam e ainda geram base64 (todos, hoje):**

| Fluxo | Campo | Gera base64 hoje? | Leitura suporta base64? |
|---|---|---|---|
| Gasto diário | `proof_url` | **sim** | **sim** |
| Gasto diário | `invoice_url` | **sim** | **sim** |
| Contas a pagar | `document_url` | **sim** | **sim** |
| Contas a pagar — baixa | `proof_url` | **sim** | **sim** |
| Vale | `proof_url` | **sim** | **sim** |
| Foto do colaborador | `photo_url` | **sim** | sim (via normalizador) |
| Documento do colaborador | `file_url` | **sim** | **não** (só exibe "anexado ✓") |
| Pagamento ao colaborador | `proof_url` | não (vai para o bucket) | **sim** |

Base64 **não foi migrado** nesta etapa e não será migrado em lote: é decisão
de produto (o registro deixa de carregar o arquivo), não de armazenamento.

Para saber **quantos** registros reais têm base64 hoje, sem escrever nada:

```bash
node scripts/audit-arquivos-referencias.mjs
```

Ele faz um único `GET /rest/v1/records`, imprime contagem por entidade/campo e
lista os `storage_path`. Não imprime byte de arquivo nem trecho de base64.

---

## 4. Arquitetura preparada

```
  React (nunca fala R2)
  ┌────────────────────────────────────────────────────────────┐
  │ AttachmentPreview  (zoom, download, PDF, imprimir)         │
  │   └─ loadPaymentProof  ← resolução por provedor            │
  │        ├─ base64 legado                                    │
  │        ├─ URL http(s)/blob                                 │
  │        ├─ storage_path SEM provider → Supabase `anexos`     │
  │        └─ storage_path COM storage_provider='r2'            │
  └────────────────────────────────────────────────────────────┘
                    │ src/lib/storage/attachmentClient.js
                    │ (só VITE_STORAGE_API_URL, sem segredo)
  ┌─────────────────▼──────────────────────────────────────────┐
  │ Backend Node  server/storage/                              │
  │   storageApi     HTTP + CORS + rate limit + só sub-rede    │
  │   storageHandler exige identidade (Supabase Auth)           │
  │   storageService upload/download/getSignedUrl/delete/exists │
  │   r2Client       SigV4 com node:crypto (sem SDK novo)      │
  └────────────────────────────────────────────────────────────┘
                    │ R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
                    ▼
              Cloudflare R2 (bucket privado)
```

### Arquivos

| Arquivo | Papel |
|---|---|
| `src/lib/storage/attachmentPath.js` | **contrato único** de referência: buckets, prefixos, validação de caminho, chave R2, resolução de origem |
| `src/lib/storage/attachmentClient.js` | cliente do frontend (falha fechado sem endpoint) |
| `server/storage/r2Client.mjs` | cliente S3/SigV4, `request` injetável |
| `server/storage/storageService.mjs` | o `storageService` do enunciado |
| `server/storage/storageHandler.mjs` | Fetch handler chamável, exige identidade |
| `server/storage/storageApi.mjs` | host Node + leitura de ambiente + `storage:dev` |
| `scripts/check-storage-config.mjs` | `storage:check`: diz o que falta, sem imprimir valor |
| `scripts/audit-arquivos-referencias.mjs` | auditoria somente-leitura dos registros |
| `scripts/test-storage-r2.mjs` | suíte (24 testes, sem rede real) |

`server/storage/*.mjs` importa `src/lib/storage/attachmentPath.js`: o backend e
o frontend compartilham **o mesmo arquivo** de contrato. Não existem duas
implementações para divergirem.

### Rotas do backend

| Rota | Método | Devolve |
|---|---|---|
| `/storage/health` | GET | `provider`, `bucket`, `configured`, `delete_enabled`, `max_bytes` |
| `/storage/upload` | POST | os campos a gravar no registro (`storage_path`, `storage_provider`, `storage_bucket`, `file_name`, `mime_type`, `file_size`) |
| `/storage/signed-url` | GET | URL temporária (TTL ≤ 300 s) |
| `/storage/object` | GET | proxy do arquivo (MIME, `nosniff`, `no-store`) |
| `/storage/exists` | GET | `{ exists, size }` |
| `/storage/delete` | POST | **403 enquanto `STORAGE_DELETE_ENABLED` não for `true`** |

---

## 5. Segurança de credenciais

Credenciais existem **somente no backend**, lidas de `process.env`:

| Variável | Exemplo | No repositório? |
|---|---|---|
| `R2_ACCOUNT_ID` | conta do Cloudflare | **não** |
| `R2_ACCESS_KEY_ID` | access key | **não** |
| `R2_SECRET_ACCESS_KEY` | secret key | **não** |
| `R2_BUCKET` | `ruy-gestao-arquivos` | não (tem padrão no código) |
| `R2_ENDPOINT` | derivado do account id | não (é derivado) |
| `STORAGE_DELETE_ENABLED` | `false` | não (padrão desligado) |

O frontend conhece **uma** variável nova:

| Variável | Que é | Pode ir no bundle? |
|---|---|---|
| `VITE_STORAGE_API_URL` | URL interna do backend (ex.: `http://ADM-RUY:8789`) | **sim**, é só endereço |

**Proibições verificadas por teste** (`scripts/test-storage-r2.mjs`, testes 19–20):

- nenhum nome de variável de credencial aparece em `src/` — nem em comentário;
- `VITE_R2_*` não existe em lugar nenhum;
- nenhum SDK de S3/AWS, nenhum `S3Client`/`getSignedUrl` no frontend;
- `cloudflarestorage.com` não aparece no bundle;
- nenhum arquivo de `server/storage/` lê o ambiente de build;
- `storageHandler.mjs` nunca toca na chave secreta;
- build de produção conferido: **0 ocorrência** de termo de credencial ou do
  endpoint do R2 em `dist/`.

O `scripts/production/store.mjs` já bloqueia a publicação se achar chave
privada ou `service_role` no build — este trabalho não afrouxa essa regra.

---

## 6. Leitura privada: URL assinada

Arquivos permanecem **privados**. Nada de bucket público por padrão.

1. O navegador pede a URL assinada ao backend, com o bearer do usuário.
2. O backend valida a identidade no Supabase Auth (mesmo verificador real do
   backend social — `createSupabaseIdentityVerifier`), revalida o caminho
   contra o contrato e responde com TTL de 300 s.
3. O navegador baixa o arquivo **sem cookies e sem cache**
   (`credentials: 'omit'`, `cache: 'no-store'`), confere o `Content-Type` e
   valida os primeiros bytes.
4. O arquivo vira `Blob` → `URL.createObjectURL` e é mostrado pelo
   `AttachmentPreview`. A URL assinada **nunca** é gravada no registro.

O cliente pode pedir TTL **menor** que o padrão; nunca maior.

Alternativa já implementada: `GET /storage/object` faz proxy com a mesma
autorização, para quando o endpoint do R2 não for alcançável do navegador.

---

## 7. Exclusão: desligada

- `storageService.delete` recusa com `STORAGE_DELETE_DISABLED` enquanto
  `allowDelete` for falso — **e o padrão é falso**.
- `storageHandler` faz a **segunda** checagem: a rota só existe com a flag
  ligada nos dois lados.
- Nenhum fluxo do sistema chama `delete`. Excluir `EmployeePayment`,
  `FinancialExpense`, `EmployeeDocument`, `Vale` ou `AccountsPayable` continua
  afetando **só o registro**, exatamente como antes.

---

## 8. Compatibilidade durante a transição

`resolveAttachmentSource()` decide, com ordem fixa e sem exceção:

| Referência no registro | Vai para |
|---|---|
| `storage_provider === 'r2'` + `storage_path` | R2 (URL assinada) |
| `storage_path` **sem** provider | **Supabase legado** (bucket `anexos`) |
| `data:...` em `proof_url`/`document_url`/`invoice_url`/`photo_url`/`file_url` | base64 legado |
| `http(s)://...` ou `blob:...` | URL (legado Base44 / Blob URL) |
| nada | erro claro, sem provider inventado |

Pontos deliberados:

- **O padrão não é R2.** Os 33 arquivos já copiados continuam sendo lidos do
  Supabase até que alguém **marque** o registro. Sem marcação, nada muda.
- **Não existe fallback automático** entre provedores. Um erro do R2 com o
  objeto presente no Supabase viraria leitura sem registro; um erro do Supabase
  esconderia defeito do R2. Quem está marcado lê de onde está marcado.
- **Nenhum campo novo é obrigatório.** `storage_provider` é opcional e, se
  ausente, vale Supabase. Nenhuma migration foi executada.

---

## 9. Novos uploads

`uploadPaymentProof({ provider })` já aceita `'r2'`. O padrão é `'supabase'`
— ou seja, **o comportamento atual está intacto** e nada muda em produção sem
uma decisão explícita.

Quando ativado, o caminho gerado é **idêntico** ao legado
(`EmployeePayment/{id}/{uuid}.{ext}`), então o objeto cai em
`anexos/EmployeePayment/{id}/{uuid}.{ext}` — o mesmo lugar onde a cópia já
deixou os arquivos antigos. O registro recebe os mesmos campos de sempre,
mais `storage_provider` e `storage_bucket`.

Nenhum formato de caminho paralelo foi criado: é o mesmo contrato nos dois
provedores.

**Fora do escopo desta etapa (decisão de produto, não de armazenamento):**
mudar `uploadFileLocal` para o backend faz gasto, conta a pagar, vale,
documento e foto pararem de nascer em base64. O caminho está pronto; a troca
precisa da aprovação do dono.

---

## 10. Comandos

```bash
npm run storage:check   # o que falta de configuração (nunca imprime valor)
npm run storage:dev     # backend de arquivos em primeiro plano
npm run test:storage    # 24 testes, sem rede real
node scripts/audit-arquivos-referencias.mjs   # auditoria somente-leitura
```

---

## 11. O que NÃO foi feito (de propósito)

- nenhum `UPDATE`, `DELETE`, `migration` ou SQL executado;
- `storage_path`, `proof_url`, `document_url`, `invoice_url`, `photo_url` e
  `file_url` **inalterados** em qualquer registro;
- nenhum arquivo copiado, movido ou apagado no Supabase ou no R2;
- nenhuma credencial real no repositório;
- nenhum upload real;
- `AttachmentPreview`, `attachmentViewer`, zoom, download do original,
  "Baixar como PDF" e imprimir **não foram refatorados** — as suítes
  `test-attachment-preview.mjs` e `test-theme-superficies.mjs` continuam
  passando sem alteração.
