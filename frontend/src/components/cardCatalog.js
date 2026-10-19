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
    groups: ['5412', '8801', '••••', '4401'],
    demoBalance: 40000,
  },
  CARD002: {
    id: 'CARD002',
    product: 'Victoria Falls',
    holder: 'NAMAKAU BANDA',
    last4: '7720',
    exp: '04/27',
    network: 'VISA',
    theme: 'falls',
    groups: ['4539', '2210', '••••', '7720'],
    demoBalance: 35000,
  },
  CARD003: {
    id: 'CARD003',
    product: 'Copperbelt',
    holder: 'KABWE MWANSA',
    last4: '3194',
    exp: '11/29',
    network: 'MASTERCARD',
    theme: 'copper',
    groups: ['5508', '4419', '••••', '3194'],
    demoBalance: 19000,
  },
};

export const CARD_ORDER = ['CARD001', 'CARD002', 'CARD003'];

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
    theme: 'falls',
    groups: ['••••', '••••', '••••', last4],
    demoBalance: 0,
  };
}

export function formatAmount(value, digits = 2) {
  if (value === '' || value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-ZM', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatZMW(value, digits = 2) {
  const amount = formatAmount(value, digits);
  return amount === '—' ? 'ZMW —' : `ZMW ${amount}`;
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
