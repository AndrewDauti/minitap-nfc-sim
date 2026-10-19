import { AnimatePresence, motion } from 'framer-motion';
import { MERCHANT, formatAmount, formatZMW } from './cardCatalog';
import { Contactless, StatusMark } from './icons';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '·', '0', '↵'];

export default function PosTerminal({
  amount,
  phase,
  receipt,
  meta,
  padRef,
  shellRef,
  reduced,
}) {
  const screenKey = phase === 'tapping' ? 'ready' : phase;
  const showRipples = !reduced && (phase === 'tapping' || phase === 'processing');
  const amountNumber = formatAmount(amount);
  const approvedAmount = receipt?.ok ? formatAmount(receipt.data.amount) : amountNumber;
  const balanceAfter = receipt?.ok ? formatZMW(receipt.data.balanceAfter) : null;

  const shellVariants = reduced
    ? { still: { x: 0 }, nudge: { x: 0 }, shake: { x: 0 } }
    : {
        still: { x: 0 },
        nudge: { x: [0, -3, 3, -2, 1, 0] },
        shake: { x: [0, -12, 10, -8, 6, -3, 0] },
      };

  const variant = phase === 'declined' ? 'shake' : phase === 'approved' ? 'nudge' : 'still';

  let copy;
  if (screenKey === 'processing') {
    copy = (
      <>
        <span className="spinner" aria-hidden="true" />
        <p className="screen-status">Authorising</p>
      </>
    );
  } else if (screenKey === 'approved') {
    copy = (
      <>
        <StatusMark kind="ok" reduced={reduced} />
        <p className="screen-status">Approved</p>
        <p className="screen-amount">
          <span>ZMW</span>
          {approvedAmount}
        </p>
        {balanceAfter && <p className="screen-hint">Balance {balanceAfter}</p>}
      </>
    );
  } else if (screenKey === 'declined') {
    copy = (
      <>
        <StatusMark kind="bad" reduced={reduced} />
        <p className="screen-status">Declined</p>
        <p className="screen-message">{receipt?.message || 'Tap declined'}</p>
      </>
    );
  } else {
    copy = (
      <>
        <p className="screen-kicker">MINITAP</p>
        <p className="screen-merchant">{MERCHANT.name}</p>
        <p className="screen-place">{MERCHANT.place}</p>
        <p className="screen-amount">
          <span>ZMW</span>
          {amountNumber}
        </p>
        <p className="screen-hint">•••• {meta.last4} · Hold to pay</p>
      </>
    );
  }

  return (
    <div className="terminal-wrap">
      <motion.div
        ref={shellRef}
        className={`terminal phase-${phase}`}
        initial={false}
        animate={variant}
        variants={shellVariants}
        transition={{ duration: phase === 'declined' ? 0.48 : 0.36 }}
      >
        <div className="terminal-top">
          <span className="terminal-brand">MINITAP POS</span>
          <span className={`led led-${phase}`} aria-hidden="true" />
        </div>
        <div className="reader">
          <div className="pad" ref={padRef}>
            <Contactless className="contactless pad-icon" />
            {showRipples && (
              <span className="ripples" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        </div>
        <div className="screen" aria-live="polite">
          {reduced ? (
            <div className="screen-copy">{copy}</div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={screenKey}
                className="screen-copy"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22 }}
              >
                {copy}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
        <div className="speaker" aria-hidden="true" />
        <div className="keypad" aria-hidden="true">
          {KEYS.map((key) => (
            <span className="key" key={key}>
              {key}
            </span>
          ))}
        </div>
        <p className="keypad-caption">Keypad hint · amount is set on the till</p>
      </motion.div>
    </div>
  );
}
