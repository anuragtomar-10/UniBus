/**
 * Mock payment gateway.
 *
 * Succeeds for any input EXCEPT cardLast4 === "0000" (declined),
 * which demonstrates the payment failure path without a real integration.
 *
 * Returns { success, transactionId, amount }.
 * On decline, returns { success: false, reason: "Card declined" }.
 */

async function processPayment({ bookingId, amount, cardLast4 }) {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 50));

  // Magic test value to trigger decline (for demos/testing)
  if (cardLast4 === "0000") {
    return { success: false, reason: "Card declined" };
  }

  return {
    success: true,
    transactionId: `txn_mock_${Date.now()}`,
    amount,
  };
}

module.exports = { processPayment };
