import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiErrorMessage, fetchWithAuth, logout } from "./auth.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [boards, setBoards] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchWithAuth(`${API_URL}/api/boards/`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setBoards)
      .catch(() => setBoards([]));
  }, []);

  async function createBoard() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter a board name.");
      return;
    }
    if (trimmed.length < 2) {
      setError("Board name must be at least 2 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/boards/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, "Could not create the board. Please try again."));
        return;
      }
      const data = await res.json();
      navigate(`/board/${data.id}`);
    } catch (e) {
      setError("Could not create the board. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <nav className="board-navbar py-2 px-3 mb-4 d-flex justify-content-between align-items-center">
        <Link to="/" className="board-logo">
          Collab Board
        </Link>
        <button className="btn btn-outline-secondary btn-sm" onClick={logout}>
          Logout
        </button>
      </nav>
      <div className="container d-flex flex-column align-items-center py-4">
        <h1 className="h4 mb-4">Create a board</h1>
        {error && <div className="alert alert-danger small w-100" style={{ maxWidth: 360 }}>{error}</div>}
        <div className="input-group mb-3" style={{ maxWidth: 360 }}>
          <input
            className="form-control"
            placeholder="Board name (required)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createBoard()}
          />
        </div>
        <button className="btn btn-new-board" onClick={createBoard} disabled={busy}>
          Create new board
        </button>
        <div className="mt-5 w-100" style={{ maxWidth: 480 }}>
          <h2 className="h6 text-muted mb-2">Boards</h2>
          {boards.length === 0 ? (
            <p className="text-muted small">No boards yet.</p>
          ) : (
            <ul className="list-group">
              {boards.map((b) => (
                <li key={b.id} className="list-group-item">
                  <Link to={`/board/${b.id}`} className="text-decoration-none">
                    {b.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
