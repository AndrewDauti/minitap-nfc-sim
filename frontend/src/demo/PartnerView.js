import { useState } from 'react';
import { formatK } from './offlineCrypto';
import { useDemo } from './DemoContext';

const HOURS = [
  { label: '06', online: 28, offline: 0 },
  { label: '08', online: 46, offline: 10 },
  { label: '10', online: 58, offline: 16 },
  { label: '12', online: 22, offline: 12, outage: true },
  { label: '14', online: 84, offline: 18 },
  { label: '16', online: 70, offline: 14 },
  { label: '18', online: 48, offline: 8 },
];

const QUEUE = [
  ['Soweto Market', 'SETTLED', '412'],
  ['City Market', 'SYNCING', '37'],
  ['Chilenje', 'SETTLED', '198'],
  ['Kanyama', 'FLAGGED', '4'],
  ['Matero', 'SETTLED', '260'],
];

const NAV = ['Overview', 'Settlement queue', 'Fraud and risk', 'Merchants', 'Outage map', 'Tax (ZRA view)', 'Reports'];

export default function PartnerView() {
  const demo = useDemo();
  const [section, setSection] = useState(NAV[0]);
  const sessionSales = demo.ledger.filter((row) => row.status === 'settled' || row.status === 'queued');
  const sessionValue = sessionSales.reduce((sum, row) => sum + Number(row.amount), 0);
  const blocked = demo.ledger.filter((row) => row.status === 'blocked').length;
  const offlineCount = demo.ledger.filter((row) => row.offline && row.status !== 'blocked').length;

  return (
    <section className="demo-pane" aria-label="Partner dashboard">
      <header className="demo-intro">
        <p className="eyebrow">Partner dashboard · Zamtel and ZRA</p>
        <h1>See the sales the network used to lose.</h1>
        <p>The figures in the cards below are example data. The session strip uses this browser only.</p>
      </header>
      <div className="dash">
        <aside className="dash-nav">
          <p>MiniTap · Network</p>
          {NAV.map((item) => (
            <button
              key={item}
              type="button"
              aria-current={section === item ? 'page' : undefined}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </aside>
        <div className="dash-main">
          <div className="dash-top">
            <h2>{section === 'Overview' ? 'Today · Lusaka region' : section}</h2>
            <span className="example-badge">Example data</span>
          </div>
          {section !== 'Overview' ? (
            <p className="example-note">
              This section is a placeholder in the demo. The live session numbers stay on Overview. No partner feed is connected.
            </p>
          ) : (
            <>
              <div className="session-strip">
                <p>This browser session</p>
                <ul>
                  <li><span>Offline taps</span><strong>{offlineCount}</strong></li>
                  <li><span>Value in the queue or settled</span><strong>{formatK(sessionValue)}</strong></li>
                  <li><span>Blocked</span><strong>{blocked}</strong></li>
                  <li><span>Trader balance</span><strong>{formatK(demo.traderBalance)}</strong></li>
                </ul>
              </div>
              <div className="stat-grid">
                <article>
                  <p>Value kept during outages</p>
                  <strong>K48,210</strong>
                  <span>Compared with cash fallback</span>
                </article>
                <article>
                  <p>Offline payments</p>
                  <strong>3,904</strong>
                  <span>97.8% settled</span>
                </article>
                <article className="is-alert">
                  <p>Blocked as fraud</p>
                  <strong>12</strong>
                  <span>Replays and edits</span>
                </article>
                <article>
                  <p>Traders who filed TOT</p>
                  <strong>286</strong>
                  <span>Opt-in, this month</span>
                </article>
              </div>
              <div className="dash-split">
                <article>
                  <div className="chart-head">
                    <h3>Payments by hour</h3>
                    <p><i className="swatch on" /> online <i className="swatch off" /> offline <i className="swatch gap" /> outage</p>
                  </div>
                  <div className="hour-chart" aria-hidden="true">
                    {HOURS.map((hour) => (
                      <div key={hour.label} className={hour.outage ? 'is-outage' : ''}>
                        <span className="bar-off" style={{ height: `${hour.offline}%` }} />
                        <span className="bar-on" style={{ height: `${hour.online}%` }} />
                        <em>{hour.label}</em>
                      </div>
                    ))}
                  </div>
                </article>
                <article>
                  <h3>Settlement queue</h3>
                  <ul className="queue-list">
                    {QUEUE.map(([name, status, count]) => (
                      <li key={name}>
                        <span>{name}</span>
                        <em className={`q-${status.toLowerCase()}`}>{status} {count}</em>
                      </li>
                    ))}
                  </ul>
                </article>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
