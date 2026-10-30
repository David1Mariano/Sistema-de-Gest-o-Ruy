# D1.1 — Renomeação segura de setores (cascata transacional)

## Escopo e decisão

A auditoria anterior confirmou que o bloqueio de renomeação de setor estava
CORRETO: os vínculos legados são textuais (`JobRole.sector_name` e
`Employee.sector` guardam o nome por extenso), então renomear sem atualizar as
referências deixaria colaboradores e funções apontando para um nome que não
existe mais.

Nesta etapa o bloqueio cego foi substituído, **exclusivamente no laboratório
D1**, por renomeação COM CONFIRMAÇÃO EXPLÍCITA:

1. Identificar quantos colaboradores e funções estão vinculados ao setor.
2. Exibir diálogo de impacto no formulário (nome atual → novo + contagens).
3. Exigir confirmação explícita do usuário antes de continuar.
4. Atualizar o nome do setor e as referências vinculadas na MESMA transação.
5. Registrar a operação na auditoria local (`Sector:rename_cascade`).
6. Qualquer falha executa ROLLBACK total (setor + vínculos + outbox + auditoria).
7. Manter as versões dos registros consistentes (+1 em cada alterado).
8. Preservar identificadores e demais dados de colaboradores e funções.

O **servidor é a autoridade**: revalida a contagem real de vínculos contra o
`renameImpact` declarado pelo cliente e recusa se divergirem. A migração para
`sector_id` NÃO foi iniciada (ver "Evolução arquitetural" abaixo).

## Arquivos alterados

Servidor (regra de negócio, dentro da transação existente):

- `server/d1-lab/entities.mjs`
  - Valida `body.confirmRename` (boolean) e `body.renameImpact` (`{colaboradores, funcoes}` não-negativos) — 400 se inválidos.
  - Inclui `confirmRename` no `hash` de replay (um comando antigo não confirmado não vira confirmado por replay).
  - Substitui o bloqueio por: contagem real de vínculos (JobRole por `sector_id` OU `sector_name` normalizado; Employee por `sector` normalizado); sem confirmação → 409 com a MESMA mensagem de sempre; confirmação com impacto divergente → 409; duplicidade de nome equivalente → 409 explícito.
  - Cascata na MESMA conexão/transação: `jsonb_set` em `JobRole.sector_name` e `Employee.sector`, com `version=version+1` e `updated_at=now()`.
  - Renomear FUNÇÃO em uso continua bloqueado (fora do escopo D1.1; vínculo `Employee.function` sem cascata aprovada).
  - `result.rename` (from/to/contagens) e `result.cascata` (registros alterados) entram no `lab_outbox.result`; auditoria extra `Sector:rename_cascade` com o mesmo `operation_id`.

Cliente D1 (adaptador e formulário, só no build do laboratório):

- `lab/d1/client.mjs` — `update(id, data, options)` aceita `{confirmRename, renameImpact}` no corpo do comando; cacheia os registros devolvidos em `result.cascata` para edições seguintes já usarem a versão nova.
- `lab/d1/SectorForm.jsx` (NOVO) — cópia revisada do form oficial com diálogo de impacto (`data-testid="d1-rename-impact"`) que pausa a renomeação, mostra contagens e só envia `confirmRename: true` + o impacto exibido ao confirmar. Cancelar descarta a renomeação.
- `lab/d1/dialog.jsx` — texto de rodapé atualizado (renomeação agora exige confirmação, não é bloqueada).
- `lab/d1/vite.config.mjs` — alias `@/components/rh/SectorForm` → `lab/d1/SectorForm.jsx` (apenas no build D1).

Teste novo:

- `scripts/d1-lab/test-sector-rename.mjs` — 13 cenários (ver abaixo), com guarda de rede, API/PostgreSQL reais e contas sintéticas próprias.

**Produção intocada**: `src/components/rh/SectorForm.jsx` permanece byte-idêntico
ao commit `9d7e59e` (verificado dentro do teste M1 e pelo `test-api.mjs`).
`git diff HEAD -- src/` vazio.

## Resultados dos testes

`scripts/d1-lab/test-sector-rename.mjs` (com `network-guard`, API reiniciada para
carregar o novo código): **13/13 aprovados, exit 0**.

| # | Cenário | Resultado |
|---|---------|-----------|
| A1 | Renomear setor SEM vínculos não pede confirmação | OK |
| B1 | Renomear COM vínculos exige confirmação e aplica cascata (setor + 2 funções + 2 colaboradores, versões +1, `name_key` acompanha) | OK |
| C1 | Sem `confirmRename` (cancelar) → 409 e nada muda | OK |
| D1 | `renameImpact` divergente do estado real → 409 | OK |
| E1 | Falha simulada na cascata → ROLLBACK total (setor + vínculos + versões desfeitos) | OK |
| F1 | IDs e campos preservados; só o campo de vínculo muda (`sector_id`, nomes, função, status) | OK |
| G1 | `viewer` não renomeia (403 no servidor; cliente barra antes do fetch) | OK |
| H1 | Renomear para nome de OUTRO setor → 409, nome original mantido | OK |
| I1 | `baseVersion` velho → 409, nada muda | OK |
| J1 | Cascata gera auditoria `Sector:rename_cascade` + `Sector:update` e `lab_outbox.result.rename/cascata` | OK |
| K1 | Dados sobrevivem ao reinício da API (`stop-api`/`start-api`) | OK |
| L1 | Renomeação funciona offline (loopback; saída externa bloqueada pelo guard) | OK |
| M1 | Form D1 monta diálogo, exige confirmação e envia impacto coerente; `src/` byte-idêntico | OK |

