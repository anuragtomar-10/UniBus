import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { Modal } from "../../components/Modal";
import api from "../../lib/api";
import { Spinner } from "../../components/Spinner";

export function ConfirmPay({ tripId, seatId, seatNumber, holdExpiresAt, onClose }) {
  const navigate = useNavigate();
  const [cardLast4, setCardLast4] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [booking, setBooking] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);

  // Countdown timer
  useEffect(() => {
    if (!holdExpiresAt) return;
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(holdExpiresAt) - Date.now()) / 1000));
      setTimeLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [holdExpiresAt]);

  async function handlePay(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Fresh idempotency key per attempt (NFR4)
    const idempotencyKey = uuidv4();
    try {
      const res = await api.post("/booking/confirm", { seatId, idempotencyKey, cardLast4 });
      setBooking(res.data);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || "Payment failed");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <Modal title="Booking confirmed! 🎉" onClose={() => { onClose(); navigate("/history"); }} width={440}>
        <div style={{ textAlign: "center", padding: "10px 0 20px" }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>✅</div>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Seat {seatNumber} is yours!</p>
          <p style={{ fontSize: 13, color: "var(--color-text-sub)", marginBottom: 20 }}>
            Booking ID: <code style={{ color: "var(--color-accent)" }}>{booking?.id?.slice(0, 8)}</code>
          </p>
          <button className="btn btn-primary" onClick={() => { onClose(); navigate("/history"); }}>
            View my bookings
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Complete payment" onClose={onClose}>
      {timeLeft !== null && (
        <div style={{
          background: timeLeft < 60 ? "rgba(248,113,113,0.12)" : "rgba(251,191,36,0.1)",
          border: `1px solid ${timeLeft < 60 ? "rgba(248,113,113,0.3)" : "rgba(251,191,36,0.3)"}`,
          borderRadius: 8,
          padding: "8px 14px",
          marginBottom: 18,
          fontSize: 13,
          color: timeLeft < 60 ? "var(--color-danger)" : "var(--color-warning)",
          textAlign: "center",
        }}>
          ⏱ Hold expires in {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
        </div>
      )}

      <p style={{ color: "var(--color-text-sub)", fontSize: 13, marginBottom: 20 }}>
        Seat <strong style={{ color: "var(--color-text)" }}>{seatNumber}</strong>. Enter the last 4 digits of your card to complete payment.
        <br />
        <span style={{ color: "var(--color-muted)", fontSize: 11 }}>Tip: use "0000" to test a declined card.</span>
      </p>

      <form id="payment-form" onSubmit={handlePay}>
        <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
          Card last 4 digits
        </label>
        <input
          id="card-last4"
          type="text"
          className="input"
          placeholder="1234"
          maxLength={4}
          pattern="\d{4}"
          value={cardLast4}
          onChange={(e) => setCardLast4(e.target.value.replace(/\D/, ""))}
          required
          autoFocus
          style={{ marginBottom: 16, letterSpacing: "0.3em", fontSize: 18, textAlign: "center" }}
        />

        {error && (
          <p style={{ color: "var(--color-danger)", fontSize: 13, marginBottom: 14 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button id="pay-btn" type="submit" className="btn btn-primary" disabled={loading || cardLast4.length !== 4}>
            {loading ? <Spinner size={16} /> : "Pay & confirm"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
