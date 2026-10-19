const bcrypt = require('bcryptjs');

function hashPin(pin, rounds) {
  return bcrypt.hashSync(pin, rounds);
}

function pinMatches(pin, pinHash) {
  // DUKPT slot: a hardware PIN pad would encrypt these digits under a
  // one-time derived key, and an HSM would translate them. This classroom
  // model has no pad. The compare is online bcrypt. Callers must not log
  // `pin`, and only `pinHash` is kept on the card.
  return bcrypt.compareSync(pin, pinHash);
}

module.exports = { hashPin, pinMatches };
