/** Mount at /api/financeiro. Authentication is injected by Agent 5. */
export function createFinanceApi({ repository, authenticate }) {
  return async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
      res.end(JSON.stringify(body));
    };
    try {
      // Same-origin only; no permissive CORS or credentials from request body.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(403,{error:'origin_forbidden'});
      const actor = await authenticate(req);
      if (!actor) return send(401,{error:'authentication_required'});
      const url = new URL(req.url,'http://local.invalid');
      if (req.method === 'POST' && url.pathname === '/api/financeiro/operations') {
        let bytes = 0; const chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024*1024) return send(413,{error:'body_too_large'}); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return send(200,await repository.execute(actor,body.operationId,body.changes));
      }
      const match = /^\/api\/financeiro\/entities\/([A-Za-z]+)(?:\/([A-Za-z0-9_-]+))?$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        const result = match[2] ? await repository.get(actor,match[1],match[2]) : await repository.list(actor,match[1],JSON.parse(url.searchParams.get('query') || '{}'),url.searchParams.get('sort') || '-created_date',Number(url.searchParams.get('limit') || 1000));
        return send(result === null ? 404 : 200,result);
      }
      send(404,{error:'route_not_found'});
    } catch (error) {
      const message = error.message;
      const status = /forbidden/.test(message) ? 403 : /conflict|record_exists/.test(message) || error.code === '23505' ? 409 : /invalid_|history_delete/.test(message) || error instanceof SyntaxError || error.code === '23503' ? 422 : 500;
      send(status,{error:status === 500 ? 'finance_internal_error' : message});
    }
  };
}
