const { wallets, transactions } = require('../utils/mockData');

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function record(fields) {
  const tx = {
    id: transactions.length + 1,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  transactions.push(tx);
  return tx;
}

exports.handleTap = (req, res) => {
  const { cardId, amount } = req.body;

  if (!cardId || amount === undefined || amount === null || amount === '') {
    return res.status(400).json({ error: 'Card ID and amount are required' });
  }

  const wallet = wallets[cardId];
  if (!wallet) {
    return res.status(404).json({ error: 'Card not registered' });
  }

  const amt = roundMoney(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  const currency = wallet.currency || 'ZMW';

  if (wallet.balance < amt) {
    const tx = record({
      cardId,
      amount: amt,
      currency,
      balanceAfter: roundMoney(wallet.balance),
      status: 'declined',
      reason: 'Insufficient balance',
    });
    return res.status(400).json({
      error: 'Insufficient balance',
      ...tx,
    });
  }

  wallet.balance = roundMoney(wallet.balance - amt);

  const tx = record({
    cardId,
    amount: amt,
    currency,
    balanceAfter: wallet.balance,
    status: 'approved',
  });

  return res.json({
    message: 'Tap successful',
    ...tx,
  });
};

exports.getTransactions = (req, res) => {
  return res.json(transactions);
};
