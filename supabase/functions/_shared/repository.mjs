import { DeliveryError } from './delivery-domain.mjs';
const q = encodeURIComponent;
export function repository(env, fetcher = fetch, timeoutMs = 8000) {
  async function rest(route, { method = 'GET', body, prefer = 'return=representation' } = {}) {
    const res = await fetcher(`${env.SUPABASE_URL}/rest/v1/${route}`, { method,
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: prefer },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new DeliveryError(res.status === 409 ? 'PERSISTENCE_CONFLICT' : 'PERSISTENCE_UNAVAILABLE', res.status === 409 ? 409 : 503);
    return res.status === 204 ? null : res.json();
  }
  const filter = p => `platform=eq.${q(p)}`;
  const eventFilter = e => `${filter(e.platform)}&merchant_id=eq.${q(e.merchant_id)}&event_id=eq.${q(e.event_id)}`;
  return {
    rpc: (name, body) => rest(`rpc/${name}`, { method: 'POST', body }),
    integration: async p => (await rest(`delivery_integrations?${filter(p)}&select=*`))[0],
    status: () => rest('delivery_integrations?select=platform,status,last_sync_at,last_error,first_event_at,last_event_at'),
    patch: (p, body) => rest(`delivery_integrations?${filter(p)}`, { method: 'PATCH', body: { ...body, updated_at: new Date().toISOString() } }),
    merchants: p => rest(`delivery_merchants?${filter(p)}&enabled=eq.true&select=merchant_id,name`),
    allMerchants: () => rest('delivery_merchants?enabled=eq.true&select=platform,merchant_id,name'),
    disableMerchants: p => rest(`delivery_merchants?${filter(p)}`, { method: 'PATCH', body: { enabled: false } }),
    saveMerchants: (p, rows) => rest('delivery_merchants?on_conflict=platform,merchant_id', { method: 'POST', body: rows.map(m => ({ platform: p, merchant_id: m.id, name: m.name || null, enabled: true })), prefer: 'resolution=merge-duplicates,return=minimal' }),
    enqueue: events => rest('rpc/delivery_enqueue', { method: 'POST', body: { p_platform: 'ifood', p_events: events } }),
    pending: () => rest(`delivery_events?platform=eq.ifood&processed_at=is.null&next_attempt_at=lte.${q(new Date().toISOString())}&order=received_at.asc&limit=20`),
    remaining: () => rest('delivery_events?platform=eq.ifood&processed_at=is.null&select=event_id&limit=20'),
    apply: (event, order) => rest('rpc/delivery_apply_event', { method: 'POST', body: { p_platform: 'ifood', p_merchant: event.merchant_id, p_event: event.event_id, p_order: order } }),
    eventPatch: (e, body) => rest(`delivery_events?${eventFilter(e)}`, { method: 'PATCH', body }),
    orders: (from, to, offset) => rest(`delivery_orders?ordered_at=gte.${q(from)}&ordered_at=lt.${q(to)}&order=ordered_at.desc,platform.asc,merchant_id.asc,external_id.asc&limit=200&offset=${offset}&select=platform,merchant_id,external_id,data,cash_movement_id,reconciled_at`),
    cash: async id => (await rest(`records?entity=eq.CashMovement&id=eq.${q(id)}&select=data`))[0]?.data,
    order: async (p, m, id) => (await rest(`delivery_orders?${filter(p)}&merchant_id=eq.${q(m)}&external_id=eq.${q(id)}&select=*`))[0],
    link: (p, m, id, cashId, userId) => rest(`delivery_orders?${filter(p)}&merchant_id=eq.${q(m)}&external_id=eq.${q(id)}`, { method: 'PATCH', body: { cash_movement_id: cashId, reconciled_by: userId, reconciled_at: new Date().toISOString() } }),
  };
}
