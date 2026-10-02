// ---------------------------------------------------------------------------
// Check de integridade da EXCLUSÃO FÍSICA de colaborador.
//
// Por que este arquivo existe
// --------------------------
// Hoje a exclusão física está certa POR ACORDO: existe uma função autorizada e
// o resto do projeto não apaga Employee. Nada impede um desenvolvedor de voltar
// a chamar `base44.entities.Employee.delete(...)` direto numa tela, ou de
// "resolver" um bloqueio apagando o pagamento primeiro — e nenhuma das duas
// coisas quebraria teste nenhum. Este script falha o build quando isso acontece.
//
// Regras
//   1. `Employee.delete(...)` só pode existir em src/lib/employeeDelete.js.
//   2. `Employee.deleteMany(...)` é proibido em TODO o projeto.
//   3. Dentro do serviço, NENHUMA outra entity pode ser apagada (sem cascata).
//   4. Toda entity que grava `employee_id`/`beneficiary_id`/`substitute_id`
//      tem de estar em EMPLOYEE_DELETE_RELATIONS — se alguém criar uma entity
//      nova ligada ao colaborador e esquecer dela aqui, a exclusão passaria a
//      responder "zero dependências" sem ter checado nada.
//   5. Todo nome de entity do mapa precisa existir em src/api/base44Client.js.
//   6. O rechecamento final tem de vir ANTES do `Employee.delete`.
//   7. O desligamento (exclusão lógica) continua existindo e é inalterado.
//
// É uma rede de segurança estática, não um substituto dos testes de
// comportamento (`scripts/test-employee-delete.mjs`).
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO, 'src');
const SERVICO = 'src/lib/employeeDelete.js';
const TELA = 'src/pages/Funcionarios.jsx';
const TESTES = 'scripts/test-employee-delete.mjs';

// Arquivos com autorização explícita para apagar o Employee.
const AUTORIZADOS = new Set([SERVICO]);

// Campos que ligam um registro ao Employee.
const CAMPOS_VINCULO = /\b(employee_id|beneficiary_id|substitute_id)\s*:/;

const erros = [];
let autoOk = 0;
let autoFail = 0;
const check = (label, ok) => {
  if (ok) { autoOk += 1; console.log(`  ok   ${label}`); }
  else { autoFail += 1; console.log(`  FAIL ${label}`); }
};

/** Percorre src/ e devolve os arquivos .js/.jsx. */
function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) yield* arquivos(p);
    else if (/\.(js|jsx)$/.test(nome)) yield p;
  }
}

