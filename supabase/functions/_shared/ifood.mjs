import { DeliveryError, eventEnvelope, normalizeIFood, ifoodStatus, mayApply } from './delivery-domain.mjs';
import { providerRequest, seal, unseal } from './provider-http.mjs';
export const IFOOD_BASE = 'https://merchant-api.ifood.com.br';
export function ifoodProvider(env, repo, http = providerRequest, now = () => Date.now()) {
  const config = () => {
    if (!env.IFOOD_CLIENT_ID || !env.IFOOD_CLIENT_SECRET || !env.DELIVERY_ENCRYPTION_KEY) throw new DeliveryError('IFOOD_NOT_CONFIGURED', 503);
  };
  const postToken = fields => http(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ clientId: env.IFOOD_CLIENT_ID, clientSecret: env.IFOOD_CLIENT_SECRET, ...fields }) });
  async function saveToken(result, previous = {}) {
    if (typeof result?.accessToken !== 'string' || !Number.isFinite(Number(result.expiresIn)) || Number(result.expiresIn) <= 0) throw new DeliveryError('INVALID_TOKEN_RESPONSE', 502);
    const token = { accessToken: result.accessToken, refreshToken: result.refreshToken || previous.refreshToken, expiresAt: now() + Number(result.expiresIn) * 1000 };
    if (!token.refreshToken) throw new DeliveryError('REFRESH_TOKEN_MISSING', 502);
    await repo.patch('ifood', { sealed_credentials: await seal(token, env.DELIVERY_ENCRYPTION_KEY) });
    return token;
  }
  async function token(force = false) {
    config();
    const record = await repo.integration('ifood');
    if (!record || record.status === 'disconnected') throw new DeliveryError('IFOOD_NOT_CONNECTED', 409);
    let stored = await unseal(record.sealed_credentials, env.DELIVERY_ENCRYPTION_KEY);
    if (force || !stored.expiresAt || stored.expiresAt <= now() + 60000) {
      if (!stored.refreshToken) throw new DeliveryError('RECONNECT_REQUIRED', 401);
      stored = await saveToken(await postToken({ grantType: 'refresh_token', refreshToken: stored.refreshToken }), stored);
    }
    return stored.accessToken;
  }
  async function authorized(path, init = {}) {
    const execute = async force => http(`${IFOOD_BASE}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await token(force)}` } }, path.startsWith('/order/v1.0/orders/') ? { attempts: 1 } : undefined);
    try { return await execute(false); }
    catch (error) { if (error.code !== 'PROVIDER_UNAUTHORIZED') throw error; return execute(true); }
  }
  async function discoverMerchants() {
    const merchants = [];
    for (let page = 1; page <= 20; page++) {
      const rows = await authorized(`/merchant/v1.0/merchants?page=${page}&size=100`);
      if (!Array.isArray(rows) || rows.some(m => typeof m.id !== 'string')) throw new DeliveryError('INVALID_MERCHANT_RESPONSE', 502);
      merchants.push(...rows);
      if (rows.length < 100) break;
      if (page === 20) throw new DeliveryError('MERCHANT_PAGINATION_LIMIT', 409);
    }
    if (!merchants.length) throw new DeliveryError('NO_AUTHORIZED_MERCHANTS', 403);
    await repo.disableMerchants('ifood');
    await repo.saveMerchants('ifood', merchants);
    return merchants;
  }
  return {
    async begin() {
      config();
      const response = await http(`${IFOOD_BASE}/authentication/v1.0/oauth/userCode`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ clientId: env.IFOOD_CLIENT_ID }) });
      if (!response?.authorizationCodeVerifier || !response.userCode || (!Number.isFinite(Number(response.expiresIn)) || Number(response.expiresIn) <= 0)) throw new DeliveryError('INVALID_AUTHORIZATION_RESPONSE', 502);
      const url = new URL(response.verificationUrlComplete || response.verificationUrl);
      if (url.origin !== 'https://portal.ifood.com.br') throw new DeliveryError('INVALID_AUTHORIZATION_URL', 502);
      const stored = await unseal((await repo.integration('ifood'))?.sealed_credentials, env.DELIVERY_ENCRYPTION_KEY);
      const pending = { verifier: response.authorizationCodeVerifier, expiresAt: now() + Number(response.expiresIn) * 1000 };
      await repo.patch('ifood', { status: 'connecting', sealed_credentials: await seal({ ...stored, pending }, env.DELIVERY_ENCRYPTION_KEY), last_error: null });
      return { userCode: response.userCode, verificationUrl: url.href, expiresAt: pending.expiresAt };
    },
    async complete(code) {
      config();
      const stored = await unseal((await repo.integration('ifood'))?.sealed_credentials, env.DELIVERY_ENCRYPTION_KEY);
      if (!stored.pending || stored.pending.expiresAt <= now()) throw new DeliveryError('AUTHORIZATION_EXPIRED', 409);
      await saveToken(await postToken({ grantType: 'authorization_code', authorizationCode: code, authorizationCodeVerifier: stored.pending.verifier }));
      const merchants = await discoverMerchants();
      await repo.patch('ifood', { status: 'connected', last_error: null });
      return { merchants: merchants.map(m => ({ merchant_id: m.id, name: m.name || null })) };
    },
    async sync({ poll = false } = {}) {
      config();
      const start = now();
      const integration = await repo.integration('ifood');
      if (!['connected', 'attention', 'error'].includes(integration?.status)) throw new DeliveryError('IFOOD_NOT_CONNECTED', 409);
      if (poll) {
        if (env.IFOOD_POLLING_ENABLED !== 'true') throw new DeliveryError('POLLING_NOT_ENABLED', 409);
        if (integration.last_poll_at && start - Date.parse(integration.last_poll_at) < 30000) throw new DeliveryError('POLLING_TOO_FREQUENT', 429);
        const merchants = await repo.merchants('ifood');
        if (!merchants.length || merchants.length > 100) throw new DeliveryError('MERCHANT_POLLING_LIMIT', 409);
        await repo.patch('ifood', { last_poll_at: new Date(start).toISOString() });
        const events = await authorized('/events/v1.0/events:polling', { headers: { 'x-polling-merchants': merchants.map(m => m.merchant_id).join(',') } });
        if (events !== null && !Array.isArray(events)) throw new DeliveryError('INVALID_EVENTS_RESPONSE', 502);
        if (events?.length) {
          const envelopes = events.map(eventEnvelope);
          await repo.enqueue(envelopes); // ACK somente após persistência durável.
          for (let i = 0; i < envelopes.length; i += 1000) await authorized('/events/v1.0/events/acknowledgment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelopes.slice(i, i + 1000).map(e => ({ id: e.id }))) });
        }
      }
      let processed = 0, failures = 0, unsupported = 0;
      for (const event of await repo.pending()) {
        if (now() - start > 35000) break;
        try {
          if (!['PLC', 'CFM', 'RTP', 'DSP', 'CON', 'CAN'].includes(event.envelope.code)) {
            unsupported++;
            await repo.eventPatch(event, { processed_at: new Date(now()).toISOString(), last_error: 'UNSUPPORTED_EVENT_TYPE' }); continue;
          }
          const previous = await repo.order('ifood', event.merchant_id, event.envelope.orderId);
          const next = previous ? { ...previous.data, status: ifoodStatus(event.envelope.code), cancelled: event.envelope.code === 'CAN', event_id: event.event_id, event_at: event.envelope.createdAt } : null;
          if (previous && (previous.status === next.status || !['PLC','CFM'].includes(event.envelope.code) || !mayApply(previous.data, next))) {
            await repo.apply(event, next);
          } else {
            const order = await authorized(`/order/v1.0/orders/${encodeURIComponent(event.envelope.orderId)}`);
            await repo.apply(event, normalizeIFood(order, event.envelope));
          }
          processed++;
        } catch (error) {
          failures++;
          const exhausted = event.attempts + 1 >= 3 || (error.status === 404 && now() - Date.parse(event.envelope.createdAt) >= 600000);
          await repo.eventPatch(event, { attempts: event.attempts + 1, last_error: exhausted ? 'ORDER_RETRY_EXHAUSTED' : error instanceof DeliveryError ? error.code : 'SYNC_FAILED',
            next_attempt_at: new Date(now() + Math.min(3600000, 30000 * 2 ** Math.min(event.attempts, 7))).toISOString() });
          if ([401, 403, 429].includes(error.status)) throw error;
        }
      }
      const pending = (await (repo.remaining ? repo.remaining() : repo.pending())).length;
      await repo.patch('ifood', { status: failures || pending || unsupported ? 'attention' : 'connected', last_error: failures ? 'PARTIAL_SYNC' : pending ? 'SYNC_PENDING' : unsupported ? 'UNSUPPORTED_EVENT_TYPE' : null,
        ...(!failures && !pending && !unsupported ? { last_sync_at: new Date(now()).toISOString() } : {}) });
      return { processed, failures, pending, unsupported, history: 'incremental_events_only' };
    },
    async disconnect() { await repo.disableMerchants('ifood'); await repo.patch('ifood', { sealed_credentials: null, status: 'disconnected', last_error: null }); return { revokedLocally: true, revokeAtProvider: 'https://portal.ifood.com.br' }; },
  };
}
