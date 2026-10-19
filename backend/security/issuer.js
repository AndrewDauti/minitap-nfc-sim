const { fromCents, VELOCITY_WINDOW_MS, PIN_MAX_ATTEMPTS } = require('./policy');
const { canonicalTap, verifyMac } = require('./cryptoAgility');
const { pinMatches } = require('./pin');
const { assessRisk, noteRecent } = require('./risk');
const { completeTrace } = require('./trace');

function createIssuer({ vault, replay, macSuite }) {
  function authorise({ token, amountCents, currency, atc, nonce, cryptogram, pin }) {
    const steps = [
      {
        id: 'terminal_session',
        label: 'Terminal session',
        result: 'passed',
        detail: 'Signed terminal pass is valid.',
      },
    ];

    const card = vault.findByToken(token);
    if (!card) {
      steps.push({
        id: 'token',
        label: 'Token',
        result: 'failed',
        detail: 'This token does not match a card.',
      });
      return finish({
        status: 404,
        code: 'UNKNOWN_TOKEN',
        error: 'Card not registered',
        steps,
        card: null,
        amountCents,
        currency,
        atc,
        record: false,
        auditEvent: 'tap.declined',
        result: 'declined',
      });
    }

    const tail = vault.tokenTail(card.token);
    steps.push({
      id: 'token',
      label: 'Token',
      result: 'passed',
      detail: `Token …${tail} stood in for ${card.maskedPan}.`,
    });

    if (currency !== card.currency) {
      return finish({
        status: 400,
        code: 'CURRENCY_MISMATCH',
        error: 'Currency does not match this card',
        steps,
        card,
        amountCents,
        currency,
        atc,
        record: true,
        auditEvent: 'tap.declined',
        result: 'declined',
      });
    }

    if (card.locked) {
      steps.push({
        id: 'cvm',
        label: 'Cardholder check',
        result: 'failed',
        detail: 'The card is locked after repeated PIN failures.',
      });
      return finish({
        status: 423,
        code: 'PIN_LOCKED',
        error: 'Card locked after repeated PIN failures.',
        steps,
        card,
        amountCents,
        currency,
        atc,
        record: true,
        auditEvent: 'pin.locked',
        result: 'declined',
      });
    }

    const message = canonicalTap({ token: card.token, amountCents, currency, atc, nonce });
    const macOk = verifyMac(macSuite, card.key, message, cryptogram);
    if (!macOk) {
      steps.push({
        id: 'cryptogram',
        label: 'Cryptogram',
        result: 'failed',
        detail: `${suiteLabel(macSuite)} did not match this amount, currency, ATC, and nonce.`,
      });
      return finish({
        status: 400,
        code: 'CRYPTOGRAM_MISMATCH',
        error: 'Cryptogram does not match this amount. The tap was changed after the chip signed it.',
        steps,
        card,
        amountCents,
        currency,
        atc,
        record: true,
        auditEvent: 'tap.declined',
        result: 'declined',
      });
    }

    steps.push({
      id: 'cryptogram',
      label: 'Cryptogram',
      result: 'passed',
      detail: `${suiteLabel(macSuite)} matched the amount, currency, ATC ${atc}, and the terminal nonce.`,
    });

    const replayResult = replay.consume({
      cardRef: card.ref,
      token: card.token,
      atc,
      nonce,
      amountCents,
      currency,
    });
    if (!replayResult.ok) {
      steps.push({
        id: 'replay',
        label: 'Replay check',
        result: 'failed',
        detail: 'This ATC or terminal nonce was already presented.',
      });
      return finish({
        status: 409,
        code: 'REPLAY',
        error: 'Replay rejected. This tap code was already used.',
        steps,
        card,
        amountCents,
        currency,
        atc,
        record: true,
        auditEvent: 'tap.replay',
        result: 'declined',
      });
    }

    steps.push({
      id: 'replay',
      label: 'Replay check',
      result: 'passed',
      detail: `ATC ${atc} and this terminal nonce have not been used.`,
    });

    const recentCount = noteRecent(card, Date.now(), VELOCITY_WINDOW_MS);
    const risk = assessRisk({
      amountCents,
      balanceCents: card.balanceCents,
      limitCents: card.contactlessLimitCents,
      ceilingCents: card.ceilingCents,
      recentCount,
    });
    const riskDetail = risk.reasons.length
      ? `Score ${risk.score}. ${risk.reasons.join('. ')}.`
      : `Score ${risk.score}. Nothing unusual.`;

    if (risk.overBalance) {
      steps.push({
        id: 'risk',
        label: 'Risk score',
        result: 'passed',
        detail: `${riskDetail} The balance check decides this tap.`,
      });
      steps.push({
        id: 'balance',
        label: 'Balance',
        result: 'failed',
        detail: 'The amount is above the available balance.',
      });
      return finish({
        status: 400,
        code: 'INSUFFICIENT_FUNDS',
        error: 'Insufficient balance',
        steps,
        card,
        amountCents,
        currency,
        atc,
        riskScore: risk.score,
        record: true,
        auditEvent: 'tap.declined',
        result: 'declined',
      });
    }

    if (risk.decision === 'decline') {
      steps.push({
        id: 'risk',
        label: 'Risk score',
        result: 'failed',
        detail: riskDetail,
      });
      return finish({
        status: 400,
        code: 'RISK_DECLINE',
        error: 'Declined by the classroom risk check. This amount is over the per-tap ceiling.',
        steps,
        card,
        amountCents,
        currency,
        atc,
        riskScore: risk.score,
        record: true,
        auditEvent: 'tap.declined',
        result: 'declined',
      });
    }

    steps.push({
      id: 'risk',
      label: 'Risk score',
      result: risk.decision === 'step_up' ? 'step_up' : 'passed',
      detail: risk.decision === 'step_up' ? `${riskDetail} A PIN is required.` : riskDetail,
    });

    if (risk.decision === 'step_up') {
      if (!pin) {
        steps.push({
          id: 'cvm',
          label: 'Cardholder check',
          result: 'step_up',
          detail: 'A PIN is required for this tap.',
        });
        return finish({
          status: 403,
          code: 'PIN_REQUIRED',
          error: 'Enter the PIN for this card and tap again.',
          steps,
          card,
          amountCents,
          currency,
          atc,
          riskScore: risk.score,
          record: false,
          auditEvent: 'tap.step_up',
          result: 'step_up',
        });
      }
      const matches = pinMatches(pin, card.pinHash);
      if (!matches) {
        card.pinFailures += 1;
        const locked = card.pinFailures >= PIN_MAX_ATTEMPTS;
        if (locked) card.locked = true;
        const remaining = Math.max(0, PIN_MAX_ATTEMPTS - card.pinFailures);
        steps.push({
          id: 'cvm',
          label: 'Cardholder check',
          result: 'failed',
          detail: locked
            ? 'PIN did not match. The card is now locked.'
            : 'PIN did not match the stored hash.',
        });
        return finish({
          status: locked ? 423 : 401,
          code: locked ? 'PIN_LOCKED' : 'PIN_INCORRECT',
          error: locked
            ? 'Card locked after repeated PIN failures.'
            : `Wrong PIN. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left.`,
          steps,
          card,
          amountCents,
          currency,
          atc,
          riskScore: risk.score,
          record: true,
          auditEvent: locked ? 'pin.locked' : 'pin.failed',
          result: 'declined',
        });
      }
      card.pinFailures = 0;
      steps.push({
        id: 'cvm',
        label: 'Cardholder check',
        result: 'passed',
        detail: 'PIN matched the stored hash.',
      });
    } else {
      steps.push({
        id: 'cvm',
        label: 'Cardholder check',
        result: 'passed',
        detail: 'Under the contactless limit, so no PIN was required.',
      });
    }

    if (card.balanceCents < amountCents) {
      steps.push({
        id: 'balance',
        label: 'Balance',
        result: 'failed',
        detail: 'The amount is above the available balance.',
      });
      return finish({
        status: 400,
        code: 'INSUFFICIENT_FUNDS',
        error: 'Insufficient balance',
        steps,
        card,
        amountCents,
        currency,
        atc,
        riskScore: risk.score,
        record: true,
        auditEvent: 'tap.declined',
        result: 'declined',
      });
    }

    card.balanceCents -= amountCents;
    steps.push({
      id: 'balance',
      label: 'Balance',
      result: 'passed',
      detail: 'Funds available.',
    });

    return finish({
      status: 200,
      code: 'APPROVED',
      message: 'Tap successful',
      steps,
      card,
      amountCents,
      currency,
      atc,
      riskScore: risk.score,
      record: true,
      auditEvent: 'tap.approved',
      result: 'approved',
    });
  }

  return { authorise };
}

