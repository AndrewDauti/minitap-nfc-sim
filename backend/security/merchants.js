const crypto = require('crypto');

// Fixed classroom shops. Nothing here creates a merchant at runtime.
// Till passes are classroom credentials, in the same spirit as the card PINs.
const MERCHANT_SEEDS = [
  {
    ref: 'MUTALE',
    name: 'Mutale Store',
    place: 'Lusaka',
    category: 'Groceries',
    line: 'Groceries',
    terminalCode: '4417',
  },
  {
    ref: 'BWALYA',
    name: 'Bwalya Pharmacy',
    place: 'Kabwata',
    category: 'Pharmacy',
    line: 'Pharmacy',
    terminalCode: '9034',
  },
  {
    ref: 'TEMBO',
    name: 'Tembo Coach',
    place: 'Intercity',
    category: 'Bus fare',
    line: 'Bus fare',
    terminalCode: '6621',
  },
];

const MERCHANT_REF = 'MUTALE';
const MERCHANT_REFS = new Set(MERCHANT_SEEDS.map((shop) => shop.ref));

function findSeed(ref) {
  return MERCHANT_SEEDS.find((shop) => shop.ref === ref) || null;
}

function publicMerchant(seed, extra = {}) {
  return {
    ref: seed.ref,
    name: seed.name,
    place: seed.place,
    category: seed.category,
    line: seed.line,
    ...extra,
  };
}

function terminalCodeMatches(seed, presented) {
  if (!seed || typeof presented !== 'string' || !/^\d{4}$/.test(presented)) return false;
  const expected = Buffer.from(seed.terminalCode);
  const given = Buffer.from(presented);
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

function parseSessionBody(body) {
  const raw = body == null ? {} : body;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'A JSON object is required', code: 'VALIDATION' };
  }
  if (Object.keys(raw).length === 0) {
    return {
      ok: true,
      value: { merchantRef: MERCHANT_REF, terminalCode: null, implicit: true },
    };
  }
  if (raw.merchantRef !== undefined && (typeof raw.merchantRef !== 'string' || !MERCHANT_REFS.has(raw.merchantRef))) {
    return { ok: false, status: 404, error: 'Unknown trader', code: 'UNKNOWN_MERCHANT' };
  }
  if (raw.terminalCode !== undefined && raw.terminalCode !== null
    && (typeof raw.terminalCode !== 'string' || !/^\d{4}$/.test(raw.terminalCode))) {
    return { ok: false, status: 400, error: 'Till pass must be 4 digits', code: 'VALIDATION' };
  }
  return {
    ok: true,
    value: {
      merchantRef: raw.merchantRef || MERCHANT_REF,
      terminalCode: raw.terminalCode == null ? null : raw.terminalCode,
      implicit: false,
    },
  };
}

module.exports = {
  MERCHANT_SEEDS,
  MERCHANT_REF,
  MERCHANT_REFS,
  findSeed,
  publicMerchant,
  terminalCodeMatches,
  parseSessionBody,
};
