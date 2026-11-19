// The browser holds a payment token and a short-lived terminal pass.
// It never receives a PAN, a card key, or a PIN hash.
// Each shop has its own pass. Mutale Store stays the default.

import { MERCHANT_REF, merchantByRef } from '../demo/offlineCrypto';

const API_BASE = (process.env.REACT_APP_API_URL || 'http://localhost:5000').replace(/\/$/, '');

const sessions = new Map();

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new Error((data && data.error) || `Request failed (${res.status})`);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data;
}

async function ensureSession(merchantRef = MERCHANT_REF) {
  const key = merchantRef || MERCHANT_REF;
  if (sessions.has(key)) return sessions.get(key);
  const shop = merchantByRef(key);
  const payload = { merchantRef: shop.ref, terminalCode: shop.terminalCode };
  const data = await request('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!data || !data.token) {
    throw new Error('Terminal session was not issued');
  }
  sessions.set(key, data.token);
  return data.token;
}

async function authed(path, options = {}, merchantRef = MERCHANT_REF) {
  const key = merchantRef || MERCHANT_REF;
  const send = async (token) => request(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  try {
    return await send(await ensureSession(key));
  } catch (err) {
    if (err.status !== 401) throw err;
    sessions.delete(key);
    return send(await ensureSession(key));
  }
}

export function openTill(merchantRef) {
  return ensureSession(merchantRef);
}

export const getTransactions = async () => {
  const data = await authed('/api/transactions');
  if (!Array.isArray(data)) {
    throw new Error('Unexpected transactions response');
  }
  return data;
};

export const getWallets = async () => {
  const data = await authed('/api/wallets');
  if (!Array.isArray(data)) {
    throw new Error('Unexpected wallets response');
  }
  return data;
};

export const issueCryptogram = ({ token, amount, currency }) =>
  authed('/api/tap/cryptogram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, amount, currency }),
  });

export const getOfflineStatus = () => authed('/api/offline/status');

export const createAllowance = ({ token, amount }) =>
  authed('/api/offline/allowance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, amount }),
  });

export const syncOfflineSales = (sales, merchantRef = MERCHANT_REF) =>
  authed('/api/offline/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sales }),
  }, merchantRef);

export const authoriseTap = (payload, merchantRef = MERCHANT_REF) => {
  const body = {
    token: payload.token,
    amount: payload.amount,
    currency: payload.currency,
    atc: payload.atc,
    nonce: payload.nonce,
    cryptogram: payload.cryptogram,
  };
  if (payload.pin) body.pin = payload.pin;
  return authed('/api/tap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, merchantRef || payload.merchantRef || MERCHANT_REF);
};
