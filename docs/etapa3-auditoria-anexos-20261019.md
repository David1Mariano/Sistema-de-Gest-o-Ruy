# Etapa 3 — auditoria prévia de anexos

Base local/remota confirmada `ba6f8cc`, checkout inicialmente limpo, branch `agente-5-auditoria-integracao-20261019`. Fonte: `agente-4-anexos-unificados` / `7fffc09`, handoff e seis testes `scripts/test-anexos-api.mjs`, `anexos.mjs`, `anexosApi.mjs` e `anexosAuth.mjs` lidos por Git, sem executá-los no servidor de produção. Comparados com contrato Etapa 1, documentação RC3 e implementação D1/C2 atual. Dez hashes WIP Etapa A conferidos antes das alterações.

| Melhoria A4 | Classificação | Comparação, dependência e decisão |
| --- | --- | --- |
| Autenticação e sessões | JÁ EXISTENTE | RC3 usa sessão SQL/cookie 8 h, CSRF, usuário ativo e admin; central verifica token/dispositivo/workspace. Preservar. |
| Login/registro anexosAuth, bearer no frontend | REJEITAR | Criaria autoridade paralela e quebraria contratos Etapa 1. |
| Permissão por usuário/registro/entidade | ADAPTAR | Reaproveitar cenários contra owner local e workspace central existentes. Admins autorizados do mesmo workspace podem compartilhar; não prometer isolamento entre eles. Granularidade operacional adicional depende de política aprovada. |
| SHA-256 em upload e leitura, MIME/extensão/base64/tamanho | JÁ EXISTENTE | Um único validador D1 usado por fila e central, 512 KiB e tipos sintéticos restritos; ampliar testes sem aumentar limites. |
| Marcadores de fechamento PDF/PNG/JPEG | ADAPTAR | RC3 aceita somente assinatura inicial, inclusive bytes truncados com hash coerente. Usar teste de regressão antes da correção e fechamento em cauda limitada como no A4. Não é parser completo nem antivírus. WebP mantém checagem atual de assinatura. |
| CORS/headers seguros | JÁ EXISTENTE | D1 exige origem local, CSRF, no-store/nosniff; download forçado com sandbox. Central aceita somente transporte servidor. Testar sem ampliar allowlist. |
| URL assinada com TTL próprio | REJEITAR | Contrato único exige sessão vigente em cada download. Sem URL pública ou ruy-anexo://. Testar expiração SQL e revogação sem apagar bytes. |
| Retenção de conteúdo | PENDENTE | TTL de autorização não é TTL de arquivo. Não criar expurgo automático; política operacional de retenção/descarte precisa definição antes da liberação. Backups possuem política própria de cópias, não alterada. |
| Criptografia/proteção | JÁ EXISTENTE em transporte e backup | mTLS provisionado/DPAPI e backup AES-256-GCM com envelope de recuperação; testar em fixture com chaves sintéticas. Bytes SQL não são individualmente cifrados; proteção em repouso do host e restauração em outro Windows ainda requerem homologação. |
| Armazenamento A4 em disco/metadados | REJEITAR | Duplicaria fila/cache/objetos SQL RC3. Sem schema, rota /api/anexos ou filesystem store novo. |
| Upload interrompido/retomada/reinício | ADAPTAR | Testar fila D1 pendente, falha de rede e ACK perdido contra central real; reenvio explícito do mesmo UUID, sem criar outra fila. |
| Recibos/idempotência e revogação | JÁ EXISTENTE | Central registra recibo imutável, valida hash e vínculo; local revalida papel e registro, central revalida credencial e workspace. Exercitar colisões e usuário revogado. |
| Auditoria | ADAPTAR | Comprovar upload/recibo transacional e que replay não duplica auditoria existente. Auditoria dedicada de todas as leituras não existe na RC3; permanece PENDENTE de política de acesso/retenção, sem alegar cobertura total. |
| Timeout 120 s A4 | REJEITAR | Transporte Etapa 1 já tem prazo único de 30 s incluindo resposta; não introduzir segundo helper. |
| Financeiro local experimental e integração do servidor de produção | REJEITAR | Fora do escopo, incompatível com autoridade RC3; não importar ou executar SQL/serviço A4. |

## Plano antes da modificação de código

Única melhoria funcional prevista: fechamento de conteúdo no validador compartilhado, sem mudar protocolo, MIME, sessão, banco ou API. Dependências existentes apenas Node/pg/testes. Risco: arquivos antes aceitos só por assinatura passam a ser recusados se incompletos; atualizar fixtures artificiais de teste, preservar arquivos completos e os textos FICTICIO existentes. Não reescrever registros existentes nem converter arquivos.

Testar primeiro a recusa de arquivos truncados com hash correto. Depois: upload/consulta/download autorizados e recusas owner/viewer/entidade/workspace; SHA/corrupção; TTL SQL, logout e revogação; concorrência/replay/colisão e falhas simuladas; reinício real de processo API; backup cifrado/restore dos bytes SQL; mTLS; contratos Etapa 1; suíte Etapa 2, lint e builds.

Todos os bancos novos A/B/C e restaurações apenas no clone marcado 55437. Não conectar 55435/55436, produção8080, API18080 ou Supabase. Artefatos privados fora do Git; não apagar bancos/arquivos existentes. Dois Windows físicos, reinício de Electron instalado e reconexão física não estão sendo simulados como aprovação real. Delivery/Etapa 4 não iniciados.
