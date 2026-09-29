import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { SocialError } from './providers.mjs';

export function verifyChallenge(query, expectedToken) {
  if (!expectedToken || query['hub.mode'] !== 'subscribe' || query['hub.verify_token'] !== expectedToken || !/^\d{1,100}$/.test(query['hub.challenge'] || '')) {
    throw new SocialError('INVALID_CHALLENGE', 'Challenge inválido');
  }
  return query['hub.challenge'];
}
// Must receive the untouched request bytes, BEFORE JSON parsing. Meta signs the
// body; it does not offer a universal signed delivery timestamp header.
export function verifyMetaPayload(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length > 1048576 || !appSecret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) {
    throw new SocialError('INVALID_SIGNATURE', 'Assinatura inválida');
  }
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) throw new SocialError('INVALID_SIGNATURE', 'Assinatura inválida');
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { throw new SocialError('INVALID_PAYLOAD', 'Payload inválido'); }
  if (!['instagram', 'page'].includes(payload.object) || !Array.isArray(payload.entry) || !payload.entry.length) throw new SocialError('INVALID_PAYLOAD', 'Payload inválido');
  for (const entry of payload.entry) {
    if (typeof entry.id !== 'string' || !entry.id || !Array.isArray(entry.changes) || !entry.changes.length) throw new SocialError('INVALID_PAYLOAD', 'Payload inválido');
    if (entry.time != null && (!Number.isFinite(entry.time) || entry.time < 0)) throw new SocialError('INVALID_PAYLOAD', 'Timestamp inválido');
  }
  return { payload, deliveryKey: createHash('sha256').update(rawBody).digest('hex') };
}
// Future ingress must atomically claim deliveryKey + upsert comments + append
// events, then ACK. An in-memory replay cache is NOT sufficient. Account IDs must
// match connected accounts. This module exposes no HTTP listener or persistence.