function suiteLabel(suite) {
  return suite === 'aes-cmac' ? 'AES-CMAC' : 'HMAC-SHA256';
}

function finish(outcome) {
  const amount = fromCents(outcome.amountCents);
  const balanceAfter = outcome.card ? fromCents(outcome.card.balanceCents) : null;
  const trace = completeTrace(outcome.steps);
  const riskScore = outcome.riskScore ?? null;
  const statusName = outcome.result === 'approved' ? 'approved' : 'declined';
  const record = outcome.record && outcome.card
    ? {
        cardRef: outcome.card.ref,
        tokenTail: outcome.card.token.slice(-4),
        maskedPan: outcome.card.maskedPan,
        last4: outcome.card.last4,
        amount,
        currency: outcome.currency,
        balanceAfter,
        status: outcome.result === 'approved' ? 'approved' : 'declined',
        reason: outcome.result === 'approved' ? null : outcome.error,
        code: outcome.code,
        riskScore,
        trace,
      }
    : null;

  const body = {
    ...(outcome.message ? { message: outcome.message } : { error: outcome.error }),
    code: outcome.code,
    status: outcome.result === 'step_up' ? 'step_up' : statusName,
    amount,
    currency: outcome.currency,
    riskScore,
    trace,
  };
  if (record) {
    body.cardRef = record.cardRef;
    body.tokenTail = record.tokenTail;
    body.maskedPan = record.maskedPan;
    body.last4 = record.last4;
    body.balanceAfter = record.balanceAfter;
    body.reason = record.reason;
  }

  return {
    status: outcome.status,
    body,
    record,
    audit: {
      event: outcome.auditEvent,
      code: outcome.code,
      cardRef: outcome.card ? outcome.card.ref : null,
      tokenTail: outcome.card ? outcome.card.token.slice(-4) : null,
      maskedPan: outcome.card ? outcome.card.maskedPan : null,
      amount,
      currency: outcome.currency,
      atc: outcome.atc ?? null,
      riskScore,
      result: outcome.result,
    },
  };
}

module.exports = { createIssuer };