Regressões preservadas:

- `scripts/d1-lab/test-sector-edit.mjs`: **8/8, `SECTOR_EDIT_OK`** (A4 confirma que SEM confirmação o bloqueio 409 permanece com a mensagem original).
- `scripts/d1-lab/test-api.mjs`: **27 PASS, `D1_OK`** (inclui byte-identicidade de `src/`, "renomeação com vínculos é bloqueada sem cascata", guard offline, produção 8080/C1/C2 ativos, replay, rollback e adaptador frontend).
- Lint (`eslint` nos arquivos alterados): exit 0.
- Build D1 reconstruído (`dist-d1/assets/index-YEnkOY1v.js`), sem `supabase.co`, contendo `confirmRename`/`renameImpact`.

## Evidências de integridade referencial

Leitura direta no PostgreSQL `ruy_d1_disposable.d1_records` (independente do
cache do cliente), dentro dos testes B1/F1/E1:

- Setor renomeado: `data.name` novo, `version` +1, `name_key = sectorKey(novo)`.
- Funções vinculadas: `data.sector_name` novo, `version` +1, `data.sector_id`
  APONTANDO PARA O MESMO SETOR (uuid preservado), `data.name` preservado.
- Colaboradores: `data.sector` novo, `version` +1, `data.name`, `data.function` e
  `data.status` preservados; id do colaborador preservado.
- Rollback (E1): setor, funções e colaboradores com nome, vínculo e versão
  idênticos aos de antes da operação falhada — nada foi aplicado parcialmente.
- Auditoria: `lab_audit` com `Sector:update` e `Sector:rename_cascade` sob o
  mesmo `operation_id` do `lab_outbox`, cujo `result` guarda `rename`

## Roteiro de validação no navegador (homologação D1)

Pré-requisito: API D1 ativa (`node scripts/d1-lab.mjs start-api`), build D1
atual (`node node_modules/vite/bin/vite.js build --config lab/d1/vite.config.mjs`).
Acessar somente `http://127.0.0.1:18087`. Usar conta fictícia de laboratório.

1. **Renomear sem vínculos**: criar setor `FICTICIO Teste Rename` sem
   colaboradores/funções → Editar → trocar o nome → Salvar. Esperado: salva
   direto, sem diálogo, nome atualiza no card.
2. **Renomear com vínculos (diálogo)**: criar setor `FICTICIO Com Vinculo`,
   vincular 2 funções e 2 colaboradores → Editar → trocar o nome → Salvar.
   Esperado: painel âmbar "Renomear setor com vínculos?" com "2 colaborador(es)"
   e "2 função(ões)".
3. **Cancelar**: no painel, clicar "Cancelar". Esperado: painel some, formulário
   permanece aberto com o nome digitado, NADA é salvo (recarregar e conferir que
   o nome antigo permanece).
4. **Confirmar**: clicar "Confirmar renomeação". Esperado: formulário fecha,
   card mostra o novo nome; abrir a tela de Funções e o detalhe do setor e
   conferir que funções e colaboradores agora exibem o NOVO nome (cascata).
5. **Identificadores preservados**: conferir que as funções/colaboradores são os
   MESMOS (nomes de pessoas e funções inalterados); apenas o setor mudou.
6. **Duplicidade**: renomear um setor para o nome de outro já existente →
   Esperado: aviso "Já existe um setor com esse nome" no formulário.
7. **Feedback de erro**: forçar um erro (ex.: parar a API) e salvar → Esperado:
   aviso vermelho D1 DENTRO do diálogo (portal), formulário não fecha.
8. **Persistência**: recarregar a página (F5) → Esperado: novo nome e vínculos
   mantidos. Reiniciar a API (`stop-api`/`start-api`) e recarregar → idem.
9. **Offline**: com a API local no ar, impedir saída à rede externa → o fluxo
   acima continua funcionando (somente loopback).
10. **Produção intacta**: conferir `http://127.0.0.1:8080` respondendo e a tela
    de Setores da release oficial sem o novo diálogo (comportamento original de
    bloqueio preservado em produção).

Os testes Node exercitam API, banco e adaptador reais, mas NÃO substituem o
aceite visual em navegador real. A homologação depende da execução deste
roteiro.

## Evolução arquitetural futura (NÃO iniciada nesta etapa)

A renomeação em cascata é uma solução de transição para o vínculo textual
legado. A solução definitiva é migrar `Employee.sector` e `JobRole.sector_name`
para uma chave estável `sector_id` (FK lógica para `d1_records.id` do setor),
eliminando renomeação em cascata, duplicidade por grafia e setores "fantasma".
Isso exige migration de dados (backfill + descontinuação do campo textual) e
alteração das telas de RH/Setores — fora do escopo desta etapa e que depende de
autorização explícita, conforme registrado na auditoria.

Data: 15/10/2026. Laboratório D1 exclusivo; dados somente `FICTICIO*`; sem
migration de produção, sem Supabase operacional, sem commit/merge/push.
  (from/to/contagens) e `cascata` (registros alterados).