const ORDER = [
  ['terminal_session', 'Terminal session'],
  ['token', 'Token'],
  ['cryptogram', 'Cryptogram'],
  ['replay', 'Replay check'],
  ['risk', 'Risk score'],
  ['cvm', 'Cardholder check'],
  ['balance', 'Balance'],
];

function completeTrace(steps) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  return ORDER.map(([id, label]) => {
    if (byId.has(id)) return byId.get(id);
    return { id, label, result: 'skipped', detail: 'Not run.' };
  });
}

module.exports = { ORDER, completeTrace };
