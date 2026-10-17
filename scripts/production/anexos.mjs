// Armazenamento local de anexos do ADM-RUY (Agente 4).
//
// Os arquivos ficam FORA de qualquer diretório público: o servidor de produção
// só serve o conteúdo de `releases/<id>/site` e a rota `/api/anexos` é o ÚNICO
// caminho para ler ou gravar anexos. Cada anexo recebe um identificador interno
// opaco (`anx_` + uuid hex); o nome original do arquivo nunca participa do
// caminho no disco — fica apenas nos metadados, sanitizado.
//
// Garantias deste módulo:
// - tipo, extensão, tamanho e CONTEÚDO (magic bytes) validados;
// - gravação em duas fases: `.part` em `tmp/` + rename atômico só depois da
//   validação — upload interrompido nunca é declarado disponível;
// - metadados com dono, registro associado, hash SHA-256 e status;
// - ledger append-only de operações + fila de pendências;
// - verificação de integridade por hash a qualquer momento.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const ANEXOS_MAX_BYTES = 15 * 1024 * 1024; // mesmo limite dos comprovantes.
export const ANEXOS_ID_RE = /^anx_[0-9a-f]{32}$/;
export const ANEXOS_ENTITY_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
export const ANEXOS_RECORD_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const ANEXOS_FIELD_RE = /^[a-z][a-z0-9_]{0,63}$/;

const KIND_BY_MIME = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
export const ANEXOS_TYPES = Object.keys(KIND_BY_MIME);

