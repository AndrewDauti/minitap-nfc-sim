function createReplayStore() {
  const outstanding = new Map();
  const usedNonces = new Set();
  const usedAtc = new Set();

  function remember(nonce, record) {
    if (outstanding.size >= 100) {
      const oldest = outstanding.keys().next().value;
      const stale = outstanding.get(oldest);
      outstanding.delete(oldest);
      usedNonces.add(oldest);
      usedAtc.add(`${stale.cardRef}:${stale.atc}`);
    }
    outstanding.set(nonce, record);
  }

  function consume({ cardRef, token, atc, nonce, amountCents, currency }) {
    const atcKey = `${cardRef}:${atc}`;
    if (usedNonces.has(nonce) || usedAtc.has(atcKey)) {
      return { ok: false, code: 'REPLAY' };
    }
    const issued = outstanding.get(nonce);
    if (!issued) return { ok: false, code: 'REPLAY' };
    const bound =
      issued.token === token &&
      issued.atc === atc &&
      issued.amountCents === amountCents &&
      issued.currency === currency &&
      issued.cardRef === cardRef;
    outstanding.delete(nonce);
    usedNonces.add(nonce);
    usedAtc.add(atcKey);
    if (!bound) return { ok: false, code: 'MISMATCH' };
    return { ok: true };
  }

  return { remember, consume };
}

module.exports = { createReplayStore };
