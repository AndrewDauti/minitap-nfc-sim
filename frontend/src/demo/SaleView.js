import { formatK, tokenRef } from './offlineCrypto';
import { useDemo } from './DemoContext';
import Hint from './Hint';
import { Keypad, NetChip, Phone, QrMark, typedAmount } from './Phone';

function tillLive(demo) {
  const { till, merchant } = demo;
  if (till.phase === 'secured' && till.secured) {
    return `${formatK(till.secured.amount)} secured for ${till.secured.merchantName || merchant.name}.`;
  }
  if (till.phase === 'declined') return till.localError || 'This tap was refused on the phone.';
  if (till.phase === 'sync' && till.sync) {
    return `${till.sync.settledCount} of ${till.sync.totalCount} payments settled.`;
  }
  if (till.phase === 'wait') return `Waiting for a tap at ${merchant.name}.`;
  return '';
}

function shortTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function CustomerPhone() {
  const demo = useDemo();
  const online = demo.network === 'online';
  const { customer, wallet, allowance, allowanceChoice } = demo;
  const screen = customer.screen;
  const remaining = allowance ? allowance.remainingCents / 100 : 0;
  const tapsLeft = allowance ? allowance.tokens.filter((token) => !token.used).length : 0;
  const next = allowance
    ? allowance.tokens.filter((token) => !token.used).sort((a, b) => a.counter - b.counter)[0]
    : null;

  return (
    <Phone online={online}>
      <div className="phone-head">
        <strong>Zamtel Kwacha</strong>
        <NetChip online={online} />
      </div>
      {screen === 'paid' && customer.paid ? (
        <div className="phone-body center-copy">
          <div className="check-badge" aria-hidden="true">✓</div>
          <p className="paid-kicker">Paid {formatK(customer.paid.amount)}</p>
          <p className="muted-line">to {customer.paid.merchantName || demo.merchant.name}</p>
          <dl className="detail-list">
            <div><dt>Allowance left</dt><dd>{formatK(customer.paid.allowanceLeft)}</dd></div>
            <div><dt>Shows in history</dt><dd>When online</dd></div>
          </dl>
          <button type="button" className="btn-green" onClick={demo.customerDone}>Done</button>
        </div>
      ) : null}

      {screen === 'qr' ? (
        <div className="phone-body center-copy">
          <p className="section-label">Show my QR</p>
          <QrMark seed={next ? next.tokenId : 'ready'} />
          <p className="ref-line">{next ? tokenRef(next.tokenId, next.counter) : 'No token ready'}</p>
          <p className="muted-line">Simulated code. The till reads it from this phone. No camera needed.</p>
          <button type="button" className="btn-green" onClick={demo.customerTap}>Tap to pay</button>
          <button type="button" className="btn-ghost" onClick={demo.showHome}>Hide QR</button>
        </div>
      ) : null}

      {screen === 'card' ? (
        <div className="phone-body">
          <div className="tap-card">
            <p>Zamtel Kwacha</p>
            <strong>TAP CARD</strong>
            <span>Linked to 097 ··· {wallet?.last4 || '4401'}</span>
          </div>
          <p className="muted-line">The card has a secure chip. Limits and freeze stay on USSD.</p>
          <button type="button" className="btn-green" onClick={demo.showUssd}>Open USSD menu</button>
          <button type="button" className="btn-ghost" onClick={demo.showHome}>Back to wallet</button>
        </div>
      ) : null}

      {screen === 'ussd' ? (
        <div className="phone-body">
          <div className="ussd">
            <p>Kwacha Tap Card</p>
            <ol>
              <li>Card balance {allowance ? formatK(remaining) : formatK(wallet?.spendable || 0)}</li>
              <li>Set tap limit {allowance ? formatK(allowance.amount) : 'Not set'}</li>
              <li>{customer.frozen ? 'Card is frozen' : 'Freeze card'}</li>
              <li>Last 5 taps</li>
              <li>0. Back</li>
            </ol>
            <div className="ussd-log">
              {demo.ledger.slice(-5).reverse().map((row) => (
                <p key={row.localId}>{formatK(row.amount)} · {row.status}</p>
              ))}
              {demo.ledger.length === 0 && <p>No taps yet</p>}
            </div>
          </div>
          {customer.frozen ? (
            <button type="button" className="btn-green" onClick={() => demo.setCustomerFrozen(false)}>
              UNFREEZE
            </button>
          ) : (
            <button type="button" className="btn-dark" onClick={() => demo.setCustomerFrozen(true)}>
              FREEZE
            </button>
          )}
          <p className="muted-line">Classroom freeze. It stays on this phone and does not lock the server PIN.</p>
          <button type="button" className="btn-ghost" onClick={demo.showHome}>0 · Back</button>
        </div>
      ) : null}

      {screen === 'home' ? (
        <div className="phone-body">
          <div className="balance-card">
            <p>Wallet balance</p>
            <strong><span>K</span>{typedAmount(wallet ? String(wallet.balance) : '')}</strong>
          </div>
          {allowance ? (
            <div className="allow-card">
              <div>
                <p className="label-row">
                  OFFLINE ALLOWANCE
                  <Hint label="tokens">
                    Each ready tap is one signed token with a counter and a spending cap. The till checks it on the phone. Sync checks it again.
                  </Hint>
                </p>
                <strong>{formatK(remaining)}</strong>
                <span>{tapsLeft} {tapsLeft === 1 ? 'tap' : 'taps'} ready</span>
              </div>
              <em>ready to tap</em>
            </div>
          ) : (
            <div className="allow-setup">
              <p className="label-row">
                OFFLINE ALLOWANCE
                <Hint label="the offline allowance">
                  Do this while Network is Online. The amount is locked out of spendable balance and comes back as single-use tokens. Each tap uses one token.
                </Hint>
              </p>
              <div className="choice-row">
                {[100, 300, 500].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className={allowanceChoice === amount ? 'choice is-on' : 'choice'}
                    onClick={() => demo.setAllowanceChoice(amount)}
                  >
                    {formatK(amount).replace('.00', '')}
                  </button>
                ))}
              </div>
              <p>Set aside from your balance. Works with no signal.</p>
              <button
                type="button"
                className="btn-green"
                onClick={demo.setAside}
                disabled={!online || demo.loading}
              >
                {online ? `Set aside ${formatK(allowanceChoice).replace('.00', '')}` : 'Go online to set aside'}
              </button>
            </div>
          )}
          {allowance && (
            <>
              <p className="muted-line">Set aside from your balance. Works with no signal.</p>
              <button type="button" className="btn-green" onClick={demo.customerTap}>Tap to pay</button>
              <button type="button" className="btn-ghost" onClick={demo.showQr}>Show my QR</button>
              <button type="button" className="btn-text" onClick={demo.showCard}>Kwacha Tap Card</button>
            </>
          )}
        </div>
      ) : null}
    </Phone>
  );
}

