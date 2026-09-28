import { DeliveryError } from './delivery-domain.mjs';
const q = encodeURIComponent;
export function repository(env, fetcher = fetch, timeoutMs = 8000) {
  async function rest(route, { method = 'GET', body, prefer = 'return=representation' } = {}) {
    const res = await fetcher(`${env.SUPABASE_URL}/rest/v1/${route}`, { method,
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: prefer },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      const allowed = { CONTACT_ACCESS_DENIED: 403, CONVERSATION_NOT_FOUND: 404, CONVERSATION_CHANGED: 409,
        INVALID_HANDOFF_MODE: 400, INVALID_HANDOFF_VERSION: 400, MESSAGE_NOT_FOUND: 404,
        MESSAGE_ID_CONFLICT: 409, CUSTOMER_SCOPE_MISMATCH: 409, UNKNOWN_PROVIDER: 400 };
      if (Object.hasOwn(allowed, error.message)) throw new DeliveryError(error.message, allowed[error.message]);
      throw new DeliveryError(res.status === 409 ? 'PERSISTENCE_CONFLICT' : 'PERSISTENCE_UNAVAILABLE', res.status === 409 ? 409 : 503);
    }
    return res.status === 204 ? null : res.json();
  }
  const filter = p => `platform=eq.${q(p)}`;
  const eventFilter = e => `${filter(e.platform)}&merchant_id=eq.${q(e.merchant_id)}&event_id=eq.${q(e.event_id)}`;
  return {
    contactScopes: actor => rest(`delivery_operator_scopes?user_id=eq.${q(actor)}&select=provider,merchant_id,can_manage&order=provider.asc,merchant_id.asc&limit=100`),
    contactScope: async (actor, p, m) => (await rest(`delivery_operator_scopes?user_id=eq.${q(actor)}&provider=eq.${q(p)}&merchant_id=eq.${q(m)}&select=can_manage`))[0],
    customers: (p, m, offset) => rest(`delivery_customers?provider=eq.${q(p)}&merchant_id=eq.${q(m)}&select=id,external_id,name,phone,created_at&order=created_at.desc,id.asc&limit=100&offset=${offset}`),
    conversations: (p, m, offset) => rest(`delivery_conversations?provider=eq.${q(p)}&merchant_id=eq.${q(m)}&select=id,external_id,customer_id,mode,version,assigned_to,updated_at&order=updated_at.desc,id.asc&limit=100&offset=${offset}`),
    conversation: async (p, m, id) => (await rest(`delivery_conversations?provider=eq.${q(p)}&merchant_id=eq.${q(m)}&id=eq.${q(id)}&select=id,customer_id,mode,version`))[0],
    messages: (id, offset) => rest(`delivery_messages?conversation_id=eq.${q(id)}&select=id,external_id,direction,author,status,body,occurred_at,received_at,invalidated,conversation_version&order=occurred_at.desc,id.desc&limit=100&offset=${offset}`),
    rpc: (name, body) => rest(`rpc/${name}`, { method: 'POST', body }),
    integration: async p => (await rest(`delivery_integrations?${filter(p)}&select=*`))[0],
    status: () => rest('delivery_integrations?select=platform,status,last_sync_at,last_error,first_event_at,last_event_at'),
    patch: (p, body) => rest(`delivery_integrations?${filter(p)}`, { method: 'PATCH', body: { ...body, updated_at: new Date().toISOString() } }),
    merchants: p => rest(`delivery_merchants?${filter(p)}&enabled=eq.true&select=merchant_id,name`),
    allMerchants: () => rest('delivery_merchants?enabled=eq.true&select=platform,merchant_id,name'),
    disableMerchants: p => rest(`delivery_merchants?${filter(p)}`, { method: 'PATCH', body: { enabled: false } }),
    saveMerchants: (p, rows) => rest('delivery_merchants?on_conflict=platform,merchant_id', { method: 'POST', body: rows.map(m => ({ platform: p, merchant_id: m.id, name: m.name || null, enabled: true })), prefer: 'resolution=merge-duplicates,return=minimal' }),
    enqueue: events => rest('rpc/delivery_enqueue', { method: 'POST', body: { p_platform: 'ifood', p_events: events } }),
    pending: () => rest(`delivery_events?platform=eq.ifood&processed_at=is.null&or=(last_error.is.null,last_error.neq.ORDER_RETRY_EXHAUSTED)&next_attempt_at=lte.${q(new Date().toISOString())}&order=received_at.asc&limit=20`),
    remaining: () => rest('delivery_events?platform=eq.ifood&processed_at=is.null&select=event_id&limit=20'),
    apply: (event, order) => rest('rpc/delivery_apply_event', { method: 'POST', body: { p_platform: 'ifood', p_merchant: event.merchant_id, p_event: event.event_id, p_order: order } }),
    eventPatch: (e, body) => rest(`delivery_events?${eventFilter(e)}`, { method: 'PATCH', body }),
    orders: (from, to, offset) => rest(`delivery_orders?ordered_at=gte.${q(from)}&ordered_at=lt.${q(to)}&order=ordered_at.desc,platform.asc,merchant_id.asc,external_id.asc&limit=200&offset=${offset}&select=platform,merchant_id,external_id,data,cash_movement_id,reconciled_at`),
    cash: async id => (await rest(`records?entity=eq.CashMovement&id=eq.${q(id)}&select=data`))[0]?.data,
    order: async (p, m, id) => (await rest(`delivery_orders?${filter(p)}&merchant_id=eq.${q(m)}&external_id=eq.${q(id)}&select=*`))[0],
    link: (p, m, id, cashId, userId) => rest(`delivery_orders?${filter(p)}&merchant_id=eq.${q(m)}&external_id=eq.${q(id)}`, { method: 'PATCH', body: { cash_movement_id: cashId, reconciled_by: userId, reconciled_at: new Date().toISOString() } }),
  };
}
