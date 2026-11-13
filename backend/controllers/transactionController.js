const { fromCents, publicPolicy } = require('../security/policy');
const { describeAgility } = require('../security/cryptoAgility');
const { parseCryptogramBody, parseAuthoriseBody } = require('../security/validate');
const { completeTrace } = require('../security/trace');
const { sendPublic } = require('../security/redact');
const { parseAllowanceBody, parseSyncBody, describeOffline } = require('../security/offline');

function createController({ vault, sessions, chip, issuer, audit, offline, macSuite }) {
  const transactions = [];

  function requireSession(req, res, next) {
    const session = sessions.fromRequest(req);
    if (!session) {
      return sendPublic(res, 401, {
        error: 'Terminal session required',
        code: 'SESSION_REQUIRED',
        trace: completeTrace([
          {
            id: 'terminal_session',
            label: 'Terminal session',
            result: 'failed',
            detail: 'Missing or expired pass.',
          },
        ]),
      });
    }
    req.terminalSession = session;
    return next();
  }

  function handleSession(req, res) {
    const issued = sessions.issue();
    audit.add({ event: 'session.issued', result: 'issued' });
    return sendPublic(res, 200, issued);
  }

  function getModel(req, res) {
    return sendPublic(res, 200, {
      ...describeAgility(macSuite),
      ...publicPolicy(),
      ...describeOffline(),
    });
  }

  function getWallets(req, res) {
    return sendPublic(res, 200, vault.listPublic());
  }

  function getTransactions(req, res) {
    return sendPublic(res, 200, transactions);
  }

  function getAudit(req, res) {
    return sendPublic(res, 200, audit.list());
  }

  function handleCryptogram(req, res) {
    const parsed = parseCryptogramBody(req.body);
    if (!parsed.ok) {
      return sendPublic(res, 400, { error: parsed.error, code: 'VALIDATION' });
    }
    const card = vault.findByToken(parsed.value.token);
    if (!card) {
      return sendPublic(res, 404, { error: 'Card not registered', code: 'UNKNOWN_TOKEN' });
    }
    if (parsed.value.currency !== card.currency) {
      return sendPublic(res, 400, {
        error: 'Currency does not match this card',
        code: 'CURRENCY_MISMATCH',
      });
    }
    if (card.locked) {
      audit.add({
        event: 'pin.locked',
        code: 'PIN_LOCKED',
        cardRef: card.ref,
        tokenTail: vault.tokenTail(card.token),
        maskedPan: card.maskedPan,
        amount: fromCents(parsed.value.amountCents),
        currency: card.currency,
        result: 'declined',
      });
      return sendPublic(res, 423, {
        error: 'Card locked after repeated PIN failures.',
        code: 'PIN_LOCKED',
      });
    }

    const issued = chip.issue(card, parsed.value);
    audit.add({
      event: 'cryptogram.issued',
      code: 'ISSUED',
      cardRef: card.ref,
      tokenTail: vault.tokenTail(card.token),
      maskedPan: card.maskedPan,
      amount: fromCents(issued.amountCents),
      currency: issued.currency,
      atc: issued.atc,
      result: 'issued',
    });
    return sendPublic(
      res,
      200,
      {
        token: issued.token,
        amount: fromCents(issued.amountCents),
        currency: issued.currency,
        atc: issued.atc,
        nonce: issued.nonce,
        cryptogram: issued.cryptogram,
        suite: issued.suite,
      },
      { allowKeys: ['cryptogram', 'nonce'] }
    );
  }

  function handleTap(req, res) {
    const parsed = parseAuthoriseBody(req.body);
    if (!parsed.ok) {
      return sendPublic(res, 400, { error: parsed.error, code: 'VALIDATION' });
    }
    const outcome = issuer.authorise(parsed.value);
    audit.add(outcome.audit);
    const body = { ...outcome.body };
    if (outcome.record) {
      const tx = {
        id: transactions.length + 1,
        timestamp: new Date().toISOString(),
        ...outcome.record,
      };
      transactions.push(tx);
      body.id = tx.id;
      body.timestamp = tx.timestamp;
    }
    return sendPublic(res, outcome.status, body);
  }

  function getOfflineStatus(req, res) {
    return sendPublic(res, 200, offline.statusBody('CARD001'));
  }

  function openOfflineAllowance(req, res) {
    const parsed = parseAllowanceBody(req.body);
    if (!parsed.ok) {
      return sendPublic(res, 400, { error: parsed.error, code: 'VALIDATION' });
    }
    const card = vault.findByToken(parsed.value.token);
    if (!card) {
      return sendPublic(res, 404, { error: 'Card not registered', code: 'UNKNOWN_TOKEN' });
    }
    const outcome = offline.openAllowance(card, parsed.value.amountCents);
    if (outcome.audit) audit.add(outcome.audit);
    return sendPublic(res, outcome.status, outcome.body);
  }

  function syncOffline(req, res) {
    const parsed = parseSyncBody(req.body);
    if (!parsed.ok) {
      return sendPublic(res, 400, { error: parsed.error, code: 'VALIDATION' });
    }
    const outcome = offline.settle(parsed.value);
    outcome.audits.forEach((entry) => audit.add(entry));
    return sendPublic(res, outcome.status, outcome.body);
  }

  return {
    requireSession,
    handleSession,
    getModel,
    getWallets,
    getTransactions,
    getAudit,
    handleCryptogram,
    handleTap,
    getOfflineStatus,
    openOfflineAllowance,
    syncOffline,
  };
}

module.exports = { createController };
