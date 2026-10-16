# Runtime C2 de laboratório

Cópia autocontida do runtime já validado em `gestao-ruy-test-isolado`, incluindo somente o grafo de imports do entrypoint, schema e testes de health/supervisão. Não contém configurações de proprietário, credenciais, dados, dependências instaladas ou artefatos. Esta pasta evita imports para caminhos absolutos de outro checkout. Mantém namespace próprio para não substituir os módulos Windows existentes.

Não habilita por si só os módulos financeiro/RH/anexos: eles são dependências do runtime existente, sem nova habilitação. A aplicação Windows permanece apontada ao D1 de laboratório; o gateway D1 é opt-in e somente para bases sintéticas. Nunca executar o schema em banco operacional.

No diretório desta pasta, usar `node scripts/test-local-health.mjs` para os testes de health. Para iniciar a substituição 18080, usar o procedimento aprovado na raiz, que exige confirmação explícita e recusa a porta ocupada. Não encerrar processos para liberar portas.
