const { CARD_SEEDS } = require('./policy');

const PANS = CARD_SEEDS.map((card) => card.pan);
const BANNED_KEYS = ['pan', 'pin', 'pinHash', 'key', 'secret', 'jwtSecret', 'cryptogram', 'nonce'];

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walk(child, visit);
  }
}

function sendPublic(res, status, body, options = {}) {
  const allow = new Set(options.allowKeys || []);
  try {
    const text = JSON.stringify(body);
    for (const pan of PANS) {
      if (text.includes(pan)) throw new Error('pan');
    }
    if (/\$2[aby]\$/.test(text)) throw new Error('hash');
    walk(body, (key) => {
      if (BANNED_KEYS.includes(key) && !allow.has(key)) throw new Error(key);
    });
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
  return res.status(status).json(body);
}

module.exports = { sendPublic };
