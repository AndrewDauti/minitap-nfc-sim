import { useDemo } from './DemoContext';
import Hint from './Hint';
import { formatK } from './offlineCrypto';

export function DemoStatus() {
  const demo = useDemo();
  const online = demo.network === 'online';
  return (
    <p className="demo-status" aria-live="polite">
      <strong>{demo.merchant.name}</strong>
      <span className={online ? 'is-on' : 'is-off'}>{online ? 'Online' : 'Offline'}</span>
      <span>{demo.nextCue}</span>
    </p>
  );
}

export default function MerchantPicker({ variant = 'demo', disabled = false }) {
  const demo = useDemo();
  const labelId = variant === 'demo' ? 'shop-picker-label' : 'classroom-shop-label';

  function onKeyDown(event) {
    if (disabled) return;
    const shops = demo.merchants;
    const index = Math.max(0, shops.findIndex((shop) => shop.ref === demo.merchant.ref));
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % shops.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + shops.length) % shops.length;
    else return;
    event.preventDefault();
    const shop = shops[next];
    demo.selectMerchant(shop.ref);
    const button = event.currentTarget.querySelector(`[data-shop="${shop.ref}"]`);
    if (button instanceof HTMLButtonElement) button.focus();
  }

  return (
    <div className={variant === 'classroom' ? 'shop-picker' : 'merchant-picker-block'}>
      <div className="picker-head">
        <p id={labelId}>Shop</p>
        <Hint label="shops and till passes">
          Pick the shop before the tap. The till pass is the classroom password for that terminal. A sale signed for one shop cannot be replayed or sent to another.
        </Hint>
      </div>
      <div
        className={variant === 'classroom' ? 'shop-picker-row' : 'merchant-picker'}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
      >
        {demo.merchants.map((shop) => {
          const selected = shop.ref === demo.merchant.ref;
          return (
            <button
              key={shop.ref}
              type="button"
              role="radio"
              data-shop={shop.ref}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => demo.selectMerchant(shop.ref)}
            >
              <span className="merchant-kicker">{shop.category}</span>
              <strong>{shop.name}</strong>
              <span>{shop.place} · Till pass {shop.terminalCode}</span>
              <em>Settled {formatK(shop.balance || 0)}</em>
            </button>
          );
        })}
      </div>
      {variant === 'demo' ? (
        <p className="picker-help">Sales, books, and the example tax follow the shop that is pressed.</p>
      ) : (
        <p className="picker-help">Kwacha taps credit this shop. Dollar and franc taps stay on the card.</p>
      )}
    </div>
  );
}
