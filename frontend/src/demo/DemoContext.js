import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createAllowance, getOfflineStatus, getWallets, syncOfflineSales } from '../components/api';
import { sanitizeAmount } from '../components/cardCatalog';
import {
  MERCHANT_REF,
  formatK,
  spendMacHex,
  tokenRef,
  verifyTokenSignature,
} from './offlineCrypto';

const STORAGE_KEY = 'minitap-offline-demo-v1';
const DemoContext = createContext(null);

const INITIAL = {
  loading: true,
  ready: false,
  apiOnline: null,
  network: 'online',
  wallet: null,
  publicKey: '',
  merchant: { ref: MERCHANT_REF, name: 'Mutale Store', place: 'Lusaka', category: 'Groceries' },
  allowance: null,
  queue: [],
  ledger: [],
  sms: [],
  traderBalance: 0,
  syncing: false,
  notice: '',
  allowanceChoice: 300,
  taxRate: 5,
  taxThreshold: 20,
  invoiceIssued: false,
  taxFiled: false,
  till: { phase: 'amount', amount: '25.00', fresh: true, sync: null, localError: '' },
  customer: { screen: 'home', paid: null, frozen: false },
};

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

async function buildSale(token, amountCents) {
  const fields = {
    tokenId: token.tokenId,
    counter: token.counter,
    amountCents,
    currency: token.currency,
    allowanceId: token.allowanceId,
    merchantRef: MERCHANT_REF,
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
    merchantRef: MERCHANT_REF,
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
    payload: sale,
    ...extra,
  };
}

