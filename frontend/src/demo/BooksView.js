import { formatK, MERCHANT_REF } from './offlineCrypto';
import { useDemo } from './DemoContext';
import Hint from './Hint';
import { NetChip, Phone } from './Phone';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function monthName(date) {
  return date.toLocaleDateString('en-GB', { month: 'long' });
}

function dueLabel(date) {
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 14);
  return next.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function booksOf(ledger, merchantRef, now) {
  const rows = ledger.filter((row) => (
    (row.merchantRef || MERCHANT_REF) === merchantRef
    && (row.status === 'settled' || row.status === 'queued')
  ));
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const savedOffline = rows.filter((row) => row.status === 'queued').length;
  const days = [0, 0, 0, 0, 0, 0, 0];
  rows.forEach((row) => {
    const date = new Date(row.at);
    if (Number.isNaN(date.getTime())) return;
    if (date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) return;
    const index = (date.getDay() + 6) % 7;
    days[index] += Number(row.amount);
  });
  return { rows, total, savedOffline, days, count: rows.length };
}

function taxDue(total, rate, threshold) {
  if (!(total >= threshold)) return 0;
  return Math.round(total * (Number(rate) / 100) * 100) / 100;
}

export default function BooksView() {
  const demo = useDemo();
  const now = new Date();
  const books = booksOf(demo.ledger, demo.merchant.ref, now);
  const due = taxDue(books.total, demo.taxRate, demo.taxThreshold);
  const peak = Math.max(1, ...books.days);
  const online = demo.network === 'online';
  const month = monthName(now);
  const lineName = demo.merchant.line || demo.merchant.category || 'Sale';
  const lines = books.rows.length
    ? books.rows.map((row) => ({ id: row.localId, name: lineName, amount: row.amount }))
    : [];

  return (
    <section className="demo-pane" aria-label="Books and tax">
      <header className="demo-intro">
        <p className="eyebrow">Trader app · free books and opt-in tax</p>
        <h1>Books for {demo.merchant.name}.</h1>
        <p>
          These records, the invoice draft, and the example turnover tax are for the shop selected above.
          Switch shops to see another set. Nothing here is filed with ZRA.
        </p>
      </header>
      {demo.notice && <p className="demo-notice" role="status">{demo.notice}</p>}
      <div className="phone-row">
        <figure>
          <Phone online={online}>
            <div className="phone-head">
              <strong>My Books</strong>
              <span className="month-chip">{month.slice(0, 3).toUpperCase()}</span>
            </div>
            <div className="phone-body">
              <div className="balance-card">
                <p>Sales this session</p>
                <strong><span>K</span>{books.total.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong>
              </div>
              <p className="section-label">SALES BY DAY</p>
              <div className="day-chart" aria-hidden="true">
                {books.days.map((value, index) => (
                  <div key={DAY_LABELS[index] + index}>
                    <span style={{ height: `${Math.max(6, (value / peak) * 72)}px` }} />
                    <em>{DAY_LABELS[index]}</em>
                  </div>
                ))}
              </div>
              <dl className="detail-list">
                <div><dt>Saved offline</dt><dd>{books.savedOffline} {books.savedOffline === 1 ? 'sale' : 'sales'}</dd></div>
                <div><dt>Top item</dt><dd>{books.count ? lineName : 'None yet'}</dd></div>
              </dl>
              <p className="muted-line">
                {books.count
                  ? `Queued and settled taps for ${demo.merchant.name} in this browser session.`
                  : `No sales for ${demo.merchant.name} yet. Go to Sale, take a payment for this shop, then come back.`}
              </p>
            </div>
          </Phone>
          <figcaption>
            <strong>Sales record</strong>
            <span>Built automatically from taps. Saved offline is the queue still on the phone.</span>
          </figcaption>
        </figure>

        <figure>
          <Phone online={online}>
            <div className="phone-head">
              <strong>Smart Invoice</strong>
              <NetChip online={online} />
            </div>
            <div className="phone-body">
              <p className="section-label">BUYER TPIN</p>
              <p className="tpin">10XX XXX XXX</p>
              {lines.length === 0 && (
                <p className="muted-line">No lines yet. A tap at {demo.merchant.name} adds {lineName.toLowerCase()} here.</p>
              )}
              <ul className="invoice-lines">
                {lines.map((line) => (
                  <li key={line.id}><span>{line.name}</span><span>{formatK(line.amount)}</span></li>
                ))}
              </ul>
              <dl className="detail-list">
                <div><dt>Total</dt><dd>{formatK(books.total)}</dd></div>
              </dl>
              <p className="saved-line">Built offline · sends to ZRA on sync</p>
              <button type="button" className="btn-green" onClick={demo.issueInvoice} disabled={!lines.length}>
                Issue invoice
              </button>
              {demo.invoiceIssued && (
                <p className="muted-line">Queued on this phone. Nothing was sent to ZRA.</p>
              )}
            </div>
          </Phone>
          <figcaption>
            <strong>Smart Invoice offline</strong>
            <span>Invoices keep working through an outage and wait for the network.</span>
          </figcaption>
        </figure>

        <figure>
          <Phone online={online}>
            <div className="phone-head">
              <strong>Turnover Tax</strong>
              <span className="month-chip">DUE {dueLabel(now).toUpperCase()}</span>
            </div>
            <div className="phone-body">
              <dl className="detail-list plain">
                <div><dt>{month} sales</dt><dd>{formatK(books.total)}</dd></div>
                <div>
                  <dt>Example rate</dt>
                  <dd>
                    <input
                      aria-label="Example tax rate percent"
                      type="number"
                      min="0"
                      max="30"
                      step="0.5"
                      value={demo.taxRate}
                      onChange={(event) => demo.setTaxRate(event.target.value)}
                    />
                    %
                  </dd>
                </div>
                <div>
                  <dt>Example threshold</dt>
                  <dd>
                    K
                    <input
                      aria-label="Example tax threshold in kwacha"
                      type="number"
                      min="0"
                      step="1"
                      value={demo.taxThreshold}
                      onChange={(event) => demo.setTaxThreshold(event.target.value)}
                    />
                  </dd>
                </div>
                <div><dt>Tax due</dt><dd>{formatK(due)}</dd></div>
              </dl>
              <p className="example-note">
                Example values for {demo.merchant.name}, not an official ZRA rate or threshold. Change them here. A live app would read both from ZRA.
                <Hint label="example turnover tax">
                  The rate and threshold are editable sample figures. Filing on this screen does not send a return and does not move money.
                </Hint>
              </p>
              <p className="muted-line">
                {books.total >= demo.taxThreshold
                  ? 'Sales are at or above the example threshold, so the example rate applies.'
                  : 'Sales are under the example threshold, so the example tax due is zero.'}
              </p>
              <button type="button" className="btn-green" onClick={demo.fileTaxDemo}>File & pay with Kwacha</button>
              {demo.taxFiled && (
                <p className="muted-line">Demo only. No return was filed with ZRA and no money moved.</p>
              )}
            </div>
          </Phone>
          <figcaption>
            <strong>One-step filing</strong>
            <span>Opt-in and transparent. The rate and threshold are examples you can edit.</span>
          </figcaption>
        </figure>

        <aside className="sms-panel">
          <p className="eyebrow">Example insight</p>
          <h2>Reminders stay in the trader's language.</h2>
          <article className="insight-card">
            <p>MINITAP INSIGHTS · EXAMPLE</p>
            <p>
              This card is example copy, not a live forecast.
              {books.count
                ? ` ${demo.merchant.name} has ${books.count} ${books.count === 1 ? 'sale' : 'sales'} in this session, ${formatK(books.total)}.`
                : ` Take a payment for ${demo.merchant.name} and the session total shows here.`}
            </p>
          </article>
          <article className="insight-card">
            <p>MINITAP · EXAMPLE</p>
            <p>
              {month} turnover tax: {formatK(due)}, due {dueLabel(now)}. Reply 1 to review the example figures. Nothing is filed from this message.
            </p>
          </article>
        </aside>
      </div>
    </section>
  );
}
