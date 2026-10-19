# MiniTap NFC Simulator

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/AndrewDauti/minitap-nfc-sim?style=flat-square)](https://github.com/AndrewDauti/minitap-nfc-sim/commits/main)
[![Open Issues](https://img.shields.io/github/issues/AndrewDauti/minitap-nfc-sim?color=orange&style=flat-square)](https://github.com/AndrewDauti/minitap-nfc-sim/issues)
[![Repo Status](https://img.shields.io/badge/status-active-brightgreen.svg)](https://github.com/AndrewDauti/minitap-nfc-sim)

A lightweight tap-to-pay simulator. The React till shows a glossy card and a point-of-sale terminal. Tapping posts to an Express API that debits an in-memory wallet in that card's currency and returns an approval or a decline.

## Project structure

```
.
├── LICENSE
├── README.md
├── docs
│   ├── minitap-idle.png
│   ├── minitap-tapping.png
│   ├── minitap-approved.png
│   └── minitap-tap.gif
├── backend
│   ├── controllers
│   │   └── transactionController.js
│   ├── models
│   │   └── walletModel.js
│   ├── package.json
│   ├── routes
│   │   └── api.js
│   ├── server.js
│   └── utils
│       └── mockData.js
└── frontend
    ├── package.json
    ├── public
    │   ├── favicon.svg
    │   └── index.html
    └── src
        ├── App.js
        ├── index.css
        ├── index.js
        └── components
            ├── CardSimulator.js
            ├── PaymentCard.js
            ├── PosTerminal.js
            ├── TransactionHistory.js
            ├── api.js
            ├── cardCatalog.js
            └── icons.js
```

## Prerequisites

- Node.js 18 or newer
- npm 9 or newer

Balances and the activity list live in process memory. Restarting the backend restores the seed wallets and clears transactions.

## Run the backend

From the repository root, in one terminal:

```bash
cd backend
npm install
npm start
```

The API listens on **port 5000** (`http://localhost:5000`). Override it with `PORT` if you need another port:

```bash
PORT=5000 npm start
```

## Run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm start
```

The dev server listens on **port 3000**. Open [http://localhost:3000](http://localhost:3000).

The UI calls `http://localhost:5000` by default. Point it at another API origin with:

```bash
REACT_APP_API_URL=http://localhost:5000 npm start
```

Production build:

```bash
cd frontend
npm run build
```

## Cards

The till offers three mock cards. The API identifies them by `cardId`. The last four digits are display-only.

| Card | cardId | Last 4 | Currency | Opening balance |
| --- | --- | --- | --- | --- |
| ZamPay Kwacha | `CARD001` | 4401 | ZMW | ZMW 40,000.00 |
| Liberty Dollar | `CARD002` | 7720 | USD | $2,500.00 |
| Alpine Franc | `CARD003` | 3194 | CHF | CHF 1’800.00 |

ZamPay Kwacha stays on the Zambian kwacha (ZMW). Liberty Dollar transacts in US dollars (USD). Alpine Franc transacts in Swiss francs (CHF). The till shows that currency on the card, the amount field, the quick amounts, the terminal, and each activity row. An amount above that card's live balance is declined by `POST /api/tap` in the card's own currency, and the terminal plays the declined state. The decline does not change the balance.

## API

All routes are under `/api`. Send and receive JSON.

### `POST /api/tap`

Debit a wallet. Approved taps reduce the balance. Declined taps (insufficient funds) are stored with `status: "declined"` and do not change the balance.

Request:

```bash
curl -s -X POST http://localhost:5000/api/tap \
  -H 'Content-Type: application/json' \
  -d '{"cardId":"CARD001","amount":150}'
```

```json
{
  "cardId": "CARD001",
  "amount": 150
}
```

`amount` may be a number or a numeric string.

Approved — `200`:

```json
{
  "message": "Tap successful",
  "id": 1,
  "timestamp": "2026-10-19T00:30:00.000Z",
  "cardId": "CARD001",
  "amount": 150,
  "currency": "ZMW",
  "balanceAfter": 39850,
  "status": "approved"
}
```

Insufficient balance — `400`:

```json
{
  "error": "Insufficient balance",
  "id": 2,
  "timestamp": "2026-10-19T00:31:00.000Z",
  "cardId": "CARD001",
  "amount": 50000,
  "currency": "ZMW",
  "balanceAfter": 39850,
  "status": "declined",
  "reason": "Insufficient balance"
}
```

Other errors:

| Status | Body | When |
| --- | --- | --- |
| 400 | `{ "error": "Card ID and amount are required" }` | Missing `cardId` or `amount` |
| 400 | `{ "error": "Amount must be a positive number" }` | Zero, negative, or non-numeric amount |
| 404 | `{ "error": "Card not registered" }` | Unknown `cardId` |

### `GET /api/transactions`

Newest taps are not pre-sorted; the UI sorts them. The array is empty until the first tap.

```bash
curl -s http://localhost:5000/api/transactions
```

```json
[
  {
    "id": 1,
    "timestamp": "2026-10-19T00:30:00.000Z",
    "cardId": "CARD001",
    "amount": 150,
    "currency": "ZMW",
    "balanceAfter": 39850,
    "status": "approved"
  }
]
```

### `GET /api/wallets`

```bash
curl -s http://localhost:5000/api/wallets
```

```json
[
  { "cardId": "CARD001", "balance": 40000, "currency": "ZMW" },
  { "cardId": "CARD002", "balance": 2500, "currency": "USD" },
  { "cardId": "CARD003", "balance": 1800, "currency": "CHF" }
]
```

## Features

- Glossy payment card with chip, contactless mark, and pointer tilt
- ZamPay Kwacha (ZMW), Liberty Dollar (USD), and Alpine Franc (CHF), each with its own amount field, quick amounts, and terminal currency
- POS terminal that shows the amount and a keypad hint
- Tap to Pay springs the card onto the reader, pulses contactless ripples, then shows a spinner
- Approved state (check mark, green glow, soft shake) and declined state (red shake) follow the real `/api/tap` response
- Activity list with status chips, amount, timestamp, and card last-4; new rows slide in
- Layout for desktop and mobile, and `prefers-reduced-motion` support

## Interface

Idle, with ZamPay Kwacha beside the till:

![MiniTap idle](docs/minitap-idle.png)

The card on the reader while the terminal is authorising:

![MiniTap tapping](docs/minitap-tapping.png)

Approved, after `POST /api/tap` returns success:

![MiniTap approved](docs/minitap-approved.png)

![MiniTap tap animation](docs/minitap-tap.gif)

## Roadmap

- Persist wallets and transactions past a process restart
- Export a receipt for an approved tap
- More than one merchant
- Optional bridge from a hardware NFC reader
- Authenticated access in front of `/api/tap`

## License

MIT. See [LICENSE](LICENSE).
