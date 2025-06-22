const { wallets, transactions } = require('../utils/mockData');

exports.handleTap = (req, res) => {
  const { cardId, amount } = req.body;

  if (!cardId || !amount) {
    return res.status(400).json({ error: 'Card ID and amount are required' });
  }

  const wallet = wallets[cardId];

  if (!wallet) {
    return res.status(404).json({ error: 'Card not registered' });
  }

  const amt = parseFloat(amount);

  if (wallet.balance < amt) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  wallet.balance -= amt;

  const tx = {
    id: transactions.length + 1,
    cardId,
    amount: amt,
    timestamp: new Date().toISOString(),
    balanceAfter: wallet.balance
  };

  transactions.push(tx);

  return res.json({
    message: 'Tap successful',
    ...tx
  });
};

exports.getTransactions = (req, res) => {
  return res.json(transactions);
};
