import { useEffect, useState } from 'react';
import { formatK, MERCHANT_REF } from './offlineCrypto';
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

function shopRows(ledger, ref) {
  return ledger.filter((row) => (row.merchantRef || MERCHANT_REF) === ref);
}

function LiveMerchants({ demo }) {
  return (
    <div className="merchant-live">
      <div className="dash-top">
        <h3>Shops this session</h3>
        <span className="example-badge is-live">Live session</span>
      </div>
      <p className="picker-help">Balances come from the API. Counts come from this browser. Example charts stay below.</p>
      <div className="merchant-grid">
        {demo.merchants.map((shop) => {
          const rows = shopRows(demo.ledger, shop.ref);
          const queued = rows.filter((row) => row.status === 'queued');
          const settled = rows.filter((row) => row.status === 'settled');
          const blocked = rows.filter((row) => row.status === 'blocked');
          const empty = queued.length + settled.length + blocked.length === 0 && !shop.balance;
          return (
            <article key={shop.ref} className={shop.ref === demo.merchant.ref ? 'is-current' : undefined}>
              <p>{shop.category}</p>
              <h3>{shop.name}</h3>
              <p className="merchant-place">{shop.place}</p>
              <dl>
                <div><dt>Settled balance</dt><dd>{formatK(shop.balance || 0)}</dd></div>
                <div><dt>Queued here</dt><dd>{queued.length}</dd></div>
                <div><dt>Settled here</dt><dd>{settled.length}</dd></div>
                <div><dt>Blocked</dt><dd>{blocked.length}</dd></div>
              </dl>
              {empty && (
                <p className="muted-line">No sales yet. On Sale, pick {shop.name} and take a payment.</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default function PartnerView() {
  const demo = useDemo();
  const [section, setSection] = useState(NAV[0]);
  const sessionSales = demo.ledger.filter((row) => row.status === 'settled' || row.status === 'queued');
  const sessionValue = sessionSales.reduce((sum, row) => sum + Number(row.amount), 0);
  const blocked = demo.ledger.filter((row) => row.status === 'blocked').length;
  const offlineCount = demo.ledger.filter((row) => row.offline && row.status !== 'blocked').length;

  useEffect(() => {
    demo.refreshMerchants();
  }, [demo.refreshMerchants]);

  return (
    <section className="demo-pane" aria-label="Partner dashboard">
      <header className="demo-intro">
        <p className="eyebrow">Partner dashboard · Zamtel and ZRA</p>
        <h1>See the sales the network used to lose.</h1>
        <p>The shop cards are this session. The large figures, the hour chart, and the market queue are example data.</p>
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
            {section !== 'Overview' && section !== 'Merchants' && (
              <span className="example-badge">Example data</span>
            )}
          </div>
          {section === 'Merchants' ? (
            <LiveMerchants demo={demo} />
          ) : section !== 'Overview' ? (
            <p className="example-note">
              This section is example layout only. Live shop totals are on Overview and Merchants. No partner feed is connected.
            </p>
          ) : (
            <>
              <LiveMerchants demo={demo} />
              <div className="dash-top example-split">
                <h3>Example region figures</h3>
                <span className="example-badge">Example data</span>
              </div>
              <div className="session-strip">
                <p>This browser session · live</p>
                <ul>
                  <li><span>Offline taps</span><strong>{offlineCount}</strong></li>
                  <li><span>Value in the queue or settled</span><strong>{formatK(sessionValue)}</strong></li>
                  <li><span>Blocked</span><strong>{blocked}</strong></li>
                  <li><span>{demo.merchant.name}</span><strong>{formatK(demo.traderBalance)}</strong></li>
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
                    <h3>Payments by hour · example</h3>
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
                  <h3>Example settlement queue</h3>
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
