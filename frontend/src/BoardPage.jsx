import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";

const COLUMNS = [
  { key: "todo", label: "To Do", headerClass: "col-header-todo", accentClass: "accent-todo", cardClass: "card-accent-todo" },
  { key: "doing", label: "Doing", headerClass: "col-header-doing", accentClass: "accent-doing", cardClass: "card-accent-doing" },
  { key: "done", label: "Done", headerClass: "col-header-done", accentClass: "accent-done", cardClass: "card-accent-done" },
];

const POSITION_GAP = 1000;

// Cards are grouped by column and sorted by position. We keep a flat list in
// state and derive columns to avoid duplicating data for the websocket/CRUD.
function sortByPosition(a, b) {
  return a.position - b.position;
}

function columnOf(key) {
  return COLUMNS.find((c) => c.key === key);
}

function SortableCard({ card, active, onConflictClear }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const col = columnOf(card.column);
  const accent = col ? col.cardClass : "";
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={`card mb-1 shadow-sm ${accent}`}>
      <div className="card-body py-2 px-3">
        <div className="d-flex justify-content-between align-items-center">
          <span className="small">{card.title}</span>
          {card.conflict && (
            <span
              className="badge text-bg-warning ms-2"
              onAnimationEnd={onConflictClear}
            >
              changed by someone else
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BoardPage() {
  const { boardId } = useParams();
  const [board, setBoard] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [drafts, setDrafts] = useState({ todo: "", doing: "", done: "" });
  const wsRef = useRef(null);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const byColumn = useMemo(() => {
    const groups = { todo: [], doing: [], done: [] };
    for (const c of cards) {
      groups[c.column] = groups[c.column] || [];
      groups[c.column].push(c);
    }
    COLUMNS.forEach(({ key }) => groups[key].sort(sortByPosition));
    return groups;
  }, [cards]);

  // Apply a card from a server/ws message into local state (upsert or delete).
  const upsertCard = useCallback((card) => {
    setCards((prev) => {
      const idx = prev.findIndex((c) => c.id === card.id);
      if (idx === -1) return [...prev, card];
      const next = prev.slice();
      next[idx] = { ...next[idx], ...card, conflict: false };
      return next;
    });
  }, []);

  const removeCard = useCallback((id) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Mark a card conflict so the inline indicator shows; clears after timeout.
  const flagConflict = useCallback((cardId) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, conflict: true } : c))
    );
    setTimeout(() => {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, conflict: false } : c))
      );
    }, 3000);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    fetch(`${API_URL}/api/boards/${boardId}/`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          setLoading(false);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setBoard(data);
        setCards(data.cards || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [boardId]);

  // Open the websocket and wire live event handlers directly to state.
  useEffect(() => {
    if (notFound) return;
    const ws = new WebSocket(`${WS_URL}/ws/boards/${boardId}/`);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      const data = msg.data || {};
      switch (msg.type) {
        case "card_created":
          upsertCard(data);
          break;
        case "card_updated":
        case "card_moved":
          upsertCard(data);
          break;
        case "card_deleted":
          removeCard(data.id);
          break;
        default:
          break;
      }
    };
    return () => {
      ws.close();
    };
  }, [boardId, notFound, upsertCard, removeCard]);

  // Compute the midpoint position for an insert/drop between neighbors.
  function midpointPosition(columnCards, index, movedId) {
    const others = columnCards.filter((c) => c.id !== movedId);
    const prev = others[index - 1];
    const next = others[index];
    if (prev && next) return (prev.position + next.position) / 2;
    if (prev) return prev.position + POSITION_GAP;
    if (next) return next.position / 2;
    return POSITION_GAP;
  }

  async function moveCard(card, column, index, optimistic = false) {
    const columnCards = byColumn[column] || [];
    const newPosition = midpointPosition(columnCards, index, card.id);
    if (optimistic) {
      setCards((prev) =>
        prev.map((c) =>
          c.id === card.id
            ? { ...c, column, position: newPosition, conflict: false }
            : c
        )
      );
    }
    try {
      const res = await fetch(`${API_URL}/api/cards/${card.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          column,
          position: newPosition,
          expected_updated_at: card.updated_at,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        // Someone else changed it first; take their version and flag it.
        setCards((prev) =>
          prev.map((c) =>
            c.id === card.id
              ? { ...c, ...data, conflict: true }
              : c
          )
        );
        flagConflict(card.id);
        return;
      }
      if (!res.ok) {
        // Non-conflict error: revert the optimistic move.
        setCards((prev) =>
          prev.map((c) => (c.id === card.id ? { ...c, ...card } : c))
        );
        return;
      }
      // Success: adopt the server-confirmed state (authoritative).
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, ...data } : c))
      );
    } catch (e) {
      // Network error: revert the optimistic move.
      setCards((prev) =>
        prev.map((c) => (c.id === card.id ? { ...c, ...card } : c))
      );
    }
  }

  function onDragStart(e) {
    setActiveId(e.active.id);
  }

  function onDragEnd(e) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const dragged = cardsRef.current.find((c) => c.id === active.id);
    if (!dragged) return;
    // Determine target column: if dropping onto another card, use its column.
    let column = dragged.column;
    let index = -1;
    const overCard = cardsRef.current.find((c) => c.id === over.id);
    if (overCard) {
      column = overCard.column;
      const col = byColumn[column] || [];
      index = col.findIndex((c) => c.id === overCard.id);
    }
    if (index < 0) {
      index = (byColumn[column] || []).length;
    }
    if (column === dragged.column && index === byColumn[dragged.column].findIndex((c) => c.id === dragged.id)) {
      return; // no-op
    }
    moveCard(dragged, column, index, true);
  }

  async function addCard(column) {
    const title = drafts[column].trim();
    if (!title) return;
    const col = byColumn[column] || [];
    const position = col.length ? col[col.length - 1].position + POSITION_GAP : POSITION_GAP;
    const res = await fetch(`${API_URL}/api/cards/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board: boardId, title, column, position }),
    });
    if (!res.ok) return;
    const data = await res.json();
    upsertCard(data);
    setDrafts((d) => ({ ...d, [column]: "" }));
  }

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-danger">Error: {error}</div>;
  if (notFound)
    return (
      <div className="container-fluid py-4">
        <nav className="board-navbar py-2 px-3 mb-4 d-flex justify-content-between align-items-center">
          <Link to="/" className="board-logo">
            Collab Board
          </Link>
          <Link to="/" className="btn btn-new-board btn-sm">
            New board
          </Link>
        </nav>
        <div className="container d-flex flex-column align-items-center py-5">
          <h1 className="h4 mb-3">Board not found</h1>
          <p className="text-muted">
            This board doesn't exist or was deleted.
          </p>
          <a href="/" className="btn btn-primary">
            Create a new board
          </a>
        </div>
      </div>
    );

  const activeCard = cards.find((c) => c.id === activeId);
  const navBar = (
    <nav className="board-navbar py-2 px-3 mb-4 d-flex justify-content-between align-items-center">
      <Link to="/" className="board-logo">
        Collab Board
      </Link>
      <Link to="/" className="btn btn-new-board btn-sm">
        New board
      </Link>
    </nav>
  );

  return (
    <div className="container-fluid py-4">
      {navBar}
      <h1 className="h4 mb-4">{board ? board.name : "Board"}</h1>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="row">
          {COLUMNS.map((col) => (
            <div className="col-md-4" key={col.key}>
              <div className="card shadow-sm">
                <div className={`card-header py-2 ${col.headerClass}`}>
                  <strong>{col.label}</strong>
                  <span className={`badge ms-2 float-end ${col.accentClass}`}>
                    {(byColumn[col.key] || []).length}
                  </span>
                </div>
                <div className="card-body">
                  <SortableContext
                    items={(byColumn[col.key] || []).map((c) => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {(byColumn[col.key] || []).map((c) => (
                      <SortableCard
                        key={c.id}
                        card={c}
                        active={activeId === c.id}
                        onConflictClear={() =>
                          setCards((prev) =>
                            prev.map((x) =>
                              x.id === c.id ? { ...x, conflict: false } : x
                            )
                          )
                        }
                      />
                    ))}
                  </SortableContext>
                  <div className="input-group input-group-sm mt-2">
                    <input
                      className="form-control"
                      placeholder="Add card..."
                      value={drafts[col.key]}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [col.key]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === "Enter" && addCard(col.key)}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={() => addCard(col.key)}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <DragOverlay>
          {activeCard ? (
            <div className={`card shadow ${columnOf(activeCard.column) ? columnOf(activeCard.column).cardClass : ""}`}>
              <div className="card-body py-2 px-3">{activeCard.title}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
