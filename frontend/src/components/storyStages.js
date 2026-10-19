// Copy is tied to backend/security/policy.js and cryptoAgility.js.
// Contactless limits: ZMW 200, USD 50, CHF 40.
// Ceilings: ZMW 8000, USD 800, CHF 600.

export const STAGES = [
  {
    id: 'chip-cryptogram',
    nav: 'Cryptogram',
    kicker: '01 · Chip code',
    title: 'Every tap gets its own code',
    accent: '#3ddc97',
    body: 'The chip builds a one-time code from the amount, the currency, a counter (the ATC), and a random terminal number. MiniTap checks it with HMAC-SHA256, or AES-CMAC if you switch suites. Change the amount after signing and the check fails. Present the same code twice and the replay check rejects it.',
  },
  {
    id: 'tokenization',
    nav: 'Token',
    kicker: '02 · Token',
    title: 'The till never sees the real card number',
    accent: '#8fd8ff',
    body: 'The real card number, the PAN, stays in the server vault. The browser receives a token and a masked number, •••• 4401. The till, the activity list, and the logs never get the full PAN. The token is only a stand-in.',
  },
  {
    id: 'pin-check',
    nav: 'PIN',
    kicker: '03 · PIN',
    title: 'Bigger taps ask for a PIN',
    accent: '#f5c16c',
    body: 'Over ZMW 200, USD 50, or CHF 40, MiniTap asks for a PIN. The same happens when a tap looks risky. The PIN is stored as a bcrypt hash and is never written to the log. Three wrong tries lock the card. A real pad would encrypt the PIN with DUKPT, a key that changes every transaction. Here, the stand-in is the hash and the lockout.',
  },
  {
    id: 'terminal-session',
    nav: 'Session',
    kicker: '04 · Session',
    title: 'The terminal has to show a pass',
    accent: '#c9b6ff',
    body: 'The till first collects a short-lived signed pass, a JWT. Payment calls without one are refused. Helmet, an origin allow-list, and a rate limit sit in front of the API. On a shop network, TLS would carry this same conversation.',
  },
  {
    id: 'key-vault',
    nav: 'Key vault',
    kicker: '05 · Keys',
    title: 'The card key stays in the vault',
    accent: '#f3d48a',
    body: 'The key that builds the tap code never leaves the vault, and it is not in the React app. A bank would keep that key in a hardware security module, a device that can use a key but will not hand it out. The vault module is that boundary.',
  },
  {
    id: 'fraud-checks',
    nav: 'Fraud checks',
    kicker: '06 · Fraud',
    title: 'The bank looks at the pattern',
    accent: '#ff9b7a',
    body: 'Four taps in two minutes, or an amount over the contactless limit, asks for a PIN. Over ZMW 8,000, USD 800, or CHF 600, the tap is declined even when the code is valid. Spending more than the balance is declined too, and the balance does not move. The log keeps the result and the masked number, not the PIN, the PAN, or the key.',
  },
  {
    id: 'post-quantum',
    nav: 'Post-quantum',
    kicker: '07 · Later',
    title: 'Room for cryptography that outlasts quantum computers',
    accent: '#b9a7ff',
    body: 'Today’s tap code is a symmetric MAC. A large quantum computer would threaten the public-key steps around it: agreeing a session key, and signing. The server keeps open slots for ML-KEM and ML-DSA. Neither slot is switched on. See backend/security/cryptoAgility.js.',
  },
];
