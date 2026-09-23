// Substitui o backend do Base44 por um banco local, guardado no navegador
// (IndexedDB). Cada "entidade" (Employee, FinancialExpense, etc.) vira uma
// tabela própria dentro do mesmo banco. A interface exposta (list, filter,
// get, create, update, delete, bulkCreate, deleteMany, subscribe) é a mesma
// que o restante do app já espera do `base44.entities.X`, então nenhuma
// página precisou ser reescrita.
//
// Importante: os dados ficam apenas no navegador/dispositivo em que o app é
// usado (IndexedDB do domínio). Não há mais sincronização entre
// dispositivos/usuários nem backup automático na nuvem — isso dependia do
// Base44. Convém orientar o time a não limpar os dados do navegador e, se
// quiser um backup, exportar (dá para adicionar um botão de exportar/
// importar JSON depois, se for útil).

const DB_NAME = 'gestao_ruy_local_db';
const DB_VERSION = 1;
const STORE = 'records';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: '_key' });
        store.createIndex('entity', '_entity', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqp(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Executa `fn` dentro de uma única transação e só resolve quando a
// transação inteira for concluída (evita corrida entre múltiplas
// transações ao ler-e-depois-escrever).
function withStore(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        let failed = false;
        Promise.resolve(fn(store))
          .then((r) => {
            result = r;
          })
          .catch((err) => {
            failed = true;
            reject(err);
            try {
              t.abort();
            } catch {
              /* noop */
            }
          });
        t.oncomplete = () => {
          if (!failed) resolve(result);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => {
          if (!failed) reject(t.error || new Error('Transação cancelada'));
        };
      })
  );
}

function uid() {
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function stripMeta(row) {
  if (!row) return row;
  const { _key, _entity, ...rest } = row;
  return rest;
}

export function matchesQuery(row, query) {
  return Object.entries(query || {}).every(([k, v]) => row[k] === v);
}

export function sortRows(rows, sort) {
  const field = sort ? (sort.startsWith('-') ? sort.slice(1) : sort) : 'created_date';
  const desc = sort ? sort.startsWith('-') : true;
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av == null && bv == null) return 0;
    if (av == null) return desc ? 1 : -1;
    if (bv == null) return desc ? -1 : 1;
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

const listeners = {};
function notify(entity) {
  (listeners[entity] || new Set()).forEach((cb) => {
    try {
      cb();
    } catch {
      /* noop */
    }
  });
}

async function getAllByEntity(entity) {
  return withStore('readonly', async (store) => {
    const idx = store.index('entity');
    const rows = await reqp(idx.getAll(IDBKeyRange.only(entity)));
    return rows.map(stripMeta);
  });
}

export function createEntityClient(entity) {
  const client = {
    async list(sort, limit) {
      const rows = sortRows(await getAllByEntity(entity), sort);
      return limit ? rows.slice(0, limit) : rows;
    },

    async filter(query = {}, sort, limit) {
      const rows = sortRows(
        (await getAllByEntity(entity)).filter((r) => matchesQuery(r, query)),
        sort
      );
      return limit ? rows.slice(0, limit) : rows;
    },

    async get(id) {
      return withStore('readonly', async (store) => {
        const row = await reqp(store.get(`${entity}::${id}`));
        if (!row) throw new Error(`${entity} "${id}" não encontrado.`);
        return stripMeta(row);
      });
    },

    async create(data) {
      const record = await withStore('readwrite', async (store) => {
        const now = new Date().toISOString();
        const id = data?.id || uid();
        const rec = { ...data, id, created_date: data?.created_date || now, updated_date: now };
        await reqp(store.put({ ...rec, _key: `${entity}::${id}`, _entity: entity }));
        return rec;
      });
      notify(entity);
      return record;
    },

    async update(id, patch) {
      const updated = await withStore('readwrite', async (store) => {
        const existing = await reqp(store.get(`${entity}::${id}`));
        if (!existing) throw new Error(`${entity} "${id}" não encontrado.`);
        const merged = { ...stripMeta(existing), ...patch, id, updated_date: new Date().toISOString() };
        await reqp(store.put({ ...merged, _key: `${entity}::${id}`, _entity: entity }));
        return merged;
      });
      notify(entity);
      return updated;
    },

    async delete(id) {
      await withStore('readwrite', async (store) => {
        await reqp(store.delete(`${entity}::${id}`));
      });
      notify(entity);
      return { id };
    },

    async bulkCreate(items = []) {
      const created = await withStore('readwrite', async (store) => {
        const now = new Date().toISOString();
        const out = [];
        for (const data of items) {
          const id = data?.id || uid();
          const rec = { ...data, id, created_date: data?.created_date || now, updated_date: now };
           
          await reqp(store.put({ ...rec, _key: `${entity}::${id}`, _entity: entity }));
          out.push(rec);
        }
        return out;
      });
      notify(entity);
      return created;
    },

    async deleteMany(ids = []) {
      await withStore('readwrite', async (store) => {
        for (const id of ids) {
           
          await reqp(store.delete(`${entity}::${id}`));
        }
      });
      notify(entity);
      return { deleted: ids.length };
    },

    // Assinatura simples: chama `cb` sempre que algo mudar nesta entidade
    // (não é realtime entre dispositivos, só dentro da mesma aba/app).
    subscribe(cb) {
      listeners[entity] = listeners[entity] || new Set();
      listeners[entity].add(cb);
      return () => listeners[entity].delete(cb);
    },
  };
  return client;
}

// Upload de arquivo 100% local: converte o arquivo em base64 (data URL) e
// devolve no mesmo formato que o Base44 devolvia ({ file_url }). O arquivo
// fica salvo dentro do próprio registro (ex.: proof_url do gasto), então
// funciona normalmente em <img>/<a href>, mas ocupa mais espaço que um
// link para um storage externo — evite anexar arquivos muito grandes.
export function uploadFileLocal({ file }) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Nenhum arquivo informado.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ file_url: reader.result, name: file.name });
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}
