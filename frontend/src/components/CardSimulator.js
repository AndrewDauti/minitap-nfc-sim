import React, { useState, useEffect } from "react";
import { sendTap, getWallets } from "./api";

function CardSimulator() {
  const [cardId, setCardId] = useState("");
  const [amount, setAmount] = useState("");
  const [wallets, setWallets] = useState([]);

  // Fetch wallet balances on component mount
  useEffect(() => {
    loadWallets();
  }, []);

  const loadWallets = async () => {
    const data = await getWallets();
    setWallets(data);
    if (data.length > 0) {
      setCardId(data[0].cardId); // auto-select first card
    }
  };

  const handleTap = async () => {
    console.log("Sending:", { cardId, amount });

    if (!cardId || !amount) {
      alert("Please enter both Card ID and Amount");
      return;
    }

    try {
      const res = await sendTap(cardId, amount);
      alert(`
✅ Tap Successful!

Card: ${res.cardId}
Debited: ZMW ${res.amount}
New Balance: ZMW ${res.balanceAfter}
      `);

      // Refresh wallet balances
      loadWallets();
    } catch (err) {
      alert("Tap Failed: " + (err.message || "Something went wrong"));
    }
  };

  return (
    <div>
      <h3>Simulate Tap</h3>

      {/* Card ID Dropdown */}
      <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
        {wallets.map((w) => (
          <option key={w.cardId} value={w.cardId}>
            {w.cardId} (ZMW {w.balance.toLocaleString()})
          </option>
        ))}
      </select>

      {/* Amount Input */}
      <input
        type="number"
        placeholder="Enter Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <button onClick={handleTap}>Simulate Tap</button>
    </div>
  );
}

export default CardSimulator;

