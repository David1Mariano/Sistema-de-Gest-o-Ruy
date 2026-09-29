// NÚCLEO de rascunhos (drafts) — puro, sem React, sem alias `@/`.
//
// Por que um módulo só? As telas do sistema são `.jsx` densos e não são
// importáveis por `node --test` (que não resolve `@/` nem compila JSX). A
// convenção do projeto já resolve isso colocando regra de negócio em
// `src/lib/*Utils.js` e testando o comportamento ali. Este arquivo é a mesma
// coisa para rascunhos: toda a decisão (saneamento, TTL, versão, isolamento
// por usuário, degradação) acontece AQUI e é testável de verdade.
//
// Nenhum componente deve chamar `localStorage` para rascunho. O que um
// formulário precisa é de `createDraftSession()` (ver o fim do arquivo).
//
// Não existe registro incompleto no banco em nenhum caminho deste arquivo:
// aqui só existe localStorage, e gravação só acontece por decisão do chamador.

import {
  DRAFT_PREFIX,
  DRAFT_VERSION,
  DRAFT_TTL_MS,
  DRAFT_DEBOUNCE_MS,
  DRAFT_MAX_DEPTH,
  DRAFT_GLOBAL_EXCLUDED_FIELDS,
  DRAFT_FORM_KEYS,
  DRAFT_REASONS,
  DRAFT_REASON_LABELS,
  draftEditKey,
} from './draftConfig.js';

export {
  DRAFT_PREFIX,
  DRAFT_VERSION,
  DRAFT_TTL_MS,
  DRAFT_DEBOUNCE_MS,
  DRAFT_FORM_KEYS,
  DRAFT_REASONS,
  DRAFT_REASON_LABELS,
  draftEditKey,
};

const ok = (reason, extra = {}) => ({ ok: true, reason, ...extra });
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// ---------------------------------------------------------------------------
// Storage tolerante a falha
// ---------------------------------------------------------------------------

// localStorage pode ser inacessível: modo privado do Safari, cota estourada,
// `dominance` bloqueado por política do navegador, ou simplesmente ausente em
// Node/testes. Qualquer acesso é encapsrado — o app nunca quebra por rascunho.
export function getStorage(candidate) {
  const target = candidate === undefined ? globalThis.localStorage : candidate;
  if (!target || typeof target.getItem !== 'function' || typeof target.setItem !== 'function') return null;
  return target;
}

// `Object.keys` funciona no localStorage real e também nos dublês de teste.
// Usa `length`/`key()` como plano B para implementações que não sejam
// indexáveis.
function storageKeys(storage) {
  if (!storage) return [];
  try {
    if (typeof storage.length === 'number' && typeof storage.key === 'function') {
      const out = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (typeof key === 'string') out.push(key);
      }
      return out;
    }
    return Object.keys(storage);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Isolamento por usuário
// ---------------------------------------------------------------------------

// `user.id` é o id do registro AuthUser — o identificador de domínio do
// sistema, o mesmo que os registros referenciam. `auth_user_id` (UUID do
// Supabase) é o plano B. E-mail NÃO serve: o próprio `full_name` do app cai
// para o e-mail quando o nome está vazio.
//
// Sem identificador devolvemos `null` de propósito: o rascunho é então
// desabilitado. Um fallback compartilhado (tipo 'anon') faria o usuário A ver
// o rascunho do usuário B na mesma máquina, que é exatamente o que não pode
// acontecer. Rascunho é recurso degradável.
export function resolveUserKey(user) {
  if (!user || typeof user !== 'object') return null;
  const id = user.id ?? user.auth_user_id;
  if (typeof id === 'number' && Number.isFinite(id)) return `u-${id}`;
  if (typeof id === 'string' && id.trim()) return `u-${encodeURIComponent(id.trim())}`;
  return null;
}

// Chave final: `gr:draft:<userKey>:<formKey>`. O usuário vem ANTES do formulário
// para que a varredura de expirados de um usuário nunca alcance o outro.
export function draftKey(userKey, formKey) {
  return `${DRAFT_PREFIX}:${userKey}:${formKey}`;
}

export function isDraftKey(key) {
  return typeof key === 'string' && key.startsWith(`${DRAFT_PREFIX}:`);
}

function userPrefix(userKey) {
  return `${DRAFT_PREFIX}:${userKey}:`;
}

// ---------------------------------------------------------------------------
// Saneamento — o que pode, o que não pode, entrar num rascunho
// ---------------------------------------------------------------------------

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isFileLike = (value) => (
  (typeof globalThis.File !== 'undefined' && value instanceof globalThis.File)
  || (typeof globalThis.Blob !== 'undefined' && value instanceof globalThis.Blob)
);

function sanitizeValue(value, excluded, seen, dropped, depth) {
  if (depth > DRAFT_MAX_DEPTH) {
    dropped.push('profundidade');
    return undefined;
  }
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  // NaN/Infinity não sobrevivem a JSON; gravá-los produziria rascunho
  // corrompido por um único campo numérico mal digitado.
  if (type === 'number') return Number.isFinite(value) ? value : undefined;
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    dropped.push(type);
    return undefined;
  }
  if (value instanceof Date) return value.toISOString();
  // Arquivos NÃO são serializados em JSON. Se um form someday colocar um File
  // no estado, ele é descartado aqui e a UI mostra "selecione o arquivo
  // novamente" — em vez de gravar lixo ou estourar a cota.
  if (isFileLike(value)) {
    dropped.push('arquivo');
    return undefined;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      dropped.push('ciclo');
      return undefined;
    }
    seen.add(value);
    const out = value
      .map((item) => sanitizeValue(item, excluded, seen, dropped, depth + 1))
      .filter((item) => item !== undefined);
    seen.delete(value);
    return out;
  }
  // Map/Set/Promises/classe de componente caem aqui: não são dados de
  // formulário, e não são serializáveis.
  if (!isPlainObject(value)) {
    dropped.push('objeto');
    return undefined;
  }
  if (seen.has(value)) {
    dropped.push('ciclo');
    return undefined;
  }
  seen.add(value);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (excluded.has(key)) {
      dropped.push(key);
      continue;
    }
    const clean = sanitizeValue(item, excluded, seen, dropped, depth + 1);
    if (clean !== undefined) out[key] = clean;
  }
  seen.delete(value);
  return out;
}