/** Remove comentários antes de casar padrões: o serviço DOCUMENTA o que proíbe. */
function semRuido(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

/** Nomes de entity declarados no mapa central. */
function entidadesDoMapa(codigo) {
  const bloco = codigo.slice(codigo.indexOf('EMPLOYEE_DELETE_RELATIONS = Object.freeze(['));
  const fim = bloco.indexOf(']);');
  return [...bloco.slice(0, fim).matchAll(/entity:\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
}

/** Nomes de entity que existem no cliente. */
function entidadesDoCliente(codigo) {
  const bloco = codigo.slice(codigo.indexOf('const ENTITY_NAMES = ['));
  const fim = bloco.indexOf('];');
  return new Set([...bloco.slice(0, fim).matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));
}

/**
 * Entities ligadas ao Employee encontradas no código.
 * Extraído como função para o autoteste do fim exercitá-lo diretamente.
 */
function entidadesVinculadas(codigo) {
  const achadas = new Set();
  for (const m of codigo.matchAll(/entities\.([A-Za-z]+)\.(?:create|bulkCreate|update)\(/g)) {
    if (CAMPOS_VINCULO.test(codigo.slice(m.index, m.index + 400))) achadas.add(m[1]);
  }
  return achadas;
}

const codigoServico = readFileSync(join(REPO, SERVICO), 'utf8');
const codigoTela = readFileSync(join(REPO, TELA), 'utf8');
const codigoCliente = readFileSync(join(REPO, 'src', 'api', 'base44Client.js'), 'utf8');
const noMapa = new Set(entidadesDoMapa(codigoServico));
const existentes = entidadesDoCliente(codigoCliente);
// --- Regras 1, 2 e 3: quem pode apagar o quê -------------------------------
for (const abs of arquivos(SRC)) {
  const rel = relative(REPO, abs).replaceAll('\\', '/');
  const limpo = semRuido(readFileSync(abs, 'utf8'));

  for (const [i, linha] of limpo.split('\n').entries()) {
    const n = i + 1;
    // Regra 1 — exclusão física do Employee só no serviço autorizado.
    if (/\bEmployee\s*\.\s*delete\s*\(/.test(linha) && !AUTORIZADOS.has(rel)) {
      erros.push(`${rel}:${n}  Employee.delete fora de ${SERVICO} — a exclusão fisica passa pela regra central`);
    }
    // Regra 2 — deleteMany em Employee nunca (exclusão em cascata/massa).
    if (/\bEmployee\s*\.\s*deleteMany\s*\(/.test(linha)) {
      erros.push(`${rel}:${n}  Employee.deleteMany e proibido em todo o projeto`);
    }
    // Regra 3 — dentro do serviço, nenhuma OUTRA entity pode ser apagada.
    if (AUTORIZADOS.has(rel)) {
      const outra = linha.match(/\b([A-Za-z]+)\s*\.\s*(delete|deleteMany)\s*\(/);
      if (outra && outra[1] !== 'Employee' && outra[1] !== 'AuditLog' && outra[1] !== 'records') {
        erros.push(`${rel}:${n}  ${outra[1]}.${outra[2]} dentro do servico — exclusao de colaborador nao pode apagar dependencia`);
      }
    }
  }

  // Regra 4 — nenhuma entity nova pode passar sem entrar no mapa.
  for (const entity of entidadesVinculadas(limpo)) {
    if (!noMapa.has(entity)) {
      erros.push(`${rel}  grava campo de vinculo com Employee em "${entity}" e a entity nao esta em EMPLOYEE_DELETE_RELATIONS`);
    }
  }
}

// --- Regra 5: nenhum nome de entity errado no mapa -------------------------
for (const entity of noMapa) {
  if (!existentes.has(entity)) {
    erros.push(`${SERVICO}  "${entity}" nao existe em src/api/base44Client.js — o filtro nunca encontraria registro`);
  }
}

// --- Regra 6: a rechecagem final vem antes do delete -----------------------
const corpoExclusao = codigoServico.slice(codigoServico.indexOf('export async function deleteEmployeeIfUnused'));
const iRecheck = corpoExclusao.indexOf('await checkEmployeeDependencies');
const iDelete = corpoExclusao.indexOf('await entities.Employee.delete(');
if (iRecheck < 0) {
  erros.push(`${SERVICO}  deleteEmployeeIfUnused nao rechecagem as dependencias antes de apagar`);
} else if (iDelete < 0) {
  erros.push(`${SERVICO}  deleteEmployeeIfUnused nao executa Employee.delete`);
} else if (iRecheck > iDelete) {
  erros.push(`${SERVICO}  o Employee.delete acontece ANTES da rechecagem final`);
}

// --- Regra 7: o desligamento continua intacto ------------------------------
if (!/Employee\.update\(e\.id, \{ status: 'desligado' \}\)/.test(codigoTela)) {
  erros.push(`${TELA}  o desligamento (exclusao logica) deixou de existir`);
}
if (!/action: 'exclusao_logica'/.test(codigoTela)) {
  erros.push(`${TELA}  a auditoria de exclusao logica do desligamento sumiu`);
}
if (!/title="Desligar"/.test(codigoTela) || !/title="Excluir definitivamente"/.test(codigoTela)) {
  erros.push(`${TELA}  as acoes Desligar e Excluir precisam continuar separadas e visiveis`);
}

// --- Regra 8: a auditoria nao pode carregar dado sensivel ------------------
const corpoAuditoria = codigoServico.slice(
  codigoServico.indexOf('export async function auditEmployeePhysicalDelete'),
  codigoServico.indexOf('export async function deleteEmployeeIfUnused'),
);
for (const campo of ['cpf', 'rg', 'pix_key', 'bank', 'salary', 'salary'.slice(0, 0) + 'vale_value']) {
  if (new RegExp(`\\b${campo}\\b`).test(corpoAuditoria)) {
    erros.push(`${SERVICO}  a auditoria da exclusao fisica cita o campo sensivel ${campo}`);
  }
}
// --- Relatório -------------------------------------------------------------
const out = [];
out.push('=== check-employee-delete-integrity ===');
out.push('');
out.push('Permitido: Employee.delete SOMENTE em src/lib/employeeDelete.js,');
out.push('e somente depois de a rechecagem final voltar limpa.');
out.push('Proibido em todo o projeto:');
out.push('  - Employee.delete fora do serviço central');
out.push('  - Employee.deleteMany');
out.push('  - apagar QUALQUER entity dependente junto do colaborador');
out.push('  - entity ligada por employee_id/beneficiary_id fora do mapa');
out.push('  - campo sensivel na auditoria da exclusao');
out.push('');
out.push('scripts/ nao e varrido de proposito: o harness de teste simula o banco.');
out.push('');
if (erros.length) {
  out.push(`FALHAS (${erros.length}):`);
  for (const e of erros) out.push(`  [ERRO] ${e}`);
  out.push('');
  out.push('EMPLOYEE_DELETE_INTEGRITY_FALHOU');
} else {
  out.push('Nenhuma exclusao fisica de colaborador fora da regra central.');
  out.push('EMPLOYEE_DELETE_INTEGRITY_OK');
}

// --- Autoteste: as MESMAS regras contra violações sintéticas ---------------
// Um check que nunca acusa nada é pior que nenhum check: daria falsa segurança.
console.log('\nAutoteste (violacoes sinteticas devem ser acusadas):');
{
  const linhaDe = (codigo) => semRuido(codigo).split('\n');

  for (const [nome, codigo] of [
    ['Employee.delete numa tela',
      'const x = await base44.entities.Employee.delete(linha.id);'],
    ['Employee.delete com espacos',
      'const x = await base44.entities.Employee . delete(linha.id);'],
    ['Employee.deleteMany',
      'await base44.entities.Employee.deleteMany(ids);'],
  ]) {
    const dentroDoServico = AUTORIZADOS.has(TELA);
    const achou = linhaDe(codigo).some((l) => /\bEmployee\s*\.\s*delete\s*\(/.test(l) && !dentroDoServico)
      || linhaDe(codigo).some((l) => /\bEmployee\s*\.\s*deleteMany\s*\(/.test(l));
    check(`detecta ${nome}`, achou);
  }

  check('detecta cascata dentro do servico', linhaDe('await entities.Vale.deleteMany({ employee_id });')
    .some((l) => { const m = l.match(/\b([A-Za-z]+)\s*\.\s*(delete|deleteMany)\s*\(/); return m && m[1] !== 'Employee' && m[1] !== 'AuditLog'; }));
  check('permite o proprio Employee.delete no servico', !linhaDe('await entities.Employee.delete(id);')
    .some((l) => { const m = l.match(/\b([A-Za-z]+)\s*\.\s*(delete|deleteMany)\s*\(/); return m && m[1] !== 'Employee'; }));

  check('detecta entity vinculada fora do mapa',
    !noMapa.has('FeriasProgramadas') && entidadesVinculadas('await base44.entities.FeriasProgramadas.create({ employee_id: e.id });').has('FeriasProgramadas'));
  check('detecta entity vinculada por beneficiary_id fora do mapa',
    !noMapa.has('Bonus') && entidadesVinculadas('await base44.entities.Bonus.create({ beneficiary_id: e.id });').has('Bonus'));
  check('nao acusa entity sem campo de vinculo',
    !entidadesVinculadas('await base44.entities.DailyProduction.create({ responsible: "Ana" });').size);
  check('reconhece as entidades do mapa', noMapa.has('EmployeePayment') && noMapa.has('FinancialExpense'));
  check('todos os nomes do mapa existem no cliente', [...noMapa].every((e) => existentes.has(e)));
  check('a suíte cobre todas as entidades do mapa', (() => {
    try {
      return [...noMapa].every((e) => readFileSync(join(REPO, TESTES), 'utf8').includes(e));
    } catch { return false; }
  })());
}

console.log(`\nAutoteste: ${autoOk} ok, ${autoFail} falhas`);

const texto = out.join('\n');
console.log(`\n${texto}`);
try {
  writeFileSync(join(REPO, 'scripts', 'check-employee-delete-integrity.out.txt'), `${texto}\n`, 'utf8');
} catch { /* o relatório é acessório; não vale falhar por causa dele */ }

process.exit(erros.length || autoFail ? 1 : 0);
