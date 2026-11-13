const crypto = require('crypto');
const { fromCents } = require('./policy');
const { parseAmount } = require('./validate');

// Classroom stand-in for an issuer-signed offline token.
// The Ed25519 private key never leaves this module. The till receives the
// raw public key and checks the signature with no network call.
// Each token also has a spend key. The customer wallet uses it to MAC the
// amount at tap time. The till checks that MAC, then drops the spend key.
// Settlement checks the same MAC again, so an edited amount fails here.

const TOKEN_BATCH = 8;
const MIN_ALLOWANCE_CENTS = 100;
const MAX_ALLOWANCE_CENTS = 500000;
const MERCHANT_REF = 'MUTALE';
const MERCHANT_NAME = 'Mutale Store';

const TAX_EXAMPLE = {
  rate: 0.05,
  threshold: 20,
  currency: 'ZMW',
  note: 'Example values for this demo. Not an official ZRA rate or threshold. A live app would read both from ZRA.',
};

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function canonicalToken({ tokenId, counter, capCents, allowanceId, cardRef, currency }) {
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

function canonicalSpend({ tokenId, counter, amountCents, currency, allowanceId, merchantRef }) {
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

function spendMacFor(spendKeyHex, fields) {
  return crypto
    .createHmac('sha256', Buffer.from(spendKeyHex, 'hex'))
    .update(canonicalSpend(fields))
    .digest('hex');
}

function macEqual(expectedHex, presented) {
  const given = String(presented || '').toLowerCase();
  if (!/^[a-f0-9]+$/.test(given)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(given, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function money(cents) {
  return fromCents(cents);
}

function createOffline({ vault }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const issuerPublicKey = spki.subarray(spki.length - 32).toString('hex');

  const trader = {
    name: MERCHANT_NAME,
    balanceCents: 0,
    currency: 'ZMW',
  };
  const allowances = new Map();
  const byCard = new Map();
  let smsSeq = 0;

  function sign(message) {
    return crypto.sign(null, Buffer.from(message), privateKey).toString('hex');
  }

  function verifySignature(message, signatureHex) {
    if (typeof signatureHex !== 'string' || !/^[a-f0-9]{128}$/i.test(signatureHex)) return false;
    try {
      return crypto.verify(null, Buffer.from(message), publicKey, Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  }

  function cardByRef(ref) {
    return vault.cards.find((card) => card.ref === ref) || null;
  }

  function customerView(card) {
    if (!card) return null;
    const locked = card.lockedCents || 0;
    return {
      cardRef: card.ref,
      balance: money(card.balanceCents),
      spendable: money(card.balanceCents - locked),
      currency: card.currency,
      maskedPan: card.maskedPan,
      last4: card.last4,
      product: card.product,
    };
  }

  function allowanceView(record) {
    if (!record) return null;
    return {
      id: record.id,
      cardRef: record.cardRef,
      currency: record.currency,
      amount: money(record.amountCents),
      remaining: money(record.remainingCents),
      tokensLeft: record.tokens.filter((token) => !record.seen.has(token.tokenId)).length,
      lastSettledCounter: record.lastSettledCounter,
    };
  }

  function statusBody(cardRef = 'CARD001') {
    const card = cardByRef(cardRef);
    const record = byCard.has(cardRef) ? allowances.get(byCard.get(cardRef)) : null;
    return {
      issuerPublicKey,
      merchant: {
        ref: MERCHANT_REF,
        name: MERCHANT_NAME,
        place: 'Lusaka',
        category: 'Groceries',
      },
      trader: {
        name: trader.name,
        balance: money(trader.balanceCents),
        currency: trader.currency,
      },
      customer: customerView(card),
      allowance: allowanceView(record),
      taxExample: TAX_EXAMPLE,
    };
  }

  function openAllowance(card, amountCents) {
    if (card.currency !== 'ZMW') {
      return fail(400, 'CURRENCY_MISMATCH', 'Offline allowance is available on Zamtel Kwacha (ZMW).');
    }
    if (byCard.has(card.ref)) {
      return fail(409, 'ALLOWANCE_OPEN', 'An offline allowance is already set aside.');
    }
    if (amountCents < MIN_ALLOWANCE_CENTS || amountCents > MAX_ALLOWANCE_CENTS) {
      return fail(400, 'VALIDATION', 'Allowance must be between K1.00 and K5000.00.');
    }
    const available = card.balanceCents - (card.lockedCents || 0);
    if (amountCents > available) {
      return fail(400, 'INSUFFICIENT_FUNDS', 'Not enough spendable balance to set aside that allowance.');
    }

    const allowanceId = `alw_${crypto.randomBytes(8).toString('hex')}`;
    const tokens = [];
    for (let index = 0; index < TOKEN_BATCH; index += 1) {
      const counter = index + 1;
      const tokenId = crypto.randomBytes(4).toString('hex').toUpperCase();
      const capCents = amountCents;
      const spendKey = crypto.randomBytes(32).toString('hex');
      const signature = sign(canonicalToken({
        tokenId,
        counter,
        capCents,
        allowanceId,
        cardRef: card.ref,
        currency: card.currency,
      }));
      tokens.push({
        tokenId,
        counter,
        capCents,
        allowanceId,
        cardRef: card.ref,
        currency: card.currency,
        signature,
        spendKey,
        used: false,
      });
    }

    card.lockedCents = (card.lockedCents || 0) + amountCents;
    const record = {
      id: allowanceId,
      cardRef: card.ref,
      currency: card.currency,
      amountCents,
      remainingCents: amountCents,
      lastSettledCounter: 0,
      tokens,
      seen: new Set(),
    };
    allowances.set(allowanceId, record);
    byCard.set(card.ref, allowanceId);

    return {
      status: 200,
      body: {
        code: 'ALLOWANCE_READY',
        allowanceId,
        amount: money(amountCents),
        remaining: money(amountCents),
        currency: card.currency,
        balance: money(card.balanceCents),
        spendable: money(card.balanceCents - card.lockedCents),
        issuerPublicKey,
        batchSize: TOKEN_BATCH,
        merchantRef: MERCHANT_REF,
        tokens: tokens.map(publicToken),
      },
      audit: {
        event: 'offline.allowance',
        code: 'ALLOWANCE_READY',
        cardRef: card.ref,
        tokenTail: vault.tokenTail(card.token),
        maskedPan: card.maskedPan,
        amount: money(amountCents),
        currency: card.currency,
        result: 'locked',
      },
    };
  }

  function settle(sales) {
    const settled = [];
    const blocked = [];
    const ordered = sales
      .map((sale, index) => ({ sale, index }))
      .sort((a, b) => a.sale.counter - b.sale.counter || a.index - b.index);

    ordered.forEach(({ sale }) => {
      const outcome = decide(sale);
      if (outcome.ok) {
        applySettle(outcome);
        settled.push(outcome.public);
      } else {
        if (outcome.burn && outcome.token && outcome.allowance) {
          outcome.allowance.seen.add(outcome.token.tokenId);
          outcome.token.used = true;
        }
        blocked.push(outcome.public);
      }
    });

    const touched = new Set();
    sales.forEach((sale) => {
      if (sale.cardRef) touched.add(sale.cardRef);
    });
    const cardRef = touched.values().next().value || 'CARD001';
    const card = cardByRef(cardRef);
    const record = byCard.has(cardRef) ? allowances.get(byCard.get(cardRef)) : null;
    const sms = buildSms(settled, blocked, card);

    return {
      status: 200,
      body: {
        settled,
        blocked,
        trader: {
          name: trader.name,
          balance: money(trader.balanceCents),
          currency: trader.currency,
        },
        customer: customerView(card),
        allowance: allowanceView(record),
        sms,
      },
      audits: [...settled, ...blocked].map((row) => ({
        event: 'offline.sync',
        code: row.code,
        cardRef: card ? card.ref : null,
        tokenTail: String(row.tokenId || '').slice(-4),
        maskedPan: card ? card.maskedPan : null,
        amount: row.amount,
        currency: row.currency,
        riskScore: row.riskScore,
        result: row.status === 'settled' ? 'settled' : 'blocked',
      })),
    };
  }

  function decide(sale) {
    const base = {
      tokenId: sale.tokenId,
      counter: sale.counter,
      amount: money(sale.amountCents),
      currency: sale.currency || 'ZMW',
    };
    const allowance = allowances.get(sale.allowanceId);
    if (!allowance || allowance.cardRef !== sale.cardRef) {
      return block(base, 'UNKNOWN_TOKEN', 'This token does not match an open allowance.', 70);
    }
    const token = allowance.tokens.find((item) => item.tokenId === sale.tokenId);
    if (!token) {
      return block(base, 'UNKNOWN_TOKEN', 'This token was not issued for the allowance.', 70);
    }

    const signed = canonicalToken({
      tokenId: sale.tokenId,
      counter: sale.counter,
      capCents: sale.capCents,
      allowanceId: sale.allowanceId,
      cardRef: sale.cardRef,
      currency: sale.currency,
    });
    if (!verifySignature(signed, sale.signature)) {
      return block(base, 'BAD_SIGNATURE', 'The issuer signature does not match this token.', 97);
    }
    if (
      token.counter !== sale.counter
      || token.capCents !== sale.capCents
      || token.currency !== sale.currency
      || token.cardRef !== sale.cardRef
    ) {
      return block(base, 'BAD_SIGNATURE', 'The signed fields do not match the issued token.', 97);
    }

    const expectedMac = spendMacFor(token.spendKey, {
      tokenId: sale.tokenId,
      counter: sale.counter,
      amountCents: sale.amountCents,
      currency: sale.currency,
      allowanceId: sale.allowanceId,
      merchantRef: sale.merchantRef,
    });
    if (!macEqual(expectedMac, sale.spendMac)) {
      return block(
        base,
        'TAMPERED_AMOUNT',
        'The amount does not match the code signed at the till. You were not charged.',
        96,
        { burn: true, token, allowance }
      );
    }

    if (allowance.seen.has(sale.tokenId)) {
      return block(
        base,
        'REPLAY',
        'A copied token was replayed. You were not charged.',
        94,
        { token, allowance }
      );
    }

    if (sale.counter <= allowance.lastSettledCounter) {
      return block(
        base,
        'COUNTER_ROLLBACK',
        'This counter is older than one already settled. You were not charged.',
        93,
        { burn: true, token, allowance }
      );
    }

    if (sale.amountCents > token.capCents) {
      return block(
        base,
        'OVER_CAP',
        'The amount is above this token spending cap. You were not charged.',
        88,
        { burn: true, token, allowance }
      );
    }

    if (sale.amountCents > allowance.remainingCents) {
      return block(
        base,
        'ALLOWANCE_EXCEEDED',
        'This sale would spend more than the offline allowance. You were not charged.',
        84,
        { burn: true, token, allowance }
      );
    }

    const card = cardByRef(allowance.cardRef);
    if (card && sale.amountCents > card.ceilingCents) {
      return block(
        base,
        'RISK_DECLINE',
        'The amount is over the per-tap ceiling. You were not charged.',
        90,
        { burn: true, token, allowance }
      );
    }

    const overContactless = card ? sale.amountCents > card.contactlessLimitCents : false;
    return {
      ok: true,
      token,
      allowance,
      sale,
      public: {
        ...base,
        status: 'settled',
        code: 'SETTLED',
        riskScore: overContactless ? 18 : 4,
        payerTail: card ? card.last4 : '',
        reason: null,
      },
    };
  }

  function applySettle(outcome) {
    const { allowance, token, sale } = outcome;
    const card = cardByRef(allowance.cardRef);
    allowance.seen.add(token.tokenId);
    token.used = true;
    allowance.remainingCents -= sale.amountCents;
    if (sale.counter > allowance.lastSettledCounter) {
      allowance.lastSettledCounter = sale.counter;
    }
    if (card) {
      card.balanceCents -= sale.amountCents;
      card.lockedCents = Math.max(0, (card.lockedCents || 0) - sale.amountCents);
    }
    trader.balanceCents += sale.amountCents;
  }

  function buildSms(settledRows, blockedRows, card) {
    const messages = [];
    const settledCents = settledRows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
    let running = (card ? card.balanceCents : 0) + settledCents;
    settledRows.forEach((row) => {
      smsSeq += 1;
      const amountCents = Math.round(row.amount * 100);
      running -= amountCents;
      messages.push({
        id: `sms_${smsSeq}`,
        from: 'ZAMTEL KWACHA',
        kind: 'settled',
        body: `Settled: ${formatKwacha(amountCents)} to ${MERCHANT_NAME}. New balance ${formatKwacha(running)}.`,
      });
    });
    blockedRows.forEach((row) => {
      smsSeq += 1;
      messages.push({
        id: `sms_${smsSeq}`,
        from: 'ZAMTEL KWACHA',
        kind: 'blocked',
        body: `Blocked: ${blockedSms(row.code)}`,
      });
    });
    return messages;
  }

  return {
    issuerPublicKey,
    statusBody,
    openAllowance,
    settle,
    verifySignature,
  };
}

function publicToken(token) {
  return {
    tokenId: token.tokenId,
    counter: token.counter,
    capCents: token.capCents,
    cap: money(token.capCents),
    allowanceId: token.allowanceId,
    cardRef: token.cardRef,
    currency: token.currency,
    signature: token.signature,
    spendKey: token.spendKey,
  };
}

function block(base, code, reason, riskScore, extra = {}) {
  return {
    ok: false,
    burn: Boolean(extra.burn),
    token: extra.token || null,
    allowance: extra.allowance || null,
    public: {
      ...base,
      status: 'blocked',
      code,
      riskScore,
      reason,
    },
  };
}

function fail(status, code, error) {
  return {
    status,
    body: { error, code },
    audit: {
      event: 'offline.allowance',
      code,
      result: 'declined',
    },
  };
}

function formatKwacha(cents) {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}K${whole}.${frac}`;
}

function blockedSms(code) {
  if (code === 'REPLAY') return 'a copied token was replayed. You were not charged.';
  if (code === 'TAMPERED_AMOUNT') return 'the amount on a saved sale was changed. You were not charged.';
  if (code === 'COUNTER_ROLLBACK') return 'a token counter was rolled back. You were not charged.';
  if (code === 'ALLOWANCE_EXCEEDED') return 'the sale was over the offline allowance. You were not charged.';
  if (code === 'BAD_SIGNATURE') return 'a token signature did not match. You were not charged.';
  return 'the sale was refused. You were not charged.';
}

function parseAllowanceBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'A JSON object is required' };
  }
  if (typeof body.token !== 'string' || !/^tok_[a-f0-9]{32}$/.test(body.token)) {
    return { ok: false, error: 'Token, amount, and currency are required' };
  }
  const amountCents = parseAmount(body.amount);
  if (amountCents === null) {
    return { ok: false, error: 'Enter an allowance between K1.00 and K5000.00.' };
  }
  return { ok: true, value: { token: body.token, amountCents } };
}

function parseSyncBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.sales)) {
    return { ok: false, error: 'A sales array is required' };
  }
  if (body.sales.length > 20) {
    return { ok: false, error: 'Send at most 20 sales in one sync' };
  }
  const sales = [];
  for (const raw of body.sales) {
    const parsed = parseSale(raw);
    if (!parsed.ok) return parsed;
    sales.push(parsed.value);
  }
  return { ok: true, value: sales };
}

function parseSale(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Each sale must be an object' };
  }
  if (typeof raw.tokenId !== 'string' || !/^[A-F0-9]{8}$/.test(raw.tokenId)) {
    return { ok: false, error: 'Token id is invalid' };
  }
  if (!Number.isInteger(raw.counter) || raw.counter < 1 || raw.counter > 1000000) {
    return { ok: false, error: 'Counter must be a positive integer' };
  }
  if (!Number.isInteger(raw.capCents) || raw.capCents < 1 || raw.capCents > MAX_ALLOWANCE_CENTS) {
    return { ok: false, error: 'Token cap is invalid' };
  }
  if (typeof raw.allowanceId !== 'string' || !/^alw_[a-f0-9]{16}$/.test(raw.allowanceId)) {
    return { ok: false, error: 'Allowance id is invalid' };
  }
  if (typeof raw.cardRef !== 'string' || !/^CARD00[123]$/.test(raw.cardRef)) {
    return { ok: false, error: 'Card reference is invalid' };
  }
  if (raw.currency !== 'ZMW') {
    return { ok: false, error: 'Offline sales use ZMW' };
  }
  if (raw.merchantRef !== MERCHANT_REF) {
    return { ok: false, error: 'Unknown trader' };
  }
  if (typeof raw.signature !== 'string' || !/^[a-f0-9]{128}$/i.test(raw.signature)) {
    return { ok: false, error: 'Token signature is invalid' };
  }
  if (typeof raw.spendMac !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.spendMac)) {
    return { ok: false, error: 'Spend code is invalid' };
  }
  const amountCents = parseAmount(raw.amount);
  if (amountCents === null) {
    return { ok: false, error: 'Sale amount is invalid' };
  }
  return {
    ok: true,
    value: {
      tokenId: raw.tokenId,
      counter: raw.counter,
      capCents: raw.capCents,
      allowanceId: raw.allowanceId,
      cardRef: raw.cardRef,
      currency: 'ZMW',
      merchantRef: MERCHANT_REF,
      signature: raw.signature.toLowerCase(),
      spendMac: raw.spendMac.toLowerCase(),
      amountCents,
    },
  };
}

function describeOffline() {
  return {
    offline: {
      model: 'Ed25519 signed single-use tokens. Each token has a monotonic counter, a spending cap, and an HMAC spend code over the amount.',
      batchSize: TOKEN_BATCH,
      merchant: MERCHANT_NAME,
      note: 'The private key stays on the server. A till can verify the public signature, the counter, and the remaining allowance with no network call. Sync rejects a replay, a tampered amount, a rolled-back counter, and a sale past the allowance.',
      taxExample: TAX_EXAMPLE,
    },
  };
}

module.exports = {
  TOKEN_BATCH,
  MERCHANT_REF,
  MERCHANT_NAME,
  TAX_EXAMPLE,
  SPKI_PREFIX,
  canonicalToken,
  canonicalSpend,
  spendMacFor,
  createOffline,
  parseAllowanceBody,
  parseSyncBody,
  describeOffline,
  formatKwacha,
};
