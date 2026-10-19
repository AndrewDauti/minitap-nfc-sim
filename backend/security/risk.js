const { VELOCITY_STEP_UP } = require('./policy');

function assessRisk({ amountCents, balanceCents, limitCents, ceilingCents, recentCount }) {
  const overBalance = amountCents > balanceCents;
  let score = 0;
  const reasons = [];

  if (!overBalance && amountCents > ceilingCents) {
    score += 70;
    reasons.push('Over the per-tap ceiling');
  } else if (amountCents > limitCents) {
    score += 35;
    reasons.push('Over the contactless limit');
  }

  if (recentCount >= VELOCITY_STEP_UP) {
    score += 45;
    reasons.push('Four or more taps in two minutes');
  } else if (recentCount >= 2) {
    score += 12;
    reasons.push('More than one recent tap');
  }

  let decision = 'allow';
  if (!overBalance && amountCents > ceilingCents) decision = 'decline';
  else if (!overBalance && (amountCents > limitCents || recentCount >= VELOCITY_STEP_UP)) {
    decision = 'step_up';
  }

  return {
    score: Math.min(100, score),
    decision,
    reasons,
    overBalance,
  };
}

function noteRecent(card, now, windowMs) {
  card.recent = card.recent.filter((stamp) => now - stamp < windowMs);
  card.recent.push(now);
  return card.recent.length;
}

module.exports = { assessRisk, noteRecent };
