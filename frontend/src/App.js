import { useEffect, useState } from 'react';
import CardSimulator from './components/CardSimulator';
import SecurityStory from './components/SecurityStory';
import TransactionHistory from './components/TransactionHistory';

export default function App() {
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState('till');

  useEffect(() => {
    const titles = {
      till: 'MiniTap · Tap to pay',
      activity: 'MiniTap · Activity',
      story: 'MiniTap · How your tap stays safe',
    };
    document.title = titles[view] || titles.till;
    window.scrollTo(0, 0);
    if (view === 'story') {
      document.getElementById('story-title')?.focus({ preventScroll: true });
    }
    if (view === 'activity') {
      document.getElementById('activity-title')?.focus({ preventScroll: true });
    }
  }, [view]);

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
          <nav className="primary-nav" aria-label="Primary">
            <button
              type="button"
              className="nav-btn"
              aria-current={view === 'till' ? 'page' : undefined}
              onClick={() => setView('till')}
            >
              Till
            </button>
            <button
              type="button"
              className="nav-btn"
              aria-current={view === 'activity' ? 'page' : undefined}
              onClick={() => setView('activity')}
            >
              Activity
            </button>
            <button
              type="button"
              className="nav-btn"
              aria-current={view === 'story' ? 'page' : undefined}
              onClick={() => setView('story')}
            >
              How your tap stays safe
            </button>
          </nav>
          <p className="locale">Lusaka · ZMW · USD · CHF</p>
        </header>
        {view === 'till' && (
          <>
            <main>
              <CardSimulator onSettled={() => setRevision((value) => value + 1)} />
            </main>
            <footer className="foot">
              Classroom model of tap security. Balances, lockouts, and the audit log reset when the API restarts.
            </footer>
          </>
        )}
        {view === 'activity' && (
          <>
            <main>
              <TransactionHistory revision={revision} />
            </main>
            <footer className="foot">
              Classroom model of tap security. Balances, lockouts, and the audit log reset when the API restarts.
            </footer>
          </>
        )}
        {view === 'story' && <SecurityStory onBack={() => setView('till')} />}
      </div>
    </div>
  );
}
