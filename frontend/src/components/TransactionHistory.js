import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { getTransactions } from './api';
import { formatWhen, formatZMW, metaFor } from './cardCatalog';

function statusOf(tx) {
  return tx.status === 'declined' ? 'declined' : 'approved';
}

export default function TransactionHistory({ revision }) {
  const reduced = useReducedMotion() === true;
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getTransactions()
      .then((rows) => {
        if (!active) return;
        setHistory(rows);
        setError('');
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError('Could not reach the till.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const ordered = [...history].sort((a, b) => {
    const delta = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (delta !== 0) return delta;
    return (b.id || 0) - (a.id || 0);
  });

  return (
    <section className="history panel" aria-labelledby="activity-title">
      <div className="section-head">
        <h2 id="activity-title">Activity</h2>
        <p>
          {loading && history.length === 0
            ? 'Syncing the till…'
            : history.length === 0
              ? 'Waiting for the first tap'
              : `${history.length} recorded`}
        </p>
      </div>
      {error && (
        <p className="banner" role="status">
          {error}
        </p>
      )}
      {loading && history.length === 0 ? (
        <div className="tx-skeleton" aria-hidden="true">
          <span />
          <span />
        </div>
      ) : ordered.length === 0 ? (
        <p className="empty">No taps yet. Choose a card and tap to pay.</p>
      ) : (
        <ul className="tx-scroll">
          <AnimatePresence initial={false}>
            {ordered.map((tx) => {
              const meta = metaFor(tx.cardId);
              const status = statusOf(tx);
              return (
                <motion.li
                  key={tx.id}
                  className={`tx-item is-${status}`}
                  layout={reduced ? false : 'position'}
                  initial={reduced ? false : { opacity: 0, y: -16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: 8 }}
                  transition={{ duration: reduced ? 0 : 0.35 }}
                >
                  <div className="tx-lead">
                    <span className={`status-chip is-${status}`}>
                      {status === 'declined' ? 'Declined' : 'Approved'}
                    </span>
                    <span className="tx-product">{meta.product}</span>
                  </div>
                  <p className="tx-amount">{formatZMW(tx.amount)}</p>
                  <p className="tx-meta">
                    <span className="tx-last4">•••• {meta.last4}</span>
                    <span aria-hidden="true"> · </span>
                    <time dateTime={tx.timestamp}>{formatWhen(tx.timestamp)}</time>
                  </p>
                  {status === 'declined' && tx.reason ? (
                    <p className="tx-reason">{tx.reason}</p>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
