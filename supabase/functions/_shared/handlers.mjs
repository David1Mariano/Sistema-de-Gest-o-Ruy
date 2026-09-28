import { DeliveryError, publicFailure, requiredString, FOOD99_BLOCKED } from './delivery-domain.mjs';
import { repository } from './repository.mjs';
import { providerAdapter } from './delivery-providers.mjs';

export async function readBody(request, max = 65536) {
  if (Number(request.headers.get('content-length')) > max) throw new DeliveryError('BODY_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DeliveryError('INVALID_BODY');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new DeliveryError('BODY_TOO_LARGE', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function parse(bytes) { try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new DeliveryError('INVALID_JSON'); } }
function equalSecret(a, b) {
  if (!a || !b || b.length < 32 || a.length !== b.length) return false;
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function authorize(request, env, write, fetcher = fetch) {
  const bearer = request.headers.get('authorization');
  if (!bearer?.startsWith('Bearer ') || bearer.length > 16000) throw new DeliveryError('ADMIN_VERIFICATION_REQUIRED', 401);
  const res = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: bearer }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new DeliveryError('ADMIN_SESSION_EXPIRED', 401);
  const user = await res.json();
  const admins = (env.DELIVERY_ADMIN_USER_IDS || '').split(',').map(x => x.trim());
  const viewers = (env.DELIVERY_VIEWER_USER_IDS || '').split(',').map(x => x.trim());
  if (!user?.id || (!admins.includes(user.id) && (write || !viewers.includes(user.id)))) throw new DeliveryError('DELIVERY_ACCESS_DENIED', 403);
  return user.id;
}
export function managementHandler(env, deps = {}) {
  const repo = deps.repo || repository(env);
  const provider = deps.provider || providerAdapter('ifood', env, repo).api;
  return async request => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    let owner, platform, action, locked = false;
    try {
      const origin = request.headers.get('origin');
      if (origin) {
        if (!(env.DELIVERY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).includes(origin)) throw new DeliveryError('ORIGIN_NOT_ALLOWED', 403);
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type';
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      }
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') throw new DeliveryError('METHOD_NOT_ALLOWED', 405);
      const body = parse(await readBody(request));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DeliveryError('INVALID_BODY');
      action = body.action;
      const read = ['status', 'orders'].includes(body.action);
      const worker = !origin && body.action === 'sync' && equalSecret(request.headers.get('x-delivery-worker-secret'), env.DELIVERY_WORKER_SECRET);
      const actor = worker ? null : await authorize(request, env, !read, deps.fetcher);
      if (body.action === 'status') return respond({ integrations: await repo.status(), merchants: await repo.allMerchants(),
        ifoodConfigured: Boolean(env.IFOOD_CLIENT_ID && env.IFOOD_CLIENT_SECRET && env.DELIVERY_ENCRYPTION_KEY),
        pollingEnabled: env.IFOOD_POLLING_ENABLED === 'true', food99Blocker: FOOD99_BLOCKED });
      if (body.action === 'orders') {
        const from = Date.parse(body.from), to = Date.parse(body.to);
        const offset = body.offset ?? 0;
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 32 * 86400000 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new DeliveryError('INVALID_PERIOD');
        const rows = await repo.orders(new Date(from).toISOString(), new Date(to).toISOString(), offset);
        return respond({ rows, nextOffset: rows.length === 200 ? offset + 200 : null });
      }
      platform = body.platform;
      if (platform === '99food') throw new DeliveryError('FOOD99_NOT_AVAILABLE', 501);
      if (platform !== 'ifood' || !['begin', 'complete', 'sync', 'disconnect', 'link'].includes(body.action)) throw new DeliveryError('INVALID_ACTION');
      owner = crypto.randomUUID();
      locked = await repo.rpc('delivery_lock', { p_platform: platform, p_owner: owner });
      if (!locked) throw new DeliveryError('INTEGRATION_BUSY', 409);
      if (body.action === 'begin') return respond(await provider.begin());
      if (body.action === 'complete') return respond(await provider.complete(requiredString(body.authorizationCode)));
      if (body.action === 'sync') {
        if (env.IFOOD_POLLING_ENABLED !== 'true') throw new DeliveryError('POLLING_NOT_ENABLED', 409);
        return respond(await provider.sync({ poll: true }));
      }
      if (body.action === 'disconnect') return respond(await provider.disconnect());
      const merchant = requiredString(body.merchantId), external = requiredString(body.externalId), cashId = requiredString(body.cashMovementId);
      const order = await repo.order(platform, merchant, external);
      const cash = await repo.cash(cashId);
      const date = order && new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(order.ordered_at));
      if (!order || !cash || cash.source !== 'delivery' || cash.channel !== platform || cash.date !== date) throw new DeliveryError('RECONCILIATION_MISMATCH', 409);
      await repo.link(platform, merchant, external, cashId, actor);
      return respond({ linked: true }); // Não cria CashMovement, Revenue ou FinancialExpense.
    } catch (error) {
      const failure = publicFailure(error);
      if (locked && platform === 'ifood' && action !== 'link') {
        try { await repo.patch(platform, { status: [401,403,429,409].includes(failure.status) ? 'attention' : 'error', last_error: failure.code }); } catch { /* Não mascara erro original. */ }
      }
      return respond({ error: failure.code }, failure.status);
    } finally {
      if (locked) { try { await repo.rpc('delivery_unlock', { p_platform: platform, p_owner: owner }); } catch { /* Lease expira automaticamente. */ } }
    }
  };
}

// Official webhook requires centralized authentication; this app uses distributed auth.
// Fail closed: no environment flag can enable an unsupported flow.
export function ifoodWebhookHandler() {
  return async () => new Response(JSON.stringify({ error: 'WEBHOOK_UNAVAILABLE_FOR_DISTRIBUTED' }), {
    status: 501, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
