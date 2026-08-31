import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../lib/api";
import { Spinner } from "../../components/Spinner";

// ─── Recommendation card ───────────────────────────────────────────────────────

function RecommendationCard({ rec, onReview }) {
  const [expanded, setExpanded] = useState(false);

  const actionColors = {
    ADD_TO_BASE: "var(--color-success)",
    REMOVE_FROM_BASE: "var(--color-danger)",
    INCREASE_FREQUENCY: "var(--color-accent)",
    DECREASE_FREQUENCY: "var(--color-warning)",
    INVESTIGATE_CANCELLATIONS: "#38bdf8",
  };

  return (
    <div className="glass" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>
              {rec.origin} → {rec.destination}
            </span>
            <span
              className="badge"
              style={{
                background: `${actionColors[rec.suggestedAction]}1a`,
                color: actionColors[rec.suggestedAction],
                border: `1px solid ${actionColors[rec.suggestedAction]}40`,
              }}
            >
              {rec.suggestedAction.replace(/_/g, " ")}
            </span>
            <span className={`badge badge-${rec.status.toLowerCase()}`}>{rec.status}</span>
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-sub)" }}>
            🕒 {rec.departureTime}
            {rec.dayOfWeek && <span style={{ marginLeft: 12 }}>Day {rec.dayOfWeek}</span>}
            <span style={{ marginLeft: 12 }}>
              {new Date(rec.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          </div>
        </div>

        {rec.status === "PENDING" && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              id={`accept-${rec.id}`}
              className="btn btn-success"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={() => onReview(rec.id, "ACCEPTED")}
            >
              ✓ Accept
            </button>
            <button
              id={`dismiss-${rec.id}`}
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={() => onReview(rec.id, "DISMISSED")}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      <button
        style={{ background: "none", border: "none", color: "var(--color-accent)", cursor: "pointer", fontSize: 12, padding: "8px 0 0", display: "flex", alignItems: "center", gap: 4 }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "▾" : "▸"} Evidence
      </button>
      {expanded && (
        <div style={{ marginTop: 8, padding: "10px 14px", background: "rgba(255,255,255,0.04)", borderRadius: 8, fontSize: 13, color: "var(--color-text-sub)", lineHeight: 1.6 }}>
          {rec.evidence}
        </div>
      )}
    </div>
  );
}

// ─── Main analytics page ───────────────────────────────────────────────────────

export function InsightsPanel() {
  const queryClient = useQueryClient();
  const [lookbackWeeks, setLookbackWeeks] = useState(4);
  const [statusFilter, setStatusFilter] = useState("");
  const [runError, setRunError] = useState("");

  const { data: recommendations, isLoading } = useQuery({
    queryKey: ["recommendations", statusFilter],
    queryFn: () =>
      api.get("/admin/analytics/recommendations", { params: statusFilter ? { status: statusFilter } : {} }).then((r) => r.data),
  });

  const analysisMutation = useMutation({
    mutationFn: () => api.post("/admin/analytics/insights", { lookbackWeeks }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recommendations"] }),
    onError: (err) => setRunError(err.response?.data?.error || "Analysis failed"),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/admin/analytics/recommendations/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recommendations"] }),
  });

  return (
    <div className="fade-up">
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 6 }}>Analytics insights</h1>
      <p style={{ color: "var(--color-text-sub)", marginBottom: 28, fontSize: 14 }}>
        AI-powered schedule recommendations using booking data
      </p>

      {/* Run analysis card */}
      <div className="glass" style={{ padding: 24, marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Run new analysis</h2>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
              Lookback window
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {[2, 4, 8].map((w) => (
                <button
                  key={w}
                  id={`lookback-${w}`}
                  type="button"
                  className={`btn ${lookbackWeeks === w ? "btn-primary" : "btn-secondary"}`}
                  style={{ padding: "7px 16px", fontSize: 13 }}
                  onClick={() => setLookbackWeeks(w)}
                >
                  {w}w
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 22 }}>
            <button
              id="run-analysis-btn"
              className="btn btn-primary glow-primary"
              onClick={() => { setRunError(""); analysisMutation.mutate(); }}
              disabled={analysisMutation.isPending}
            >
              {analysisMutation.isPending ? (
                <><Spinner size={16} /> Analysing…</>
              ) : (
                "🤖 Run analysis"
              )}
            </button>
          </div>
        </div>

        {analysisMutation.isSuccess && (
          <div style={{ marginTop: 14, fontSize: 13, color: "var(--color-success)" }}>
            ✅ Saved {analysisMutation.data?.data?.saved ?? 0} recommendations
            {analysisMutation.data?.data?.skipped > 0 && ` (${analysisMutation.data.data.skipped} skipped — invalid)`}
          </div>
        )}
        {runError && <p style={{ marginTop: 14, fontSize: 13, color: "var(--color-danger)" }}>{runError}</p>}
      </div>

      {/* Recommendations list */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Recommendations</h2>
        <select
          id="status-filter"
          className="input"
          style={{ width: "auto", fontSize: 13 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          <option value="PENDING">Pending</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
      </div>

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Spinner size={28} /></div>
      ) : recommendations?.length === 0 ? (
        <div className="glass" style={{ padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
          <p style={{ color: "var(--color-text-sub)" }}>No recommendations yet. Run an analysis to get started.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {recommendations?.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              onReview={(id, status) => reviewMutation.mutate({ id, status })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
