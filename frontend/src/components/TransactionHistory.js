import React, { useEffect, useState } from 'react';
import { getTransactions } from './api';

function TransactionHistory() {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    getTransactions().then(setHistory);
  }, []);

  return (
    <div>
      <h3>Transaction History</h3>
      <ul>
        {history.map((tx) => (
          <li key={tx.id}>
            {tx.timestamp} | {tx.cardId} | ZMW {tx.amount}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default TransactionHistory;

