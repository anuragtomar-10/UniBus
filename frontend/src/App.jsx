import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { PageSpinner } from "./components/Spinner";
import { LoginForm } from "./features/auth/LoginForm";
import { RegisterForm } from "./features/auth/RegisterForm";
import { TripSearch } from "./features/trips/TripSearch";
import { SeatMap } from "./features/booking/SeatMap";
import { BookingHistory } from "./features/history/BookingHistory";
import { AdminPage } from "./features/admin/AdminPage";
import { InsightsPanel } from "./features/analytics/InsightsPanel";

// ── Protected route wrapper ───────────────────────────────────────────────────
function Protected({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "ADMIN") return <Navigate to="/trips" replace />;
  return children;
}

// ── Top navigation bar ────────────────────────────────────────────────────────
function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        background: "rgba(10,11,15,0.85)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--color-border)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        height: 56,
        gap: 8,
      }}
    >
      {/* Logo */}
      <span
        style={{ fontWeight: 800, fontSize: 18, marginRight: 24, cursor: "pointer" }}
        onClick={() => navigate(user.role === "ADMIN" ? "/admin" : "/trips")}
      >
        🚌 <span className="gradient-text">UniBus</span>
      </span>

      {/* User nav links */}
      {user.role !== "ADMIN" && (
        <>
          <NavLink to="/trips" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Search
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            My bookings
          </NavLink>
        </>
      )}

      {/* Admin nav links */}
      {user.role === "ADMIN" && (
        <>
          <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Schedule
          </NavLink>
          <NavLink to="/admin/analytics" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Analytics
          </NavLink>
        </>
      )}

      {/* Spacer + user info + logout */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 13, color: "var(--color-text-sub)" }}>
          {user.name}
          {user.role === "ADMIN" && (
            <span className="badge badge-special" style={{ marginLeft: 8 }}>Admin</span>
          )}
        </span>
        <button
          id="logout-btn"
          className="btn btn-secondary"
          style={{ fontSize: 12, padding: "5px 12px" }}
          onClick={logout}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { loading } = useAuth();
  if (loading) return <PageSpinner />;

  return (
    <div style={{ minHeight: "100vh" }}>
      <NavBar />

      {/* Decorative background blobs */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          overflow: "hidden",
        }}
      >
        <div style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(109,86,250,0.08) 0%, transparent 70%)",
          top: -200,
          left: -200,
        }} />
        <div style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.06) 0%, transparent 70%)",
          bottom: -100,
          right: -100,
        }} />
      </div>

      <main style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginForm />} />
          <Route path="/register" element={<RegisterForm />} />

          {/* User routes */}
          <Route path="/trips" element={<Protected><TripSearch /></Protected>} />
          <Route path="/trips/:tripId/seats" element={<Protected><SeatMap /></Protected>} />
          <Route path="/history" element={<Protected><BookingHistory /></Protected>} />

          {/* Admin routes */}
          <Route path="/admin" element={<Protected adminOnly><AdminPage /></Protected>} />
          <Route path="/admin/analytics" element={<Protected adminOnly><InsightsPanel /></Protected>} />

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </main>
    </div>
  );
}