function TraderPhone() {
  const demo = useDemo();
  const online = demo.network === 'online';
  const { till, savedCount } = demo;
  const title = till.phase === 'sync' ? 'Sync' : 'MiniTap Till';

  return (
    <Phone online={online}>
      <div className="phone-head">
        <strong>{title}</strong>
        <NetChip online={online} />
      </div>
      {till.phase === 'amount' && (
        <div className="phone-body">
          <p className="charge-label">Charge customer</p>
          <p className="amount-xl"><span>K</span>{typedAmount(till.amount)}</p>
          <p className="merchant-sub">{demo.merchant.category} · {demo.merchant.name}</p>
          <Keypad onKey={demo.pressKey} />
          {savedCount > 0 && (
            <p className="saved-line">
              {savedCount === 1 ? '1 sale saved' : `${savedCount} sales saved`} · will sync automatically
            </p>
          )}
          {demo.syncing && <p className="muted-line">Syncing the queue.</p>}
          <button type="button" className="btn-green" onClick={demo.beginTap}>Take payment</button>
        </div>
      )}
      {till.phase === 'wait' && (
        <div className="phone-body center-copy">
          <p className="section-label">AMOUNT DUE</p>
          <p className="amount-xl"><span>K</span>{typedAmount(till.amount)}</p>
          <div className="tap-waves" aria-hidden="true"><span /></div>
          <p className="tap-title">Tap phone or card</p>
          <p className="muted-line">or scan the customer QR</p>
          {till.localError && <p className="local-error" role="alert">{till.localError}</p>}
          <button type="button" className="btn-dark" onClick={demo.scanQr}>Scan QR instead</button>
          <button type="button" className="btn-ghost" onClick={demo.cancelWait}>Cancel</button>
        </div>
      )}
      {till.phase === 'secured' && till.secured && (
        <div className="phone-body center-copy">
          <div className="check-badge" aria-hidden="true">✓</div>
          <p className="secured-title">{formatK(till.secured.amount)} secured</p>
          <p className="muted-line">
            {demo.network === 'online'
              ? `Verified on this phone. Settling to ${till.secured.merchantName || demo.merchant.name}.`
              : `Verified on this phone. Switch Network to Online to settle to ${till.secured.merchantName || demo.merchant.name}.`}
          </p>
          <dl className="detail-list">
            <div><dt>Payer</dt><dd>{till.secured.payer}</dd></div>
            <div><dt>Token</dt><dd>{till.secured.ref}</dd></div>
            <div><dt>Receipt</dt><dd>SMS queued</dd></div>
          </dl>
          <button type="button" className="btn-dark" onClick={demo.nextSale}>Next sale</button>
        </div>
      )}
      {till.phase === 'declined' && (
        <div className="phone-body center-copy">
          <div className="check-badge is-bad" aria-hidden="true">!</div>
          <p className="secured-title">Not secured</p>
          <p className="local-error" role="alert">{till.localError || 'This tap was refused on the phone.'}</p>
          <button type="button" className="btn-dark" onClick={demo.nextSale}>Try again</button>
        </div>
      )}
      {till.phase === 'sync' && till.sync && (
        <div className="phone-body">
          <p className="section-label">SETTLED JUST NOW</p>
          <p className="amount-xl"><span>K</span>{typedAmount(String(till.sync.settledAmount))}</p>
          <p className="muted-line">
            {till.sync.settledCount} of {till.sync.totalCount} {till.sync.totalCount === 1 ? 'payment' : 'payments'} settled
          </p>
          <ul className="sync-list">
            {till.sync.rows.map((row) => (
              <li key={row.localId || `${row.ref}-${row.time}-${row.status}`}>
                <span>{formatK(row.amount)} · {shortTime(row.time)}</span>
                <em className={row.status === 'settled' ? 'pill-ok' : 'pill-bad'}>
                  {row.status === 'settled' ? 'SETTLED' : 'BLOCKED'}
                </em>
                {row.riskScore != null && <small>Risk {row.riskScore}</small>}
              </li>
            ))}
          </ul>
          {till.sync.rows.filter((row) => row.status !== 'settled').slice(0, 1).map((row) => (
            <p key={row.ref} className="block-note">{row.reason}</p>
          ))}
          <button type="button" className="btn-dark" onClick={demo.nextSale}>Next sale</button>
        </div>
      )}
    </Phone>
  );
}

