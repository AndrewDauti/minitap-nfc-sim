import React, { useState } from 'react';
import { sendTap } from './api';

function CardSimulator() {
  const [cardId, setCardId] = useState('');
  const [amount, setAmount] = useState('');

  const handleTap = async () => {
        console.log('Sending:', { cardId, amount });

    if (!cardId || !amount) {
      alert('Please enter both Card ID and Amount');
      return;
    }
    try {
      const res = await sendTap(cardId, amount);
      alert(`Tap Success: ZMW ${res.amount} for ${res.cardId}`);
    } catch (err) {
      alert('Tap Failed: ' + (err.message || 'Something went wrong'));
    }
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Enter Card ID"
        value={cardId}
        onChange={(e) => setCardId(e.target.value)}
      />
      <input
        type="number"
        placeholder="Enter Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button onClick={handleTap}>Simulate Tap</button>
    </div>
  );
}

export default CardSimulator;

