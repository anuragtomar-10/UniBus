import { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { useSocket } from "../../sockets/useSocket";
import { Spinner } from "../../components/Spinner";
import { ConfirmPay } from "./ConfirmPay";

const SEAT_LETTERS = ["A", "B", "C", "D", "E", "F"];
const ROWS = 10;
const COLS = 6;

function getSeatNumber(row, col) {
  return `${row + 1}${SEAT_LETTERS[col]}`;
}

function getSeatClass(seat, selected) {
  if (!seat) return "seat seat-available";
  if (selected === seat.seatNumber) return "seat seat-selected";
  if (seat.status === "AVAILABLE") return "seat seat-available";
  if (seat.status === "HELD") return "seat seat-held";
  return "seat seat-booked";
}

export function SeatMap() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [holding, setHolding] = useState(false);
  const [holdError, setHoldError] = useState("");
  const [holdData, setHoldData] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["seats", tripId],
    queryFn: () => api.get(`/trips/${tripId}/seats`).then((r) => r.data),
    staleTime: 10_000,
  });

  // Real-time seat updates via Socket.io
  const handleSeatEvent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["seats", tripId] });
  }, [queryClient, tripId]);

  useSocket(tripId, handleSeatEvent);

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Spinner size={36} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass fade-up" style={{ padding: 40, textAlign: "center" }}>
        <p style={{ color: "var(--color-danger)" }}>Failed to load seat map</p>
        <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginTop: 16 }}>
          Go back
        </button>
      </div>
    );
  }

  const { trip, seats } = data || {};
  const seatMap = {};
  (seats || []).forEach((s) => { seatMap[s.seatNumber] = s; });

  async function handleSelect() {
    setHolding(true);
    setHoldError("");
    try {
      const res = await api.post(`/booking/hold`, { tripId, seatNumber: selectedSeat });
      setHoldData({ ...res.data, seatNumber: selectedSeat });
    } catch (err) {
      setHoldError(err.response?.data?.error || "Could not hold seat");
      setSelectedSeat(null);
    } finally {
      setHolding(false);
    }
  }

  return (
    <div className="fade-up">
      <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginBottom: 20, fontSize: 13 }}>
        ← Back
      </button>

      <div className="glass" style={{ padding: 24, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
          {trip?.origin} → {trip?.destination}
        </h1>
        <div style={{ color: "var(--color-text-sub)", fontSize: 13, marginTop: 6, display: "flex", gap: 20 }}>
          <span>🕒 {trip?.departureTime}</span>
          <span>📅 {trip?.date ? new Date(trip.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}</span>
          <span>🚌 {trip?.bus?.registrationNo}</span>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { cls: "seat seat-available", label: "Available" },
          { cls: "seat seat-held", label: "On hold" },
          { cls: "seat seat-booked", label: "Booked" },
          { cls: "seat seat-selected", label: "Selected" },
        ].map(({ cls, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--color-text-sub)" }}>
            <div className={cls} style={{ cursor: "default", width: 20, height: 20, fontSize: 0 }} />
            {label}
          </div>
        ))}
      </div>

      {/* Seat grid — 10 rows × 6 cols (3+aisle+3) */}
      <div className="glass" style={{ padding: 24, display: "inline-block" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(3, 36px) 24px repeat(3, 36px)`, gap: 8 }}>
          {Array.from({ length: ROWS }).map((_, row) =>
            Array.from({ length: COLS + 1 }).map((_, colIdx) => {
              // Insert aisle after col 2
              if (colIdx === 3) {
                return <div key={`aisle-${row}`} style={{ width: 24 }} />;
              }
              const col = colIdx > 3 ? colIdx - 1 : colIdx;
              const seatNum = getSeatNumber(row, col);
              const seat = seatMap[seatNum];
              const isClickable = !seat || seat.status === "AVAILABLE";
              return (
                <div
                  key={seatNum}
                  id={`seat-${seatNum}`}
                  className={getSeatClass(seat, selectedSeat)}
                  title={`Seat ${seatNum}`}
                  onClick={() => {
                    if (!isClickable || holding) return;
                    setSelectedSeat(seatNum === selectedSeat ? null : seatNum);
                    setHoldError("");
                  }}
                  style={{ cursor: isClickable && !holding ? "pointer" : "not-allowed" }}
                >
                  {seatNum}
                </div>
              );
            })
          )}
        </div>
      </div>

      {holdError && (
        <div style={{ marginTop: 16, color: "var(--color-danger)", fontSize: 14 }}>
          {holdError}
        </div>
      )}

      {selectedSeat && !holdData && (
        <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 14, color: "var(--color-text-sub)" }}>
            Selected: Seat <strong style={{ color: "var(--color-text)" }}>{selectedSeat}</strong>
          </span>
          <button
            id="hold-seat-btn"
            className="btn btn-primary glow-primary"
            onClick={handleSelect}
            disabled={holding}
          >
            {holding ? <Spinner size={16} /> : "Select"}
          </button>
        </div>
      )}

      {holdData && (
        <ConfirmPay
          tripId={tripId}
          seatId={holdData.seatId}
          seatNumber={holdData.seatNumber}
          holdExpiresAt={holdData.holdExpiresAt}
          onClose={() => {
            api.post("/booking/release", { tripId, seatNumber: holdData.seatNumber }).catch(() => {});
            setHoldData(null);
            setSelectedSeat(null);
            queryClient.invalidateQueries({ queryKey: ["seats", tripId] });
          }}
        />
      )}
    </div>
  );
}
