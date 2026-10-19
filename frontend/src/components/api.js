const API_BASE = (process.env.REACT_APP_API_URL || 'http://localhost:5000').replace(/\/$/, '');

async function request(path, options) {
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

export const getTransactions = async () => {
  const data = await request('/api/transactions');
  if (!Array.isArray(data)) {
    throw new Error('Unexpected transactions response');
  }
  return data;
};

export const sendTap = (cardId, amount) =>
  request('/api/tap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, amount }),
  });

export const getWallets = async () => {
  const data = await request('/api/wallets');
  if (!Array.isArray(data)) {
    throw new Error('Unexpected wallets response');
  }
  return data;
};
