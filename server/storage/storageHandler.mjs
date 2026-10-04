// ===========================================================================
// HANDLER DE ANEXOS — Fetch handler CHAMÁVEL, não montado.
//
// Mesmo desenho de `server/social/aiHandler.mjs`: recebe um `Request`,
// devolve um `Response`, e quem hospeda é decisão de infra. Isso mantém o
// handler testável sem abrir porta.
//
// A hospedagem real é `storageApi.mjs` (mesmo processo/porta padrão do
// backend social é intencionalmente OUTRO processo: o servidor de
// produção de estáticos não pode virar gateway de arquivo — ver o
// comentário do `aiHost.mjs`).
//
// AUTORIZAÇÃO: `verifyIdentity` é OBRIGATÓRIO e valida o bearer do usuário
// no Supabase Auth (o mesmo verificador real do backend social). Sem token,
// token inválido ou vínculo inativo a resposta é 401/403 — falha fechada.
//
// NUNCA ACEITOS DO CORPO: `storage_provider`, `bucket`, `key` e qualquer
// caminho. O corpo só traz metadados do arquivo e o `path` no caso de
// leitura; o prefixo vem da própria rota, e o caminho é revalidado contra
// o contrato `attachmentPath.js`.
// ===========================================================================
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_PREFIXES,
  ATTACHMENT_SIGNED_TTL_SECONDS,
  STORAGE_BUCKET_R2,
  STORAGE_PROVIDER,
} from '../../src/lib/storage/attachmentPath.js';
import { STORAGE_ERRORS } from './storageService.mjs';

