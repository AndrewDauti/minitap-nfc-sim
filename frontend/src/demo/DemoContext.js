import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createAllowance, getOfflineStatus, getWallets, openTill, syncOfflineSales } from '../components/api';
import { sanitizeAmount } from '../components/cardCatalog';
import {
  MERCHANT_REF,
  MERCHANTS,
  formatK,
  merchantByRef,
  spendMacHex,
  tokenRef,
  verifyTokenSignature,
} from './offlineCrypto';

const STORAGE_KEY = 'minitap-offline-demo-v1';
const DemoContext = createContext(null);

function blankBooks() {
  return Object.fromEntries(MERCHANTS.map((shop) => [shop.ref, { invoiceIssued: false, taxFiled: false }]));
}

function seedMerchants(rows) {
  const live = new Map((rows || []).map((row) => [row.ref, row]));
  return MERCHANTS.map((shop) => {
    const row = live.get(shop.ref);
    return {
      ...shop,
      name: row?.name || shop.name,
      place: row?.place || shop.place,
      category: row?.category || shop.category,
      line: row?.line || shop.line,
      balance: Number(row?.balance) || 0,
    };
  });
}

const INITIAL = {
  loading: true,
  ready: false,
  apiOnline: null,
  network: 'online',
  wallet: null,
  publicKey: '',
  merchant: seedMerchants()[0],
  merchants: seedMerchants(),
  allowance: null,
  queue: [],
  ledger: [],
  sms: [],
  traderBalance: 0,
  syncing: false,
  notice: '',
  nextCue: 'Pick a shop, then set aside an allowance on the customer phone.',
  allowanceChoice: 300,
  taxRate: 5,
  taxThreshold: 20,
  shopBooks: blankBooks(),
  till: { phase: 'amount', amount: '25.00', fresh: true, sync: null, localError: '' },
  customer: { screen: 'home', paid: null, frozen: false },
};

function booksFromSaved(saved) {
  const books = blankBooks();
  if (saved?.shopBooks && typeof saved.shopBooks === 'object') {
    MERCHANTS.forEach((shop) => {
      const row = saved.shopBooks[shop.ref];
      if (!row || typeof row !== 'object') return;
      books[shop.ref] = {
        invoiceIssued: Boolean(row.invoiceIssued),
        taxFiled: Boolean(row.taxFiled),
      };
    });
    return books;
  }
  const ref = typeof saved?.merchantRef === 'string' ? saved.merchantRef : MERCHANT_REF;
  if (books[ref] && (saved?.invoiceIssued || saved?.taxFiled)) {
    books[ref] = {
      invoiceIssued: Boolean(saved.invoiceIssued),
      taxFiled: Boolean(saved.taxFiled),
    };
  }
  return books;
}

function readSaved() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function messageOf(err) {
  return err?.payload?.error || err?.message || 'The till could not reach the server.';
}

