import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Spinner } from "../../components/Spinner";

export function LoginForm() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.role === "ADMIN" ? "/admin" : "/trips");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "radial-gradient(ellipse at 30% 50%, rgba(109,86,250,0.12) 0%, transparent 60%), var(--color-bg)",
      }}
    >
      <div className="glass fade-up" style={{ width: "100%", maxWidth: 420, padding: 36 }}>
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🚌</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>
            <span className="gradient-text">UniBus</span>
          </h1>
          <p style={{ margin: "8px 0 0", color: "var(--color-text-sub)", fontSize: 14 }}>
            Sign in to your account
          </p>
        </div>

        <form onSubmit={handleSubmit} id="login-form">
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
              Email
            </label>
            <input
              id="login-email"
              type="email"
              className="input"
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
              Password
            </label>
            <input
              id="login-password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p style={{ color: "var(--color-danger)", fontSize: 13, marginBottom: 16, textAlign: "center" }}>
              {error}
            </p>
          )}

          <button id="login-submit" type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
            {loading ? <Spinner size={16} /> : "Sign in"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--color-text-sub)" }}>
          No account?{" "}
          <Link to="/register" style={{ color: "var(--color-accent)", textDecoration: "none", fontWeight: 500 }}>
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}
