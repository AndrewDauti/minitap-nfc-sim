import { motion } from 'framer-motion';
import { Chip, Contactless } from './icons';

export default function PaymentCard({ meta, animate, transition, pointer, flying }) {
  return (
    <motion.article
      className={`pay-card theme-${meta.theme}${flying ? ' is-flying' : ''}`}
      animate={animate}
      transition={transition}
      initial={false}
      style={{
        transformPerspective: 1000,
        '--mx': `${pointer.x}%`,
        '--my': `${pointer.y}%`,
      }}
      aria-label={`${meta.product}, card ending ${meta.last4}`}
    >
      <div className="card-gloss" />
      <div className="sheen" />
      <div className="glare" />
      <div className="card-face">
        <div className="card-top">
          <div className="card-brand">
            <strong>{meta.product}</strong>
            <small>{meta.theme === 'kwacha' ? 'Debit · ZMW' : 'Debit'}</small>
          </div>
          <Contactless />
        </div>
        <div className="chip-row">
          <Chip />
          <span className="holo" aria-hidden="true" />
        </div>
        <p className="pan">
          {meta.groups.map((group, index) => (
            <span key={`${group}-${index}`}>{group}</span>
          ))}
        </p>
        <div className="card-bottom">
          <div>
            <p className="label">Cardholder</p>
            <p className="value">{meta.holder}</p>
          </div>
          <div>
            <p className="label">Expires</p>
            <p className="value">{meta.exp}</p>
          </div>
          {meta.network === 'MASTERCARD' ? (
            <span className="mc" aria-label="Mastercard">
              <span />
              <span />
            </span>
          ) : (
            <span className="visa">VISA</span>
          )}
        </div>
        {meta.theme === 'kwacha' && <span className="flag-ribbon" aria-hidden="true" />}
      </div>
    </motion.article>
  );
}
