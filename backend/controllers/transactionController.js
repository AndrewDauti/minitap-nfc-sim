const mockData = require('../utils/mockData');

let transactions = [];

exports.handleTap = (req, res) => {
  const { cardId } = req.body;

  const wallet = mockData.wallets.find(w => w.cardId === cardId);
  if (!wallet) return res.status(404).json({ message: 'Wallet not found' });

  const transaction = {
    id: transactions.length + 1,
    amount: Math.floor(Math.random() * 100), // Simulated amount
    timestamp: new Date(),
    cardId,
  };

  transactions.push(transaction);
  return res.status(200).json({ message: 'Tap recorded', transaction });
};

exports.getTransactions = (req, res) => {
  res.status(200).json(transactions);
};
