// Banco de dados na NUVEM (Supabase), com a MESMA interface do localDb
// (list, filter, get, create, update, delete, bulkCreate, deleteMany,
// subscribe), para nenhuma página precisar ser reescrita.
//
// Todos os registros ficam em UMA tabela genérica `records`:
//   (entity, id, data jsonb, created_date, updated_date)
// Isso dispensa um schema por entidade e mantém o app flexível.
//
// Configuração: preencha abaixo (ou use .env.local com
// VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY). Enquanto estiver vazio,
// o app continua usando o banco local do navegador (IndexedDB).

import { sortRows, matchesQuery } from '@/lib/localDb';

export const cloudConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || 'https://wvcvveqdkecsoygtilop.supabase.co',
  key: import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_HQU9s6nSU5UH-UFMA9SOsA_Exqep5wh',
};

const LOCAL_DB_NAME = 'gestao_ruy_local_db';
const MIGRATION_FLAG = 'gr_cloud_migrated_v1';
const REFRESH_INTERVAL_MS = 20000; // sincroniza abas/máquinas a cada 20s

export function isCloudConfigured() {
  return Boolean(cloudConfig.url && cloudConfig.key);
}

function baseHeaders(extra = {}) {
  return {
    apikey: cloudConfig.key,
    Authorization: `Bearer ${cloudConfig.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = baseHeaders(prefer ? { Prefer: prefer } : {});
  const res = await fetch(`${cloudConfig.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) return null;
  return res.json();
}

function enc(value) {
  return encodeURIComponent(value);
}

export async function fetchEntityRows(entity) {
  const rows = await rest(`records?entity=eq.${enc(entity)}&select=data,created_date,updated_date`);
  return (rows || []).map((r) => r.data);
}

export async function fetchRow(entity, id) {
  const rows = await rest(
    `records?entity=eq.${enc(entity)}&id=eq.${enc(id)}&select=data,created_date,updated_date`
  );
  return rows && rows.length ? rows[0] : null;
}

function toRow(entity, rec) {
  return {
    entity,
    id: rec.id,
    data: rec,
    created_date: rec.created_date || new Date().toISOString(),
    updated_date: rec.updated_date || new Date().toISOString(),
  };
}

export async function upsertRows(rows) {
  if (!rows.length) return [];
  const out = [];
  // Em lotes de 200 para não estourar limite de payload.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const res = await rest('records?on_conflict=entity,id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: chunk,
    });
    if (Array.isArray(res)) out.push(...res);
  }
  return out;
}

export async function patchRow(entity, id, rec) {
  const rows = await rest(`records?entity=eq.${enc(entity)}&id=eq.${enc(id)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: toRow(entity, rec),
  });
  return rows && rows.length ? rows[0].data : rec;
}

export async function deleteRow(entity, id) {
  await rest(`records?entity=eq.${enc(entity)}&id=eq.${enc(id)}`, { method: 'DELETE' });
  return { id };
}

// ---------------------------------------------------------------------------
// subscribe: notifica quando algo muda nesta entidade (nesta aba) + um
// "polling" global que dispara a refetch periódica para refletir mudanças
// feitas em outras máquinas/abas.
// ---------------------------------------------------------------------------
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
let pollStarted = false;
function startPolling() {
  if (pollStarted) return;
  pollStarted = true;
  setInterval(() => {
    Object.keys(listeners).forEach((entity) => notify(entity));
  }, REFRESH_INTERVAL_MS);
}

function uid() {
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createEntityClient(entity) {
  startPolling();
  return {
    async list(sort, limit) {
      const rows = sortRows(await fetchEntityRows(entity), sort);
      return limit ? rows.slice(0, limit) : rows;
    },

    async filter(query = {}, sort, limit) {
      const rows = sortRows(
        (await fetchEntityRows(entity)).filter((r) => matchesQuery(r, query)),
        sort
      );
      return limit ? rows.slice(0, limit) : rows;
    },

    async get(id) {
      const row = await fetchRow(entity, id);
      if (!row) throw new Error(`${entity} "${id}" não encontrado.`);
      return row.data;
    },

    async create(data) {
      const now = new Date().toISOString();
      const id = data?.id || uid();
      const rec = { ...data, id, created_date: data?.created_date || now, updated_date: now };
      await upsertRows([toRow(entity, rec)]);
      notify(entity);
      return rec;
    },

    async update(id, patch) {
      const existing = await fetchRow(entity, id);
      if (!existing) throw new Error(`${entity} "${id}" não encontrado.`);
      const merged = {
        ...existing.data,
        ...patch,
        id,
        created_date: existing.data?.created_date || existing.created_date,
        updated_date: new Date().toISOString(),
      };
      const saved = await patchRow(entity, id, merged);
      notify(entity);
      return saved;
    },

    async delete(id) {
      await deleteRow(entity, id);
      notify(entity);
      return { id };
    },

    async bulkCreate(items = []) {
      const now = new Date().toISOString();
      const out = items.map((data) => {
        const id = data?.id || uid();
        return { ...data, id, created_date: data?.created_date || now, updated_date: now };
      });
      await upsertRows(out.map((rec) => toRow(entity, rec)));
      notify(entity);
      return out;
    },

    async deleteMany(ids = []) {
      for (const id of ids) {
        await deleteRow(entity, id);
      }
      notify(entity);
      return { deleted: ids.length };
    },

    subscribe(cb) {
      listeners[entity] = listeners[entity] || new Set();
      listeners[entity].add(cb);
      return () => listeners[entity].delete(cb);
    },
  };
}

// ---------------------------------------------------------------------------
// Migração única: sobe para a nuvem o que já existia no navegador
// (IndexedDB). Cada máquina roda essa rotina uma vez, então dados feitos
// offline/anteriormente são preservados. Ids são os mesmos, então upsert
// não duplica nada.
// ---------------------------------------------------------------------------
function readLocalIndexedRows() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(LOCAL_DB_NAME);
    } catch {
      resolve([]);
      return;
    }
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('records', 'readonly');
        const getAll = tx.objectStore('records').getAll();
        getAll.onsuccess = () => resolve(getAll.result || []);
        getAll.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    };
    req.onerror = () => resolve([]);
  });
}

export async function migrateLocalDataIfPending() {
  if (!isCloudConfigured()) return;
  if (localStorage.getItem(MIGRATION_FLAG)) return;
  try {
    const rows = await readLocalIndexedRows();
    const payload = rows
      .filter((r) => r?._entity && r?.id)
      .map((r) => {
        const { _key, _entity, ...data } = r;
        return {
          entity: _entity,
          id: r.id,
          data,
          created_date: r.created_date || new Date().toISOString(),
          updated_date: r.updated_date || new Date().toISOString(),
        };
      });
    await upsertRows(payload);
    localStorage.setItem(MIGRATION_FLAG, String(Date.now()));
    if (payload.length) {
      console.info(`[cloudDb] ${payload.length} registro(s) locais migrado(s) para a nuvem.`);
    }
  } catch (err) {
    // Não marca a flag: tenta de novo na próxima carga.
    console.error('[cloudDb] Falha na migração local→nuvem:', err);
  }
}