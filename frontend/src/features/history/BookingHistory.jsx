import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { Spinner } from "../../components/Spinner";

export function BookingHistory() {
  const queryClient = useQueryClient();

  const { data: bookings, isLoading, error } = useQuery({
    queryKey: ["bookings-history"],
    queryFn: () => api.get("/bookings/history").then((r) => r.data.bookings),
  });

  const cancelMutation = useMutation({
    mutationFn: (bookingId) => api.post(`/booking/${bookingId}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings-history"] }),
  });

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Spinner size={32} />
      </div>
    );
  }

  if (error) {
    return <p style={{ color: "var(--color-danger)", textAlign: "center" }}>Failed to load history</p>;
  }

  return (
    <div className="fade-up">
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>My bookings</h1>
      <p style={{ color: "var(--color-text-sub)", marginBottom: 28, fontSize: 14 }}>Last 30 days</p>

      {bookings.length === 0 ? (
        <div className="glass" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎟️</div>
          <p style={{ color: "var(--color-text-sub)" }}>No bookings yet</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {bookings.map((b) => {
            const trip = b.seat?.trip;
            const isPast = trip
              ? new Date(`${trip.date}T${trip.departureTime}`) < new Date()
              : false;
            return (
              <div key={b.id} className="glass" style={{ padding: "18px 22px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>
                        {trip?.origin} → {trip?.destination}
                      </span>
                      <span className={`badge badge-${b.status.toLowerCase()}`}>{b.status}</span>
                    </div>
                    <div style={{ color: "var(--color-text-sub)", fontSize: 12, display: "flex", gap: 18 }}>
                      <span>🕒 {trip?.departureTime}</span>
                      <span>📅 {trip?.date ? new Date(trip.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
                      <span>💺 Seat {b.seat?.seatNumber}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 6 }}>
                      Booking #{b.id.slice(0, 8)}
                    </div>
                  </div>
                  {b.status === "CONFIRMED" && !isPast && (
                    <button
                      id={`cancel-${b.id}`}
                      className="btn btn-danger"
                      style={{ fontSize: 12, padding: "6px 14px" }}
                      onClick={() => {
                        if (confirm("Cancel this booking?")) cancelMutation.mutate(b.id);
                      }}
                      disabled={cancelMutation.isPending}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
