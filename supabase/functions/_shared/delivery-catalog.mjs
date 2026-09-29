// Future restricted records; no migration or persistence is connected yet.
export function catalogMapping({ provider, merchantId, internalProductId, externalProductId, revision }) {
  if (!['ifood', '99food', 'whatsapp', 'own'].includes(provider)) throw Error('UNKNOWN_PROVIDER');
  for (const value of [merchantId, internalProductId, externalProductId]) if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error('INVALID_PRODUCT_MAPPING');
  if (!Number.isInteger(revision) || revision < 1) throw Error('INVALID_CATALOG_REVISION');
  return { provider, merchantId, internalProductId, externalProductId, revision,
    key: JSON.stringify([provider, merchantId, externalProductId]) };
}
export function deliveryCustomer({ id, merchantId, provider, externalCustomerId }) {
  // Never merge identities by phone/name, or reuse RH/Employee records.
  if (!['ifood', '99food', 'whatsapp', 'own'].includes(provider)) throw Error('UNKNOWN_PROVIDER');
  for (const value of [id, merchantId, externalCustomerId]) if (typeof value !== 'string' || !value.trim() || value.length > 200) throw Error('INVALID_CUSTOMER_IDENTITY');
  return { id, merchantId, identities: [{ provider, externalCustomerId }],
    profile: null, history: { orders: null, lastOrderAt: null, averageTicket: null, channels: [provider] } };
}