function captionForCustomer(screen) {
  if (screen === 'paid') return 'Instant feedback for the payer.';
  if (screen === 'qr') return 'A phone without NFC shows a QR code.';
  if (screen === 'card' || screen === 'ussd') return 'Card has a secure chip. Limits and freeze by USSD.';
  return 'No new app for customers. The allowance caps the risk.';
}

function captionForTill(phase) {
  if (phase === 'wait') return 'NFC first, with QR as a fallback.';
  if (phase === 'secured') return 'Secured, rather than paid: verified now, settled later.';
  if (phase === 'sync') return 'Automatic sync, and a clear result for every sale.';
  if (phase === 'declined') return 'The phone refused the tap before anything was queued.';
  return 'Big numbers and one action. The offline chip stays honest.';
}

export default function SaleView() {
  const demo = useDemo();
  return (
    <section className="demo-pane" aria-label="Offline sale">
      <header className="demo-intro">
        <p className="eyebrow">Trader app · offline sale</p>
        <h1>Selling with zero bars.</h1>
        <p>
          Pick a shop above, set aside an allowance while you are online, then take a payment. The till shows when the phone is offline and when the money is safe.
        </p>
      </header>
      {demo.apiOnline === false && (
        <p className="demo-notice" role="alert">
          The till cannot reach the API on port 5000. In the backend folder run npm start, then refresh this page.
        </p>
      )}
      {demo.notice && <p className="demo-notice" role="alert">{demo.notice}</p>}
      <p className="sr-only" aria-live="polite">{tillLive(demo)}</p>
      <div className="phone-row">
        <figure>
          <CustomerPhone />
          <figcaption>
            <strong>Inside the Kwacha app</strong>
            <span>{captionForCustomer(demo.customer.screen)}</span>
          </figcaption>
        </figure>
        <figure>
          <TraderPhone />
          <figcaption>
            <strong>{demo.till.phase === 'amount' ? 'Enter amount' : 'MiniTap Till'}</strong>
            <span>{captionForTill(demo.till.phase)}</span>
          </figcaption>
        </figure>
        <aside className="sms-panel">
          <p className="eyebrow">SMS receipts</p>
          <h2>Proof for people with no app.</h2>
          <p className="sms-note">Simulated messages. Nothing is sent to a real phone.</p>
          {demo.sms.length === 0 && (
            <p className="sms-empty">No messages yet. Set aside an allowance, then take a payment. A simulated SMS appears here.</p>
          )}
          <div className="sms-list">
            {demo.sms.map((row) => (
              <article key={row.id}>
                <p>{row.from}</p>
                <p>{row.body}</p>
              </article>
            ))}
          </div>
        </aside>
      </div>
      <section className="judge-checks" aria-label="Security checks">
        <div>
          <p className="eyebrow">Security checks</p>
          <h2>Show a blocked sale.</h2>
          <p>
            Clean taps above do not use these. Each one queues a bad sale so sync can refuse it.
            <Hint label="security checks">
              Make one good sale first. Replay copies that token. Change a saved amount edits the figure after signing. Roll a counter back sends an older token after a newer one. Send to another shop keeps the signature and changes the merchant.
            </Hint>
          </p>
        </div>
        <div className="judge-actions">
          <button type="button" onClick={() => demo.runAttack('replay')}>Replay a copied token</button>
          <button type="button" onClick={() => demo.runAttack('tamper')}>Change a saved amount</button>
          <button type="button" onClick={() => demo.runAttack('rollback')}>Roll a counter back</button>
          <button type="button" onClick={() => demo.runAttack('redirect')}>Send a sale to another shop</button>
        </div>
      </section>
    </section>
  );
}
