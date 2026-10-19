function createAudit() {
  const events = [];

  function add(event) {
    const row = {
      id: events.length + 1,
      timestamp: new Date().toISOString(),
      event: event.event,
      code: event.code || null,
      cardRef: event.cardRef || null,
      tokenTail: event.tokenTail || null,
      maskedPan: event.maskedPan || null,
      amount: event.amount ?? null,
      currency: event.currency || null,
      atc: event.atc ?? null,
      riskScore: event.riskScore ?? null,
      result: event.result,
    };
    events.push(row);
    return row;
  }

  return { add, list: () => events.map((row) => ({ ...row })) };
}

module.exports = { createAudit };