const EXTENSION_BY_KIND = {
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
  pdf: ['pdf'],
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class AnexosError extends Error {
  constructor(message, { status = 400, code = 'erro_anexo' } = {}) {
    super(message);
    this.name = 'AnexosError';
    this.status = status;
    this.code = code;
  }
}

/** Detecta o tipo REAL do conteúdo pelos magic bytes (nunca confia no header). */
export function sniffKind(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.subarray(0, 8).equals(PNG_MAGIC)) return 'png';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (bytes.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  return null;
}

function cleanFileName(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop() || '';
  const safe = base.replace(/[\x00-\x1f<>:"|?*]/g, '').trim().slice(0, 120);
  return safe || 'anexo';
}

function extensionOf(fileName) {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  return match ? match[1].toLowerCase() : '';
}

function tailIncludes(bytes, marker, window = 4096) {
  const start = Math.max(0, bytes.length - window);
  return bytes.subarray(start).includes(marker);
}

/**
 * Valida declaração (tipo/extensão) ANTES de abrir espaço em disco.
 * O conteúdo em si é validado em `validateAnexosContent`, na finalização.
 */
export function validateAnexosDeclaration({ fileName, mimeType }) {
  const name = cleanFileName(fileName);
  const kind = KIND_BY_MIME[mimeType];
  if (!kind) {
    throw new AnexosError('Tipo de anexo não permitido. Use JPG, JPEG, PNG, WEBP ou PDF.', {
      status: 415, code: 'tipo_nao_permitido',
    });
  }
  const ext = extensionOf(name);
  if (!ext || !EXTENSION_BY_KIND[kind].includes(ext)) {
    throw new AnexosError('A extensão do arquivo não corresponde ao tipo permitido.', {
      status: 422, code: 'extensao_incompativel',
    });
  }
  return { fileName: name, mimeType, kind };
}

/** Valida conteúdo real: magic bytes + marcadores estruturais. */
export function validateAnexosContent({ fileName, mimeType, bytes }) {
  const declared = validateAnexosDeclaration({ fileName, mimeType });
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new AnexosError('O arquivo está vazio.', { status: 422, code: 'arquivo_vazio' });
  }
  if (bytes.length > ANEXOS_MAX_BYTES) {
    throw new AnexosError(`O anexo excede o limite de ${ANEXOS_MAX_BYTES} bytes.`, {
      status: 413, code: 'limite_excedido',
    });
  }
  const kind = sniffKind(bytes);
  if (!kind) {
    throw new AnexosError('O conteúdo do arquivo não é um JPG, PNG, WEBP ou PDF válido.', {
      status: 422, code: 'conteudo_invalido',
    });
  }
  if (kind !== declared.kind) {
    throw new AnexosError('O conteúdo do arquivo não corresponde ao tipo informado.', {
      status: 422, code: 'conteudo_nao_corresponde',
    });
  }
  const structural = {
    // Marcadores de fechamento: JPEG FF D9, PNG IEND, PDF %%EOF.
    jpeg: tailIncludes(bytes, Buffer.from([0xff, 0xd9])),
    png: tailIncludes(bytes, Buffer.from('IEND')),
    pdf: tailIncludes(bytes, Buffer.from('%%EOF')),
    webp: true,
  }[kind];
  if (!structural) {
    throw new AnexosError('O arquivo parece incompleto ou corrompido (finalização ausente).', {
      status: 422, code: 'conteudo_incompleto',
    });
  }
  return { ...declared, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function validateBinding({ entity, recordId, field }) {
  if (!ANEXOS_ENTITY_RE.test(String(entity || ''))) {
    throw new AnexosError('Entidade do registro associado inválida.', { code: 'registro_invalido' });
  }
  if (!ANEXOS_RECORD_RE.test(String(recordId || ''))) {
    throw new AnexosError('Identificador do registro associado inválido.', { code: 'registro_invalido' });
  }
  const resolvedField = field || 'anexo';
  if (!ANEXOS_FIELD_RE.test(resolvedField)) {
    throw new AnexosError('Campo do registro associado inválido.', { code: 'registro_invalido' });
  }
  return { entity: String(entity), recordId: String(recordId), field: resolvedField };
}


export function anexosPaths(home) {
  const root = path.join(home, 'anexos');
  return {
    root,
    files: path.join(root, 'files'),
    meta: path.join(root, 'meta'),
    tmp: path.join(root, 'tmp'),
    ledger: path.join(root, 'operacoes.jsonl'),
    pendencias: path.join(root, 'pendencias.json'),
  };
}

function shardOf(id) {
  return id.slice(5, 7);
}

async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}

/** Política de acesso: dono do anexo ou administrador. */
export function canAccess(meta, actor) {
  if (!meta || !actor) return false;
  if (actor.role === 'admin') return true;
  return Boolean(meta.owner?.id) && meta.owner.id === actor.id;
}

export function createAnexosStore({ home, now = () => new Date().toISOString() } = {}) {
  const paths = anexosPaths(home);
  const uploads = new Map(); // uploadId -> { handle, bytes, declaration }

  const ready = (async () => {
    await fs.mkdir(paths.files, { recursive: true });
    await fs.mkdir(paths.meta, { recursive: true });
    await fs.mkdir(paths.tmp, { recursive: true });
  })();

  async function ledger(entry) {
    await ready;
    const line = JSON.stringify({ at: now(), ...entry });
    await fs.appendFile(paths.ledger, `${line}\n`, 'utf8');
  }

  async function readPendencias() {
    try {
      const parsed = JSON.parse(await fs.readFile(paths.pendencias, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function writePendencias(list) {
    await ready;
    await atomicJson(paths.pendencias, list);
  }

  const api = {
    paths,

    /** Cria o `.part` e valida a declaração antes de receber bytes. */
    async beginUpload({ fileName, mimeType }) {
      await ready;
      const declaration = validateAnexosDeclaration({ fileName, mimeType });
      const uploadId = randomUUID();
      const handle = await fs.open(path.join(paths.tmp, `${uploadId}.part`), 'wx');
      uploads.set(uploadId, { handle, bytes: 0, declaration });
      return { uploadId, declaration };
    },

    /** Acrescenta bytes ao `.part`, respeitando o limite global. */
    async writeUpload(uploadId, chunk) {
      const entry = uploads.get(uploadId);
      if (!entry) {
        throw new AnexosError('Upload desconhecido ou já finalizado.', { status: 409, code: 'upload_desconhecido' });
      }
      entry.bytes += chunk.length;
      if (entry.bytes > ANEXOS_MAX_BYTES) {
        await api.abortUpload(uploadId, 'limite_excedido');
        throw new AnexosError(`O anexo excede o limite de ${ANEXOS_MAX_BYTES} bytes.`, {
          status: 413, code: 'limite_excedido',
        });
      }
      await entry.handle.write(chunk);
      return entry.bytes;
    },

    /** Cancela um upload: fecha, apaga o `.part` e registra no ledger. */
    async abortUpload(uploadId, reason = 'upload_abortado') {
      const entry = uploads.get(uploadId);
      uploads.delete(uploadId);
      const part = path.join(paths.tmp, `${uploadId}.part`);
      if (entry) {
        try { await entry.handle.close(); } catch { /* já fechado */ }
      }
      await fs.unlink(part).catch(() => {});
      await ledger({ op: 'upload_abortado', upload_id: uploadId, motivo: reason });
      return { uploadId, reason };
    },

    /**
     * Finaliza: valida CONTEÚDO, calcula hash, move para `files/<shard>/<id>`
     * por rename atômico e grava metadados. Só aqui o anexo vira `available`.
     */
    async finalizeUpload({ uploadId, entity, recordId, field, actor }) {
      const entry = uploads.get(uploadId);
      if (!entry) {
        throw new AnexosError('Upload desconhecido ou já finalizado.', { status: 409, code: 'upload_desconhecido' });
      }
      const part = path.join(paths.tmp, `${uploadId}.part`);
      let bytes;
      try {
        await entry.handle.close();
        bytes = await fs.readFile(part);
      } catch {
        uploads.delete(uploadId);
        await fs.unlink(part).catch(() => {});
        await ledger({ op: 'upload_interrompido', upload_id: uploadId, motivo: 'falha_na_leitura' });
        throw new AnexosError('Upload interrompido antes da finalização.', {
          status: 409, code: 'upload_interrompido',
        });
      }
      uploads.delete(uploadId);
      const binding = validateBinding({ entity, recordId, field });
      let validated;
      try {
        validated = validateAnexosContent({ ...entry.declaration, bytes });
      } catch (error) {
        await fs.unlink(part).catch(() => {});
        await ledger({ op: 'upload_rejeitado', upload_id: uploadId, code: error.code || 'conteudo_invalido' });
        throw error;
      }
      const id = `anx_${randomUUID().replace(/-/g, '')}`;
      const dir = path.join(paths.files, shardOf(id));
      await fs.mkdir(dir, { recursive: true });
      await fs.rename(part, path.join(dir, id));
      const meta = {
        id,
        sha256: validated.sha256,
        bytes: bytes.length,
        mime_type: entry.declaration.mimeType,
        kind: validated.kind,
        file_name: entry.declaration.fileName,
        entity: binding.entity,
        record_id: binding.recordId,
        field: binding.field,
        owner: { id: actor?.id || null, name: actor?.name || null, role: actor?.role || null },
        status: 'available',
        available: true,
        created_at: now(),
      };
      await atomicJson(path.join(paths.meta, `${id}.json`), meta);
      await ledger({
        op: 'upload', id, sha256: meta.sha256, bytes: meta.bytes,
        entity: meta.entity, record_id: meta.record_id, field: meta.field,
        owner: meta.owner.id,
      });
      return meta;
    },

    /**
     * Varre `tmp/`: qualquer `.part` restante é um upload morto (queda do
     * servidor/conexão). Apaga e registra na fila de pendências para
     * acompanhamento — nunca vira anexo disponível.
     */
    async sweepInterrupted({ motivo = 'reinicio_do_servidor' } = {}) {
      await ready;
      const created = [];
      let names = [];
      try { names = await fs.readdir(paths.tmp); } catch { names = []; }
      for (const name of names) {
        if (!name.endsWith('.part')) continue;
        const full = path.join(paths.tmp, name);
        const stat = await fs.stat(full).catch(() => null);
        if (!stat) continue;
        await fs.unlink(full).catch(() => {});
        const pending = {
          id: `pend_${randomUUID().replace(/-/g, '')}`,
          tipo: 'upload_interrompido',
          upload_id: name.replace(/\.part$/, ''),
          bytes: stat.size,
          motivo,
          status: 'pendente',
          created_at: now(),
        };
        const list = await readPendencias();
        list.push(pending);
        await writePendencias(list);
        await ledger({ op: 'upload_interrompido', upload_id: pending.upload_id, bytes: pending.bytes, motivo });
        created.push(pending);
      }
      return created;
    },

    async listPendencias({ status } = {}) {
      const list = await readPendencias();
      return status ? list.filter((item) => item.status === status) : list;
    },

    /** Registra uma operação pendente (ex.: espelho remoto aguardando cópia). */
    async addPendencia({ tipo, detalhes = {}, status = 'pendente' }) {
      const entry = {
        id: `pend_${randomUUID().replace(/-/g, '')}`,
        tipo,
        status,
        detalhes,
        created_at: now(),
      };
      const list = await readPendencias();
      list.push(entry);
      await writePendencias(list);
      await ledger({ op: 'pendencia_registrada', pendencia: entry.id, tipo });
      return entry;
    },

    async resolvePendencia(id, { resolucao = 'resolvida' } = {}) {
      const list = await readPendencias();
      const entry = list.find((item) => item.id === id);
      if (!entry) return null;
      entry.status = resolucao;
      entry.resolved_at = now();
      await writePendencias(list);
      await ledger({ op: 'pendencia_resolvida', pendencia: id, resolucao });
      return entry;
    },

    async getMeta(id) {
      if (!ANEXOS_ID_RE.test(String(id))) {
        throw new AnexosError('Identificador de anexo inválido.', { status: 400, code: 'id_invalido' });
      }
      try {
        return JSON.parse(await fs.readFile(path.join(paths.meta, `${id}.json`), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },

    contentPath(meta) {
      return path.join(paths.files, shardOf(meta.id), meta.id);
    },

    /** Lê os bytes e confere o hash declarado (integridade em cada leitura). */
    async readContent(meta, { verify = true } = {}) {
      const bytes = await fs.readFile(this.contentPath(meta));
      if (verify) {
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (sha256 !== meta.sha256) {
          await ledger({ op: 'falha_integridade', id: meta.id, esperado: meta.sha256, obtido: sha256 });
          throw new AnexosError('O arquivo de anexo não confere com o hash registrado (possível corrupção ou adulteração).', {
            status: 500, code: 'integridade_falhou',
          });
        }
      }
      return bytes;
    },

    async deleteAttachment({ id, actor }) {
      const meta = await this.getMeta(id);
      if (!meta) throw new AnexosError('Anexo não encontrado.', { status: 404, code: 'nao_encontrado' });
      if (!canAccess(meta, actor)) {
        throw new AnexosError('Sem permissão para excluir este anexo.', { status: 403, code: 'sem_permissao' });
      }
      await fs.unlink(this.contentPath(meta)).catch(() => {});
      await fs.unlink(path.join(paths.meta, `${id}.json`)).catch(() => {});
      await ledger({ op: 'exclusao', id, owner: meta.owner?.id || null, actor: actor?.id || null });
      return { id, deleted: true };
    },

    /** Relatório de integridade: hash de todo anexo + órfãos. */
    async verifyIntegrity() {
      await ready;
      const report = { attachments: 0, mismatches: [], missing: [], orphans: [] };
      const known = new Set();
      for (const name of await fs.readdir(paths.meta)) {
        if (!name.endsWith('.json')) continue;
        const meta = JSON.parse(await fs.readFile(path.join(paths.meta, name), 'utf8'));
        report.attachments += 1;
        known.add(meta.id);
        try {
          const bytes = await fs.readFile(this.contentPath(meta));
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          if (sha256 !== meta.sha256) report.mismatches.push(meta.id);
        } catch (error) {
          if (error.code === 'ENOENT') report.missing.push(meta.id);
          else throw error;
        }
      }
      for (const shard of await fs.readdir(paths.files, { withFileTypes: true })) {
        if (!shard.isDirectory()) continue;
        for (const name of await fs.readdir(path.join(paths.files, shard.name))) {
          if (!known.has(name)) report.orphans.push(name);
        }
      }
      return report;
    },
  };

  return api;
}



