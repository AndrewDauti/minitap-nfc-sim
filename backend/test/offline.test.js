const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../server');
const { CARD_SEEDS } = require('../security/policy');
const {
  canonicalToken,
  canonicalSpend,
  spendMacFor,
  MERCHANT_REF,
  SPKI_PREFIX,
} = require('../security/offline');

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

async function boot() {
  const live = await listen(testApp());
  const session = await api(live.base, '/api/session', { method: 'POST', body: {} });
  assert.equal(session.status, 200);
  const wallets = await api(live.base, '/api/wallets', { token: session.body.token });
  assert.equal(wallets.status, 200);
  return { live, token: session.body.token, wallets: wallets.body };
}

function card(wallets, ref) {
  return wallets.find((row) => row.cardRef === ref);
}

function assertNoPan(value) {
  const text = JSON.stringify(value);
  for (const seed of CARD_SEEDS) {
    assert.equal(text.includes(seed.pan), false, `response contained PAN for ${seed.ref}`);
  }
  assert.doesNotMatch(text, /\$2[aby]\$/);
  assert.equal(text.includes(KEY1), false);
}

function saleFrom(token, amount) {
  const amountCents = Math.round(Number(amount) * 100);
  const fields = {
    tokenId: token.tokenId,
    counter: token.counter,
    amountCents,
    currency: token.currency,
    allowanceId: token.allowanceId,
    merchantRef: MERCHANT_REF,
  };
  return {
    tokenId: token.tokenId,
    counter: token.counter,
    capCents: token.capCents,
    allowanceId: token.allowanceId,
    cardRef: token.cardRef,
    currency: token.currency,
    merchantRef: MERCHANT_REF,
    signature: token.signature,
    amount,
    spendMac: spendMacFor(token.spendKey, fields),
  };
}

async function openAllowance(ctx, amount = 300) {
  const row = card(ctx.wallets, 'CARD001');
  const opened = await api(ctx.live.base, '/api/offline/allowance', {
    method: 'POST',
    token: ctx.token,
    body: { token: row.token, amount },
  });
  return opened;
}

async function sync(ctx, sales) {
  return api(ctx.live.base, '/api/offline/sync', {
    method: 'POST',
    token: ctx.token,
    body: { sales },
  });
}