function applySync(state, result, sales) {
  const settledPool = [...(result.settled || [])];
  const blockedPool = [...(result.blocked || [])];
  const take = (pool, sale) => {
    const idx = pool.findIndex((row) => row.tokenId === sale.tokenId && row.amount === Number(sale.amount));
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
  return {
    ...state,
    queue: state.queue.filter((sale) => !sent.has(sale.localId)),
    ledger,
    allowance,
    traderBalance: result.trader ? result.trader.balance : state.traderBalance,
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
    commit((current) => ({ ...current, syncing: true }));
    try {
      const result = await syncOfflineSales(batch.map(wireSale));
      const sent = new Set(batch.map((sale) => sale.localId));
      queueRef.current = queueRef.current.filter((sale) => !sent.has(sale.localId));
      commit((current) => applySync({ ...current, queue: queueRef.current }, result, batch));
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
          merchant: status.merchant || INITIAL.merchant,
          allowance,
          queue: sameAllowance && Array.isArray(saved.queue) ? saved.queue : [],
          ledger: sameAllowance && Array.isArray(saved.ledger) ? saved.ledger : [],
          sms: sameAllowance && Array.isArray(saved.sms) ? saved.sms : [],
          traderBalance: status.trader?.balance || 0,
          allowanceChoice: saved?.allowanceChoice || 300,
          taxRate: Number.isFinite(saved?.taxRate) ? saved.taxRate : 5,
          taxThreshold: Number.isFinite(saved?.taxThreshold) ? saved.taxThreshold : 20,
          invoiceIssued: Boolean(saved?.invoiceIssued),
          taxFiled: Boolean(saved?.taxFiled),
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
        commit((current) => ({ ...current, loading: false, ready: true, apiOnline: false }));
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
      invoiceIssued: state.invoiceIssued,
      taxFiled: state.taxFiled,
      allowanceChoice: state.allowanceChoice,
      amount: state.till.amount,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [state]);

  function notice(text) {
    commit((current) => ({ ...current, notice: text }));
  }

  function setNetwork(network) {
    networkRef.current = network;
    commit((current) => ({ ...current, network, notice: '' }));
    if (network === 'online') syncNow(queueRef.current);
  }

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
      notice('Go online to set aside an allowance. The tokens are signed while the network is up.');
      return;
    }
    if (!current.wallet?.token) {
      notice('The Zamtel Kwacha wallet is not loaded yet.');
      return;
    }
    if (current.allowance) {
      notice('An allowance is already set aside.');
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
      notice('Set aside an offline allowance on the customer phone while you are online.');
      return;
    }
    if (!current.publicKey) {
      notice('Go online once so this till can collect the issuer public key.');
      return;
    }
    const amountCents = amountCentsOf(current.till.amount);
    if (!amountCents) {
      notice('Enter an amount on the till first.');
      return;
    }
    const token = nextToken(current.allowance, current.allowance.lastLocalCounter || 0);
    if (!token) {
      notice('No offline tokens left. The batch is used up.');
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
      const sale = await buildSale(token, amountCents);
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
        merchantRef: MERCHANT_REF,
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
        return {
          ...latest,
          notice: '',
          allowance,
          queue: [...latest.queue, stamped],
          ledger: [...latest.ledger, ledgerFrom(stamped, { offline, via })],
          sms: [{
            id: `local_${stamped.localId}`,
            from: 'ZAMTEL KWACHA',
            at: stamped.at,
            body: `You paid ${formatK(amountCents / 100)} to Mutale Store offline. Ref ${ref}. It will appear in your history once the network is back. Allowance left: ${left}.`,
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
            },
          },
          customer: {
            ...latest.customer,
            screen: 'paid',
            paid: {
              amount: amountCents / 100,
              allowanceLeft: remainingCents / 100,
              ref,
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
    if (!amountCentsOf(current.till.amount)) {
      notice('Enter an amount greater than zero.');
      return;
    }
    commit((latest) => ({
      ...latest,
      notice: '',
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
    else notice('Saved on this phone. Turn the network on and it will sync.');
  }

  async function runAttack(kind) {
    const current = stateRef.current;
    if (!current.allowance) {
      notice('Set aside an allowance before running a security check.');
      return;
    }
    if (kind === 'replay') {
      const prior = [...current.ledger].reverse().find((row) => row.payload);
      if (!prior) {
        notice('Make a sale first, then replay its token.');
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
        notice('No unused token left to tamper with.');
        return;
      }
      const honest = await buildSale(token, 1000);
      const tampered = { ...honest, amount: '40.00' };
      await queueAttackSale(tampered, 'tamper');
      return;
    }
    if (kind === 'rollback') {
      if (current.network !== 'online') {
        notice('Turn the network on. The counter check runs when the sale reaches the server.');
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
        notice('This check needs two unused tokens.');
        return;
      }
      if (current.allowance.remainingCents < 3000) {
        notice('Not enough allowance left for this check.');
        return;
      }
      const low = unused[0];
      const high = unused[1];
      try {
        const saleHigh = await buildSale(high, 1500);
        const saleLow = await buildSale(low, 1500);
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
        const first = await syncOfflineSales([wireSale(saleHigh)]);
        const second = await syncOfflineSales([wireSale(saleLow)]);
        const combined = {
          settled: [...first.settled, ...second.settled],
          blocked: [...first.blocked, ...second.blocked],
          trader: second.trader,
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

  function setTaxRate(value) {
    const rate = Math.min(30, Math.max(0, Number(value)));
    if (!Number.isFinite(rate)) return;
    commit((current) => ({ ...current, taxRate: rate, taxFiled: false }));
  }

  function setTaxThreshold(value) {
    const threshold = Math.min(1000000, Math.max(0, Number(value)));
    if (!Number.isFinite(threshold)) return;
    commit((current) => ({ ...current, taxThreshold: threshold, taxFiled: false }));
  }

  function issueInvoice() {
    commit((current) => ({ ...current, invoiceIssued: true }));
  }

  function fileTaxDemo() {
    commit((current) => ({ ...current, taxFiled: true }));
  }

  const savedCount = state.queue.length;
  const value = {
    ...state,
    savedCount,
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
