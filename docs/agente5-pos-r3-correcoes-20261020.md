# Correções pós-instalação R3 — laboratório

## Diagnóstico e alterações

- **Anexos:** o lançamento comum não recebia a flag que habilitava as rotas existentes. Capacidades passam a ser definidas pelo manifesto exclusivo de desenvolvimento, sem login ou armazenamento paralelo. SHA-256, autorização, auditoria e transporte D1/C2 permanecem nos mecanismos existentes.
- **Delivery:** a proteção anterior exigia o provisionamento legado e a porta 55437. O novo escopo valida marcador, banco, identidade do dispositivo e portas próprias. A preparação do esquema ocorre somente em banco novo do namespace autorizado; a proteção legada permanece. Pagamentos externos e sincronização operacional continuam desativados.
- **NSIS:** a causa da ausência da entrada esperada na R3 permanece desconhecida. Foi preparada uma verificação de leitura das chaves oficiais HKCU, que recusa informar sucesso quando instalação/desinstalador não correspondem ao destino. A macro compilou; não foi executada instalação nem escrita manual no registro. Isso ainda não comprova a correção em Windows limpo.
- **API antiga:** PID 22292 e porta 18080 ausentes. Diagnóstico somente por leitura não estabeleceu a causa; não houve recriação, substituição ou reinício.
- **Encerramento:** a aplicação recusa iniciar sobre cluster em parada; timeout de inicialização retorna falha. A parada própria usa pg_ctl assíncrono, sem matar o auxiliar por timeout. Checkpoints demorados observados avançaram e terminaram normalmente, sem intervenção forçada.

## Isolamento

Namespace `i5r4-dev-20261020`, API 18113, PostgreSQL 55453, mTLS 18553, gateway 18554 e ponte 18555. Perfil, diretório de dados, credenciais, certificados e chaves são próprios. A instalação R3 existente não foi substituída. Nenhum novo instalador Setup foi gerado nesta rodada; existe apenas pacote de desenvolvimento desempacotado.

## Resultados verificáveis

| Verificação | Resultado | Alcance |
|---|---|---|
| Anexos | 14 verificações aprovadas | HTTP/mTLS e PostgreSQL reais; pares e falhas de rede simulados; autorização, SHA, TTL, revogação, retentativas e recuperação |
| Delivery | 16 verificações aprovadas | API/PG reais; concorrência de clientes simulados, rollback, idempotência, pedidos/itens/status/cadastro e restauração |
| Delivery com interface | 17 verificações aprovadas | Inclui Electron em desenvolvimento; não equivale a instalador homologado |
| Contratos novos | 4/4 | Capacidades e rejeição de destinos legados |
| Regressões de contratos existentes | 33/33 | Inicialização, janela, isolamento, Delivery e conteúdo de anexos |
| Domínio | 15/15 | Estoque, produção, cancelamento, finanças, pagamentos e permissões no servidor |
| Executável desempacotado | Aprovado no escopo automatizado | Login, colaborador, estoque/produção/financeiro; anexar, visualizar texto escapado, baixar, SHA, recarregar; Delivery disponível sem flags manuais |
| Persistência e backup | Aprovado | Reinício controlado do PG 55453; backup cifrado, restauração em banco novo, 17 tabelas, dois anexos e hashes |
| Lint / builds | Aprovados | ESLint, web e D1; avisos de tamanho de chunks |
| NSIS | Compilação aprovada; instalação pendente | Macro de leitura apenas; nenhuma instalação/reinstalação executada |

A regressão antiga de produção esperava conclusão ao salvar rascunho. O teste foi atualizado para exigir `em_producao` nessa etapa e `concluida` somente após confirmação atômica; a regra de domínio não foi alterada.

Evidências locais, ignoradas pelo Git: `logs/i5r4-dev/attachments.json`, `delivery.json`, `delivery-ui.json`, `domain-regression.log`, `packaged-runtime.json`, `persistence-backup.json`, `preservation-summary.json` e logs de build/lint.

## Preservação e divergência observada

Os dez arquivos WIP da Etapa A mantiveram os hashes. As 25 cópias cifradas preservadas mantiveram todos os hashes. ASARs instalados e arquivos DPAPI comparados permaneceram intactos. Dos 104 arquivos da linha de base, um backup original deixou de existir durante a execução da I5 anterior: `2026-10-20T00-05-35-232Z-115124c5-9137-4150-b4f4-803aecbc65ec.ruybak`. Sua cópia preservada permanece íntegra. A ocorrência é compatível com a política automática retain=24, mas não há auditoria individual que prove o autor da exclusão. Não foi feita reposição, limpeza ou alteração dos originais.

Ao concluir os testes, portas próprias 18113/55453 estavam livres; a API anterior 18091 e o PostgreSQL anterior 55437 permaneciam ativos. Produção, Supabase e instalação R3 não foram alvo de comandos de alteração.

## Próxima candidata e bloqueios

Antes de gerar/instalar uma candidata: validar a leitura NSIS em Windows descartável autorizado; revisar identificação definitiva, atalhos e diretórios próprios; empacotar em artefato novo, calcular SHA-256 e obter autorização de instalação lado a lado. Não reutilizar o provisionamento ou perfis instalados.

Permanecem pendentes: instalação limpa e registro NSIS real, dois Windows físicos, reconexão real de rede, certificados entre máquinas e aceite operacional. A causa do desaparecimento da API 18080 continua desconhecida. O produto permanece restrito à homologação.
