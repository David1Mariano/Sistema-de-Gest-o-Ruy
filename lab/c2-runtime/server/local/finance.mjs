import { FINANCIAL_ENTITIES } from '../../scripts/local-finance/repository.mjs';
import {isLocalAdmin} from '../../src/lib/localPermissions.mjs';
import { ANEXOS_ID_RE, ANEXOS_MAX_BYTES, canAccess, validateAnexosDeclaration, validateAnexosContent } from '../../scripts/production/anexos.mjs';

// Runs only after C1 authenticates the cookie and checks exact Origin and CSRF.
export async function handleFinance({req,res,url,body,session,repository,attachmentStore,reply}) {
  try {
    if (!isLocalAdmin(session.role)) return reply(403,{error:'finance_forbidden'});
    const root = '/api/local/financeiro';
    if(req.method==='POST'&&url.pathname===`${root}/commands`)return reply(200,{records:await repository.executeCommand(session,body.operationId,body.command,body.params)});
    const operation=url.pathname.match(/^\/api\/local\/financeiro\/result\/([a-f0-9-]{36})$/i);
    if(req.method==='GET'&&operation)return reply(200,await repository.operation(session,operation[1]));
    if (req.method === 'POST' && url.pathname === `${root}/operations`) {
      return reply(200,{records:await repository.execute(session,body.operationId,body.changes)});
    }
    if (req.method === 'POST' && url.pathname === `${root}/attachments`) {
      if (!attachmentStore) return reply(503,{error:'attachment_store_unavailable'});
      if (!FINANCIAL_ENTITIES.includes(body.entity) || !/^[A-Za-z0-9_-]{1,128}$/.test(body.recordId || '') || !/^[a-z][a-z0-9_]{0,63}$/.test(body.field || '')) return reply(422,{error:'invalid_binding'});
      if (typeof body.base64 !== 'string' || body.base64.length%4 || /[^A-Za-z0-9+/=]/.test(body.base64)) return reply(422,{error:'invalid_file'});
      const bytes=Buffer.from(body.base64,'base64');
      if (!bytes.length || bytes.length>ANEXOS_MAX_BYTES) return reply(413,{error:'attachment_size'});
      // Validate before opening a file: rejected content creates no temporary file.
      const declaration=validateAnexosDeclaration({fileName:body.fileName,mimeType:body.mimeType});
      validateAnexosContent({...declaration,bytes});
      const {uploadId}=await attachmentStore.beginUpload({fileName:body.fileName,mimeType:body.mimeType});
      await attachmentStore.writeUpload(uploadId,bytes);
      const meta=await attachmentStore.finalizeUpload({uploadId,entity:body.entity,recordId:body.recordId,field:body.field,actor:session});
      return reply(201,{reference:`ruy-anexo://${meta.id}`,id:meta.id});
    }
    const content=url.pathname.match(/^\/api\/local\/financeiro\/attachments\/(anx_[a-f0-9]{32})$/);
    if (req.method === 'GET' && content && attachmentStore && ANEXOS_ID_RE.test(content[1])) {
      const meta=await attachmentStore.getMeta(content[1]);
      if (!meta || !FINANCIAL_ENTITIES.includes(meta.entity) || !canAccess(meta,session)) return reply(404,{error:'attachment_unavailable'});
      const bytes=await attachmentStore.readContent(meta);
      res.writeHead(200,{'Content-Type':meta.mime_type,'Content-Disposition':'inline','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});
      return res.end(bytes);
    }
    const match=url.pathname.match(/^\/api\/local\/financeiro\/entities\/([A-Za-z]+)(?:\/([A-Za-z0-9_-]{1,128}))?$/);
    if (req.method === 'GET' && match) {
      const value=match[2] ? await repository.get(session,match[1],match[2]) : await repository.list(session,match[1],JSON.parse(url.searchParams.get('query')||'{}'),url.searchParams.get('sort')||'-created_date',Number(url.searchParams.get('limit')||1000));
      return reply(value===null ? 404 : 200,{records:value===null ? [] : Array.isArray(value) ? value : [value]});
    }
    return reply(404,{error:'route_not_found'});
  } catch(error) {
    const status=error.status || (/forbidden/.test(error.message) ? 403 : /conflict|record_exists/.test(error.message)||error.code==='23505' ? 409 : /invalid_|history_delete/.test(error.message)||error instanceof SyntaxError||error.code==='23503' ? 422 : 500);
    return reply(status,{error:status===500 ? 'finance_internal_error' : error.message});
  }
}