/**
 * Reduz o estado do formulário a JSON puro e seguro.
 * @returns {{ data: object, dropped: string[] }} `dropped` lista o que saiu,
 * para o chamador poder avisar o usuário sobre arquivo (e os testes poderem
 * afirmar que File nunca foi serializado).
 */
export function sanitizeDraftData(data, excludeFields = []) {
  const excluded = new Set([...DRAFT_GLOBAL_EXCLUDED_FIELDS, ...excludeFields]);
  const dropped = [];
  const clean = sanitizeValue(data, excluded, new WeakSet(), dropped, 0);
  return { data: (clean && typeof clean === 'object' ? clean : {}), dropped };
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

const buildEnvelope = ({ userKey, formKey, data, updatedAt, version }) => ({
  app: DRAFT_PREFIX,
  version,
  formKey,
  userKey,
  updatedAt,
  data,
});

const validEnvelope = (env) => (
  !!env
  && typeof env === 'object'
  && typeof env.version === 'number'
  && typeof env.userKey === 'string' && env.userKey
  && typeof env.formKey === 'string' && env.formKey
  && typeof env.updatedAt === 'number' && Number.isFinite(env.updatedAt)
  && !!env.data && typeof env.data === 'object' && !Array.isArray(env.data)
);

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Lê um rascunho e explica por que ele não voltou.
 * Rascunho inválido, expirado, de outra versão ou corrompido é REMOVIDO no
 * ato — nunca fica morando no storage falhando silenciosamente.
 */
export function readDraft({
  userKey,
  formKey,
  storage,
  now = Date.now(),
  version = DRAFT_VERSION,
  ttlMs = DRAFT_TTL_MS,
} = {}) {
  if (!userKey) return fail(DRAFT_REASONS.NO_USER);
  const store = getStorage(storage);
  if (!store) return fail(DRAFT_REASONS.STORAGE_UNAVAILABLE);

  const key = draftKey(userKey, formKey);
  let raw;
  try {
    raw = store.getItem(key);
  } catch {
    return fail(DRAFT_REASONS.READ_FAILED, { key });
  }
  if (raw === null || raw === undefined) return fail(DRAFT_REASONS.MISSING, { key });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeQuietly(store, key);
    return fail(DRAFT_REASONS.INVALID_JSON, { key });
  }

  if (!validEnvelope(parsed)) {
    removeQuietly(store, key);
    return fail(DRAFT_REASONS.MALFORMED, { key });
  }
  // A chave já é por usuário, então divergência aqui significa chave forjada
  // ou storage adulterado. Não é o rascunho de quem está Asking.
  if (parsed.userKey !== userKey) {
    removeQuietly(store, key);
    return fail(DRAFT_REASONS.USER_MISMATCH, { key });
  }
  // Versão incompatível: descartar é mais seguro que interpretar às cegas.
  if (parsed.version !== version) {
    removeQuietly(store, key);
    return fail(DRAFT_REASONS.INCOMPATIBLE_VERSION, { key });
  }
  // Relógio que andou para trás (fuso, NTP) não pode ressuscitar rascunho
  // antigo: trata a data futura como válida, mas nunca como expirada.
  if (now - parsed.updatedAt > ttlMs) {
    removeQuietly(store, key);
    return fail(DRAFT_REASONS.EXPIRED, { key });
  }
  return ok(DRAFT_REASONS.OK, { key, draft: parsed });
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/**
 * Grava o rascunho. Política é latest-write-wins: quem escreve por último
 * vence, sem bloqueio e sem collaboration. É o comportamento previsível que
 * duas abas precisam ter entre si.
 */
export function writeDraft({
  userKey,
  formKey,
  data,
  excludeFields = [],
  storage,
  now = Date.now(),
  version = DRAFT_VERSION,
} = {}) {
  if (!userKey) return fail(DRAFT_REASONS.NO_USER);
  const store = getStorage(storage);
  if (!store) return fail(DRAFT_REASONS.STORAGE_UNAVAILABLE);

  const { data: clean, dropped } = sanitizeDraftData(data, excludeFields);
  const key = draftKey(userKey, formKey);
  const envelope = buildEnvelope({ userKey, formKey, data: clean, updatedAt: now, version });

  try {
    store.setItem(key, JSON.stringify(envelope));
  } catch (err) {
    // Cota estourada é o caso comum aqui. Degradamos: o app segue funcionando.
    return fail(DRAFT_REASONS.QUOTA, { key, error: err });
  }
  return ok(DRAFT_REASONS.OK, { key, updatedAt: now, dropped, draft: envelope });
}

export function clearDraft({ userKey, formKey, storage } = {}) {
  if (!userKey) return fail(DRAFT_REASONS.NO_USER);
  const store = getStorage(storage);
  if (!store) return fail(DRAFT_REASONS.STORAGE_UNAVAILABLE);
  removeQuietly(store, draftKey(userKey, formKey));
  return ok(DRAFT_REASONS.OK, { key: draftKey(userKey, formKey) });
}

function removeQuietly(store, key) {
  try {
    store.removeItem(key);
  } catch {
    /* storage quebrado é degradação, não exceção */
  }
}

// ---------------------------------------------------------------------------
// Conteúdo "relevante"?
// ---------------------------------------------------------------------------

// Um form recém-aberto tem `amount: 0`, `current_stock: 0`, `status: 'ativo'`.
// Um campo string não-vazio conta como preenchimento, o que é conservador
// demais para `status: 'ativo'`: por isso a decisão de "isto é preenchível?" no
// Cancelar é tomada com `hasDraftChanged`, que compara com o baseline exato
// daquele formulário. Esta função cobre o caso simples (formulário vazio).
export function hasDraftContent(data) {
  if (!data || typeof data !== 'object') return false;
  return Object.values(data).some((value) => {
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'boolean') return value === true;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return false;
  });
}

