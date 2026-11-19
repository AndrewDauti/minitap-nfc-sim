import { useId, useState } from 'react';

export default function Hint({ label, children }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  return (
    <span className="hint-wrap">
      <button
        type="button"
        className="hint-btn"
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sr-only">{open ? `Hide help: ${label}` : `Help: ${label}`}</span>
        <span aria-hidden="true">?</span>
      </button>
      {open ? (
        <span id={tipId} className="hint-pop" role="note">
          {children}
        </span>
      ) : null}
    </span>
  );
}
