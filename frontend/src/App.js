import { useEffect, useState } from 'react';
import CardSimulator from './components/CardSimulator';
import SecurityStory from './components/SecurityStory';
import TransactionHistory from './components/TransactionHistory';
import BooksView from './demo/BooksView';
import { DemoProvider, useDemo } from './demo/DemoContext';
import PartnerView from './demo/PartnerView';
import SaleView from './demo/SaleView';
import './demo.css';

const TITLES = {
  sale: 'MiniTap · Offline sale',
  books: 'MiniTap · Books',
  network: 'MiniTap · Network',
  classroom: 'MiniTap · Classroom till',
  activity: 'MiniTap · Activity',
  story: 'MiniTap · How your tap stays safe',
};

function AppShell() {
  const demo = useDemo();
  const [view, setView] = useState('sale');
  const [revision, setRevision] = useState(0);
  const demoView = view === 'sale' || view === 'books' || view === 'network';

  useEffect(() => {
    document.title = TITLES[view] || TITLES.sale;
    window.scrollTo(0, 0);
    if (view === 'story') {
      document.getElementById('story-title')?.focus({ preventScroll: true });
    }
    if (view === 'activity') {
      document.getElementById('activity-title')?.focus({ preventScroll: true });
    }
  }, [view]);

  return (
    <div className={demoView ? 'app-shell demo-shell' : 'app-shell'}>
      {!demoView && <div className="orb orb-a" aria-hidden="true" />}
      {!demoView && <div className="orb orb-b" aria-hidden="true" />}
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-badge" aria-hidden="true" />
            <div>
              <p className="brand-name">MiniTap</p>
              <p className="brand-sub">{demoView ? 'Zamtel Kwacha' : 'Tap to pay simulator'}</p>
            </div>
          </div>
          <nav className="primary-nav" aria-label="Primary">
            <button type="button" className="nav-btn" aria-current={view === 'sale' ? 'page' : undefined} onClick={() => setView('sale')}>
              Sale
            </button>
            <button type="button" className="nav-btn" aria-current={view === 'books' ? 'page' : undefined} onClick={() => setView('books')}>
              Books
            </button>
            <button type="button" className="nav-btn" aria-current={view === 'network' ? 'page' : undefined} onClick={() => setView('network')}>
              Network
            </button>
            <button type="button" className="nav-btn" aria-current={view === 'classroom' ? 'page' : undefined} onClick={() => setView('classroom')}>
              Classroom till
            </button>
            <button type="button" className="nav-btn" aria-current={view === 'activity' ? 'page' : undefined} onClick={() => setView('activity')}>
              Activity
            </button>
            <button type="button" className="nav-btn" aria-current={view === 'story' ? 'page' : undefined} onClick={() => setView('story')}>
              How your tap stays safe
            </button>
          </nav>
          {demoView ? (
            <div className="top-tools">
              <div className="net-toggle" role="group" aria-label="Network">
                <span>Network</span>
                <button type="button" aria-pressed={demo.network === 'online'} onClick={() => demo.setNetwork('online')}>
                  Online
                </button>
                <button type="button" className="is-off" aria-pressed={demo.network === 'offline'} onClick={() => demo.setNetwork('offline')}>
                  Offline
                </button>
              </div>
            </div>
          ) : (
            <p className="locale">Lusaka · ZMW · USD · CHF</p>
          )}
        </header>
        {view === 'sale' && <SaleView />}
        {view === 'books' && <BooksView />}
        {view === 'network' && <PartnerView />}
        {view === 'classroom' && (
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
        {view === 'story' && <SecurityStory onBack={() => setView('sale')} />}
        {demoView && (
          <footer className="foot">
            Simulated payments. Nothing here moves real money. The security story is still under How your tap stays safe.
          </footer>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <DemoProvider>
      <AppShell />
    </DemoProvider>
  );
}