export const hasDraftChanged = (current, baseline) => JSON.stringify(current) !== JSON.stringify(baseline);

/**
 * O Cancelar só precisa perguntar quando o usuário digitou ALGUMA coisa em
 * relação ao formulário recém-aberto. Comparar com o baseline é o que separa
 * "abriu e cancelou" de "digitou e desistiu" mesmo com defaults não vazios
 * (`status: 'ativo'`, `unit: 'un'`, `salary: null`...).
 */
export const hasMeaningfulDraftChange = (current, baseline) => hasDraftChanged(current, baseline);

// ---------------------------------------------------------------------------
// Conflito com o backend
// ---------------------------------------------------------------------------

// Em EDIÇÃO o rascunho pode ser mais velho que o registro. Sobrescrever dado
// novo com rascunho velho é perda silenciosa de trabalho do outro usuário, então
// o draft é considerado possivelmente desatualizado e NÃO é aplicado sozinho.
export function isDraftStaleAgainst(draft, recordUpdatedAt) {
  if (!draft || typeof draft.updatedAt !== 'number') return false;
  const backend = typeof recordUpdatedAt === 'number' ? recordUpdatedAt : Date.parse(recordUpdatedAt || '');
  if (!Number.isFinite(backend)) return false;
  return draft.updatedAt < backend;
}