describe('offline allowance', { concurrency: 1 }, () => {
  test('an online allowance locks spendable funds and returns signed single-use tokens', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const opened = await openAllowance(ctx, 300);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.code, 'ALLOWANCE_READY');
    assert.equal(opened.body.amount, 300);
    assert.equal(opened.body.remaining, 300);
    assert.equal(opened.body.balance, 40000);
    assert.equal(opened.body.spendable, 39700);
    assert.equal(opened.body.batchSize, 8);
    assert.equal(opened.body.tokens.length, 8);
    const counters = opened.body.tokens.map((token) => token.counter);
    assert.deepEqual(counters, [1, 2, 3, 4, 5, 6, 7, 8]);
    opened.body.tokens.forEach((token) => {
      assert.equal(token.cap, 300);
      assert.match(token.signature, /^[a-f0-9]{128}$/);
      assert.match(token.spendKey, /^[a-f0-9]{64}$/);
    });

    const raw = Buffer.from(opened.body.issuerPublicKey, 'hex');
    assert.equal(raw.length, 32);
    const pub = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    const token = opened.body.tokens[0];
    const message = canonicalToken({
      tokenId: token.tokenId,
      counter: token.counter,
      capCents: token.capCents,
      allowanceId: token.allowanceId,
      cardRef: token.cardRef,
      currency: token.currency,
    });
    assert.equal(
      crypto.verify(null, Buffer.from(message), pub, Buffer.from(token.signature, 'hex')),
      true
    );
    assertNoPan(opened.body);

    const wallets = await api(ctx.live.base, '/api/wallets', { token: ctx.token });
    assert.equal(card(wallets.body, 'CARD001').balance, 40000);
    assert.equal(card(wallets.body, 'CARD001').spendable, 39700);
    assert.equal(card(wallets.body, 'CARD002').balance, 2500);
  });

  test('a second sale past the allowance is blocked and only the first settles', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const opened = await openAllowance(ctx, 300);
    assert.equal(opened.status, 200);
    const [firstToken, secondToken] = opened.body.tokens;
    const synced = await sync(ctx, [
      saleFrom(firstToken, 200),
      saleFrom(secondToken, 200),
    ]);
    assert.equal(synced.status, 200);
    assert.equal(synced.body.settled.length, 1);
    assert.equal(synced.body.settled[0].amount, 200);
    assert.equal(synced.body.settled[0].status, 'settled');
    assert.equal(typeof synced.body.settled[0].riskScore, 'number');
    assert.equal(synced.body.blocked.length, 1);
    assert.equal(synced.body.blocked[0].code, 'ALLOWANCE_EXCEEDED');
    assert.equal(synced.body.blocked[0].status, 'blocked');
    assert.equal(synced.body.trader.balance, 200);
    assert.equal(synced.body.customer.balance, 39800);
    assert.equal(synced.body.customer.spendable, 39700);
    assert.equal(synced.body.allowance.remaining, 100);
    const text = JSON.stringify(synced.body);
    assert.equal(text.includes(firstToken.spendKey), false);
    assert.equal(text.includes(secondToken.spendKey), false);
    assertNoPan(synced.body);

    const wallets = await api(ctx.live.base, '/api/wallets', { token: ctx.token });
    assert.equal(card(wallets.body, 'CARD001').balance, 39800);
    assert.equal(card(wallets.body, 'CARD001').spendable, 39700);
  });

  test('a token replayed on a later sync is rejected and does not settle twice', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const opened = await openAllowance(ctx, 300);
    const sale = saleFrom(opened.body.tokens[0], 25);
    const first = await sync(ctx, [sale]);
    assert.equal(first.status, 200);
    assert.equal(first.body.settled.length, 1);
    assert.equal(first.body.trader.balance, 25);
    assert.equal(first.body.customer.balance, 39975);

    const second = await sync(ctx, [sale]);
    assert.equal(second.status, 200);
    assert.equal(second.body.settled.length, 0);
    assert.equal(second.body.blocked.length, 1);
    assert.equal(second.body.blocked[0].code, 'REPLAY');
    assert.match(second.body.blocked[0].reason, /replayed/i);
    assert.equal(second.body.trader.balance, 25);
    assert.equal(second.body.customer.balance, 39975);
    assert.equal(second.body.allowance.remaining, 275);
    assert.equal(second.body.sms[0].body.includes('replayed'), true);
    assertNoPan(second.body);
  });

  test('a tampered amount is rejected and does not move money', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const opened = await openAllowance(ctx, 300);
    const sale = saleFrom(opened.body.tokens[0], 25);
    const tampered = { ...sale, amount: 75 };
    const synced = await sync(ctx, [tampered]);
    assert.equal(synced.status, 200);
    assert.equal(synced.body.settled.length, 0);
    assert.equal(synced.body.blocked[0].code, 'TAMPERED_AMOUNT');
    assert.equal(synced.body.trader.balance, 0);
    assert.equal(synced.body.customer.balance, 40000);
    assert.equal(synced.body.allowance.remaining, 300);
    assertNoPan(synced.body);

    const honest = saleFrom(opened.body.tokens[1], 25);
    const follow = await sync(ctx, [honest]);
    assert.equal(follow.body.settled.length, 1);
    assert.equal(follow.body.trader.balance, 25);
  });

  test('a counter rollback is rejected after a higher counter has settled', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const opened = await openAllowance(ctx, 300);
    const higher = saleFrom(opened.body.tokens[2], 10);
    const lower = saleFrom(opened.body.tokens[0], 10);
    assert.equal(higher.counter, 3);
    assert.equal(lower.counter, 1);
    assert.notEqual(canonicalSpend({
      tokenId: higher.tokenId,
      counter: higher.counter,
      amountCents: 1000,
      currency: 'ZMW',
      allowanceId: higher.allowanceId,
      merchantRef: MERCHANT_REF,
    }).includes('MINITAP-OFFLINE-SPEND-v1'), false);

    const first = await sync(ctx, [higher]);
    assert.equal(first.body.settled.length, 1);
    assert.equal(first.body.allowance.lastSettledCounter, 3);
    assert.equal(first.body.trader.balance, 10);

    const second = await sync(ctx, [lower]);
    assert.equal(second.body.settled.length, 0);
    assert.equal(second.body.blocked[0].code, 'COUNTER_ROLLBACK');
    assert.equal(second.body.trader.balance, 10);
    assert.equal(second.body.customer.balance, 39990);
    assert.equal(second.body.allowance.remaining, 290);
    assertNoPan(second.body);
  });

  test('online taps cannot spend the locked allowance', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const opened = await openAllowance(ctx, 300);
    assert.equal(opened.status, 200);
    const row = card(ctx.wallets, 'CARD001');
    const proof = await api(ctx.live.base, '/api/tap/cryptogram', {
      method: 'POST',
      token: ctx.token,
      body: { token: row.token, amount: 39800, currency: 'ZMW' },
    });
    assert.equal(proof.status, 200);
    const declined = await api(ctx.live.base, '/api/tap', {
      method: 'POST',
      token: ctx.token,
      body: {
        token: proof.body.token,
        amount: proof.body.amount,
        currency: proof.body.currency,
        atc: proof.body.atc,
        nonce: proof.body.nonce,
        cryptogram: proof.body.cryptogram,
      },
    });
    assert.equal(declined.status, 400);
    assert.equal(declined.body.code, 'INSUFFICIENT_FUNDS');
    assert.equal(declined.body.balanceAfter, 40000);

    const wallets = await api(ctx.live.base, '/api/wallets', { token: ctx.token });
    assert.equal(card(wallets.body, 'CARD001').balance, 40000);
    assert.equal(card(wallets.body, 'CARD001').spendable, 39700);
  });

  test('offline routes need a terminal pass, and the till copy shares the token format', async (t) => {
    const live = await listen(testApp());
    t.after(() => live.close());
    const status = await api(live.base, '/api/offline/status');
    assert.equal(status.status, 401);
    assert.equal(status.body.code, 'SESSION_REQUIRED');

    const session = await api(live.base, '/api/session', { method: 'POST', body: {} });
    const model = await api(live.base, '/api/security-model');
    assert.equal(model.status, 200);
    assert.match(model.body.offline.model, /Ed25519/);
    assert.equal(model.body.offline.taxExample.rate, 0.05);
    assert.match(model.body.offline.taxExample.note, /Not an official/);

    const ready = await api(live.base, '/api/offline/status', { token: session.body.token });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.allowance, null);
    assert.equal(ready.body.trader.balance, 0);
    assert.equal(ready.body.merchant.name, 'Mutale Store');
    assertNoPan(ready.body);

    const client = fs.readFileSync(
      path.join(__dirname, '../../frontend/src/demo/offlineCrypto.js'),
      'utf8'
    );
    assert.match(client, /MINITAP-OFFLINE-TOKEN-v1/);
    assert.match(client, /MINITAP-OFFLINE-SPEND-v1/);
    assert.match(client, /MUTALE/);
  });
});