const NO_STORE = { 'cache-control': 'no-store' };
const reply = (status, body, headers = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

// Mapa de erro do serviço para HTTP honesto. A mensagem interna do R2
// (endpoint, account id, trecho do XML de erro) NUNCA chega ao navegador.
const STATUS = {
  [STORAGE_ERRORS.NOT_CONFIGURED]: [503, 'not_configured'],
  [STORAGE_ERRORS.INVALID_PATH]: [400, 'invalid_path'],
  [STORAGE_ERRORS.INVALID_FILE]: [415, 'invalid_file'],
  [STORAGE_ERRORS.DELETE_DISABLED]: [403, 'delete_disabled'],
  [STORAGE_ERRORS.NOT_FOUND]: [404, 'not_found'],
  R2_FORBIDDEN: [502, 'storage_denied'],
  R2_NOT_FOUND: [404, 'not_found'],
  R2_ERROR: [502, 'storage_error'],
};

const MENSAGEM = {
  not_configured: 'O armazenamento de arquivos não está configurado.',
  invalid_path: 'Caminho de anexo inválido.',
  invalid_file: 'Arquivo não permitido.',
  delete_disabled: 'A exclusão de anexos está desabilitada.',
  not_found: 'Anexo não encontrado.',
  storage_denied: 'O armazenamento recusou o acesso ao anexo.',
  storage_error: 'Falha no armazenamento de arquivos.',
  unauthorized: 'Sessão não autenticada.',
  forbidden: 'Sem permissão para acessar anexos.',
  payload_too_large: 'Arquivo acima do limite de 15 MB.',
  invalid_request: 'Requisição inválida.',
};

const mensagem = (code) => MENSAGEM[code] || MENSAGEM.storage_error;

/**
 * @param {object} o
 * @param {object} o.service          `createStorageService(...)`
 * @param {Function} o.verifyIdentity obrigatório; devolve `null` sem identidade
 */
export function createStorageHandler({ service, verifyIdentity } = {}) {
  if (typeof verifyIdentity !== 'function') throw new Error('createStorageHandler requer verifyIdentity()');

  const falharCom = (error) => {
    const [status, code] = STATUS[error?.code] || [502, 'storage_error'];
    return reply(status, { error: code, message: mensagem(code) });
  };

  return async function handler(request) {
    const url = new URL(request.url);
    const rota = url.pathname;
    const metodo = request.method.toUpperCase();

    // 1. Identidade real. Sem isto o R2 seria um repositório anônimo com
    //    URL adivinhável, e o bucket é justamente onde está CPF/holerite.
    const identity = await verifyIdentity(request.headers.get('authorization'));
    if (!identity) return reply(401, { error: 'unauthorized', message: mensagem('unauthorized') });
    if (service?.allowDelete !== true && rota.endsWith('/delete')) {
      // Defense in depth: mesmo que alguém ligue a flag no serviço, o
      // handler só libera quando os DOIS lados concordarem.
      return reply(403, { error: 'delete_disabled', message: mensagem('delete_disabled') });
    }

    // 2. Saúde: nunca revela segredo. Só "tem cliente?" e "pode apagar?".
    if (rota === '/storage/health' && metodo === 'GET') {
      return reply(200, {
        provider: STORAGE_PROVIDER.R2,
        bucket: STORAGE_BUCKET_R2,
        configured: service?.configured === true,
        delete_enabled: service?.allowDelete === true,
        max_bytes: ATTACHMENT_MAX_BYTES,
      });
    }

    if (!service?.configured) return reply(503, { error: 'not_configured', message: mensagem('not_configured') });
// 3. Upload: corpo binário puro, metadados na query. O prefixo NUNCA
    //    vem do corpo — ele é escolhido pelo backend a partir da rota.
    if (rota === '/storage/upload' && metodo === 'POST') {
      const prefix = url.searchParams.get('prefix') || '';
      const recordId = url.searchParams.get('recordId') || '';
      const contentType = url.searchParams.get('contentType') || '';
      const fileName = (url.searchParams.get('fileName') || '').slice(0, 200);
      if (!ATTACHMENT_PREFIXES.includes(prefix)) return reply(400, { error: 'invalid_request', message: mensagem('invalid_request') });

      const declarado = Number(request.headers.get('content-length') || 0);
      if (declarado && declarado > ATTACHMENT_MAX_BYTES) return reply(413, { error: 'payload_too_large', message: mensagem('payload_too_large') });

      let body;
      try { body = Buffer.from(await request.arrayBuffer()); }
      catch { return reply(400, { error: 'invalid_request', message: mensagem('invalid_request') }); }
      if (body.length > ATTACHMENT_MAX_BYTES) return reply(413, { error: 'payload_too_large', message: mensagem('payload_too_large') });

      try {
        const reference = await service.upload({ prefix, recordId, body, contentType, fileName });
        // Devolve SOMENTE o que vai para o registro. Endpoint, bucket
        // interno e credencial não aparecem.
        return reply(200, reference);
      } catch (error) { return falharCom(error); }
    }

    // 4. URL assinada. `path` chega pela query e é revalidado no serviço.
    if (rota === '/storage/signed-url' && metodo === 'GET') {
      const path = url.searchParams.get('path') || '';
      const prefix = url.searchParams.get('prefix') || undefined;
      const pedido = Number(url.searchParams.get('expiresIn'));
      // O cliente NÃO escolhe o TTL: só pode pedir MENOS que o padrão.
      const expiresIn = Math.min(Number.isFinite(pedido) && pedido > 0 ? pedido : ATTACHMENT_SIGNED_TTL_SECONDS, ATTACHMENT_SIGNED_TTL_SECONDS);
      try {
        const { url: signed, expiresIn: ttl, path: validado } = await service.getSignedUrl({ path, prefix, expiresIn });
        return reply(200, { url: signed, expires_in: ttl, path: validado, provider: STORAGE_PROVIDER.R2 });
      } catch (error) { return falharCom(error); }
    }

    if (rota === '/storage/exists' && metodo === 'GET') {
      const path = url.searchParams.get('path') || '';
      const prefix = url.searchParams.get('prefix') || undefined;
      try {
        const head = await service.exists({ path, prefix });
        return reply(head.exists ? 200 : 404, { exists: head.exists === true, size: head.size || 0 });
      } catch (error) { return falharCom(error); }
    }
// 5. Proxy do arquivo: alternativa segura quando o navegador não consegue
    //    alcançar o endpoint do R2. Mesma autorização, sem URL assinada.
    if (rota === '/storage/object' && metodo === 'GET') {
      const path = url.searchParams.get('path') || '';
      const prefix = url.searchParams.get('prefix') || undefined;
      try {
        const file = await service.download({ path, prefix });
        return new Response(file.body, {
          status: 200,
          headers: {
            'content-type': file.contentType || 'application/octet-stream',
            'content-length': String(file.size),
            'content-disposition': `inline; filename="${identificador(file.path)}"`,
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer',
            ...NO_STORE,
          },
        });
      } catch (error) { return falharCom(error); }
    }

    // 6. Exclusão: existe, mas fica atrás da dupla checagem do passo 1.
    if (rota === '/storage/delete' && metodo === 'POST') {
      const path = url.searchParams.get('path') || '';
      const prefix = url.searchParams.get('prefix') || undefined;
      try {
        const result = await service.delete({ path, prefix });
        return reply(200, { deleted: result.deleted === true, path });
      } catch (error) { return falharCom(error); }
    }

    return reply(404, { error: 'not_found', message: mensagem('not_found') });
  };
}

// Nome de arquivo do proxy: só o último segmento, sem diretório e sem
// caractere de controle — o cabeçalho não pode virar injeção.
const identificador = (path) => String(path || '').split('/').pop().replace(/[^\w.\-]/g, '_').slice(0, 120) || 'anexo';