// ---------------------------------------------------------------------------
// Listagem e limpeza de expirados
// ---------------------------------------------------------------------------

/** Rascunhos válidos, opcionalmente só os de um usuário. Não remove nada. */
export function listDrafts({ userKey, storage, now = Date.now(), version = DRAFT_VERSION, ttlMs = DRAFT_TTL_MS } = {}) {
  const store = getStorage(storage);
  if (!store) return [];
  const prefix = userKey ? userPrefix(userKey) : `${DRAFT_PREFIX}:`;
  const out = [];
  for (const key of storageKeys(store)) {
    if (!isDraftKey(key) || !key.startsWith(prefix)) continue;
    const read = readDraft({ userKey: parseUserKeyFrom(key), formKey: parseFormKeyFrom(key), storage: store, now, version, ttlMs });
    if (read.ok) out.push(read.draft);
  }
  return out;
}

function parseUserKeyFrom(key) {
  const rest = key.slice(`${DRAFT_PREFIX}:`.length);
  const at = rest.indexOf(':');
  return at === -1 ? '' : rest.slice(0, at);
}

function parseFormKeyFrom(key) {
  const rest = key.slice(`${DRAFT_PREFIX}:`.length);
  const at = rest.indexOf(':');
  return at === -1 ? '' : rest.slice(at + 1);
}

/**
 * Remove rascunhos expirados, corrompidos ou de versão incompatível.
 * Varre SOMENTE o prefixo deste projeto (`gr:draft:`) e, se `userKey` for
 * informado, somente o prefixo daquele usuário. Nenhum outro site/aplicativo
 * no mesmo navegador é tocado.
 */
export function cleanupExpiredDrafts({ userKey, storage, now = Date.now(), version = DRAFT_VERSION, ttlMs = DRAFT_TTL_MS } = {}) {
  const store = getStorage(storage);
  if (!store) return { scanned: 0, removed: 0, removedKeys: [] };
  const prefix = userKey ? userPrefix(userKey) : `${DRAFT_PREFIX}:`;
  const removedKeys = [];
  let scanned = 0;
  for (const key of storageKeys(store)) {
    if (!isDraftKey(key) || !key.startsWith(prefix)) continue;
    scanned += 1;
    let parsed = null;
    try {
      parsed = JSON.parse(store.getItem(key));
    } catch {
      parsed = null;
    }
    const broken = !validEnvelope(parsed)
      || parsed.version !== version
      || now - parsed.updatedAt > ttlMs;
    if (broken) {
      removeQuietly(store, key);
      removedKeys.push(key);
    }
  }
  return { scanned, removed: removedKeys.length, removedKeys };
}

// ---------------------------------------------------------------------------
// Sessão de rascunho — o ciclo de vida, sem React
// ---------------------------------------------------------------------------

/**
 * Controla o rascunho de UM formulário. É isto que o hook React embrulha e
 * que os testes exercitam de verdade.
 *
 * O ciclo é: `restore` → `change`/`flush` (debounce) → `saved` | `failed` |
 * `discard`. Nada aqui fala com o banco: `saved()` só é chamado pelo
 * formulário DEPOIS de o backend confirmar.
 */
