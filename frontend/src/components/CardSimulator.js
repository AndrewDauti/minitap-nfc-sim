import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { getWallets, sendTap } from './api';
import { CARD_CATALOG, CARD_ORDER, formatAmount, formatZMW } from './cardCatalog';
import PaymentCard from './PaymentCard';
import PosTerminal from './PosTerminal';

const PRESETS = [50, 150, 500, 1000];
const REST_FLIGHT = { x: 0, y: 0, scale: 1, rotateX: 0, rotateY: 0, rotateZ: 0 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function friendlyError(err) {
  const message = err?.message || 'Tap declined';
  if (message === 'Failed to fetch' || /network|fetch/i.test(message)) {
    return 'Terminal unreachable';
  }
  return message;
}

function mostlyOffscreen(node) {
  if (!node) return false;
  const rect = node.getBoundingClientRect();
  return rect.top < 48 || rect.bottom > window.innerHeight - 8;
}

function measureFlight(slot, pad) {
  if (!slot || !pad) {
    return { x: 180, y: 10, scale: 0.52, rotateX: 18, rotateY: -8, rotateZ: -7 };
  }
  const from = slot.getBoundingClientRect();
  const to = pad.getBoundingClientRect();
  return {
    x: to.left + to.width / 2 - (from.left + from.width / 2),
    y: to.top + to.height / 2 - (from.top + from.height / 2),
    scale: 0.52,
    rotateX: 18,
    rotateY: -8,
    rotateZ: -7,
  };
}

export default function CardSimulator({ onSettled }) {
  const reduced = useReducedMotion() === true;
  const [wallets, setWallets] = useState([]);
  const [online, setOnline] = useState(null);
  const [cardId, setCardId] = useState(CARD_ORDER[0]);
  const [amount, setAmount] = useState('150');
  const [fieldError, setFieldError] = useState('');
  const [phase, setPhase] = useState('idle');
  const [flight, setFlight] = useState(REST_FLIGHT);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [pointer, setPointer] = useState({ x: 32, y: 18 });
  const [receipt, setReceipt] = useState(null);
  const slotRef = useRef(null);
  const padRef = useRef(null);
  const terminalRef = useRef(null);
  const mounted = useRef(true);
  const lock = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getWallets()
      .then((rows) => {
        if (!active) return;
        setWallets(rows);
        setOnline(true);
        setCardId((current) => {
          if (current && rows.some((row) => row.cardId === current)) return current;
          return rows[0]?.cardId || CARD_ORDER[0];
        });
      })
      .catch(() => {
        if (active) setOnline(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function refreshWallets() {
    try {
      const rows = await getWallets();
      if (!mounted.current) return;
      setWallets(rows);
      setOnline(true);
    } catch {
      if (mounted.current) setOnline(false);
    }
  }

  const cards = CARD_ORDER.map((id) => {
    const meta = CARD_CATALOG[id];
    const live = wallets.find((row) => row.cardId === id);
    return { ...meta, balance: live ? live.balance : meta.demoBalance };
  });
  const selected = cards.find((card) => card.id === cardId) || cards[0];
  const numericAmount = Number(amount);
  const overBalance = Number.isFinite(numericAmount) && numericAmount > selected.balance;
  const busy = phase === 'tapping' || phase === 'processing';

  function onPointerMove(event) {
    if (reduced || phase !== 'idle' || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    setPointer({ x: px * 100, y: py * 100 });
    setTilt({ rx: (0.5 - py) * 12, ry: (px - 0.5) * 14 });
  }

  function onPointerLeave() {
    setTilt({ rx: 0, ry: 0 });
    setPointer({ x: 32, y: 18 });
  }

  function reset() {
    setPhase('idle');
    setReceipt(null);
    setFlight(REST_FLIGHT);
    setTilt({ rx: 0, ry: 0 });
  }

  async function handleTap() {
    if (lock.current || phase !== 'idle') return;
    if (!String(amount).trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFieldError('Enter an amount greater than zero.');
      return;
    }

    setFieldError('');
    lock.current = true;
    setPhase('tapping');
    const tapPromise = sendTap(cardId, numericAmount).then(
      (data) => ({ ok: true, data }),
      (err) => ({ ok: false, message: friendlyError(err) })
    );

    try {
      if (!reduced) {
        if (mostlyOffscreen(terminalRef.current)) {
          terminalRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await sleep(480);
        }
        if (!mounted.current) return;
        setFlight(measureFlight(slotRef.current, padRef.current));
        await sleep(900);
        if (!mounted.current) return;
        setPhase('processing');
        await sleep(1050);
      } else {
        setPhase('processing');
      }

      const result = await tapPromise;
      if (!mounted.current) return;
      setReceipt(result);
      setPhase(result.ok ? 'approved' : 'declined');
      if (onSettled) onSettled();
      await refreshWallets();
    } finally {
      lock.current = false;
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    if (phase === 'idle') handleTap();
    else if (phase === 'approved' || phase === 'declined') reset();
  }

  const buttonLabel = phase === 'idle'
    ? 'Tap to Pay'
    : busy
      ? 'Authorising…'
      : phase === 'approved'
        ? 'New payment'
        : 'Try again';

  const cardAnimate = phase === 'idle' || reduced
    ? {
        x: 0,
        y: 0,
        scale: 1,
        rotateX: reduced ? 0 : tilt.rx,
        rotateY: reduced ? 0 : tilt.ry,
        rotateZ: 0,
      }
    : flight;

  const cardTransition = reduced
    ? { duration: 0 }
    : phase === 'idle'
      ? { type: 'spring', stiffness: 260, damping: 22, mass: 0.55 }
      : { type: 'spring', stiffness: 108, damping: 16, mass: 0.9 };

  return (
    <section className="hero" aria-label="Tap to pay">
      <div className="stage">
        <div
          className="card-slot"
          ref={slotRef}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        >
          <PaymentCard
            meta={selected}
            animate={cardAnimate}
            transition={cardTransition}
            pointer={pointer}
            flying={!reduced && phase !== 'idle'}
          />
        </div>
      </div>

      <PosTerminal
        amount={amount}
        phase={phase}
        receipt={receipt}
        meta={selected}
        padRef={padRef}
        shellRef={terminalRef}
        reduced={reduced}
      />

      <form className="panel controls" onSubmit={onSubmit}>
        <div className="controls-inner">
          {online === false && (
            <p className="banner" role="status">
              Backend unreachable on port 5000. Taps will decline until it is running.
            </p>
          )}

          <div className="field-label-row">
            <p id="card-picker-label">Card</p>
            <p className="balance">
              Available <strong>{formatZMW(selected.balance)}</strong>
            </p>
          </div>
          <div className="card-picker" role="group" aria-labelledby="card-picker-label">
            {cards.map((card) => {
              const isSelected = card.id === cardId;
              return (
                <button
                  key={card.id}
                  type="button"
                  className={isSelected ? 'picker-card is-selected' : 'picker-card'}
                  aria-pressed={isSelected}
                  disabled={phase !== 'idle'}
                  onClick={() => setCardId(card.id)}
                >
                  <span className={`pip theme-${card.theme}`} aria-hidden="true" />
                  <span className="picker-copy">
                    <span className="picker-name">{card.product}</span>
                    <span className="picker-meta">•••• {card.last4}</span>
                  </span>
                  <span className="picker-balance">{formatZMW(card.balance, 0)}</span>
                </button>
              );
            })}
          </div>

          <label htmlFor="amount">Amount (ZMW)</label>
          <div className="amount-field">
            <span aria-hidden="true">ZMW</span>
            <input
              id="amount"
              name="amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              autoComplete="off"
              value={amount}
              disabled={phase !== 'idle'}
              onWheel={(event) => event.currentTarget.blur()}
              onChange={(event) => {
                setAmount(event.target.value);
                if (fieldError) setFieldError('');
              }}
            />
          </div>
          <div className="presets">
            {PRESETS.map((value) => (
              <button
                key={value}
                type="button"
                className={Number(amount) === value ? 'preset is-on' : 'preset'}
                disabled={phase !== 'idle'}
                onClick={() => {
                  setAmount(String(value));
                  setFieldError('');
                }}
              >
                {formatZMW(value, 0)}
              </button>
            ))}
          </div>
          {fieldError && (
            <p className="field-error" role="alert">
              {fieldError}
            </p>
          )}
          {!fieldError && overBalance && phase === 'idle' && (
            <p className="hint warn">
              This is over the available balance. The reader will decline it.
            </p>
          )}

          <button className="tap-btn" type="submit" disabled={busy} aria-busy={busy}>
            {buttonLabel}
          </button>
          <p className="fine-print">Simulated NFC. Nothing here charges a real card.</p>
        </div>
      </form>
    </section>
  );
}
