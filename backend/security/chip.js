const crypto = require('crypto');
const { canonicalTap, mac } = require('./cryptoAgility');

function createChip({ vault, replay, macSuite }) {
  function issue(card, { amountCents, currency }) {
    card.atc += 1;
    const atc = card.atc;
    const nonce = crypto.randomBytes(16).toString('hex');
    const message = canonicalTap({
      token: card.token,
      amountCents,
      currency,
      atc,
      nonce,
    });
    const cryptogram = mac(macSuite, card.key, message);
    replay.remember(nonce, {
      token: card.token,
      atc,
      amountCents,
      currency,
      cardRef: card.ref,
    });
    return {
      token: card.token,
      amountCents,
      currency,
      atc,
      nonce,
      cryptogram,
      suite: macSuite,
    };
  }

  return { issue, findByToken: vault.findByToken };
}

module.exports = { createChip };
