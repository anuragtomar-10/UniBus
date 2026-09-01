import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../../lib/api";
import { Spinner } from "../../components/Spinner";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDate(isoDate) {
  const d = new Date(isoDate + "T00:00:00");
  return {
    day: DAY_NAMES[d.getDay()],
    dayShort: DAY_SHORT[d.getDay()],
    date: d.getDate(),
    month: d.toLocaleString("en-GB", { month: "short" }),
    iso: isoDate,
    isToday: isoDate === new Date().toISOString().split("T")[0],
  };
}

// ── Individual trip card ───────────────────────────────────────────────────────
function TripCard({ trip }) {
  const navigate = useNavigate();
  const pct = trip.totalSeats > 0 ? (trip.availableSeats / trip.totalSeats) * 100 : 0;
  const fillColor = pct > 50 ? "var(--color-success)" : pct > 20 ? "var(--color-warning)" : "var(--color-danger)";

  return (
    <div
      id={`trip-card-${trip.id}`}
      className="glass-sm"
      onClick={() => navigate(`/trips/${trip.id}/seats`)}
      style={{
        padding: "14px 18px",
        cursor: "pointer",
        transition: "border-color 0.2s, transform 0.15s",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "rgba(109,86,250,0.45)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--color-border)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {/* Time bubble */}
      <div
        style={{
          minWidth: 52,
          textAlign: "center",
          background: "rgba(109,86,250,0.12)",
          borderRadius: 10,
          padding: "6px 8px",
          border: "1px solid rgba(109,86,250,0.2)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--color-accent)" }}>
          {trip.departureTime}
        </div>
      </div>

      {/* Route info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>
            {trip.origin} → {trip.destination}
          </span>
          {trip.source === "SPECIAL" && (
            <span className="badge badge-special">Special</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-sub)" }}>
          🚌 {trip.bus?.registrationNo}
          {trip.driver?.name && (
            <span style={{ marginLeft: 10 }}>👤 {trip.driver.name}</span>
          )}
        </div>
      </div>

      {/* Seat availability */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: fillColor }}>
          {trip.availableSeats}
        </div>
        <div style={{ fontSize: 10, color: "var(--color-text-sub)" }}>/ {trip.totalSeats} free</div>
        {/* Mini bar */}
        <div style={{ width: 48, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, marginTop: 4 }}>
          <div style={{ height: 3, borderRadius: 2, width: `${pct}%`, background: fillColor, transition: "width 0.3s" }} />
        </div>
      </div>

      <div style={{ color: "var(--color-muted)", fontSize: 16 }}>›</div>
    </div>
  );
}

// ── Day column ─────────────────────────────────────────────────────────────────
function DayColumn({ dateInfo, trips }) {
  const isEmpty = !trips || trips.length === 0;
  return (
    <div>
      {/* Day header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          paddingBottom: 10,
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: dateInfo.isToday
              ? "linear-gradient(135deg, #6d56fa, #a78bfa)"
              : "rgba(255,255,255,0.05)",
            border: dateInfo.isToday ? "none" : "1px solid var(--color-border)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{dateInfo.date}</div>
          <div style={{ fontSize: 9, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {dateInfo.month}
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {dateInfo.day}
            {dateInfo.isToday && (
              <span style={{ marginLeft: 6, fontSize: 10, color: "var(--color-accent)", fontWeight: 600 }}>TODAY</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-sub)" }}>
            {isEmpty ? "No buses" : `${trips.length} trip${trips.length !== 1 ? "s" : ""}`}
          </div>
        </div>
      </div>

      {/* Trips */}
      {isEmpty ? (
        <div
          style={{
            padding: "20px 0",
            textAlign: "center",
            color: "var(--color-muted)",
            fontSize: 13,
          }}
        >
          —
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function TripSearch() {
  const [filterDate, setFilterDate] = useState("");
  const [filterDest, setFilterDest] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  // Load all trips for the week (always)
  const { data: weekData, isLoading } = useQuery({
    queryKey: ["trips-week"],
    queryFn: () => api.get("/trips/week").then((r) => r.data),
    staleTime: 30_000,
  });

  // Build the sorted list of days and collect all destinations for the dropdown
  const { days, allDestinations } = useMemo(() => {
    if (!weekData) return { days: [], allDestinations: [] };

    const sorted = Object.keys(weekData).sort();
    const destSet = new Set();
    for (const dateKey of sorted) {
      for (const trip of weekData[dateKey]) {
        destSet.add(trip.destination);
      }
    }
    return { days: sorted, allDestinations: [...destSet].sort() };
  }, [weekData]);

  // Apply filters client-side
  const filteredDays = useMemo(() => {
    if (!weekData) return [];
    const keys = filterDate ? [filterDate] : days;
    return keys
      .filter((k) => weekData[k] !== undefined || filterDate) // keep exact date even if empty
      .map((k) => {
        const trips = (weekData[k] || []).filter((t) =>
          filterDest ? t.destination === filterDest : true
        );
        return { dateKey: k, trips };
      });
  }, [weekData, days, filterDate, filterDest]);

  const hasAnyTrip = filteredDays.some((d) => d.trips.length > 0);
  const isFiltering = filterDate || filterDest;

  return (
    <div className="fade-up">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>This week's buses</h1>
          <p style={{ margin: "4px 0 0", color: "var(--color-text-sub)", fontSize: 14 }}>
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <button
          id="toggle-search-btn"
          className={`btn ${showSearch ? "btn-primary" : "btn-secondary"}`}
          onClick={() => { setShowSearch((v) => !v); if (showSearch) { setFilterDate(""); setFilterDest(""); } }}
        >
          {showSearch ? "✕ Clear filter" : "🔍 Filter trips"}
        </button>
      </div>

      {/* Filter panel */}
      {showSearch && (
        <div
          className="glass"
          style={{ padding: "18px 22px", marginBottom: 24, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          {/* Date picker */}
          <div style={{ flex: "1 1 170px" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
              Date
            </label>
            <input
              id="filter-date"
              type="date"
              className="input"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              min={days[0] || ""}
              max={days[days.length - 1] || ""}
            />
          </div>

          {/* Destination dropdown */}
          <div style={{ flex: "2 1 200px" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
              Destination
            </label>
            <select
              id="filter-destination"
              className="input"
              value={filterDest}
              onChange={(e) => setFilterDest(e.target.value)}
            >
              <option value="">All destinations</option>
              {allDestinations.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Clear */}
          {isFiltering && (
            <button
              className="btn btn-secondary"
              style={{ fontSize: 13, height: 42 }}
              onClick={() => { setFilterDate(""); setFilterDest(""); }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <Spinner size={32} />
        </div>
      )}

      {/* No results */}
      {!isLoading && weekData && !hasAnyTrip && (
        <div className="glass" style={{ padding: 52, textAlign: "center" }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>🚌</div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No buses found</h2>
          <p style={{ margin: 0, color: "var(--color-text-sub)", fontSize: 14 }}>
            {isFiltering
              ? "No trips match your filter. Try a different date or destination."
              : "No trips scheduled for this week yet. Ask your admin to refresh the schedule."}
          </p>
          {isFiltering && (
            <button className="btn btn-secondary" style={{ marginTop: 18 }} onClick={() => { setFilterDate(""); setFilterDest(""); }}>
              Show all trips
            </button>
          )}
        </div>
      )}

      {/* Day-by-day schedule */}
      {!isLoading && hasAnyTrip && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {filteredDays.map(({ dateKey, trips }) => {
            // Always show days that have trips; if filtering by date show even if empty
            if (trips.length === 0 && !filterDate) return null;
            return (
              <div key={dateKey} className="glass" style={{ padding: "20px 22px" }}>
                <DayColumn dateInfo={formatDate(dateKey)} trips={trips} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