function amountCentsOf(text) {
  const raw = String(text || '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 100000000) return null;
  return cents;
}

function wireSale(sale) {
  return {
    tokenId: sale.tokenId,
    counter: sale.counter,
    capCents: sale.capCents,
    allowanceId: sale.allowanceId,
    cardRef: sale.cardRef,
    currency: sale.currency,
    merchantRef: sale.merchantRef,
    signature: sale.signature,
    amount: sale.amount,
    spendMac: sale.spendMac,
  };
}

function nextLocalId() {
  return `sale_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

async function buildSale(token, amountCents, merchant) {
  const shop = merchant?.ref ? merchant : merchantByRef(MERCHANT_REF);
  const fields = {
    tokenId: token.tokenId,
    counter: token.counter,
    amountCents,
    currency: token.currency,
    allowanceId: token.allowanceId,
    merchantRef: shop.ref,
  };
  const spendMac = await spendMacHex(token.spendKey, fields);
  return {
    localId: nextLocalId(),
    at: new Date().toISOString(),
    tokenId: token.tokenId,
    counter: token.counter,
    capCents: token.capCents,
    allowanceId: token.allowanceId,
    cardRef: token.cardRef,
    currency: token.currency,
    merchantRef: shop.ref,
    merchantName: shop.name,
    signature: token.signature,
    amount: (amountCents / 100).toFixed(2),
    spendMac,
  };
}

function ledgerFrom(sale, extra) {
  return {
    localId: sale.localId,
    at: sale.at,
    amount: Number(sale.amount),
    counter: sale.counter,
    tokenId: sale.tokenId,
    ref: tokenRef(sale.tokenId, sale.counter),
    status: 'queued',
    code: 'QUEUED',
    reason: null,
    riskScore: null,
    offline: false,
    attack: null,
    merchantRef: sale.merchantRef || MERCHANT_REF,
    merchantName: sale.merchantName || merchantByRef(sale.merchantRef || MERCHANT_REF).name,
    payload: sale,
    ...extra,
  };
}

function applySync(state, result, sales) {
  const settledPool = [...(result.settled || [])];
  const blockedPool = [...(result.blocked || [])];
  const take = (pool, sale) => {
    const idx = pool.findIndex((row) => (
    row.tokenId === sale.tokenId
    && row.amount === Number(sale.amount)
    && (!row.merchantRef || row.merchantRef === sale.merchantRef)
  ));
    if (idx < 0) return null;
    return pool.splice(idx, 1)[0];
  };
  const matched = sales.map((sale) => ({
    sale,
    row: take(settledPool, sale) || take(blockedPool, sale),
  }));
  const byId = new Map(matched.filter((entry) => entry.row).map((entry) => [entry.sale.localId, entry]));
  const sent = new Set(sales.map((sale) => sale.localId));
  const ledger = state.ledger.map((item) => {
    const hit = byId.get(item.localId);
    if (!hit) return item;
    return {
      ...item,
      status: hit.row.status === 'settled' ? 'settled' : 'blocked',
      code: hit.row.code,
      reason: hit.row.reason,
      riskScore: hit.row.riskScore,
    };
  });
  const known = new Set(ledger.map((item) => item.localId));
  matched.forEach((entry) => {
    if (!entry.row || known.has(entry.sale.localId)) return;
    ledger.push({
      ...ledgerFrom(entry.sale, { offline: state.network === 'offline' }),
      status: entry.row.status === 'settled' ? 'settled' : 'blocked',
      code: entry.row.code,
      reason: entry.row.reason,
      riskScore: entry.row.riskScore,
    });
  });
  const usedIds = new Set(sales.map((sale) => sale.tokenId));
  const allowance = state.allowance
    ? {
      ...state.allowance,
      remainingCents: result.allowance
        ? Math.round(Number(result.allowance.remaining) * 100)
        : state.allowance.remainingCents,
      lastSettledCounter: result.allowance
        ? result.allowance.lastSettledCounter
        : state.allowance.lastSettledCounter,
      lastLocalCounter: Math.max(
        state.allowance.lastLocalCounter || 0,
        result.allowance ? result.allowance.lastSettledCounter : 0
      ),
      tokens: state.allowance.tokens.map((token) => (
        usedIds.has(token.tokenId) ? { ...token, used: true } : token
      )),
    }
    : state.allowance;
  const rows = matched.filter((entry) => entry.row).map((entry) => ({
    amount: entry.row.amount,
    time: entry.sale.at,
    status: entry.row.status,
    reason: entry.row.reason,
    code: entry.row.code,
    ref: tokenRef(entry.sale.tokenId, entry.sale.counter),
    localId: entry.sale.localId,
    riskScore: entry.row.riskScore,
  }));
  const incomingSms = (result.sms || []).map((row) => ({
    id: row.id,
    from: row.from,
    body: row.body,
    at: new Date().toISOString(),
  }));
  const merchants = result.merchants ? seedMerchants(result.merchants) : state.merchants;
  const merchant = merchants.find((shop) => shop.ref === state.merchant.ref) || merchants[0];
  const settledCount = (result.settled || []).length;
  const blockedCount = (result.blocked || []).length;
  const shopNames = [...new Set(sales.map((sale) => sale.merchantName || merchantByRef(sale.merchantRef).name))];
  let nextCue = state.nextCue;
  if (settledCount && !blockedCount) {
    nextCue = `Settled to ${shopNames.join(', ')}. Open Books for that shop, or press Next sale.`;
  } else if (blockedCount && !settledCount) {
    nextCue = 'The server blocked the sale. Read the reason on the till. A clean tap can still go through.';
  } else if (settledCount && blockedCount) {
    nextCue = 'Some sales settled and some were blocked. The till lists each result.';
  }
  return {
    ...state,
    queue: state.queue.filter((sale) => !sent.has(sale.localId)),
    ledger,
    allowance,
    merchants,
    merchant,
    traderBalance: merchant ? merchant.balance : state.traderBalance,
    nextCue,
    wallet: state.wallet
      ? {
        ...state.wallet,
        balance: result.customer?.balance ?? state.wallet.balance,
        spendable: result.customer?.spendable ?? state.wallet.spendable,
      }
      : state.wallet,
    sms: [...incomingSms.reverse(), ...state.sms],
    syncing: false,
    notice: '',
    till: {
      ...state.till,
      phase: 'sync',
      localError: '',
      sync: {
        settledAmount: (result.settled || []).reduce((sum, row) => sum + Number(row.amount), 0),
        settledCount: (result.settled || []).length,
        totalCount: (result.settled || []).length + (result.blocked || []).length,
        rows,
      },
    },
  };
}

function kwachaWallet(rows) {
  const live = (rows || []).find((row) => row.cardRef === 'CARD001');
  if (!live) return null;
  return {
    token: live.token,
    balance: live.balance,
    spendable: live.spendable ?? live.balance,
    last4: live.last4,
    maskedPan: live.maskedPan,
    currency: live.currency,
  };
}

export function DemoProvider({ children }) {
  const [state, setState] = useState(INITIAL);
  const stateRef = useRef(INITIAL);
  const queueRef = useRef(INITIAL.queue);
  const networkRef = useRef(INITIAL.network);
  const syncingRef = useRef(false);
  const pendingRef = useRef(false);
  const acceptLock = useRef(false);
  const openingRef = useRef(false);
  const bootSync = useRef(false);

  function commit(recipe) {
    const next = typeof recipe === 'function' ? recipe(stateRef.current) : recipe;
    stateRef.current = next;
    queueRef.current = next.queue;
    networkRef.current = next.network;
    setState(next);
    return next;
  }

  async function syncNow(sales) {
    if (networkRef.current !== 'online') return;
    const batch = (sales || []).filter(Boolean);
    if (!batch.length) return;
    if (syncingRef.current) {
      pendingRef.current = true;
      return;
    }
    syncingRef.current = true;
    commit((current) => ({
      ...current,
      syncing: true,
      nextCue: 'Sending saved sales to the shop that took each one.',
    }));
    try {
      const groups = new Map();
      batch.forEach((sale) => {
        const ref = sale.merchantRef || MERCHANT_REF;
        const list = groups.get(ref) || [];
        list.push(sale);
        groups.set(ref, list);
      });
      let merged = null;
      for (const [ref, group] of groups) {
        const result = await syncOfflineSales(group.map(wireSale), ref);
        merged = merged
          ? {
            settled: [...(merged.settled || []), ...(result.settled || [])],
            blocked: [...(merged.blocked || []), ...(result.blocked || [])],
            trader: result.trader || merged.trader,
            merchants: result.merchants || merged.merchants,
            customer: result.customer || merged.customer,
            allowance: result.allowance || merged.allowance,
            sms: [...(merged.sms || []), ...(result.sms || [])],
          }
          : result;
      }
      const sent = new Set(batch.map((sale) => sale.localId));
      queueRef.current = queueRef.current.filter((sale) => !sent.has(sale.localId));
      commit((current) => applySync({ ...current, queue: queueRef.current }, merged, batch));
    } catch (err) {
      commit((current) => ({ ...current, syncing: false, notice: messageOf(err) }));
    } finally {
      syncingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        const left = queueRef.current;
        if (left.length) syncNow(left);
      }
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [wallets, status] = await Promise.all([getWallets(), getOfflineStatus()]);
        if (!active) return;
        const saved = readSaved();
        const wallet = kwachaWallet(wallets);
        const merchants = seedMerchants(status.merchants);
        const savedRef = typeof saved?.merchantRef === 'string' ? saved.merchantRef : MERCHANT_REF;
        const merchant = merchants.find((shop) => shop.ref === savedRef) || merchants[0];
        const sameAllowance = Boolean(
          status.allowance
          && saved?.allowance
          && saved.allowance.id === status.allowance.id
        );
        const allowance = sameAllowance
          ? {
            ...saved.allowance,
            remainingCents: Math.round(Number(status.allowance.remaining) * 100),
            lastSettledCounter: status.allowance.lastSettledCounter,
            lastLocalCounter: Math.max(
              saved.allowance.lastLocalCounter || 0,
              status.allowance.lastSettledCounter || 0
            ),
          }
          : null;
        commit({
          ...INITIAL,
          loading: false,
          ready: true,
          apiOnline: true,
          network: saved?.network === 'offline' ? 'offline' : 'online',
          wallet,
          publicKey: status.issuerPublicKey || '',
          merchant,
          merchants,
          allowance,
          queue: sameAllowance && Array.isArray(saved.queue) ? saved.queue : [],
          ledger: sameAllowance && Array.isArray(saved.ledger) ? saved.ledger : [],
          sms: sameAllowance && Array.isArray(saved.sms) ? saved.sms : [],
          traderBalance: merchant.balance || 0,
          nextCue: merchant.balance
            ? `${merchant.name} is the active shop. Settled balance ${formatK(merchant.balance)}.`
            : `Active shop: ${merchant.name}. Set aside an allowance, then take a payment.`,
          allowanceChoice: saved?.allowanceChoice || 300,
          taxRate: Number.isFinite(saved?.taxRate) ? saved.taxRate : 5,
          taxThreshold: Number.isFinite(saved?.taxThreshold) ? saved.taxThreshold : 20,
          shopBooks: booksFromSaved(saved),
          till: {
            ...INITIAL.till,
            amount: typeof saved?.amount === 'string' ? saved.amount : '25.00',
            fresh: true,
          },
          customer: {
            ...INITIAL.customer,
            frozen: Boolean(saved?.frozen),
          },
        });
      } catch {
        if (!active) return;
        commit((current) => ({
          ...current,
          loading: false,
          ready: true,
          apiOnline: false,
          notice: 'The till cannot reach the API on port 5000. Start the backend with npm start, then refresh this page.',
        }));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!state.ready || !state.apiOnline || bootSync.current) return;
    if (state.network === 'online' && state.queue.length) {
      bootSync.current = true;
      syncNow(state.queue);
    }
  }, [state.ready, state.apiOnline]);

  useEffect(() => {
    if (!state.ready || state.apiOnline !== true) return;
    const payload = {
      network: state.network,
      allowance: state.allowance,
      queue: state.queue,
      ledger: state.ledger,
      sms: state.sms,
      frozen: state.customer.frozen,
      taxRate: state.taxRate,
      taxThreshold: state.taxThreshold,
      allowanceChoice: state.allowanceChoice,
      amount: state.till.amount,
      merchantRef: state.merchant?.ref || MERCHANT_REF,
      shopBooks: state.shopBooks,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [state]);

  function notice(text) {
    commit((current) => ({ ...current, notice: text }));
  }

  function setNetwork(network) {
    networkRef.current = network;
    const queued = queueRef.current.length;
    commit((current) => ({
      ...current,
      network,
      notice: '',
      nextCue: network === 'offline'
        ? 'Network is off. Take a payment now. It stays on this phone until you switch back to Online.'
        : queued
          ? 'Network is on. Saved sales are syncing to the shop that took them.'
          : 'Network is on. Set aside an allowance, or take a payment and it will settle straight away.',
    }));
    if (network === 'online') syncNow(queueRef.current);
  }

  async function selectMerchant(ref) {
    const shop = stateRef.current.merchants.find((item) => item.ref === ref);
    if (!shop || shop.ref === stateRef.current.merchant.ref) return;
    commit((current) => ({
      ...current,
      merchant: shop,
      traderBalance: shop.balance || 0,
      notice: '',
      nextCue: `Now taking payments for ${shop.name}. The next sale settles to this shop.`,
    }));
    try {
      await openTill(shop.ref);
    } catch (err) {
      notice(`Could not open the till for ${shop.name}. ${messageOf(err)} Check that the API is running, then pick the shop again.`);
    }
  }

  const refreshMerchants = useCallback(async () => {
    try {
      const status = await getOfflineStatus();
      commit((current) => {
        const merchants = seedMerchants(status.merchants);
        const merchant = merchants.find((shop) => shop.ref === current.merchant.ref) || merchants[0];
        return {
          ...current,
          merchants,
          merchant,
          traderBalance: merchant.balance || 0,
          publicKey: status.issuerPublicKey || current.publicKey,
        };
      });
    } catch {
      // Keep the last balances if the status call fails.
    }
  }, []);

  function pressKey(key) {
    commit((current) => {
      const { amount, fresh } = current.till;
      let next = amount;
      let nextFresh = false;
      if (key === 'del') {
        next = fresh ? '' : String(amount).slice(0, -1);
      } else if (fresh) {
        next = key === '.' ? '0.' : key;
      } else {
        const combined = sanitizeAmount(`${amount}${key}`, 99999.99);
        next = combined === '' && key !== 'del' ? amount : combined;
      }
      return {
        ...current,
        till: { ...current.till, amount: next, fresh: nextFresh, localError: '' },
      };
    });
  }

  function setAllowanceChoice(amount) {
    commit((current) => ({ ...current, allowanceChoice: amount }));
  }

  async function setAside() {
    const current = stateRef.current;
    if (current.network !== 'online') {
      notice('Switch Network to Online first. The allowance is signed while the signal is up, then you can go offline.');
      return;
    }
    if (!current.wallet?.token) {
      notice('The Zamtel Kwacha wallet is not loaded yet. Start the API, then refresh this page.');
      return;
    }
    if (current.allowance) {
      notice('An allowance is already set aside. Use the taps that are left, or restart the API to start again.');
      return;
    }
    if (openingRef.current) return;
    openingRef.current = true;
    try {
      const data = await createAllowance({
        token: current.wallet.token,
        amount: current.allowanceChoice,
      });
      commit((latest) => ({
        ...latest,
        notice: '',
        publicKey: data.issuerPublicKey || latest.publicKey,
        wallet: latest.wallet
          ? { ...latest.wallet, balance: data.balance, spendable: data.spendable }
          : latest.wallet,
        allowance: {
          id: data.allowanceId,
          amount: data.amount,
          remainingCents: Math.round(Number(data.remaining) * 100),
          lastLocalCounter: 0,
          lastSettledCounter: 0,
          tokens: data.tokens.map((token) => ({ ...token, used: false })),
        },
        nextCue: 'Allowance ready. Switch Network to Offline, enter an amount, then press Take payment.',
        customer: { ...latest.customer, screen: 'home' },
      }));
    } catch (err) {
      notice(messageOf(err));
    } finally {
      openingRef.current = false;
    }
  }

  function nextToken(allowance, lastCounter) {
    return allowance.tokens
      .filter((token) => !token.used && token.counter > lastCounter)
      .sort((a, b) => a.counter - b.counter)[0] || null;
  }

  async function acceptTap(via) {
    if (acceptLock.current) return;
    const current = stateRef.current;
    if (current.customer.frozen) {
      commit((latest) => ({
        ...latest,
        notice: 'This Tap Card is frozen. Unfreeze it from the USSD menu.',
        till: { ...latest.till, phase: 'declined', localError: 'Tap Card frozen. You were not charged.' },
      }));
      return;
    }
    if (!current.allowance) {
      notice('Set aside an allowance on the customer phone while Network is Online. Then you can take a payment.');
      return;
    }
    if (!current.publicKey) {
      notice('Switch Network to Online once so this till can collect the issuer public key. Then you can go offline.');
      return;
    }
    const amountCents = amountCentsOf(current.till.amount);
    if (!amountCents) {
      notice('Enter an amount on the till first.');
      return;
    }
    const token = nextToken(current.allowance, current.allowance.lastLocalCounter || 0);
    if (!token) {
      notice('No tokens left in this batch. Restart the API, refresh, and set aside a new allowance.');
      return;
    }
    if (amountCents > current.allowance.remainingCents) {
      commit((latest) => ({
        ...latest,
        notice: '',
        till: {
          ...latest.till,
          phase: 'declined',
          localError: `Above the offline allowance. ${formatK(latest.allowance.remainingCents / 100)} left.`,
        },
      }));
      return;
    }

    acceptLock.current = true;
    try {
      // Local checks only. This function does not call the API.
      const shop = current.merchant;
      const sale = await buildSale(token, amountCents, shop);
      const signatureOk = await verifyTokenSignature(current.publicKey, token);
      if (!signatureOk) {
        commit((latest) => ({
          ...latest,
          till: {
            ...latest.till,
            phase: 'declined',
            localError: 'Token signature did not match the issuer key on this phone.',
          },
        }));
        return;
      }
      const expectedMac = await spendMacHex(token.spendKey, {
        tokenId: token.tokenId,
        counter: token.counter,
        amountCents,
        currency: token.currency,
        allowanceId: token.allowanceId,
        merchantRef: shop.ref,
      });
      if (expectedMac !== sale.spendMac) {
        commit((latest) => ({
          ...latest,
          till: {
            ...latest.till,
            phase: 'declined',
            localError: 'The spend code did not match this amount.',
          },
        }));
        return;
      }
      if (token.counter <= (current.allowance.lastLocalCounter || 0)) {
        commit((latest) => ({
          ...latest,
          till: {
            ...latest.till,
            phase: 'declined',
            localError: 'This token counter was rolled back.',
          },
        }));
        return;
      }
      if (amountCents > token.capCents) {
        commit((latest) => ({
          ...latest,
          till: {
            ...latest.till,
            phase: 'declined',
            localError: 'This is above the token spending cap.',
          },
        }));
        return;
      }

      const offline = networkRef.current !== 'online';
      const ref = tokenRef(token.tokenId, token.counter);
      let queuedSale = null;
      commit((latest) => {
        const remainingCents = latest.allowance.remainingCents - amountCents;
        const allowance = {
          ...latest.allowance,
          remainingCents,
          lastLocalCounter: token.counter,
          tokens: latest.allowance.tokens.map((item) => (
            item.tokenId === token.tokenId ? { ...item, used: true } : item
          )),
        };
        const stamped = { ...sale, offline };
        queuedSale = stamped;
        const left = formatK(remainingCents / 100);
        const shopName = shop.name;
        return {
          ...latest,
          notice: '',
          nextCue: offline
            ? `Saved for ${shopName}. Switch Network to Online when you want this sale to settle.`
            : `Checked on the phone. Settling to ${shopName}.`,
          allowance,
          queue: [...latest.queue, stamped],
          ledger: [...latest.ledger, ledgerFrom(stamped, { offline, via })],
          sms: [{
            id: `local_${stamped.localId}`,
            from: 'ZAMTEL KWACHA',
            at: stamped.at,
            body: `You paid ${formatK(amountCents / 100)} to ${shopName}. Ref ${ref}. It will appear in your history once the network is back. Allowance left: ${left}.`,
          }, ...latest.sms],
          till: {
            ...latest.till,
            phase: 'secured',
            localError: '',
            secured: {
              amount: amountCents / 100,
              ref,
              payer: `Kwacha ···${latest.wallet?.last4 || '4401'}`,
              via,
              merchantName: shopName,
            },
          },
          customer: {
            ...latest.customer,
            screen: 'paid',
            paid: {
              amount: amountCents / 100,
              allowanceLeft: remainingCents / 100,
              ref,
              merchantName: shopName,
            },
          },
        };
      });
      if (queuedSale && networkRef.current === 'online') {
        window.setTimeout(() => {
          if (networkRef.current === 'online') syncNow(queueRef.current);
        }, 700);
      }
    } catch (err) {
      notice(err?.message || 'The phone could not check this token.');
    } finally {
      acceptLock.current = false;
    }
  }

  function beginTap() {
    const current = stateRef.current;
    if (!current.allowance) {
      notice('Set aside an allowance on the customer phone first. Network has to be Online for that step.');
      return;
    }
    if (!amountCentsOf(current.till.amount)) {
      notice('Enter an amount greater than zero, then press Take payment.');
      return;
    }
    commit((latest) => ({
      ...latest,
      notice: '',
      nextCue: `Waiting for a tap at ${latest.merchant.name}. On the customer phone, press Tap to pay. Or press Scan QR instead.`,
      till: { ...latest.till, phase: 'wait', localError: '' },
    }));
  }

  function cancelWait() {
    commit((latest) => ({
      ...latest,
      till: { ...latest.till, phase: 'amount', localError: '' },
    }));
  }

  function nextSale() {
    commit((latest) => ({
      ...latest,
      till: { ...latest.till, phase: 'amount', localError: '', fresh: true },
      customer: { ...latest.customer, screen: 'home' },
      nextCue: `Ready for another sale at ${latest.merchant.name}. Enter an amount, then press Take payment.`,
    }));
  }

  function customerDone() {
    commit((latest) => ({
      ...latest,
      customer: { ...latest.customer, screen: 'home', paid: null },
    }));
  }

  function showScreen(screen) {
    commit((latest) => ({
      ...latest,
      customer: { ...latest.customer, screen },
    }));
  }

  async function scanQr() {
    if (stateRef.current.customer.screen !== 'qr') {
      commit((latest) => ({
        ...latest,
        till: {
          ...latest.till,
          phase: 'wait',
          localError: 'Ask the customer to tap Show my QR.',
        },
      }));
      return;
    }
    await acceptTap('qr');
  }

  async function queueAttackSale(sale, attack) {
    commit((latest) => ({
      ...latest,
      notice: '',
      queue: [...latest.queue, sale],
      ledger: [...latest.ledger, ledgerFrom(sale, { attack, offline: latest.network !== 'online' })],
      allowance: latest.allowance
        ? {
          ...latest.allowance,
          tokens: latest.allowance.tokens.map((token) => (
            token.tokenId === sale.tokenId ? { ...token, used: true } : token
          )),
        }
        : latest.allowance,
    }));
    if (networkRef.current === 'online') await syncNow(queueRef.current);
    else notice('Saved on this phone. Switch Network to Online and the server will check it.');
  }

  async function runAttack(kind) {
    const current = stateRef.current;
    if (!current.allowance) {
      notice('Set aside an allowance before a security check. Do that on the customer phone while Network is Online.');
      return;
    }
    if (kind === 'redirect') {
      const prior = [...current.ledger].reverse().find((row) => row.payload && !row.attack)
        || [...current.ledger].reverse().find((row) => row.payload);
      if (!prior) {
        notice('Make a sale first. Then send that token to another shop to see it blocked.');
        return;
      }
      const other = MERCHANTS.find((shop) => shop.ref !== prior.payload.merchantRef) || MERCHANTS[1];
      const sale = {
        ...prior.payload,
        localId: nextLocalId(),
        at: new Date().toISOString(),
        merchantRef: other.ref,
        merchantName: other.name,
      };
      await queueAttackSale(sale, 'redirect');
      return;
    }
    if (kind === 'replay') {
      const prior = [...current.ledger].reverse().find((row) => row.payload);
      if (!prior) {
        notice('Make a sale first, then replay its token to see the block.');
        return;
      }
      const sale = {
        ...prior.payload,
        localId: nextLocalId(),
        at: new Date().toISOString(),
      };
      await queueAttackSale(sale, 'replay');
      return;
    }
    if (kind === 'tamper') {
      const token = nextToken(current.allowance, current.allowance.lastLocalCounter || 0);
      if (!token) {
        notice('No unused token left. Set aside a new allowance after restarting the API, then try this check.');
        return;
      }
      const honest = await buildSale(token, 1000, current.merchant);
      const tampered = { ...honest, amount: '40.00' };
      await queueAttackSale(tampered, 'tamper');
      return;
    }
    if (kind === 'rollback') {
      if (current.network !== 'online') {
        notice('Switch Network to Online. The counter check runs when the sale reaches the server.');
        return;
      }
      if (syncingRef.current) {
        notice('Wait for the current sync to finish.');
        return;
      }
      if (current.queue.length) {
        notice('Let the saved sales sync first, then roll a counter back.');
        return;
      }
      const unused = current.allowance.tokens
        .filter((token) => !token.used)
        .sort((a, b) => a.counter - b.counter);
      if (unused.length < 2) {
        notice('This check needs two unused tokens. Take fewer sales, or restart the API and set aside a new allowance.');
        return;
      }
      if (current.allowance.remainingCents < 3000) {
        notice('Not enough allowance left. This check needs K30.00 still set aside.');
        return;
      }
      const low = unused[0];
      const high = unused[1];
      try {
        const saleHigh = await buildSale(high, 1500, current.merchant);
        const saleLow = await buildSale(low, 1500, current.merchant);
        commit((latest) => ({
          ...latest,
          syncing: true,
          allowance: {
            ...latest.allowance,
            tokens: latest.allowance.tokens.map((token) => (
              token.tokenId === high.tokenId || token.tokenId === low.tokenId
                ? { ...token, used: true }
                : token
            )),
          },
          ledger: [
            ...latest.ledger,
            ledgerFrom(saleHigh, { attack: 'rollback' }),
            ledgerFrom(saleLow, { attack: 'rollback' }),
          ],
        }));
        const first = await syncOfflineSales([wireSale(saleHigh)], saleHigh.merchantRef);
        const second = await syncOfflineSales([wireSale(saleLow)], saleLow.merchantRef);
        const combined = {
          settled: [...first.settled, ...second.settled],
          blocked: [...first.blocked, ...second.blocked],
          trader: second.trader,
          merchants: second.merchants,
          customer: second.customer,
          allowance: second.allowance,
          sms: [...(first.sms || []), ...(second.sms || [])],
        };
        commit((latest) => applySync(latest, combined, [saleHigh, saleLow]));
      } catch (err) {
        commit((latest) => ({ ...latest, syncing: false, notice: messageOf(err) }));
      }
    }
  }

  function setCustomerFrozen(frozen) {
    commit((latest) => {
      const sms = frozen
        ? [{
          id: `freeze_${Date.now()}`,
          from: 'ZAMTEL KWACHA',
          at: new Date().toISOString(),
          body: `Your Tap Card ···${latest.wallet?.last4 || '4401'} is frozen. Reply UNFREEZE with your PIN to restore it.`,
        }, ...latest.sms]
        : [{
          id: `unfreeze_${Date.now()}`,
          from: 'ZAMTEL KWACHA',
          at: new Date().toISOString(),
          body: `Your Tap Card ···${latest.wallet?.last4 || '4401'} is active again.`,
        }, ...latest.sms];
      return {
        ...latest,
        notice: frozen ? 'Tap Card frozen on this phone.' : '',
        sms,
        customer: { ...latest.customer, frozen, screen: 'ussd' },
      };
    });
  }

  function patchShop(current, patch) {
    const ref = current.merchant.ref;
    const prev = current.shopBooks[ref] || { invoiceIssued: false, taxFiled: false };
    return {
      ...current.shopBooks,
      [ref]: { ...prev, ...patch },
    };
  }

  function setTaxRate(value) {
    const rate = Math.min(30, Math.max(0, Number(value)));
    if (!Number.isFinite(rate)) return;
    commit((current) => ({
      ...current,
      taxRate: rate,
      shopBooks: patchShop(current, { taxFiled: false }),
    }));
  }

  function setTaxThreshold(value) {
    const threshold = Math.min(1000000, Math.max(0, Number(value)));
    if (!Number.isFinite(threshold)) return;
    commit((current) => ({
      ...current,
      taxThreshold: threshold,
      shopBooks: patchShop(current, { taxFiled: false }),
    }));
  }

  function issueInvoice() {
    const current = stateRef.current;
    const count = current.ledger.filter((row) => (
      (row.merchantRef || MERCHANT_REF) === current.merchant.ref
      && (row.status === 'settled' || row.status === 'queued')
    )).length;
    if (!count) {
      notice(`No sales for ${current.merchant.name} yet. Take a payment on the Sale screen, then issue the invoice.`);
      return;
    }
    commit((latest) => ({
      ...latest,
      notice: '',
      nextCue: `Invoice draft queued on this phone for ${latest.merchant.name}. Nothing was sent to ZRA.`,
      shopBooks: patchShop(latest, { invoiceIssued: true }),
    }));
  }

  function fileTaxDemo() {
    commit((current) => ({
      ...current,
      nextCue: `Example filing noted for ${current.merchant.name}. No return was sent and no money moved.`,
      shopBooks: patchShop(current, { taxFiled: true }),
    }));
  }

  const savedCount = state.queue.length;
  const shopFlags = state.shopBooks[state.merchant.ref] || { invoiceIssued: false, taxFiled: false };
  const value = {
    ...state,
    invoiceIssued: shopFlags.invoiceIssued,
    taxFiled: shopFlags.taxFiled,
    savedCount,
    selectMerchant,
    refreshMerchants,
    setNetwork,
    pressKey,
    setAllowanceChoice,
    setAside,
    beginTap,
    cancelWait,
    customerTap: () => acceptTap('nfc'),
    scanQr,
    showQr: () => showScreen('qr'),
    showCard: () => showScreen('card'),
    showUssd: () => showScreen('ussd'),
    showHome: () => showScreen('home'),
    nextSale,
    customerDone,
    runAttack,
    setCustomerFrozen,
    setTaxRate,
    setTaxThreshold,
    issueInvoice,
    fileTaxDemo,
  };

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemo must be used inside DemoProvider');
  return ctx;
}
