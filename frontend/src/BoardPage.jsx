import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
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
import ReactMarkdown from "react-markdown";
import { apiErrorMessage, fetchWithAuth, getToken, logout } from "./auth.js";

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

function displayName(user) {
  return (user && user.name) || (user && user.email) || "?";
}

function initials(user) {
  const name = displayName(user);
  if (name === "?") return "?";
  if (name.includes("@")) {
    // No name on record (pre-existing account): fall back to email initial.
    const local = name.split("@")[0];
    return local.charAt(0).toUpperCase() || "?";
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return parts[0].charAt(0).toUpperCase() || "?";
}

function cardTooltip(card) {
  const created = card.created_by ? displayName(card.created_by) : "—";
  const updated = card.updated_by ? displayName(card.updated_by) : "—";
  const assigned = card.assignee ? displayName(card.assignee) : "Unassigned";
  return [
    `Created By: ${created}`,
    `Last Updated By: ${updated}`,
    `Assigned to: ${assigned}`,
  ].join("\n");
}

function CardAvatars({ card }) {
  const badges = [];
  if (card.created_by) badges.push({ tag: "C", user: card.created_by });
  if (
    card.updated_by &&
    (!card.created_by || card.updated_by.id !== card.created_by.id)
  ) {
    badges.push({ tag: "U", user: card.updated_by });
  }
  if (card.assignee) badges.push({ tag: "A", user: card.assignee });
  return (
    <div className="card-avatars">
      {badges.slice(0, 3).map((b) => (
        <span
          key={b.tag}
          className={`avatar-badge avatar-${b.tag.toLowerCase()}`}
          title={displayName(b.user)}
        >
          {b.tag}
          {initials(b.user)}
        </span>
      ))}
    </div>
  );
}

function SortableCard({ card, users, onSaveTitle, onAssign, onConflictClear }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const col = columnOf(card.column);
  const accent = col ? col.cardClass : "";

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!assignOpen) return;
    function onDocClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setAssignOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [assignOpen]);

  function startEdit() {
    setDraft(card.title);
    setEditing(true);
  }

  function saveTitle() {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === card.title) return;
    onSaveTitle(card.id, trimmed);
  }

  function onTitleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveTitle();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      title={cardTooltip(card)}
      className={`card mb-1 shadow-sm ${accent}`}
    >
      <div className="card-body py-2 px-3">
        <div className="d-flex justify-content-between align-items-start">
          {editing ? (
            <input
              ref={inputRef}
              className="form-control form-control-sm"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={onTitleKeyDown}
            />
          ) : (
            <span className="small card-title-text" onClick={startEdit} title="Click to edit">
              {card.title}
            </span>
          )}
          {card.conflict && (
            <span
              className="badge text-bg-warning ms-2"
              onAnimationEnd={onConflictClear}
            >
              changed by someone else
            </span>
          )}
        </div>
        <div className="d-flex justify-content-between align-items-center mt-1">
          <span {...listeners} className="drag-handle" title="Drag to move">
            &#8801;
          </span>
          <div className="d-flex align-items-center" ref={dropdownRef}>
            <CardAvatars card={card} />
            <div className="position-relative ms-1">
              <button
                className="btn btn-sm btn-outline-secondary py-0 px-1 assign-btn"
                onClick={() => setAssignOpen((o) => !o)}
              >
                +
              </button>
              {assignOpen && (
                <div className="assign-menu">
                  <div className="assign-menu-header small text-muted px-2 py-1">
                    Assign to
                  </div>
                  <button
                    className="dropdown-item small"
                    onClick={() => {
                      setAssignOpen(false);
                      onAssign(card.id, null);
                    }}
                  >
                    Unassign
                  </button>
                  {[...users]
                    .sort((a, b) =>
                      displayName(a).localeCompare(displayName(b))
                    )
                    .map((u) => (
                    <button
                      key={u.id}
                      className="dropdown-item small"
                      onClick={() => {
                        setAssignOpen(false);
                        onAssign(card.id, u.id);
                      }}
                    >
                      {displayName(u)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColumnBody({ id, children }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className="card-body">
      {children}
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
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
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
    fetchWithAuth(`${API_URL}/api/boards/${boardId}/`)
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
        setError("Could not load the board. Please try again.");
        setLoading(false);
      });
  }, [boardId]);

  // Load the user list once for the assignee dropdown (shared across cards).
  useEffect(() => {
    fetchWithAuth(`${API_URL}/api/auth/users/`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  // Open the websocket and wire live event handlers directly to state.
  useEffect(() => {
    if (notFound) return;
    const ws = new WebSocket(`${WS_URL}/ws/boards/${boardId}/?token=${getToken()}`);
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

  // Shared optimistic-PATCH helper with the 409 conflict pattern used for
  // moves, title edits, and assignee changes.
  async function patchCard(cardId, patchBody, applyOptimistic) {
    const current = cardsRef.current.find((c) => c.id === cardId);
    if (!current) return;
    if (applyOptimistic) applyOptimistic(current);
    try {
      const res = await fetchWithAuth(`${API_URL}/api/cards/${cardId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...patchBody,
          expected_updated_at: current.updated_at,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setCards((prev) =>
          prev.map((c) =>
            c.id === cardId ? { ...c, ...data, conflict: true } : c
          )
        );
        flagConflict(cardId);
        return;
      }
      if (!res.ok) {
        setCards((prev) =>
          prev.map((c) => (c.id === cardId ? current : c))
        );
        return;
      }
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, ...data } : c))
      );
    } catch (e) {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? current : c))
      );
    }
  }

  function moveCard(card, column, index, optimistic = false) {
    const columnCards = byColumn[column] || [];
    const newPosition = midpointPosition(columnCards, index, card.id);
    patchCard(card.id, { column, position: newPosition }, (cur) => {
      if (optimistic) {
        setCards((prev) =>
          prev.map((c) =>
            c.id === card.id
              ? { ...c, column, position: newPosition, conflict: false }
              : c
          )
        );
      }
    });
  }

  function saveTitle(cardId, newTitle) {
    patchCard(cardId, { title: newTitle }, (cur) => {
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, title: newTitle } : c))
      );
    });
  }

  function assignCard(cardId, assigneeId) {
    patchCard(cardId, { assignee_id: assigneeId }, (cur) => {
      setCards((prev) =>
        prev.map((c) => {
          if (c.id !== cardId) return c;
          const assignee =
            assigneeId == null
              ? null
              : users.find((u) => u.id === assigneeId) || null;
          return { ...c, assignee, conflict: false };
        })
      );
    });
  }

  function onDragStart(e) {
    setActiveId(e.active.id);
  }

  // Live-reparent the dragged card into whichever column/position the pointer
  // is over during the drag. SortableContext is per-column, so without this a
  // cross-column move would never register in the target column's list.
  function onDragOver(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeCard = cardsRef.current.find((c) => c.id === active.id);
    if (!activeCard) return;

    let targetColumn = null;
    let overIndex = -1;

    const overCard = cardsRef.current.find((c) => c.id === over.id);
    if (overCard) {
      targetColumn = overCard.column;
      const col = byColumn[targetColumn] || [];
      overIndex = col.findIndex((c) => c.id === overCard.id);
      if (overIndex < 0) return;
    } else if (typeof over.id === "string" && over.id.startsWith("column-")) {
      targetColumn = over.id.slice("column-".length);
      overIndex = (byColumn[targetColumn] || []).length;
    } else {
      return;
    }

    if (targetColumn === activeCard.column) {
      const col = byColumn[targetColumn] || [];
      const curIndex = col.findIndex((c) => c.id === activeCard.id);
      if (curIndex === overIndex || curIndex === -1) return;
      const next = col.slice();
      next.splice(curIndex, 1);
      next.splice(overIndex, 0, activeCard);
      setCards((prev) =>
        prev.map((c) => {
          const idx = next.findIndex((x) => x.id === c.id);
          if (idx === -1) return c;
          return { ...c, position: next[idx].position };
        })
      );
      return;
    }

    const targetCol = byColumn[targetColumn] || [];
    const others = targetCol.filter((c) => c.id !== activeCard.id);
    const insertAt = Math.min(overIndex, others.length);
    const prev = others[insertAt - 1];
    const next = others[insertAt];
    const newPosition = prev && next
      ? (prev.position + next.position) / 2
      : prev
        ? prev.position + POSITION_GAP
        : next
          ? next.position / 2
          : POSITION_GAP;
    setCards((prev) =>
      prev.map((c) =>
        c.id === activeCard.id
          ? { ...c, column: targetColumn, position: newPosition }
          : c
      )
    );
  }

  // Persist the (already-reparented-by-onDragOver) position with the existing
  // conflict-check PATCH. No midpoint recomputation here — state holds it.
  function moveCardTo(cardId, column, position) {
    patchCard(cardId, { column, position }, (cur) => {
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? { ...c, column, position, conflict: false }
            : c
        )
      );
    });
  }

  function onDragEnd(e) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const dragged = cardsRef.current.find((c) => c.id === active.id);
    if (!dragged) return;
    moveCardTo(dragged.id, dragged.column, dragged.position);
  }

  async function addCard(column) {
    const title = drafts[column].trim();
    if (!title) return;
    const col = byColumn[column] || [];
    const position = col.length ? col[col.length - 1].position + POSITION_GAP : POSITION_GAP;
    const res = await fetchWithAuth(`${API_URL}/api/cards/`, {
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
          <button className="btn btn-outline-secondary btn-sm" onClick={logout}>
            Logout
          </button>
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

  async function generateSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);
    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/boards/${boardId}/summary/`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSummaryError(
          data.detail ||
            "Could not generate the summary. Please try again."
        );
        return;
      }
      setSummary(data.summary);
    } catch (e) {
      setSummaryError("Could not generate the summary. Please try again.");
    } finally {
      setSummaryLoading(false);
    }
  }

  const activeCard = cards.find((c) => c.id === activeId);
  const navBar = (
    <nav className="board-navbar py-2 px-3 mb-4 d-flex justify-content-between align-items-center">
      <Link to="/" className="board-logo">
        Collab Board
      </Link>
      <Link to="/" className="btn btn-new-board btn-sm">
        New board
      </Link>
      <button className="btn btn-outline-secondary btn-sm" onClick={logout}>
        Logout
      </button>
    </nav>
  );

  return (
    <div className="container-fluid py-4">
      {navBar}
      <h1 className="h4 mb-3">{board ? board.name : "Board"}</h1>
      <div className="mb-4">
        <button
          className="btn btn-outline-primary btn-sm"
          onClick={generateSummary}
          disabled={summaryLoading}
        >
          {summaryLoading ? "Generating..." : summary ? "Regenerate Summary" : "Generate Board Summary"}
        </button>
        {summaryError && (
          <div className="alert alert-danger small mt-2 mb-0">{summaryError}</div>
        )}
        {summary && (
          <div className="card mt-2 shadow-sm">
            <div className="card-body">
              <div className="card-title small text-muted mb-2">
                Board Summary
              </div>
              <div className="small summary-content">
                <ReactMarkdown>{summary}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
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
                <ColumnBody id={`column-${col.key}`}>
                  <SortableContext
                    items={(byColumn[col.key] || []).map((c) => c.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {(byColumn[col.key] || []).map((c) => (
                      <SortableCard
                        key={c.id}
                        card={c}
                        users={users}
                        onSaveTitle={saveTitle}
                        onAssign={assignCard}
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
                </ColumnBody>
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
