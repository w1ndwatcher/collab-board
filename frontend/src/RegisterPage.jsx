import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "./auth.js";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(name, email, password);
      navigate("/login");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container d-flex flex-column align-items-center py-5" style={{ maxWidth: 420 }}>
      <h1 className="h3 mb-4">Collab Board</h1>
      <form className="w-100" onSubmit={submit}>
        {error && <div className="alert alert-danger small">{error}</div>}
        <div className="mb-3">
          <label className="form-label">Name</label>
          <input
            className="form-control"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <label className="form-label">Email</label>
          <input
            className="form-control"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <label className="form-label">Password</label>
          <input
            className="form-control"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-new-board w-100" disabled={busy}>
          Create account
        </button>
      </form>
      <p className="mt-3 small">
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
