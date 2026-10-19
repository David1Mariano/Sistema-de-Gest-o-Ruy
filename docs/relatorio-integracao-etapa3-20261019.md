# Etapa 3 — integração de anexos

19/10/2026. Worktree `gestao-ruy-integracao-auditoria-20261019`, branch `agente-5-auditoria-integracao-20261019`. HEAD inicial e remoto `ba6f8cc`, checkout limpo antes das alterações. Fonte A4 `7fffc09`. Somente Etapa 3 executada.

## Matriz de aproveitamento

Auditoria completa e plano anterior à correção: [comparação A4/RC3](etapa3-auditoria-anexos-20261019.md). Foram lidos o handoff, os seis testes da API A4 e os módulos de conteúdo, autenticação e transporte, sem importar seu servidor de produção ou financeiro experimental.

| Melhoria | Classificação | Resultado |
| --- | --- | --- |
| Checklist A4 de upload, permissões, TTL, reinício e integridade | APROVEITAR | Cenários reimplementados contra a API e persistência D1/C2 existentes. O teste A4 original não foi executado como se comprovasse RC3. |
| Marcadores de fechamento PDF/PNG/JPEG | ADAPTAR | Única alteração funcional: no validador compartilhado, exigir `%%EOF`, `IEND` ou FF D9 na cauda de até 4096 bytes. Três testes falhavam antes da correção e passam depois. |
| Hash, MIME/extensão, base64 canônico e limite 512 KiB | JÁ EXISTENTE | Mantidos e testados. Sem aumento de tamanho ou entidades permitidas. |
| Sessão SQL 8 h, CSRF, admin ativo, owner local e workspace central | JÁ EXISTENTE | Revalidação no servidor; admins autorizados do mesmo workspace continuam compartilhando registros. Não foi criada ACL operacional nova. |
| mTLS/DPAPI, fila/cache SQL, objetos/recibos centrais e backup AES-GCM | JÁ EXISTENTE | Testes reais em loopback com certificados/chaves sintéticos; mantida a mesma arquitetura. |
| Upload interrompido, ACK perdido e replay | ADAPTAR | Falhas injetadas na mesma fila e UUID; a repetição simultânea na central não duplica objeto, recibo ou auditoria de upload. |
| URL assinada/TTL próprio e ruy-anexo:// | REJEITAR | Autorização expira com sessão/revogação. Download exige sessão vigente; URL não concede acesso. |
| anexosAuth, bearer no frontend, armazenamento em disco e /api/anexos | REJEITAR | Duplicariam login e armazenamento. Nenhuma dessas implementações foi copiada. |
| Timeout paralelo 120 s | REJEITAR | Mantido transporte único da Etapa 1, 30 s incluindo resposta. |
| Financeiro A4, schema experimental e mudanças no servidor de produção | REJEITAR | Fora do escopo e incompatíveis com a autoridade única RC3. |
| Expurgo/retencão operacional, auditoria de todas as leituras e permissões mais granulares | PENDENTE | Dependem de política de negócio aprovada; não implementados como efeitos colaterais desta integração. |

## Aprovação dos fluxos

| Fluxo | Resultado e evidência |
| --- | --- |
| Upload autorizado e bloqueio de envio indevido | APROVADO — cenários 01/02: sessão, CSRF, origem, owner, viewer, entidade, versão e colisão. Cenário 07 recusa uploads estruturalmente válidos com credencial revogada, viewer e outro workspace. |
| Consulta/download local e compartilhamento autorizado D1/C2 | APROVADO — 03/06: bytes HTTP, headers no-store/nosniff/sandbox e download forçado; peer autorizado obtém cache via mTLS. |
| Leitura entre usuários sem permissão | APROVADO — 03/07/11: outro owner local, workspace estranho, viewer, credencial revogada e registro excluído são recusados. Compartilhamento entre admins do mesmo workspace é permitido pelo contrato atual. |
| SHA-256, conteúdo adulterado e fechamento | APROVADO — 08/09 e testes unitários: objeto/cache corrompidos recusados, truncados com hash correto recusados, fixtures com fechamento permitido atravessam D1/C2. |
| TTL de acesso, logout e revogação | APROVADO — 10: sessão SQL expirada/revogada impede upload e leitura; bytes permanecem intactos. Relógio real do SQL, expiração forçada no fixture; não houve espera de oito horas. |
| Retenção/expurgo operacional | PENDENTE — não há expurgo de anexos por TTL de sessão. Política operacional de guarda e descarte precisa definição. Política de cópias de backup existente não foi alterada. |
| Retentativa, idempotência e recuperação | APROVADO com falha de rede simulada — 04/05: offline e ACK perdido injetados; central HTTP/TLS/SQL real em loopback, mesmo UUID e um objeto/recibo/auditoria. |
| Persistência após reinício | APROVADO para API auxiliar — 12: processo filho sai normalmente, novo PID, mesma sessão SQL e fila/cache preservados; download funciona. Reinício de Electron instalado continua PENDENTE. |
| Backup e restauração dos anexos | APROVADO — 13: pg_dump real e arquivo cifrado, senha incorreta e corrupção recusadas; restauração em três bancos novos preserva exatamente fila/cache/bytes/objetos/recibos/auditoria. |
| Etapa 1 | APROVADO — 15 testes de contrato/transporte dentro da regressão e oito cenários API reais novamente executados. Fixtures binárias foram completadas; sessões, protocolos e política de download mantidos. |
| Etapa 2 | APROVADO — 16 cenários novamente executados, inclusive rollback, concorrência, estorno, backup e reinício normal exclusivo do clone 55437. Núcleo estoque/produção inalterado. |
| Dois Windows físicos/rede real/instalação limpa | PENDENTE — não executados nem declarados aprovados. |

