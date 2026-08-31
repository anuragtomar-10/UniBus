import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Spinner } from "../../components/Spinner";

export function RegisterForm() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await register(name, email, password);
      navigate("/trips");
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed");
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
        background: "radial-gradient(ellipse at 70% 40%, rgba(167,139,250,0.1) 0%, transparent 60%), var(--color-bg)",
      }}
    >
      <div className="glass fade-up" style={{ width: "100%", maxWidth: 420, padding: 36 }}>
        <div style={{ marginBottom: 32, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🎓</div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>
            <span className="gradient-text">Create account</span>
          </h1>
          <p style={{ margin: "8px 0 0", color: "var(--color-text-sub)", fontSize: 14 }}>
            Join UniBus today
          </p>
        </div>

        <form onSubmit={handleSubmit} id="register-form">
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
              Full name
            </label>
            <input id="register-name" type="text" className="input" placeholder="Alex Johnson" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
              Email
            </label>
            <input id="register-email" type="email" className="input" placeholder="you@university.edu" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--color-text-sub)" }}>
              Password
            </label>
            <input id="register-password" type="password" className="input" placeholder="Min. 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>

          {error && (
            <p style={{ color: "var(--color-danger)", fontSize: 13, marginBottom: 16, textAlign: "center" }}>{error}</p>
          )}

          <button id="register-submit" type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
            {loading ? <Spinner size={16} /> : "Create account"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--color-text-sub)" }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "var(--color-accent)", textDecoration: "none", fontWeight: 500 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
