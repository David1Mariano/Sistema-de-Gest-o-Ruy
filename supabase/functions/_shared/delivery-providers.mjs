import { ifoodProvider } from './ifood.mjs';
import { DeliveryError, eventEnvelope, normalizeIFood } from './delivery-domain.mjs';

// No URL/auth/payload is assumed for providers whose contracts are not confirmed.
export const PROVIDER_CAPABILITIES = Object.freeze({
  ifood: Object.freeze({ connection: 'distributed', events: 'polling', orders: 'read', commands: false }),
  '99food': Object.freeze({ connection: null, events: null, orders: null, commands: false }),
  whatsapp: Object.freeze({ connection: null, events: null, orders: null, commands: false }),
  own: Object.freeze({ connection: null, events: null, orders: null, commands: false }),
});
export function providerAdapter(provider, env, repo) {
  if (!Object.hasOwn(PROVIDER_CAPABILITIES, provider)) throw new DeliveryError('UNKNOWN_PROVIDER');
  if (provider !== 'ifood') return Object.freeze({
    capabilities: PROVIDER_CAPABILITIES[provider],
    normalizeEvent() { throw new DeliveryError('PROVIDER_CONFIGURATION_REQUIRED', 501); },
    connect() { throw new DeliveryError('PROVIDER_CONFIGURATION_REQUIRED', 501); },
  });
  return {
    capabilities: PROVIDER_CAPABILITIES.ifood, api: ifoodProvider(env, repo),
    normalizeEvent(payload) {
      const source = eventEnvelope(payload);
      return { provider: 'ifood', merchantId: source.merchantId, externalOrderId: source.orderId,
        eventId: source.id, occurredAt: source.createdAt, type: 'order.status_observed', source };
    },
    normalizeOrder: normalizeIFood,
  };
}
