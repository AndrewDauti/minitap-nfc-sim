import React from 'react';
import TransactionHistory from './components/TransactionHistory';
import CardSimulator from './components/CardSimulator';

function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'Arial' }}>
      <h1>Minitap NFC Simulator 💳🔥</h1>
      <CardSimulator />
      <hr />
      <TransactionHistory />
    </div>
  );
}

export default App;

