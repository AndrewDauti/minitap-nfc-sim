const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../server');
const { aesCmac, mac, verifyMac, assertActiveMac } = require('../security/cryptoAgility');
const { CARD_SEEDS } = require('../security/policy');

const KEY1 = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const PINS = { CARD001: '2580', CARD002: '1492', CARD003: '7731' };

function testApp(extra = {}) {
  return createApp({
    jwtSecret: 'test-secret-test-secret-test-secret',
    jwtExpiresIn: '15m',
    bcryptRounds: 4,
    rateLimitMax: 500,
    rateLimitWindowMs: 60000,
    pins: PINS,
    keys: { CARD001: KEY1 },
    macSuite: 'hmac-sha256',
    ...extra,
  });
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done, reject) => {
          server.close((err) => (err ? reject(err) : done()));
        }),
      });
    });
  });
}

async function api(base, urlPath, { method = 'GET', token, body } = {}) {
  const res = await fetch(base + urlPath, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

async function boot(extra) {
  const live = await listen(testApp(extra));
  const session = await api(live.base, '/api/session', { method: 'POST', body: {} });
  assert.equal(session.status, 200);
  const wallets = await api(live.base, '/api/wallets', { token: session.body.token });
  assert.equal(wallets.status, 200);
  return { live, token: session.body.token, wallets: wallets.body };
}

function card(wallets, ref) {
  return wallets.find((row) => row.cardRef === ref);
}

async function cryptogram(ctx, ref, amount, currency) {
  const row = card(ctx.wallets, ref);
  return api(ctx.live.base, '/api/tap/cryptogram', {
    method: 'POST',
    token: ctx.token,
    body: { token: row.token, amount, currency },
  });
}

async function authorise(ctx, proof, extra = {}) {
  return api(ctx.live.base, '/api/tap', {
    method: 'POST',
    token: ctx.token,
    body: {
      token: proof.token,
      amount: proof.amount,
      currency: proof.currency,
      atc: proof.atc,
      nonce: proof.nonce,
      cryptogram: proof.cryptogram,
      ...extra,
    },
  });
}

function assertNoPan(value) {
  const text = JSON.stringify(value);
  for (const seed of CARD_SEEDS) {
    assert.equal(text.includes(seed.pan), false, `response contained PAN for ${seed.ref}`);
  }
  assert.doesNotMatch(text, /\$2[aby]\$/);
  assert.equal(text.includes(KEY1), false);
}

describe('payment security', { concurrency: 1 }, () => {
  test('AES-CMAC matches the RFC 4493 vectors', () => {
    const key = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
    const block = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
    assert.equal(aesCmac(key, block), '070a16b46b4d4144f79bdd9dd04a287c');
    assert.equal(aesCmac(key, Buffer.alloc(0)), 'bb1d6929e95937287fa37d129b756746');
    const long = Buffer.from(
      '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
      'hex'
    );
    assert.equal(aesCmac(key, long), '51f0bebf7e3b9d92fc49741779363cfe');
  });

  test('HMAC verification rejects a changed message', () => {
    const key = crypto.randomBytes(32);
    const tag = mac('hmac-sha256', key, 'amount=150');
    assert.equal(verifyMac('hmac-sha256', key, 'amount=150', tag), true);
    assert.equal(verifyMac('hmac-sha256', key, 'amount=175', tag), false);
  });

  test('post-quantum names are slots, not active algorithms', () => {
    assert.throws(() => assertActiveMac('ML-KEM-768'), /not active/);
    assert.throws(() => assertActiveMac('ML-DSA-65'), /not active/);
    assert.throws(() => testApp({ macSuite: 'ML-DSA-65' }), /not active/);
  });

  test('security modules do not write to the console', () => {
    const securityDir = path.join(__dirname, '..', 'security');
    for (const file of fs.readdirSync(securityDir)) {
      const text = fs.readFileSync(path.join(securityDir, file), 'utf8');
      assert.doesNotMatch(text, /console\./, file);
    }
    const controller = fs.readFileSync(
      path.join(__dirname, '..', 'controllers', 'transactionController.js'),
      'utf8'
    );
    assert.doesNotMatch(controller, /console\./);
  });

  test('an approved tap debits the right currency and returns a safe trace', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const proof = await cryptogram(ctx, 'CARD001', 150, 'ZMW');
    assert.equal(proof.status, 200);
    assert.match(proof.body.cryptogram, /^[a-f0-9]{64}$/);
    const approved = await authorise(ctx, proof.body);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'approved');
    assert.equal(approved.body.currency, 'ZMW');
    assert.equal(approved.body.amount, 150);
    assert.equal(approved.body.balanceAfter, 39850);
    assert.equal(approved.body.riskScore, 0);
    assert.equal(approved.body.maskedPan, '•••• •••• •••• 4401');
    const byId = Object.fromEntries(approved.body.trace.map((step) => [step.id, step]));
    assert.equal(byId.cryptogram.result, 'passed');
    assert.equal(byId.token.result, 'passed');
    assert.equal(byId.replay.result, 'passed');
    assert.equal(byId.risk.result, 'passed');
    assert.equal(byId.cvm.result, 'passed');
    assertNoPan(approved.body);
    assertNoPan(proof.body);
    assertNoPan(ctx.wallets);

    const usdProof = await cryptogram(ctx, 'CARD002', 20, 'USD');
    const usd = await authorise(ctx, usdProof.body);
    assert.equal(usd.status, 200);
    assert.equal(usd.body.currency, 'USD');
    assert.equal(usd.body.balanceAfter, 2480);

    const wallets = await api(ctx.live.base, '/api/wallets', { token: ctx.token });
    assert.equal(card(wallets.body, 'CARD001').balance, 39850);
    assert.equal(card(wallets.body, 'CARD002').balance, 2480);
    assert.equal(card(wallets.body, 'CARD003').balance, 1800);
    assertNoPan(wallets.body);

    const history = await api(ctx.live.base, '/api/transactions', { token: ctx.token });
    const audit = await api(ctx.live.base, '/api/audit', { token: ctx.token });
    assertNoPan(history.body);
    assertNoPan(audit.body);
    assert.equal(JSON.stringify(audit.body).includes(proof.body.nonce), false);
    assert.equal(JSON.stringify(audit.body).includes(proof.body.cryptogram), false);
  });

  test('AES-CMAC can be the active suite', async (t) => {
    const ctx = await boot({ macSuite: 'aes-cmac' });
    t.after(() => ctx.live.close());
    const proof = await cryptogram(ctx, 'CARD003', 10, 'CHF');
    assert.equal(proof.status, 200);
    assert.equal(proof.body.suite, 'aes-cmac');
    assert.match(proof.body.cryptogram, /^[a-f0-9]{32}$/);
    const approved = await authorise(ctx, proof.body);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.currency, 'CHF');
    assert.equal(approved.body.balanceAfter, 1790);
    assert.match(approved.body.trace.find((step) => step.id === 'cryptogram').detail, /AES-CMAC/);
  });

  test('a reused cryptogram is rejected and does not debit', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const proof = await cryptogram(ctx, 'CARD001', 150, 'ZMW');
    const first = await authorise(ctx, proof.body);
    assert.equal(first.status, 200);
    const replay = await authorise(ctx, proof.body);
    assert.equal(replay.status, 409);
    assert.equal(replay.body.code, 'REPLAY');
    assert.equal(replay.body.status, 'declined');
    assert.equal(replay.body.trace.find((step) => step.id === 'replay').result, 'failed');
    assert.equal(replay.body.balanceAfter, 39850);
    const wallets = await api(ctx.live.base, '/api/wallets', { token: ctx.token });
    assert.equal(card(wallets.body, 'CARD001').balance, 39850);
  });

  test('a tampered amount is rejected and does not debit', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const proof = await cryptogram(ctx, 'CARD001', 150, 'ZMW');
    const tampered = await authorise(ctx, { ...proof.body, amount: 175 });
    assert.equal(tampered.status, 400);
    assert.equal(tampered.body.code, 'CRYPTOGRAM_MISMATCH');
    assert.equal(tampered.body.trace.find((step) => step.id === 'cryptogram').result, 'failed');
    assert.equal(tampered.body.trace.find((step) => step.id === 'replay').result, 'skipped');
    const wallets = await api(ctx.live.base, '/api/wallets', { token: ctx.token });
    assert.equal(card(wallets.body, 'CARD001').balance, 40000);
    assertNoPan(tampered.body);
  });

  test('three wrong PINs lock the card', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const codes = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const proof = await cryptogram(ctx, 'CARD001', 500, 'ZMW');
      assert.equal(proof.status, 200);
      const declined = await authorise(ctx, proof.body, { pin: '0000' });
      codes.push(declined.status);
      assert.equal(declined.body.balanceAfter ?? 40000, 40000);
      assertNoPan(declined.body);
    }
    assert.deepEqual(codes, [401, 401, 423]);

    const blocked = await cryptogram(ctx, 'CARD001', 500, 'ZMW');
    assert.equal(blocked.status, 423);
    assert.equal(blocked.body.code, 'PIN_LOCKED');

    const wallets = await api(ctx.live.base, '/api/wallets', { token: ctx.token });
    assert.equal(card(wallets.body, 'CARD001').locked, true);
    assert.equal(card(wallets.body, 'CARD001').balance, 40000);
    const audit = await api(ctx.live.base, '/api/audit', { token: ctx.token });
    const spoken = audit.body
      .map((row) => `${row.event} ${row.result} ${row.code}`)
      .join(' ');
    assert.equal(spoken.includes('0000'), false);
    assert.equal(spoken.includes('2580'), false);
    assertNoPan(audit.body);
  });

  test('the correct PIN approves a tap over the contactless limit', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const missing = await cryptogram(ctx, 'CARD002', 100, 'USD');
    const needsPin = await authorise(ctx, missing.body);
    assert.equal(needsPin.status, 403);
    assert.equal(needsPin.body.code, 'PIN_REQUIRED');

    const proof = await cryptogram(ctx, 'CARD002', 100, 'USD');
    const approved = await authorise(ctx, proof.body, { pin: '1492' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.balanceAfter, 2400);
    assert.equal(approved.body.trace.find((step) => step.id === 'cvm').result, 'passed');
    assert.equal(JSON.stringify(approved.body).includes('1492'), false);
  });

  test('the per-tap ceiling declines even with the right PIN', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const proof = await cryptogram(ctx, 'CARD001', 10000, 'ZMW');
    const declined = await authorise(ctx, proof.body, { pin: '2580' });
    assert.equal(declined.status, 400);
    assert.equal(declined.body.code, 'RISK_DECLINE');
    assert.equal(declined.body.trace.find((step) => step.id === 'risk').result, 'failed');
    const wallets = await api(ctx.live.base, '/api/wallets', { token: ctx.token });
    assert.equal(card(wallets.body, 'CARD001').balance, 40000);
  });

  test('spending more than the balance declines without changing it', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const proof = await cryptogram(ctx, 'CARD001', 50000, 'ZMW');
    const declined = await authorise(ctx, proof.body);
    assert.equal(declined.status, 400);
    assert.equal(declined.body.code, 'INSUFFICIENT_FUNDS');
    assert.equal(declined.body.balanceAfter, 40000);
    assert.equal(declined.body.trace.find((step) => step.id === 'balance').result, 'failed');
  });

  test('the rate limit rejects an extra call', async (t) => {
    const live = await listen(testApp({ rateLimitMax: 3 }));
    t.after(() => live.close());
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await api(live.base, '/api/session', { method: 'POST', body: {} }));
    }
    assert.deepEqual(results.map((result) => result.status), [200, 200, 200, 429]);
    assert.equal(results[3].body.code, 'RATE_LIMIT');
  });

  test('routes without a terminal pass are refused', async (t) => {
    const live = await listen(testApp());
    t.after(() => live.close());
    const wallets = await api(live.base, '/api/wallets');
    assert.equal(wallets.status, 401);
    assert.equal(wallets.body.code, 'SESSION_REQUIRED');
    const model = await api(live.base, '/api/security-model');
    assert.equal(model.status, 200);
    assert.equal(model.body.activeMac, 'hmac-sha256');
    assert.equal(model.body.kem[0].status, 'slot');
    assert.equal(model.body.signature[0].id, 'ML-DSA-65');
    assertNoPan(model.body);
  });
});