Resultados finais: **14/14 cenários integrados de anexos**, **96/96 testes Node**, incluindo dez novos testes de conteúdo e **121/121** verificações internas de estoque. Fase2A **7/7** e verificação estática de estoque aprovadas. Lint, build web e build D1 aprovados. Avisos de build: chunks acima de 500 kB e base Browserslist desatualizada; nenhuma dependência adicionada/atualizada. Nenhum teste final reprovado.

## Isolamento e limites

Todos os bancos A/B/C e restaurações criados somente no clone descartável marcado 55437, PGDATA conferido. O harness recusa portas ocupadas antes de iniciar: 55437, 18091, 18092 e 18094. Usa a API auxiliar em processo próprio 18091, gateway C2 18092, central 18094 e mTLS em porta efêmera, todos loopback. Chaves sintéticas ficam no diretório privado do fixture/DPAPI; nenhum segredo é transmitido por argumentos de processo ou versionado. O processo filho recebe a configuração apenas por IPC.

Os helpers leem a identificação protegida dos laboratórios, mas não conectam 55435/55436. Não houve migrations em bancos existentes, DROP, resetwal, kill ou deploy. Somente os processos iniciados pelo harness foram encerrados normalmente. Artefatos privados e logs completos permanecem fora do Git. Retenção do fixture não implica política operacional de retenção.

A verificação de fechamento detecta truncamento evidente, mas não é decodificador de imagem, validador completo de PDF, verificador de CRC nem antivírus. WebP continua com a verificação de assinatura anterior; o A4 também não oferecia validação estrutural completa de WebP. Não foram examinados ou modificados anexos existentes. Bytes no PostgreSQL não passaram a ser cifrados individualmente; proteção de disco/host, permissões operacionais e restauração em outro computador ainda precisam homologação.

Auditoria comprovada: upload central e recibo transacional, sem duplicação no replay. Não foi criada auditoria dedicada de cada leitura. A ausência dessa trilha e a política de guarda devem ser resolvidas conforme os critérios de aceite operacional, sem afirmar rastreabilidade de leituras inexistente.

## Reprodução

Executar sequencialmente no Windows autorizado que possui o clone marcado:

```powershell
$env:RUY_D1_ALLOW_TESTS='1'
$env:RUY_D1_RESTART_FIXTURE='e5aaec701010f607'
$env:RUY_D1_MTLS_LAB='1'
node scripts/d1-lab/run-integration-stage3-isolated.mjs
node scripts/d1-lab/run-integration-stage2-isolated.mjs
node scripts/d1-lab/run-integration-stage1-isolated.mjs
node --test scripts/d1-lab/test-integration-stage3-content.mjs scripts/d1-lab/test-integration-stage1.mjs scripts/d1-lab/test-h-units.mjs scripts/d1-lab/test-client-recovery.mjs scripts/d1-lab/test-build-aliases.mjs lab/c2-runtime/scripts/test-local-health.mjs scripts/test-employee-delete.mjs scripts/test-stock.mjs scripts/test-payment-proof.mjs scripts/test-payable-attachment.mjs scripts/d1-lab/test-agente5-rc2-policy.mjs scripts/d1-lab/test-stage2-lint.mjs
npm run lint
npm run build
npx --no-install vite build --config lab/d1/vite.config.mjs
```

Resultados sanitizados e hashes dos logs: [evidências](evidencias/agente5-integracao-etapa3-20261019.json). Os números desta execução não dependem dos resultados antigos para aprovação.

## Arquivos e entrega Git

- `server/d1-lab/attachment-contract.mjs`: verificação de fechamento no mecanismo único.
- `scripts/d1-lab/test-integration-stage1.mjs`: fixtures com fechamento, sem retirar cenários anteriores.
- `scripts/d1-lab/stage3-attachment-samples.mjs` e `test-integration-stage3-content.mjs`: fixtures e regressões da falha.
- `scripts/d1-lab/stage3-api-worker.mjs`: processo auxiliar de API com IPC e parada normal, apenas para testes.
- `scripts/d1-lab/test-integration-stage3.mjs` e `run-integration-stage3-isolated.mjs`: ensaio completo e isolamento.
- Auditoria, este relatório e JSON de evidências: três arquivos documentais.

Commit funcional: `951180c`. O commit seguinte contém testes integrados e evidências; seu hash é confirmado no relatório de entrega e no Git. Os arquivos de cada commit foram revisados e passaram pela verificação de padrões de segredos, binários, bancos, backups, instaladores e artefatos privados. O remoto é conferido antes do push, sem força e apenas nesta branch.

## Preservação e próximos critérios

Contratos Etapa 1 e código transacional Etapa 2 preservados. Nenhuma mudança em `src/`, `lab/`, `desktop/`, `scripts/production/`, autenticação, sessões, mTLS ou schemas. Apenas o validador compartilhado de anexos mudou no runtime. WIP Etapa A: dez hashes iguais ao inventário; HEAD original `db99024`. Produção8080, API antiga18080, Supabase e branches originais dos agentes intactos.

Sistema restrito à homologação. Continuam pendentes instalação/reinício/reinstalação/restauração em Windows autorizado, dois computadores físicos e reconexão real, política operacional de retenção/auditoria/permissões e proteção do host. Delivery/Etapa 4 não iniciados; aguardam autorização específica.
