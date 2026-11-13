// The browser holds a payment token and a short-lived terminal pass.
// It never receives a PAN, a card key, or a PIN hash.

const API_BASE = (process.env.REACT_APP_API_URL || 'http://localhost:5000').replace(/\/$/, '');

let sessionToken = null;

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

async function ensureSession() {
  if (sessionToken) return sessionToken;
  const data = await request('/api/session', { method: 'POST' });
  if (!data || !data.token) {
    throw new Error('Terminal session was not issued');
  }
  sessionToken = data.token;
  return sessionToken;
}

async function authed(path, options = {}) {
  const send = async (token) => request(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  try {
    return await send(await ensureSession());
  } catch (err) {
    if (err.status !== 401) throw err;
    sessionToken = null;
    return send(await ensureSession());
  }
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

export const syncOfflineSales = (sales) =>
  authed('/api/offline/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sales }),
  });

export const authoriseTap = (payload) => {
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
  });
};
