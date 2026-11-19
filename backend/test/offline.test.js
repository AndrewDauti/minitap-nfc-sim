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
  MERCHANT_SEEDS,
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

function saleFrom(token, amount, merchantRef = MERCHANT_REF) {
  const amountCents = Math.round(Number(amount) * 100);
  const fields = {
    tokenId: token.tokenId,
    counter: token.counter,
    amountCents,
    currency: token.currency,
    allowanceId: token.allowanceId,
    merchantRef,
  };
  return {
    tokenId: token.tokenId,
    counter: token.counter,
    capCents: token.capCents,
    allowanceId: token.allowanceId,
    cardRef: token.cardRef,
    currency: token.currency,
    merchantRef,
    signature: token.signature,
    amount,
    spendMac: spendMacFor(token.spendKey, fields),
  };
}

function shopSeed(ref) {
  return MERCHANT_SEEDS.find((shop) => shop.ref === ref);
}

function balanceOf(merchants, ref) {
  const row = (merchants || []).find((shop) => shop.ref === ref);
  assert.ok(row, `missing merchant ${ref}`);
  return row.balance;
}

async function tillSession(base, ref) {
  const shop = shopSeed(ref);
  const session = await api(base, '/api/session', {
    method: 'POST',
    body: { merchantRef: ref, terminalCode: shop.terminalCode },
  });
  assert.equal(session.status, 200);
  assert.equal(session.body.merchant.ref, ref);
  assert.equal(JSON.stringify(session.body).includes(shop.terminalCode), false);
  return session.body.token;
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
    assert.match(model.body.offline.model, /shop/);
    assert.equal(model.body.offline.merchants.length, 3);
    assert.equal(model.body.offline.merchants[0].name, 'Mutale Store');
    assert.equal(JSON.stringify(model.body).includes('4417'), false);
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
    assert.match(client, /BWALYA/);
    assert.match(client, /TEMBO/);
  });

  test('each shop settles its own sales and keeps its own balance', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const opened = await openAllowance(ctx, 300);
    assert.equal(opened.status, 200);
    const pharmacyPass = await tillSession(ctx.live.base, 'BWALYA');
    const coachPass = await tillSession(ctx.live.base, 'TEMBO');
    const [mutaleToken, pharmacyToken, coachToken] = opened.body.tokens;

    const mutale = await sync(ctx, [saleFrom(mutaleToken, 25, 'MUTALE')]);
    assert.equal(mutale.status, 200);
    assert.equal(mutale.body.settled.length, 1);
    assert.equal(mutale.body.settled[0].merchantRef, 'MUTALE');
    assert.equal(mutale.body.trader.name, 'Mutale Store');
    assert.equal(mutale.body.trader.balance, 25);
    assert.equal(balanceOf(mutale.body.merchants, 'BWALYA'), 0);
    assert.equal(balanceOf(mutale.body.merchants, 'TEMBO'), 0);
    assert.match(mutale.body.sms[0].body, /Mutale Store/);

    const pharmacy = await api(ctx.live.base, '/api/offline/sync', {
      method: 'POST',
      token: pharmacyPass,
      body: { sales: [saleFrom(pharmacyToken, 40, 'BWALYA')] },
    });
    assert.equal(pharmacy.status, 200);
    assert.equal(pharmacy.body.settled.length, 1);
    assert.equal(pharmacy.body.trader.name, 'Bwalya Pharmacy');
    assert.equal(pharmacy.body.trader.balance, 40);
    assert.equal(balanceOf(pharmacy.body.merchants, 'MUTALE'), 25);
    assert.equal(balanceOf(pharmacy.body.merchants, 'TEMBO'), 0);
    assert.match(pharmacy.body.sms[0].body, /Bwalya Pharmacy/);

    const coach = await api(ctx.live.base, '/api/offline/sync', {
      method: 'POST',
      token: coachPass,
      body: { sales: [saleFrom(coachToken, 15, 'TEMBO')] },
    });
    assert.equal(coach.status, 200);
    assert.equal(coach.body.settled[0].merchantName, 'Tembo Coach');
    assert.equal(balanceOf(coach.body.merchants, 'MUTALE'), 25);
    assert.equal(balanceOf(coach.body.merchants, 'BWALYA'), 40);
    assert.equal(balanceOf(coach.body.merchants, 'TEMBO'), 15);
    assert.equal(coach.body.customer.balance, 39920);
    assert.equal(coach.body.allowance.remaining, 220);
    assertNoPan(coach.body);

    const refused = await api(ctx.live.base, '/api/session', {
      method: 'POST',
      body: { merchantRef: 'BWALYA', terminalCode: '0000' },
    });
    assert.equal(refused.status, 401);
    assert.equal(refused.body.code, 'TILL_PASS');
    const missing = await api(ctx.live.base, '/api/session', {
      method: 'POST',
      body: { merchantRef: 'TEMBO' },
    });
    assert.equal(missing.status, 401);
    assert.equal(missing.body.code, 'TILL_PASS');
  });

  test('a sale captured at one shop cannot be replayed or redirected to another', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const opened = await openAllowance(ctx, 300);
    const pharmacyPass = await tillSession(ctx.live.base, 'BWALYA');
    const captured = saleFrom(opened.body.tokens[0], 25, 'MUTALE');
    const settled = await sync(ctx, [captured]);
    assert.equal(settled.body.settled.length, 1);
    assert.equal(settled.body.trader.balance, 25);

    const redirected = { ...captured, merchantRef: 'BWALYA' };
    const wrongShop = await api(ctx.live.base, '/api/offline/sync', {
      method: 'POST',
      token: pharmacyPass,
      body: { sales: [redirected] },
    });
    assert.equal(wrongShop.status, 200);
    assert.equal(wrongShop.body.settled.length, 0);
    assert.equal(wrongShop.body.blocked.length, 1);
    assert.equal(wrongShop.body.blocked[0].code, 'MERCHANT_MISMATCH');
    assert.match(wrongShop.body.blocked[0].reason, /Mutale Store/);
    assert.equal(wrongShop.body.trader.balance, 0);
    assert.equal(balanceOf(wrongShop.body.merchants, 'MUTALE'), 25);
    assert.equal(balanceOf(wrongShop.body.merchants, 'BWALYA'), 0);
    assert.equal(wrongShop.body.customer.balance, 39975);
    assert.match(wrongShop.body.sms[0].body, /wrong shop/);

    const replayed = saleFrom(opened.body.tokens[0], 25, 'BWALYA');
    const replay = await api(ctx.live.base, '/api/offline/sync', {
      method: 'POST',
      token: pharmacyPass,
      body: { sales: [replayed] },
    });
    assert.equal(replay.body.settled.length, 0);
    assert.equal(replay.body.blocked[0].code, 'REPLAY');
    assert.equal(balanceOf(replay.body.merchants, 'MUTALE'), 25);
    assert.equal(balanceOf(replay.body.merchants, 'BWALYA'), 0);
    assert.equal(replay.body.customer.balance, 39975);

    const waiting = saleFrom(opened.body.tokens[1], 10, 'MUTALE');
    const claimed = await api(ctx.live.base, '/api/offline/sync', {
      method: 'POST',
      token: pharmacyPass,
      body: { sales: [waiting] },
    });
    assert.equal(claimed.body.blocked[0].code, 'MERCHANT_MISMATCH');
    assert.equal(balanceOf(claimed.body.merchants, 'MUTALE'), 25);
    assert.equal(balanceOf(claimed.body.merchants, 'BWALYA'), 0);

    const follow = await sync(ctx, [waiting]);
    assert.equal(follow.body.settled.length, 1);
    assert.equal(balanceOf(follow.body.merchants, 'MUTALE'), 35);
    assert.equal(balanceOf(follow.body.merchants, 'BWALYA'), 0);
    assert.equal(follow.body.customer.balance, 39965);
    assertNoPan(follow.body);
  });

  test('an online kwacha tap credits the shop on the till pass', async (t) => {
    const ctx = await boot();
    t.after(() => ctx.live.close());
    const pharmacyPass = await tillSession(ctx.live.base, 'BWALYA');
    const kwacha = card(ctx.wallets, 'CARD001');
    const dollar = card(ctx.wallets, 'CARD002');

    async function tap(token, row, amount, currency) {
      const proof = await api(ctx.live.base, '/api/tap/cryptogram', {
        method: 'POST',
        token: ctx.token,
        body: { token: row.token, amount, currency },
      });
      assert.equal(proof.status, 200);
      return api(ctx.live.base, '/api/tap', {
        method: 'POST',
        token,
        body: {
          token: proof.body.token,
          amount: proof.body.amount,
          currency: proof.body.currency,
          atc: proof.body.atc,
          nonce: proof.body.nonce,
          cryptogram: proof.body.cryptogram,
        },
      });
    }

    const mutaleTap = await tap(ctx.token, kwacha, 10, 'ZMW');
    assert.equal(mutaleTap.status, 200);
    assert.equal(mutaleTap.body.merchant.ref, 'MUTALE');
    assert.equal(mutaleTap.body.merchant.balance, 10);
    assert.equal(mutaleTap.body.balanceAfter, 39990);

    const pharmacyTap = await tap(pharmacyPass, kwacha, 20, 'ZMW');
    assert.equal(pharmacyTap.status, 200);
    assert.equal(pharmacyTap.body.merchant.ref, 'BWALYA');
    assert.equal(pharmacyTap.body.merchant.balance, 20);

    const dollarTap = await tap(ctx.token, dollar, 5, 'USD');
    assert.equal(dollarTap.status, 200);
    assert.equal(dollarTap.body.merchant, undefined);
    assert.equal(dollarTap.body.balanceAfter, 2495);

    const status = await api(ctx.live.base, '/api/offline/status', { token: ctx.token });
    assert.equal(balanceOf(status.body.merchants, 'MUTALE'), 10);
    assert.equal(balanceOf(status.body.merchants, 'BWALYA'), 20);
    assert.equal(balanceOf(status.body.merchants, 'TEMBO'), 0);
    assert.equal(JSON.stringify(status.body).includes(shopSeed('BWALYA').terminalCode), false);
    assertNoPan(status.body);
  });
});
