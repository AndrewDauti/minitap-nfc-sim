// Classroom limits. The story page repeats these numbers; keep the two in step.

const VELOCITY_WINDOW_MS = 120 * 1000;
const VELOCITY_STEP_UP = 4;
const PIN_MAX_ATTEMPTS = 3;

const CARD_SEEDS = [
  {
    ref: 'CARD001',
    product: 'ZamPay Kwacha',
    // Fictional PAN. It stays in this vault and must never leave the server.
    pan: '5412880112344401',
    currency: 'ZMW',
    balanceCents: 4000000,
    contactlessLimitCents: 20000,
    ceilingCents: 800000,
    network: 'VISA',
  },
  {
    ref: 'CARD002',
    product: 'Liberty Dollar',
    pan: '4539221012347720',
    currency: 'USD',
    balanceCents: 250000,
    contactlessLimitCents: 5000,
    ceilingCents: 80000,
    network: 'VISA',
  },
  {
    ref: 'CARD003',
    product: 'Alpine Franc',
    pan: '5508441912343194',
    currency: 'CHF',
    balanceCents: 180000,
    contactlessLimitCents: 4000,
    ceilingCents: 60000,
    network: 'MASTERCARD',
  },
];

function fromCents(cents) {
  return Math.round(cents) / 100;
}

function maskPan(pan) {
  return `•••• •••• •••• ${String(pan).slice(-4)}`;
}

function publicPolicy() {
  const limits = {};
  const ceilings = {};
  for (const card of CARD_SEEDS) {
    limits[card.currency] = fromCents(card.contactlessLimitCents);
    ceilings[card.currency] = fromCents(card.ceilingCents);
  }
  return {
    contactlessLimits: limits,
    amountCeilings: ceilings,
    pinAttempts: PIN_MAX_ATTEMPTS,
    velocity: {
      windowSeconds: VELOCITY_WINDOW_MS / 1000,
      stepUpCount: VELOCITY_STEP_UP,
    },
  };
}

module.exports = {
  VELOCITY_WINDOW_MS,
  VELOCITY_STEP_UP,
  PIN_MAX_ATTEMPTS,
  CARD_SEEDS,
  fromCents,
  maskPan,
  publicPolicy,
};
