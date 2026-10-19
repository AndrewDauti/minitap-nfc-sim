const crypto = require('crypto');
const { assertActiveMac } = require('./cryptoAgility');

const CLASSROOM_PINS = {
  CARD001: '2580',
  CARD002: '1492',
  CARD003: '7731',
};

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function loadConfig(overrides = {}) {
  const macSuite = overrides.macSuite || process.env.MAC_SUITE || 'hmac-sha256';
  assertActiveMac(macSuite);

  const rounds = Math.min(
    12,
    Math.max(4, Math.round(positive(overrides.bcryptRounds ?? process.env.BCRYPT_ROUNDS, 8)))
  );

  const corsRaw = overrides.corsOrigins || process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000';
  const corsOrigins = Array.isArray(corsRaw)
    ? corsRaw
    : String(corsRaw).split(',').map((item) => item.trim()).filter(Boolean);

  const pins = overrides.pins || {
    CARD001: process.env.PIN_CARD001 || CLASSROOM_PINS.CARD001,
    CARD002: process.env.PIN_CARD002 || CLASSROOM_PINS.CARD002,
    CARD003: process.env.PIN_CARD003 || CLASSROOM_PINS.CARD003,
  };

  const keys = overrides.keys || {
    CARD001: process.env.CARD_KEY_CARD001 || null,
    CARD002: process.env.CARD_KEY_CARD002 || null,
    CARD003: process.env.CARD_KEY_CARD003 || null,
  };

  return {
    jwtSecret: overrides.jwtSecret || process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    jwtExpiresIn: overrides.jwtExpiresIn || process.env.JWT_EXPIRES_IN || '15m',
    corsOrigins,
    rateLimitWindowMs: positive(overrides.rateLimitWindowMs ?? process.env.RATE_LIMIT_WINDOW_MS, 60000),
    rateLimitMax: positive(overrides.rateLimitMax ?? process.env.RATE_LIMIT_MAX, 120),
    macSuite,
    bcryptRounds: rounds,
    pins,
    keys,
    jwtSecretFromEnv: Boolean(overrides.jwtSecret || process.env.JWT_SECRET),
  };
}

module.exports = { loadConfig, CLASSROOM_PINS };
