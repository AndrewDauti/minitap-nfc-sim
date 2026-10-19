import { useState } from 'react';
import CardSimulator from './components/CardSimulator';
import TransactionHistory from './components/TransactionHistory';

export default function App() {
  const [revision, setRevision] = useState(0);

  return (
    <div className="app-shell">
      <div className="orb orb-a" aria-hidden="true" />
      <div className="orb orb-b" aria-hidden="true" />
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-badge" aria-hidden="true" />
            <div>
              <p className="brand-name">MiniTap</p>
              <p className="brand-sub">Tap to pay simulator</p>
            </div>
          </div>
          <p className="locale">Lusaka · ZMW · USD · CHF</p>
        </header>
        <main>
          <CardSimulator onSettled={() => setRevision((value) => value + 1)} />
          <TransactionHistory revision={revision} />
        </main>
        <footer className="foot">
          In-memory simulation. Balances and activity reset when the API restarts.
        </footer>
      </div>
    </div>
  );
}
