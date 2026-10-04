// ===========================================================================
// VERIFICAÇÃO DE CONFIGURAÇÃO DO BACKEND DE ARQUIVOS (R2).
//
//   npm run storage:check
//
// Responde UMA pergunta: o backend de arquivos consegue subir? Só isso.
// Não conecta no R2, não envia arquivo, não assina URL, não apaga nada.
//
// REGRA: o valor de uma variável NUNCA é impresso. Só o nome, e se está
// presente. `R2_SECRET_ACCESS_KEY` e `R2_ACCESS_KEY_ID` são segredo;
// imprimi-los num relatório de terminal já é vazamento.
import { storageAPIConfigFromEnvironment, missingStorageConfig } from '../server/storage/storageApi.mjs';

const config = storageAPIConfigFromEnvironment();
const faltando = missingStorageConfig(config);

const OPCIONAIS = [
  ['R2_ACCOUNT_ID', config.accountId, 'derivacao do endpoint (so se R2_ENDPOINT faltar)'],
  ['R2_REGION', config.region, 'assinatura SigV4'],
  ['R2_PREFIX', config.r2Prefix, 'prefixo que espelha o bucket legado'],
  ['STORAGE_API_ALLOWED_ORIGINS', config.origins.join(','), 'CORS'],
  ['STORAGE_API_ENFORCE_LOCAL', String(config.enforceLocal), 'restringe a rede local'],
  ['STORAGE_DELETE_ENABLED', String(config.allowDelete), 'exclusao real (desligada por padrao)'],
];

console.log('Backend de arquivos (R2) - verificacao de configuracao\n');
for (const [nome, valor, uso] of OPCIONAIS) {
  console.log(`  ${valor ? 'OK  ' : 'AVISO'} ${nome.padEnd(28)} ${valor ? '' : `ausente (${uso})`}`);
}

console.log(`\nBucket configurado: ${config.bucket}`);
console.log(`Exclusao real de arquivo: ${config.allowDelete ? 'LIGADA' : 'DESLIGADA'}`);

if (faltando.length) {
  console.error(`\nOBRIGATORIAS AUSENTES: ${faltando.join(', ')}`);
  console.error('O backend de arquivos nao sobe sem elas. Nada foi escrito.');
  process.exit(1);
}

console.log('\nObrigatorias presentes. `npm run storage:dev` pode subir.');
console.log('Lembrete: isto NAO copia, NAO apaga e NAO altera nenhum registro.');
console.log('Para migrar os registros, use a auditoria em scripts/audit-arquivos-referencias.mjs.');
