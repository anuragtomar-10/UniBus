import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { Spinner } from "../../components/Spinner";

// ─── Base Schedule Editor ──────────────────────────────────────────────────────

function BaseScheduleEditor() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    origin: "", destination: "", departureTime: "", daysOfWeek: [],
  });
  const [showForm, setShowForm] = useState(false);

  const { data: bases, isLoading } = useQuery({
    queryKey: ["base-trips"],
    queryFn: () => api.get("/admin/schedule/base").then((r) => r.data.trips),
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.post("/admin/schedule/base", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["base-trips"] });
      setShowForm(false);
      setForm({ origin: "", destination: "", departureTime: "", daysOfWeek: [] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/admin/schedule/base/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["base-trips"] }),
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.post("/admin/schedule/refresh"),
  });

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function toggleDay(d) {
    setForm((f) => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d],
    }));
  }

  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Base schedule</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            id="refresh-schedule-btn"
            className="btn btn-secondary"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            style={{ fontSize: 12 }}
          >
            {refreshMutation.isPending ? <Spinner size={14} /> : "🔄 Refresh week"}
          </button>
          <button id="add-base-trip-btn" className="btn btn-primary" onClick={() => setShowForm((v) => !v)} style={{ fontSize: 12 }}>
            + Add template
          </button>
        </div>
      </div>

      {refreshMutation.isSuccess && (
        <div style={{ padding: "8px 14px", background: "rgba(34,211,163,0.1)", border: "1px solid rgba(34,211,163,0.25)", borderRadius: 8, marginBottom: 14, fontSize: 13, color: "var(--color-success)" }}>
          ✅ Weekly schedule refreshed
        </div>
      )}

      {showForm && (
        <div className="glass-sm" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <input id="base-origin" className="input" placeholder="Origin" value={form.origin} onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))} style={{ flex: "1 1 150px" }} />
            <input id="base-dest" className="input" placeholder="Destination" value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} style={{ flex: "1 1 150px" }} />
            <input id="base-time" className="input" type="time" value={form.departureTime} onChange={(e) => setForm((f) => ({ ...f, departureTime: e.target.value }))} style={{ flex: "0 0 120px" }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {dayLabels.map((d, i) => (
              <button
                key={d}
                type="button"
                className={`btn ${form.daysOfWeek.includes(i + 1) ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "5px 10px", fontSize: 12 }}
                onClick={() => toggleDay(i + 1)}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            id="save-base-trip"
            className="btn btn-primary"
            onClick={() => createMutation.mutate(form)}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <Spinner size={14} /> : "Save"}
          </button>
        </div>
      )}

      {isLoading ? <Spinner /> : (
        <div style={{ display: "grid", gap: 8 }}>
          {(bases || []).map((b) => (
            <div key={b.id} className="glass-sm" style={{ padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontWeight: 600 }}>{b.origin} → {b.destination}</span>
                <span style={{ color: "var(--color-text-sub)", fontSize: 12, marginLeft: 14 }}>
                  {b.departureTime} · Days: {(b.daysOfWeek || []).join(",")}
                </span>
              </div>
              <button
                className="btn btn-danger"
                style={{ padding: "5px 12px", fontSize: 12 }}
                onClick={() => deleteMutation.mutate(b.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Special Trip Form ─────────────────────────────────────────────────────────

function SpecialTripForm() {
  const [form, setForm] = useState({ origin: "", destination: "", departureTime: "", date: "", busId: "", driverId: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setResult(null); setLoading(true);
    try {
      const res = await api.post("/admin/trips/special", form);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create special trip");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ marginBottom: 40 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Create special trip</h2>
      <div className="glass-sm" style={{ padding: 20 }}>
        <form id="special-trip-form" onSubmit={handleSubmit} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input id="sp-origin" className="input" placeholder="Origin" value={form.origin} onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))} style={{ flex: "1 1 130px" }} required />
          <input id="sp-dest" className="input" placeholder="Destination" value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} style={{ flex: "1 1 130px" }} required />
          <input id="sp-time" className="input" type="time" value={form.departureTime} onChange={(e) => setForm((f) => ({ ...f, departureTime: e.target.value }))} style={{ flex: "0 0 110px" }} required />
          <input id="sp-date" className="input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={{ flex: "0 0 140px" }} required />
          <input id="sp-bus" className="input" placeholder="Bus ID" value={form.busId} onChange={(e) => setForm((f) => ({ ...f, busId: e.target.value }))} style={{ flex: "1 1 150px" }} required />
          <input id="sp-driver" className="input" placeholder="Driver ID" value={form.driverId} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))} style={{ flex: "1 1 150px" }} required />
          <button id="create-special-trip" type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <Spinner size={14} /> : "Create"}
          </button>
        </form>
        {error && <p style={{ color: "var(--color-danger)", fontSize: 13, marginTop: 10 }}>{error}</p>}
        {result && <p style={{ color: "var(--color-success)", fontSize: 13, marginTop: 10 }}>✅ Special trip created: {result.id?.slice(0, 8)}</p>}
      </div>
    </section>
  );
}

// ─── Audit Lookup ──────────────────────────────────────────────────────────────

function AuditLookup() {
  const [bookingId, setBookingId] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data: logs, isFetching, error } = useQuery({
    queryKey: ["audit", bookingId],
    queryFn: () => api.get(`/admin/audit/${bookingId}`).then((r) => r.data),
    enabled: submitted && !!bookingId,
    staleTime: 0,
  });

  return (
    <section>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Audit log lookup</h2>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <input
          id="audit-booking-id"
          className="input"
          placeholder="Booking ID"
          value={bookingId}
          onChange={(e) => { setBookingId(e.target.value); setSubmitted(false); }}
          style={{ maxWidth: 340 }}
        />
        <button id="audit-search-btn" className="btn btn-secondary" onClick={() => setSubmitted(true)} disabled={!bookingId}>
          Lookup
        </button>
      </div>
      {isFetching && <Spinner />}
      {error && <p style={{ color: "var(--color-danger)", fontSize: 13 }}>{error.response?.data?.error || "Not found"}</p>}
      {logs && (
        <div style={{ display: "grid", gap: 8 }}>
          {logs.map((log) => (
            <div key={log.id} className="glass-sm" style={{ padding: "10px 16px", fontSize: 13 }}>
              <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>{log.action}</span>
              <span style={{ color: "var(--color-text-sub)", marginLeft: 12 }}>
                {new Date(log.createdAt).toLocaleString()}
              </span>
              {log.metadata && (
                <pre style={{ margin: "6px 0 0", fontSize: 11, color: "var(--color-muted)", whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Main Admin Page ───────────────────────────────────────────────────────────

export function AdminPage() {
  return (
    <div className="fade-up">
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Admin panel</h1>
      <p style={{ color: "var(--color-text-sub)", marginBottom: 32, fontSize: 14 }}>
        Manage schedules, trips, and audit logs
      </p>
      <BaseScheduleEditor />
      <div className="divider" />
      <SpecialTripForm />
      <div className="divider" />
      <AuditLookup />
    </div>
  );
}
