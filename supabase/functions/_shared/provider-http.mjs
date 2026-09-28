import { DeliveryError } from './delivery-domain.mjs';

export async function providerRequest(url, init = {}, { fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), attempts = 3 } = {}) {
  const retryable = !init.method || init.method === 'GET';
  for (let n = 0; n < (retryable ? attempts : 1); n++) {
    let response;
    try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
    catch { if (retryable && n + 1 < attempts) { await sleep(250 * 2 ** n); continue; } throw new DeliveryError('PROVIDER_TIMEOUT', 504); }
    if (response.ok) {
      if (response.status === 204 || response.status === 202) return null;
      try { return await response.json(); } catch { throw new DeliveryError('INVALID_PROVIDER_RESPONSE', 502); }
    }
    // Nunca propaga corpo/URL/token do fornecedor ao cliente ou aos logs.
    if (response.status === 401) throw new DeliveryError('PROVIDER_UNAUTHORIZED', 401);
    if (response.status === 403) throw new DeliveryError('PROVIDER_FORBIDDEN', 403);
    const transient = response.status === 429 || response.status >= 500;
    const retryAfter = Number(response.headers.get('retry-after'));
    if (retryable && transient && n + 1 < attempts && (!retryAfter || retryAfter <= 2)) {
      await sleep(Math.max(250 * 2 ** n, (retryAfter || 0) * 1000)); continue;
    }
    throw new DeliveryError(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : `PROVIDER_HTTP_${response.status}`, response.status);
  }
  throw new DeliveryError('PROVIDER_UNAVAILABLE', 503);
}

export async function seal(value, keyString) {
  const key = await encryptionKey(keyString);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({ v: 1, iv: encode(iv), data: encode(new Uint8Array(data)) });
}
export async function unseal(value, keyString) {
  if (!value) return {};
  try {
    const packet = JSON.parse(value);
    if (packet.v !== 1) throw Error();
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(packet.iv) }, await encryptionKey(keyString), decode(packet.data));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new DeliveryError('CREDENTIAL_STORAGE_UNAVAILABLE', 503); }
}
const encode = bytes => btoa(String.fromCharCode(...bytes));
const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
async function encryptionKey(value) {
  if (!value) throw new DeliveryError('SERVER_NOT_CONFIGURED', 503);
  let bytes;
  try { bytes = decode(value); } catch { throw new DeliveryError('SERVER_NOT_CONFIGURED', 503); }
  if (bytes.length !== 32) throw new DeliveryError('SERVER_NOT_CONFIGURED', 503);
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function verifyIFoodSignature(bytes, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = Uint8Array.from(signature.match(/../g), x => parseInt(x, 16));
  return crypto.subtle.verify('HMAC', key, sig, bytes);
}
