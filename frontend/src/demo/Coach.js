import { useEffect, useRef } from 'react';

export const COACH_KEY = 'minitap-coach-v1';

export const COACH_STEPS = [
  {
    id: 'shop',
    title: 'Pick the shop first',
    body: 'Mutale Store, Bwalya Pharmacy, and Tembo Coach are fixed demo shops. Each has its own till pass. The shop you pick is the one that gets the sale.',
  },
  {
    id: 'network',
    title: 'Online and offline',
    body: 'Use Online to set aside an allowance and to sync. Offline keeps the sale on this phone. Switch back to Online and the queue settles to the shop that took it.',
  },
  {
    id: 'allowance',
    title: 'Set aside an allowance',
    body: 'On the customer phone, choose K100, K300, or K500 while Network is Online. That locks spendable money and loads single-use tokens. An offline tap cannot spend more than what is left.',
  },
  {
    id: 'pay',
    title: 'Take a payment',
    body: 'Enter an amount on the till, press Take payment, then Tap to pay. The phone checks the signature, the counter, and the shop. It does not call the server while you are offline.',
  },
  {
    id: 'after',
    title: 'Books, Network, and checks',
    body: 'Books shows the selected shop, including the invoice draft and example tax. Network lists every shop from this session. Security checks can replay a token or send a sale to another shop.',
  },
];

export default function Coach({ step, onStep, onClose }) {
  const titleRef = useRef(null);
  const current = COACH_STEPS[step] || COACH_STEPS[0];
  const last = step >= COACH_STEPS.length - 1;

  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section className="coach" aria-labelledby="coach-title">
      <p className="coach-kicker">{`Tip ${step + 1} of ${COACH_STEPS.length}`}</p>
      <h2 id="coach-title" tabIndex={-1} ref={titleRef}>{current.title}</h2>
      <p id="coach-body">{current.body}</p>
      <div className="coach-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>
          Skip tips
        </button>
        {step > 0 ? (
          <button type="button" className="btn-ghost" onClick={() => onStep(step - 1)}>
            Back
          </button>
        ) : null}
        <button type="button" className="btn-green coach-next" onClick={() => (last ? onClose() : onStep(step + 1))}>
          {last ? 'Done' : 'Next'}
        </button>
      </div>
    </section>
  );
}
