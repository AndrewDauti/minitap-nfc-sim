import { useEffect, useState } from 'react';

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function Phone({ online, children, variant = 'light' }) {
  const time = useClock();
  return (
    <div className={`phone phone-${variant}`}>
      <div className="phone-screen">
        <div className="status-bar">
          <span>{time}</span>
          <span>{online ? 'Zamtel 4G · 81%' : 'No service · 38%'}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NetChip({ online }) {
  return (
    <span className={online ? 'net-chip is-on' : 'net-chip is-off'}>
      <i aria-hidden="true" />
      {online ? 'ONLINE' : 'OFFLINE'}
    </span>
  );
}

export function typedAmount(amount) {
  if (!amount) return '0.00';
  const [whole, frac] = String(amount).split('.');
  const withCommas = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac === undefined) return `${withCommas}.00`;
  return `${withCommas}.${frac}`;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

export function Keypad({ onKey }) {
  return (
    <div className="till-pad" role="group" aria-label="Amount">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className="till-key"
          onClick={() => onKey(key)}
          aria-label={key === 'del' ? 'Delete' : key}
        >
          {key === 'del' ? '⌫' : key}
        </button>
      ))}
    </div>
  );
}

export function QrMark({ seed }) {
  const cells = [];
  let hash = 7;
  const text = String(seed || 'minitap');
  for (let i = 0; i < text.length; i += 1) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  for (let i = 0; i < 49; i += 1) {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const finder = (row < 2 && col < 2) || (row < 2 && col > 4) || (row > 4 && col < 2);
    const on = finder || ((hash >> (i % 24)) & 1) === 1;
    cells.push(<span key={i} className={on ? 'on' : ''} />);
  }
  return <div className="qr-mark" aria-hidden="true">{cells}</div>;
}
