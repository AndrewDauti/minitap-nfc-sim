import { useEffect, useState } from 'react';

const RESULT_LABEL = {
  passed: 'Passed',
  failed: 'Failed',
  skipped: 'Skipped',
  step_up: 'Step-up',
};

export default function SecurityTrace({ trace, riskScore, startOpen = true, traceKey = 0 }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => {
    setOpen(startOpen);
  }, [traceKey, startOpen]);
  if (!Array.isArray(trace) || trace.length === 0) return null;

  const failed = trace.find((step) => step.result === 'failed');
  const score = typeof riskScore === 'number' ? ` · risk ${riskScore}` : '';
  const summary = failed
    ? `Security trace · ${failed.label} failed`
    : `Security trace · checks passed${score}`;

  return (
    <details
      className="trace"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{summary}</summary>
      <ol className="trace-list">
        {trace.map((step) => (
          <li key={step.id} className={`trace-item is-${step.result}`}>
            <span className="trace-dot" aria-hidden="true" />
            <span className="trace-label">{step.label}</span>
            <span className="trace-result">{RESULT_LABEL[step.result] || step.result}</span>
            <p className="trace-detail">{step.detail}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
