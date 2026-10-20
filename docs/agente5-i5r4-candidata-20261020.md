# I5 R4 — candidata de laboratório 0.5.2-rc.4

Base confirmada: `b87bff2`, branch `agente-5-auditoria-integracao-20261019`, limpa e sincronizada antes do trabalho. As correções pós-R3 não foram alteradas nesta preparação.

## Artefato

- Identidade: `Sistema Ruy - I5 R4 Desenvolvimento`, revisão `A5-I5-R4-DEV-20261020`.
- appId NSIS: `br.ruy.gestao.agente5.integracao5r4.dev`, exclusivo em relação à I5 e R3.
- Instalador: `artifacts/agente5-i5r4-candidate-20261020/Sistema-Ruy-A5-I5-R4-DEV-20261020-Setup.exe`.
- SHA-256: `d984fcdbb1e29bcb6a2e4338bff1894efba73452929f1fa69701973df3ceb6f4`.
- Tamanho: 112007538 bytes. Não assinado. Não instalado nem executado no Pichau.
- ASAR: `2bcdbd9d6b978068d40dff517e0ab32df468fc164cc124618b42dba564fc7a3b`.

Mantém o namespace de desenvolvimento já validado `i5r4-dev-20261020`: API 18113, PG 55453, perfil `SistemaGestaoRuy-i5r4-dev-20261020` e dados `GestaoRuy/installation-i5r4-dev-20261020`. Esse ambiente contém somente dados sintéticos; não é uma nova instância independente do protótipo R4. Não iniciar protótipo e instalação R4 simultaneamente. É independente das instalações I5/R3 e de seus perfis, certificados, chaves e bancos.

## Verificações desta rodada

| Teste | Resultado |
|---|---|
| ESLint; build web; build D1 | Aprovados; avisos de chunks grandes |
| Contratos existentes / novo isolamento | 33/33 e 4/4 aprovados em ambientes separados |
| Domínio em PostgreSQL 55453 | 15/15: estoque, consumo, cancelamento, finanças, permissões e rollback |
| Reinício, persistência e backup cifrado | Aprovados; restauração em banco novo, 17 tabelas e SHA dos dois anexos |
| Pacote corrigido | Fontes e frontend correspondem; 13 dependências presentes; ausência de segredos/arquivos privados; fuses preservados |
| Executável desempacotado corrigido | Janela, login, colaboradores, estoque/produção/financeiro, anexos com upload/preview/download/SHA/reload e workspace Delivery aprovados |
| Encerramento | Normal; portas próprias 18113 e 55453 livres; sem encerramento forçado |
| NSIS | Compilação real aprovada; instalação, atalhos instalados e leitura HKCU real pendentes |

Anexos: as 14 verificações HTTP/mTLS de permissões, TTL, integridade, revogação e recuperação do lote anterior continuam válidas para o mesmo código. Delivery: 16 verificações API/PG e 17 com interface do lote anterior, incluindo pedidos, itens, cadastros, conflitos e idempotência; dispositivos e rede simulados. Estes lotes não foram integralmente repetidos nesta rodada. Não equivalem a testes em dois Windows físicos.

O primeiro empacotamento desta rodada, via API com mesclagem da configuração padrão, omitiu o frontend D1; o teste de pacote o reprovou e o teste Electron falhou no login, encerrando normalmente. Esse artefato em `artifacts/agente5-i5r4-dev-20261020` NÃO é a candidata. A invocação CLI com arquivo de configuração produziu o pacote corrigido no diretório `agente5-i5r4-candidate-20261020`, verificado integralmente.

## NSIS e reprodução

A configuração candidata herda instalação assistida, por usuário, sem elevação, atalhos próprios e preservação de AppData. A macro de leitura HKCU roda após `registryAddInstallInfo` oficial e valida InstallLocation e UninstallString com `/currentuser`, sem escrita manual de registro. Ausência de ambiente Windows descartável autorizado impede comprovar o comportamento instalado. A causa da ausência do registro da R3 continua desconhecida.

Para reproduzir, executar builds web/D1 e o CLI electron-builder instalado, usando `--projectDir desktop --config electron-builder-agente5-i5r4-candidate.cjs --win nsis --x64`, com distribuição Electron 44.7.2 e ferramentas existentes. Verificar com `scripts/d1-lab/test-i5r4-artifact.mjs`, fornecendo `RUY_ELECTRON_TOOL_HOME` somente ao processo verificador. Não usar a API que mescla novamente a configuração padrão.

## Preservação e próximos passos

Conferidos: ASARs e DPAPI instalados, 25 cópias cifradas e dez arquivos WIP da Etapa A. I5 anterior continuou com API 18091 e PG 55437. API 18080 não foi recriada. Nenhuma instalação, registro manual, alteração de produção, Supabase, sincronização real ou migração operacional foi executada.

Após autorização específica: verificar hash e recursos livres, instalar interativamente em destino exclusivo R4 sem elevação, inspecionar registro/atalhos, abrir e fechar pelo atalho, validar persistência/backup. Interromper diante de bloqueio de segurança; não contornar proteções nem sobrescrever versões anteriores.

Bloqueios: instalação NSIS real/limpa, segunda máquina física, reconexão real, certificados entre máquinas e aceite operacional. Candidata restrita à homologação; nenhuma liberação operacional.

Evidências locais: `logs/i5r4-candidate/` e os relatórios do lote pós-R3. Instaladores e logs privados não são versionados.
