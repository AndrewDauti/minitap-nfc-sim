// src/components/api.js

// GET all transactions
export const getTransactions = async () => {
  try {
    const res = await fetch("http://localhost:5000/api/transactions");
    const data = await res.json(); // Expecting an array of transactions
    return data;
  } catch (err) {
    console.error("Error fetching transactions:", err);
    return [];
  }
};

// POST a simulated NFC tap
export const sendTap = async (cardId, amount) => {
  try {
    const res = await fetch("http://localhost:5000/api/tap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cardId, amount }),
    });

    const data = await res.json();
    console.log("Tap response:", data);
    return data; // contains cardId, amount, message
  } catch (err) {
    console.error("Error sending tap:", err);
    return { error: "Failed to tap" };
  }
};

// ✅ NEW: GET wallet balances
export const getWallets = async () => {
  try {
    const res = await fetch("http://localhost:5000/api/wallets");
    return await res.json();
  } catch (err) {
    console.error("Error fetching wallets:", err);
    return [];
  }
};

