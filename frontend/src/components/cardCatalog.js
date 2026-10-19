// Public simulator ids and masked numbers only. The PAN stays on the server.
export const MERCHANT = {
  name: 'Mpepo Grocer',
  place: 'Cairo Road, Lusaka',
};

export const CARD_CATALOG = {
  CARD001: {
    id: 'CARD001',
    product: 'ZamPay Kwacha',
    holder: 'CHILESHE PHIRI',
    last4: '4401',
    exp: '09/28',
    network: 'VISA',
    theme: 'kwacha',
    currency: 'ZMW',
    groups: ['••••', '••••', '••••', '4401'],
    contactlessLimit: 200,
    demoBalance: 40000,
    presets: [50, 150, 500, 1000],
    defaultAmount: '150',
    maxAmount: 99999.99,
    classroomPin: '2580',
  },
  CARD002: {
    id: 'CARD002',
    product: 'Liberty Dollar',
    holder: 'NAMAKAU BANDA',
    last4: '7720',
    exp: '04/27',
    network: 'VISA',
    theme: 'liberty',
    currency: 'USD',
    groups: ['••••', '••••', '••••', '7720'],
    contactlessLimit: 50,
    demoBalance: 2500,
    presets: [5, 20, 50, 100],
    defaultAmount: '20',
    maxAmount: 9999.99,
    classroomPin: '1492',
  },
  CARD003: {
    id: 'CARD003',
    product: 'Alpine Franc',
    holder: 'KABWE MWANSA',
    last4: '3194',
    exp: '11/29',
    network: 'MASTERCARD',
    theme: 'alpine',
    currency: 'CHF',
    groups: ['••••', '••••', '••••', '3194'],
    contactlessLimit: 40,
    demoBalance: 1800,
    presets: [10, 25, 50, 100],
    defaultAmount: '25',
    maxAmount: 9999.99,
    classroomPin: '7731',
  },
};

export const CARD_ORDER = ['CARD001', 'CARD002', 'CARD003'];

const CURRENCY_LOCALE = {
  ZMW: 'en-ZM',
  USD: 'en-US',
  CHF: 'de-CH',
};

export function metaFor(cardId) {
  if (CARD_CATALOG[cardId]) return CARD_CATALOG[cardId];
  const last4 = String(cardId || '0000').slice(-4).padStart(4, '0');
  return {
    id: cardId,
    product: 'MiniTap Card',
    holder: 'CARDHOLDER',
    last4,
    exp: '—',
    network: 'VISA',
    theme: 'kwacha',
    currency: 'ZMW',
    groups: ['••••', '••••', '••••', last4],
    contactlessLimit: 200,
    demoBalance: 0,
    presets: [50, 150, 500, 1000],
    defaultAmount: '150',
    maxAmount: 99999.99,
  };
}

function currencyDisplay(currency) {
  return currency === 'USD' ? 'symbol' : 'code';
}

export function moneyParts(value, currency = 'ZMW', digits = 2) {
  const prefix = currency === 'USD' ? '$' : currency;
  const blank = { prefix, number: '—', text: currency === 'USD' ? '$ —' : `${currency} —` };
  const amount = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(amount)) {
    return blank;
  }
  const parts = new Intl.NumberFormat(CURRENCY_LOCALE[currency] || 'en', {
    style: 'currency',
    currency,
    currencyDisplay: currencyDisplay(currency),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).formatToParts(amount);
  const resolvedPrefix = parts.find((part) => part.type === 'currency')?.value || prefix;
  const number = parts
    .filter((part) => part.type !== 'currency' && part.type !== 'literal')
    .map((part) => part.value)
    .join('');
  const text = parts
    .map((part) => part.value)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/\u202f/g, ' ');
  return { prefix: resolvedPrefix, number, text };
}

export function formatMoney(value, currency = 'ZMW', digits = 2) {
  return moneyParts(value, currency, digits).text;
}

function formatCap(maxAmount) {
  const fixed = Number(maxAmount).toFixed(2);
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

// Keeps a typed amount inside the till: digits only, one decimal point,
// two decimal places, and never above the card's maximum.
export function sanitizeAmount(raw, maxAmount) {
  const max = Number(maxAmount);
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  if (!cleaned) return '';
  const dot = cleaned.indexOf('.');
  let whole = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const fraction = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  whole = whole.replace(/^0+(?=\d)/, '');
  const maxWholeDigits = String(Math.floor(max)).length;
  if (whole.length > maxWholeDigits) return formatCap(max);
  const text = fraction === null ? whole : `${whole === '' ? '0' : whole}.${fraction}`;
  const numeric = Number(text.endsWith('.') ? text.slice(0, -1) : text);
  if (text !== '' && Number.isFinite(numeric) && numeric > max) return formatCap(max);
  return text;
}

export function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
