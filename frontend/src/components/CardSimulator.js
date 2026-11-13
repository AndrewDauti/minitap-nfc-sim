import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { authoriseTap, getWallets, issueCryptogram } from './api';
import { CARD_CATALOG, CARD_ORDER, formatMoney, moneyParts, sanitizeAmount } from './cardCatalog';
import PaymentCard from './PaymentCard';
import PosTerminal from './PosTerminal';

const REST_FLIGHT = { x: 0, y: 0, scale: 1, rotateX: 0, rotateY: 0, rotateZ: 0 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function friendlyError(err) {
  if (err?.payload?.error) return err.payload.error;
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
  const [pin, setPin] = useState('');
  const [pinPrompt, setPinPrompt] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [phase, setPhase] = useState('idle');
  const [flight, setFlight] = useState(REST_FLIGHT);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0 });
  const [pointer, setPointer] = useState({ x: 32, y: 18 });
  const [receipt, setReceipt] = useState(null);
  const [proof, setProof] = useState(null);
  const [previewTrace, setPreviewTrace] = useState(null);
  const [previewScore, setPreviewScore] = useState(null);
  const [traceKey, setTraceKey] = useState(0);
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
          if (current && rows.some((row) => row.cardRef === current)) return current;
          return rows[0]?.cardRef || CARD_ORDER[0];
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
    const live = wallets.find((row) => row.cardRef === id);
    return {
      ...meta,
      balance: live ? (live.spendable ?? live.balance) : meta.demoBalance,
      heldOffline: live && Number.isFinite(live.spendable)
        ? Math.round((Number(live.balance) - Number(live.spendable)) * 100) / 100
        : 0,
      currency: live?.currency || meta.currency,
      token: live?.token || '',
      contactlessLimit: live?.contactlessLimit ?? meta.contactlessLimit,
      locked: Boolean(live?.locked),
      maskedPan: live?.maskedPan || `•••• •••• •••• ${meta.last4}`,
    };
  });
  const selected = cards.find((card) => card.id === cardId) || cards[0];
  const amountPrefix = moneyParts(0, selected.currency).prefix;
  const numericAmount = Number(amount);
  const overBalance = Number.isFinite(numericAmount) && numericAmount > selected.balance;
  const showPin = !selected.locked && (
    pinPrompt || (Number.isFinite(numericAmount) && numericAmount > selected.contactlessLimit)
  );
  const busy = phase === 'tapping' || phase === 'processing';
  const liveTrace = phase === 'approved' || phase === 'declined' ? receipt?.data?.trace : previewTrace;
  const liveScore = phase === 'approved' || phase === 'declined' ? receipt?.data?.riskScore : previewScore;

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
    setPreviewTrace(null);
    setFlight(REST_FLIGHT);
    setTilt({ rx: 0, ry: 0 });
  }

  async function runPayment(lab) {
    if (lab === 'replay') return authoriseTap(proof);
    if (lab === 'tamper') {
      const nextAmount = (Math.round((Number(proof.amount) + 25) * 100) / 100).toFixed(2);
      return authoriseTap({ ...proof, amount: nextAmount });
    }
    const issued = await issueCryptogram({
      token: selected.token,
      amount,
      currency: selected.currency,
    });
    const nextProof = {
      token: issued.token,
      amount: issued.amount,
      currency: issued.currency,
      atc: issued.atc,
      nonce: issued.nonce,
      cryptogram: issued.cryptogram,
    };
    setProof(nextProof);
    return authoriseTap({
      ...nextProof,
      pin: showPin ? pin : undefined,
    });
  }

  async function startAuthorisation(lab) {
    if (lock.current) return;
    if (!lab && phase !== 'idle') return;
    if (lab && !proof) return;

    if (!lab) {
      if (!selected.token) {
        setFieldError('Still waiting for the till.');
        return;
      }
      if (!String(amount).trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
        setFieldError('Enter an amount greater than zero.');
        return;
      }
      if (numericAmount > selected.maxAmount) {
        setFieldError(`Enter at most ${formatMoney(selected.maxAmount, selected.currency)}.`);
        return;
      }
      if (showPin && !/^\d{4,6}$/.test(pin)) {
        setFieldError('Enter the 4-digit classroom PIN.');
        return;
      }
    }

    setFieldError('');
    setPreviewTrace(null);
    lock.current = true;
    setPhase('tapping');
    const tapPromise = runPayment(lab).then(
      (data) => ({ ok: true, data }),
      (err) => ({ ok: false, message: friendlyError(err), data: err?.payload || null })
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

      if (result.data?.code === 'PIN_REQUIRED') {
        setPinPrompt(true);
        setPreviewTrace(result.data.trace || null);
        setPreviewScore(result.data.riskScore);
        setTraceKey((value) => value + 1);
        setReceipt(null);
        setPhase('idle');
        setFlight(REST_FLIGHT);
        return;
      }

      if (result.data?.code === 'PIN_INCORRECT' || result.data?.code === 'PIN_LOCKED') {
        setPin('');
      }
      if (result.data?.code === 'PIN_LOCKED') {
        setWallets((rows) => rows.map((row) => (
          row.cardRef === cardId ? { ...row, locked: true } : row
        )));
      }
      if (result.ok) {
        setPin('');
        setPinPrompt(false);
      }

      setReceipt(result);
      setTraceKey((value) => value + 1);
      setPhase(result.ok ? 'approved' : 'declined');
      if (onSettled && result.data?.id) onSettled();
      await refreshWallets();
    } finally {
      lock.current = false;
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    if (phase === 'idle') startAuthorisation();
    else if (phase === 'approved' || phase === 'declined') reset();
  }

  let buttonLabel = 'Tap to Pay';
  if (phase === 'idle' && selected.locked) buttonLabel = 'Card locked';
  else if (phase === 'idle' && showPin) buttonLabel = 'Tap with PIN';
  else if (busy) buttonLabel = 'Authorising…';
  else if (phase === 'approved') buttonLabel = 'New payment';
  else if (phase === 'declined') buttonLabel = 'Try again';

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
        trace={liveTrace}
        riskScore={liveScore}
        traceKey={traceKey}
        hasProof={Boolean(proof)}
        labEnabled={Boolean(proof) && !busy}
        onReplay={() => startAuthorisation('replay')}
        onTamper={() => startAuthorisation('tamper')}
      />

      <form className="panel controls" onSubmit={onSubmit}>
        <div className="controls-inner">
          {online === false && (
            <p className="banner" role="status">
              Backend unreachable on port 5000. Taps will decline until it is running.
            </p>
          )}
          {selected.locked && (
            <p className="banner" role="status">
              This card is locked after repeated PIN failures. Restart the API to clear the classroom wallet.
            </p>
          )}

          <div className="field-label-row">
            <p id="card-picker-label">Card</p>
            <p className="balance">
              Available <strong>{formatMoney(selected.balance, selected.currency)}</strong>
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
                  onClick={() => {
                    setCardId(card.id);
                    setAmount(card.defaultAmount);
                    setPin('');
                    setPinPrompt(false);
                    setProof(null);
                    setFieldError('');
                  }}
                >
                  <span className={`pip theme-${card.theme}`} aria-hidden="true" />
                  <span className="picker-copy">
                    <span className="picker-name">{card.product}</span>
                    <span className="picker-meta">•••• {card.last4}</span>
                  </span>
                  <span className="picker-balance">{formatMoney(card.balance, card.currency, 0)}</span>
                </button>
              );
            })}
          </div>
          <p className="classroom-pin">
            Classroom PIN for this card <strong>{selected.classroomPin}</strong>
          </p>
          {selected.heldOffline > 0 && (
            <p className="hint">
              {`${formatMoney(selected.heldOffline, selected.currency)} is set aside for offline taps.`}
            </p>
          )}

          <label htmlFor="amount">Amount ({selected.currency})</label>
          <div className="amount-field">
            <span className={amountPrefix.length === 1 ? 'is-symbol' : undefined} aria-hidden="true">
              {amountPrefix}
            </span>
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="0.00"
              aria-describedby="amount-cap"
              value={amount}
              disabled={phase !== 'idle'}
              onChange={(event) => {
                setAmount(sanitizeAmount(event.target.value, selected.maxAmount));
                if (fieldError) setFieldError('');
              }}
            />
          </div>
          <p id="amount-cap" className="hint amount-cap">
            {`Maximum ${formatMoney(selected.maxAmount, selected.currency)}`}
          </p>
          <div className="presets">
            {selected.presets.map((value) => (
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
                {formatMoney(value, selected.currency, 0)}
              </button>
            ))}
          </div>
          {showPin && (
            <div className="pin-field">
              <label htmlFor="pin">PIN</label>
              <input
                id="pin"
                name="pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={6}
                value={pin}
                disabled={phase !== 'idle'}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, '').slice(0, 6));
                  if (fieldError) setFieldError('');
                }}
              />
              <p className="hint">
                {pinPrompt
                  ? 'The risk check wants a PIN. Enter it and tap again. '
                  : `Taps over ${formatMoney(selected.contactlessLimit, selected.currency, 0)} ask for a PIN. `}
                {`Use ${selected.classroomPin}.`}
              </p>
            </div>
          )}
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

          <button className="tap-btn" type="submit" disabled={busy || selected.locked} aria-busy={busy}>
            {buttonLabel}
          </button>
          <p className="fine-print">Simulated NFC. Nothing here charges a real card. The checks are a classroom model.</p>
        </div>
      </form>
    </section>
  );
}
