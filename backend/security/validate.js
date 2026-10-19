function parseAmount(value) {
  let text = value;
  if (typeof text === 'number') {
    if (!Number.isFinite(text)) return null;
    text = String(text);
  }
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100000000) return null;
  return cents;
}

function parseToken(value) {
  if (typeof value !== 'string' || !/^tok_[a-f0-9]{32}$/.test(value)) return null;
  return value;
}

function parseCurrency(value) {
  if (value === 'ZMW' || value === 'USD' || value === 'CHF') return value;
  return null;
}

function parsePin(value) {
  if (value === undefined || value === null || value === '') return { present: false, pin: null };
  if (typeof value !== 'string' || !/^\d{4,6}$/.test(value)) return { error: 'PIN must be 4 to 6 digits' };
  return { present: true, pin: value };
}

function parseCryptogramBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'A JSON object is required' };
  }
  const token = parseToken(body.token);
  const amountCents = parseAmount(body.amount);
  const currency = parseCurrency(body.currency);
  if (!token || amountCents === null || !currency) {
    return { ok: false, error: 'Token, amount, and currency are required' };
  }
  return { ok: true, value: { token, amountCents, currency } };
}

function parseAuthoriseBody(body) {
  const base = parseCryptogramBody(body);
  if (!base.ok) return base;
  const atc = body.atc;
  const nonce = typeof body.nonce === 'string' ? body.nonce.toLowerCase() : '';
  const cryptogram = typeof body.cryptogram === 'string' ? body.cryptogram.toLowerCase() : '';
  if (!Number.isInteger(atc) || atc < 1 || atc > 1000000) {
    return { ok: false, error: 'ATC must be a positive integer' };
  }
  if (!/^[a-f0-9]{32,64}$/.test(nonce)) {
    return { ok: false, error: 'Terminal nonce is invalid' };
  }
  if (!/^[a-f0-9]{32,64}$/.test(cryptogram)) {
    return { ok: false, error: 'Cryptogram is invalid' };
  }
  const pin = parsePin(body.pin);
  if (pin.error) return { ok: false, error: pin.error };
  return {
    ok: true,
    value: {
      ...base.value,
      atc,
      nonce,
      cryptogram,
      pin: pin.present ? pin.pin : null,
    },
  };
}

module.exports = { parseAmount, parseCryptogramBody, parseAuthoriseBody };
