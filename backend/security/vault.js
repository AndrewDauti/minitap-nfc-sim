const crypto = require('crypto');
const { CARD_SEEDS, fromCents, maskPan } = require('./policy');
const { hashPin } = require('./pin');

function readKey(hex) {
  if (!hex) return crypto.randomBytes(32);
  if (!/^[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error('Card keys must be 64 hex characters (32 bytes).');
  }
  return Buffer.from(hex, 'hex');
}

function createVault({ pins, keys = {}, bcryptRounds }) {
  const cards = CARD_SEEDS.map((seed) => {
    const pin = pins[seed.ref];
    if (!pin) throw new Error(`Missing classroom PIN for ${seed.ref}`);
    return {
      ref: seed.ref,
      product: seed.product,
      pan: seed.pan,
      last4: seed.pan.slice(-4),
      maskedPan: maskPan(seed.pan),
      network: seed.network,
      currency: seed.currency,
      balanceCents: seed.balanceCents,
      contactlessLimitCents: seed.contactlessLimitCents,
      ceilingCents: seed.ceilingCents,
      token: `tok_${crypto.randomBytes(16).toString('hex')}`,
      pinHash: hashPin(pin, bcryptRounds),
      key: readKey(keys[seed.ref]),
      atc: 0,
      pinFailures: 0,
      locked: false,
      recent: [],
    };
  });

  function findByToken(token) {
    return cards.find((card) => card.token === token) || null;
  }

  function publicView(card) {
    return {
      cardRef: card.ref,
      token: card.token,
      maskedPan: card.maskedPan,
      last4: card.last4,
      product: card.product,
      balance: fromCents(card.balanceCents),
      currency: card.currency,
      contactlessLimit: fromCents(card.contactlessLimitCents),
      locked: card.locked,
    };
  }

  function tokenTail(token) {
    return String(token).slice(-4);
  }

  return {
    cards,
    findByToken,
    publicView,
    tokenTail,
    listPublic: () => cards.map(publicView),
  };
}

module.exports = { createVault, CARD_SEEDS };
