// Keep these strings in step with backend/security/offline.js.
// The till verifies a token on the phone. This file does not call the network.

export const MERCHANT_REF = 'MUTALE';

export function canonicalToken({ tokenId, counter, capCents, allowanceId, cardRef, currency }) {
  return [
    'MINITAP-OFFLINE-TOKEN-v1',
    tokenId,
    counter,
    capCents,
    allowanceId,
    cardRef,
    currency,
  ].join('|');
}

export function canonicalSpend({ tokenId, counter, amountCents, currency, allowanceId, merchantRef }) {
  return [
    'MINITAP-OFFLINE-SPEND-v1',
    tokenId,
    counter,
    amountCents,
    currency,
    allowanceId,
    merchantRef,
  ].join('|');
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (clean.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function spendMacHex(spendKeyHex, fields) {
  const raw = hexToBytes(spendKeyHex);
  if (!raw) throw new Error('Spend key is invalid');
  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(canonicalSpend(fields))
  );
  return bytesToHex(new Uint8Array(mac));
}

export async function verifyTokenSignature(publicKeyHex, token) {
  const raw = hexToBytes(publicKeyHex);
  const signature = hexToBytes(token.signature);
  if (!raw || raw.length !== 32 || !signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'Ed25519' },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    signature,
    new TextEncoder().encode(canonicalToken(token))
  );
}

export function formatK(value) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;
  const negative = safe < 0;
  const [whole, frac] = Math.abs(safe).toFixed(2).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}K${withCommas}.${frac}`;
}

export function tokenRef(tokenId, counter) {
  const head = String(tokenId || '').slice(0, 4);
  const tail = String(counter ?? '').padStart(3, '0');
  return `${head}·${tail}`;
}
