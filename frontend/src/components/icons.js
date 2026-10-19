import { motion } from 'framer-motion';

export function Contactless({ className = 'contactless' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 8.2c2.2 2 2.2 5.6 0 7.6" />
      <path d="M12 5.2c3.6 3.2 3.6 10.4 0 13.6" />
      <path d="M15.5 2.6c5 4.4 5 14.4 0 18.8" />
    </svg>
  );
}

export function Chip() {
  return (
    <svg className="emv" viewBox="0 0 46 34" aria-hidden="true">
      <defs>
        <linearGradient id="chipGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f8e7b5" />
          <stop offset="0.45" stopColor="#c79a45" />
          <stop offset="1" stopColor="#f3d48a" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="45" height="33" rx="6" fill="url(#chipGold)" stroke="rgba(90,60,10,0.45)" />
      <path d="M0 11.5h46M0 22.5h46M16 0v34M30 0v34" stroke="rgba(80,50,10,0.35)" strokeWidth="1" />
    </svg>
  );
}

export function StatusMark({ kind, reduced }) {
  const ring = { duration: reduced ? 0 : 0.35 };
  const tick = { duration: reduced ? 0 : 0.28, delay: reduced ? 0 : 0.16 };
  if (kind === 'ok') {
    return (
      <motion.svg className="mark" viewBox="0 0 52 52" aria-hidden="true">
        <motion.circle
          cx="26"
          cy="26"
          r="23"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={ring}
        />
        <motion.path
          d="M15.5 27.2 22.2 34 37 18.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={tick}
        />
      </motion.svg>
    );
  }

  return (
    <motion.svg className="mark" viewBox="0 0 52 52" aria-hidden="true">
      <motion.circle
        cx="26"
        cy="26"
        r="23"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={ring}
      />
      <motion.path
        d="M18 18 34 34M34 18 18 34"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={tick}
      />
    </motion.svg>
  );
}
