// ===========================================================================
// VERIFICAÇÃO DE CONFIGURAÇÃO DO BACKEND SOCIAL (Fase 9).
//
// `npm run social:check`
//
// Responde UMA pergunta: o backend social consegue subir? Só isso. Não conecta
// no banco, não aplica schema, não executa bootstrap, não chama Ollama.
//
// Por que existe separado do `social:dev`: o `dev` sobe o servidor, e alguém
// precisa saber o que falta ANTES de subir. Este script diz o nome da variável
// que falta, sem derrubar nada.
//
// REGRA: o valor de uma variável nunca é impresso. Só o nome, e se está presente.
// `SUPABASE_DB_URL` e `SUPABASE_ANON_KEY` podem conter senha e chave; imprimi-los
// num relatório de terminal é vazamento.
import { socialAPIConfigFromEnvironment, missingRequiredConfig } from '../server/social/socialApi.mjs';

const config = socialAPIConfigFromEnvironment();
const faltando = missingRequiredConfig(config);

const OPCIONAIS = [
  ['SUPABASE_DB_URL', config.dbUrl, 'administracao de acessos (503 sem ela)'],
  ['OLLAMA_BASE_URL', config.ollamaBaseUrl, 'IA local'],
  ['OLLAMA_MODEL', config.ollamaModel, 'IA local'],
  ['SOCIAL_AI_ALLOWED_ORIGINS', config.origins, 'CORS'],
];

console.log('Backend social - verificacao de configuracao\n');
for (const [nome, valor, uso] of OPCIONAIS) {
  // Só presença. Nunca o valor: a URL de conexão e a chave são segredos.
  console.log(`  ${valor ? 'OK  ' : 'AVISO'} ${nome.padEnd(26)} ${valor ? '' : `ausente (${uso})`}`);
}

if (faltando.length) {
  console.error(`\nOBRIGATORIAS AUSENTES: ${faltando.join(', ')}`);
  console.error('O backend social nao sobe sem elas. Nada foi escrito.');
  process.exit(1);
}

console.log('\nObrigatorias presentes. `npm run social:dev` pode subir.');
console.log('Lembrete: isto NAO aplica migration e NAO cria o primeiro administrador.');
