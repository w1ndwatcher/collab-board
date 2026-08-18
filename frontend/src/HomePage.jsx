import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [boards, setBoards] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/api/boards/`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setBoards)
      .catch(() => setBoards([]));
  }, []);

  async function createBoard() {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/boards/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Untitled board" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      navigate(`/board/${data.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container d-flex flex-column align-items-center py-5">
      <h1 className="h3 mb-4">Collab Board</h1>
      <div className="input-group mb-3" style={{ maxWidth: 360 }}>
        <input
          className="form-control"
          placeholder="Board name (optional)"
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
  );
}
