// ---------------------------------------------------------------------------
// Banco em memória que reproduz a tabela `records` do Supabase (PostgREST) e
// o compare-and-swap de `transact`.
//
// Por que existe: o `stockService` precisa ser exercitado de verdade — ler,
// calcular e gravar — sem tocar o Supabase real. Um mock puramente síncrono
// não provaria nada de concorrência, então aqui toda operação de I/O tem um
// ponto de interleamento (setTimeout) que reproduz a janela de corrida entre
// duas máquinas.
//
// Não tem dependência externa: roda em qualquer clone, com `node scripts/...`.
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

export { REPO };

let pass = 0;
let fail = 0;
const failures = [];

export function check(label, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ok   ${label}`); }
  else {
    fail += 1;
    failures.push(label);
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

export function section(titulo) {
  console.log(`\n${titulo}`);
}

export function resumo() {
  console.log(`\nSTOCK_TOTAL ${pass}/${pass + fail}`);
  if (fail) {
    console.log('Falhas:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  return fail;
}


/**
 * Cria um banco em memória.
 *
 * O `casHook` simula outra máquina gravando DENTRO da janela do
 * compare-and-swap (entre ler a versão e gravar), que é exatamente onde a
 * transação precisa detectar o conflito e repetir. Ele substitui a linha por
 * um objeto novo: editar no lugar não serviria, porque o mock seguraria a
 * mesma referência antes e depois e a comparação de versão passaria.
 */
export function makeDb() {
  const rows = new Map();
  const listOf = (entity) => [...rows.values()]
    .filter((r) => r.entity === entity)
    .map((r) => ({ ...r.data }));
  const matches = (row, q) => Object.entries(q || {}).every(([k, v]) => row[k] === v);
  let seq = 0;

  const put = (entity, rec) => {
    const id = rec.id || `${entity.slice(0, 3)}${(seq += 1).toString(36)}`;
    const now = new Date().toISOString();
    const prev = rows.get(`${entity}::${id}`);
    const row = {
      entity,
      id,
      data: { ...rec, id, created_date: rec.created_date || prev?.data.created_date || now },
      created_date: prev?.created_date || now,
      updated_date: now,
    };
    rows.set(`${entity}::${id}`, row);
    return { ...row.data };
  };

  function client(entity) {
    return {
      async list() { return listOf(entity); },
      // Síncrono de propósito: o serviço sempre faz `await`, e os testes
      // precisam ler `item().current_stock` direto.
      get(id) { return rows.get(`${entity}::${id}`)?.data ?? null; },
      async filter(q) { return listOf(entity).filter((r) => matches(r, q)); },
      async create(rec) {
        // A falha vem ANTES de gravar, como um banco que rejeita o INSERT.
        if (db.failCreateFor === entity) throw new Error(db.failMessage);
        const out = put(entity, rec);
        db.creates.push({ entity, rec: out });
        return { ...out };
      },
      async update(id, patch) {
        const cur = rows.get(`${entity}::${id}`);
        if (!cur) throw new Error(`${entity} "${id}" não encontrado.`);
        return put(entity, { ...cur.data, ...patch });
      },
      async transact(id, mutate, options = {}) {
        const retries = typeof options === 'number' ? options : (options.retries ?? 6);
        for (let attempt = 0; attempt <= retries; attempt += 1) {
          await new Promise((r) => setTimeout(r, 0));   // ponto de interleaving
          const row = rows.get(`${entity}::${id}`);
          if (!row) throw new Error(`${entity} "${id}" não encontrado.`);
          const patch = await mutate({ ...row.data });
          if (patch === null || patch === undefined) return { ...row.data };
          await new Promise((r) => setTimeout(r, 0));   // janela entre ler e gravar
          if (db.casHook) { const h = db.casHook; db.casHook = null; h(id); }
          const cur = rows.get(`${entity}::${id}`);
          if (cur.updated_date !== row.updated_date) { db.casRetries += 1; continue; }
          return put(entity, { ...cur.data, ...patch, updated_date: new Date().toISOString() });
        }
        throw new Error(
          `Não foi possível gravar ${entity} "${id}": o registro mudou durante ${retries + 1} tentativas.`
        );
      },
    };
  }

  const db = {
    rows, casRetries: 0, creates: [], casHook: null,
    failCreateFor: null, failMessage: 'falha simulada',
  };
  db.list = listOf;
  // O Proxy precisa devolver SEMPRE o mesmo objeto por entidade: os testes
  // trocam métodos para simular falha, e um cliente novo a cada acesso perderia
  // a troca.
  const cache = new Map();
  db.entities = new Proxy({}, {
    get: (_, name) => {
      const key = String(name);
      if (!cache.has(key)) cache.set(key, client(key));
      return cache.get(key);
    },
  });
  return db;
}

/** Força um conflito de versão na primeira tentativa do próximo `transact`. */
export function injetarConflito(db, novoSaldo, id = 'it1') {
  db.casHook = (alvo) => {
    const key = `InventoryItem::${alvo || id}`;
    const row = db.rows.get(key);
    if (!row) return;
    db.rows.set(key, {
      ...row,
      data: { ...row.data, current_stock: novoSaldo },
      // A versão PRECISA mudar: no mesmo milissegundo o ISO seria idêntico.
      updated_date: new Date(Date.now() + 1000).toISOString(),
    });
  };
}

/**
 * Carrega o `stockService` REAL do repositório, com o `base44` apontado para
 * o banco em memória.
 *
 * O `src/` usa o alias `@/` e módulos ESM, que o Node não resolve fora do
 * Vite. Em vez de duplicar a lógica (o que faria o teste não testar o código
 * real), removemos só a sintaxe de módulo e colamos os arquivos — o corpo vem
 * do disco, byte a byte, a cada execução.
 */
export function loadService(db) {
  // O padrão de import precisa ser NÃO guloso e ancorado no início da linha:
  // um `[\s\S]*` guloso engolia o corpo inteiro do arquivo.
  const strip = (s) => s
    .replace(/\r\n/g, '\n')
    .replace(/^import\b[\s\S]*?from\s*['"][^'"]*['"];?[ \t]*$/gm, '')
    .replace(/^export\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?[ \t]*$/gm, '')
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '')
    .replace(/^export\s+(async\s+)?function\b/gm, '$1function')
    .replace(/^export\s+const\b/gm, 'const')
    .replace(/^export\s+let\b/gm, 'let')
    .replace(/^export\s+class\b/gm, 'class');

  const glue = [
    strip(readFileSync(pathRepo('src/lib/numberUtils.js'), 'utf8')),
    strip(readFileSync(pathRepo('src/lib/stockRules.js'), 'utf8')),
    strip(readFileSync(pathRepo('src/lib/stockService.js'), 'utf8')),
  ].join('\n');

  return new Function('base44', `${glue}\nreturn {
    registrarMovimentacao, registrarEntrada, registrarSaida, registrarPerda,
    ajustarSaldo, registrarEntradaDeCompra, criarItemComEstoqueInicial,
    newClientToken, findMovementByClientToken,
  };`)({ entities: db.entities });
}

/** Cenário pronto: um item "Farinha" com o saldo informado. */
export function novoCenario(db, saldo = 0, extra = {}) {
  db.entities.InventoryItem.create({
    id: 'it1', name: 'Farinha', unit: 'kg', status: 'ativo', minimum_stock: 0,
    average_cost: 0, last_cost: 0, ...extra, current_stock: saldo,
  });
  const svc = loadService(db);
  return {
    db,
    svc,
    item: () => db.entities.InventoryItem.get('it1'),
    moves: () => db.list('StockMovement'),
  };
}

/** Base do repositório: resolve caminhos relativos ao script, não ao terminal. */
export const pathRepo = (...p) => join(REPO, ...p);
