const crypto = require('crypto');

// Active tap cryptograms are symmetric MACs. The objects below are the
// places a later algorithm would be wired in. ML-KEM would encapsulate a
// session key between terminal and issuer. ML-DSA would sign an
// authorisation. Neither is called. DUKPT would encrypt a PIN at a
// hardware pad; the PIN check in pin.js is the classroom stand-in.

const SLOTS = {
  'ML-KEM-768': 'Would encapsulate a session key between the terminal and the issuer.',
  'ML-DSA-65': 'Would sign the authorisation payload.',
  DUKPT: 'Would encrypt the PIN under a one-time derived key at a hardware pad.',
};

function assertActiveMac(suite) {
  if (Object.prototype.hasOwnProperty.call(SLOTS, suite)) {
    const error = new Error(
      `${suite} is a crypto-agility slot in this classroom model and is not active.`
    );
    error.code = 'PQ_SLOT';
    throw error;
  }
  if (suite !== 'hmac-sha256' && suite !== 'aes-cmac') {
    throw new Error(`Unknown MAC suite "${suite}". Use hmac-sha256 or aes-cmac.`);
  }
}

function describeAgility(activeSuite) {
  assertActiveMac(activeSuite);
  return {
    label: 'Educational model of payment security. Not production payment cryptography.',
    activeMac: activeSuite,
    mac: [
      {
        id: 'hmac-sha256',
        status: activeSuite === 'hmac-sha256' ? 'active' : 'available',
        purpose: 'Tap cryptogram, an ARQC stand-in.',
      },
      {
        id: 'aes-cmac',
        status: activeSuite === 'aes-cmac' ? 'active' : 'available',
        purpose: 'Alternate tap cryptogram, closer to an AES EMV MAC.',
      },
    ],
    kem: [{ id: 'ML-KEM-768', status: 'slot', purpose: SLOTS['ML-KEM-768'] }],
    signature: [{ id: 'ML-DSA-65', status: 'slot', purpose: SLOTS['ML-DSA-65'] }],
    cvm: {
      active: 'bcrypt',
      slot: 'DUKPT',
      note: SLOTS.DUKPT,
    },
  };
}

function canonicalTap({ token, amountCents, currency, atc, nonce }) {
  return `MINITAP-ARQC-v1|${token}|${amountCents}|${currency}|${atc}|${nonce}`;
}

// One AES block. CBC with a zero IV is the same as ECB for a single block,
// which is all CMAC needs. A fresh cipher is created per block.
function aesBlock(key16, block) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key16, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function shiftLeft(block) {
  const out = Buffer.alloc(16);
  let overflow = 0;
  for (let i = 15; i >= 0; i -= 1) {
    out[i] = ((block[i] << 1) | overflow) & 0xff;
    overflow = block[i] & 0x80 ? 1 : 0;
  }
  return out;
}

function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

function cmacSubkeys(key16) {
  const l = aesBlock(key16, Buffer.alloc(16));
  let k1 = shiftLeft(l);
  if (l[0] & 0x80) k1[15] ^= 0x87;
  let k2 = shiftLeft(k1);
  if (k1[0] & 0x80) k2[15] ^= 0x87;
  return { k1, k2 };
}

function aesCmac(key, message) {
  const key16 = key.subarray(0, 16);
  const { k1, k2 } = cmacSubkeys(key16);
  const data = Buffer.isBuffer(message) ? message : Buffer.from(message);
  const complete = data.length > 0 && data.length % 16 === 0;
  const blocks = Math.max(1, Math.ceil(data.length / 16));
  let x = Buffer.alloc(16);
  for (let i = 0; i < blocks - 1; i += 1) {
    const block = data.subarray(i * 16, (i + 1) * 16);
    x = aesBlock(key16, xor(x, block));
  }
  let last;
  if (complete) {
    last = xor(data.subarray((blocks - 1) * 16), k1);
  } else {
    const start = (blocks - 1) * 16;
    const padded = Buffer.alloc(16);
    data.copy(padded, 0, start);
    padded[data.length - start] = 0x80;
    last = xor(padded, k2);
  }
  return aesBlock(key16, xor(x, last)).toString('hex');
}

function hmacSha256(key, message) {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

function mac(suite, key, message) {
  assertActiveMac(suite);
  if (suite === 'aes-cmac') return aesCmac(key, message);
  return hmacSha256(key, message);
}

function verifyMac(suite, key, message, presented) {
  const given = String(presented || '').toLowerCase();
  if (!/^[a-f0-9]+$/.test(given)) return false;
  const expected = mac(suite, key, message);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  SLOTS,
  assertActiveMac,
  describeAgility,
  canonicalTap,
  mac,
  verifyMac,
  aesCmac,
};