export function createDraftSession({
  userKey,
  formKey,
  storage,
  excludeFields = [],
  now = () => Date.now(),
  debounceMs = undefined,
  ttlMs = DRAFT_TTL_MS,
  version = DRAFT_VERSION,
} = {}) {
  const delay = typeof debounceMs === 'number' ? debounceMs : DRAFT_DEBOUNCE_MS;
  const store = getStorage(storage);
  const enabled = Boolean(userKey) && formKey && Boolean(store);

  let pending = null;   // { data, at }
  let lastRead = null;   // envelope da última restauração
  let lastWrite = null;  // { updatedAt, reason }
  let discarded = false;

  const session = {
    key: userKey && formKey ? draftKey(userKey, formKey) : null,
    enabled,
    get lastWrite() { return lastWrite; },
    get lastRead() { return lastRead; },
    get pending() { return pending !== null; },

    /**
     * Restaura sobre um baseline. Devolve o MESMO objeto `base` quando não há
     * rascunho — o formulário pode usar o retorno direto, sem bifurcação.
     * Um rascunho possivelmente desatualizado (`recordUpdatedAt` mais novo)
     * NÃO é aplicado; apenas sinalizado.
     */
    restore({ base, recordUpdatedAt } = {}) {
      if (!enabled) return { data: base, restored: false, reason: DRAFT_REASONS.STORAGE_UNAVAILABLE, stale: false, key: null };
      const read = readDraft({ userKey, formKey, storage: store, now: now(), version, ttlMs });
      if (!read.ok) {
        lastRead = null;
        discarded = false;
        return { data: base, restored: false, reason: read.reason, stale: false, key: read.key ?? null, label: DRAFT_REASON_LABELS[read.reason] };
      }
      const stale = isDraftStaleAgainst(read.draft, recordUpdatedAt);
      lastRead = read.draft;
      discarded = false;
      if (stale) {
        // O backend tem dado mais novo. Restaurar aqui sobrescreveria o
        // trabalho de outra pessoa sem avisar.
        return { data: base, restored: false, reason: DRAFT_REASONS.OK, stale: true, key: read.key, draft: read.draft };
      }
      // Mesma chave pode ter mudado de forma; o rascunho só preenche o que
      // ainda existe no formulário, e nunca inventa campo.
      const merged = { ...base };
      for (const [field, value] of Object.entries(read.draft.data)) {
        if (Object.prototype.hasOwnProperty.call(base, field)) merged[field] = value;
      }
      return { data: merged, restored: true, reason: DRAFT_REASONS.OK, stale: false, key: read.key, draft: read.draft };
    },

    /** Marca o estado atual como pendiente de gravação. */
    change(data, at) {
      if (!enabled) return;
      pending = { data, at: typeof at === 'number' ? at : now() };
    },

    /**
     * Grava se houver pendência E o debounce tiver vencido.
     * `force` grava na hora (usado no `pagehide`/desmontagem, para não
     * perder a última tecla antes de o componente sair de cena).
     */
    flush(at, { force = false } = {}) {
      if (!enabled || !pending) return false;
      const stamp = typeof at === 'number' ? at : now();
      if (!force && stamp - pending.at < delay) return false;
      const payload = pending;
      pending = null;
      const write = writeDraft({ userKey, formKey, data: payload.data, excludeFields, storage: store, now: stamp, version });
      lastWrite = { updatedAt: stamp, reason: write.reason, ok: write.ok, dropped: write.dropped ?? [] };
      return write.ok;
    },

    /** Backend CONFIRMOU. Só agora o rascunho sai. */
    saved() {
      pending = null;
      if (!enabled) return false;
      const result = clearDraft({ userKey, formKey, storage: store });
      lastWrite = null;
      discarded = false;
      return result.ok;
    },

    /** Backend FALHOU: o rascunho é a única cópia do que o usuário digitou. */
    failed() {
      // Pendência de propósito: o próximo flush ainda grava o que está na tela.
      return true;
    },

    /** Usuário escolheu descartar. Some da fila e do storage. */
    discard() {
      pending = null;
      lastRead = null;
      discarded = true;
      if (!enabled) return false;
      return clearDraft({ userKey, formKey, storage: store }).ok;
    },

    /** Cancelou mas quer continuar depois. Nada some. */
    keep() {
      discarded = false;
      return this.flush(now(), { force: true });
    },

    hasContent: (data) => hasDraftContent(data),
  };

  return session;
}

// ---------------------------------------------------------------------------
// Múltiplas abas
// ---------------------------------------------------------------------------

/**
 * Observa alterações de rascunho feitas por OUTRAS abas do mesmo navegador.
 * Devolve a função de cancelamento. Abas de outros sites não geram evento
 * porque o listener só reage a chaves com o prefixo daqui.
 */
export function subscribeExternalDrafts(handler, { storage, eventTarget } = {}) {
  const target = eventTarget || (typeof globalThis.addEventListener === 'function' ? globalThis : null);
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  const store = getStorage(storage);
  const listener = (event) => {
    const { key, newValue } = event || {};
    if (!isDraftKey(key)) return;
    if (store) {
      // A aba que gravou não recebe o próprio evento; as outras recebem com
      // newValue já populado. Comparar com o storage local evita eco.
      let current = null;
      try {
        current = store.getItem(key);
      } catch {
        return;
      }
      if (current === newValue) return;
    }
    handler({ key, newValue });
  };
  target.addEventListener('storage', listener);
  return () => target.removeEventListener('storage', listener);
}
