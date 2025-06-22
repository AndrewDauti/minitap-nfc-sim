router.post('/tap', (req, res) => {
  const { cardId, amount } = req.body;

  // Example storage (optional)
  // transactions.push({ id: Date.now(), cardId, amount, timestamp: new Date().toISOString() });

  res.json({
    message: 'Tap successful',
    cardId,
    amount,
  });
});
