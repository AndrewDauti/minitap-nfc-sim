const express = require('express');
const router = express.Router();
const controller = require('../controllers/transactionController');

router.post('/tap', controller.handleTap);
router.get('/transactions', controller.getTransactions);
router.get('/wallets', (req, res) => {
  const { wallets } = require('../utils/mockData');
  const result = Object.entries(wallets).map(([cardId, data]) => ({
    cardId,
    balance: data.balance
  }));
  res.json(result);
});


module.exports = router;
