# Collab Board

A real-time collaborative kanban board. Users register and log in, create boards, and work on them together. Card changes broadcast over WebSockets so everyone on a board sees updates live, with no refresh.

## Demo

[Live Demo](https://collab-board-yu78.vercel.app/login)

## Tech Stack

- **Backend:** Django 5, Django REST Framework, Django Channels, djangorestframework-simplejwt, PostgreSQL (via `DATABASE_URL`) / SQLite for local dev
- **Frontend:** React 18 (Vite), react-router-dom, @dnd-kit (drag-and-drop), Bootstrap 5 (CDN) + custom CSS
- **Realtime:** Django Channels WebSockets with the in-memory channel layer (single-instance deployment)

## Features

- **Authentication** - email + password registration and login, JWT access/refresh tokens, route protection and 401 auto-redirect on the frontend.
- **Boards** - create boards, list existing boards on the home page, open any board by URL (`/board/:boardId`). Boards are currently shared by URL and accessible to any authenticated user.
- **Kanban columns** - To Do / Doing / Done, with cards grouped by column and ordered by a gap-based `position` float so moving one card never renumbers a column.
- **Drag-and-drop** - reorder within a column and move cards across columns (including into empty columns). Moves persist via PATCH with an optimistic update and a conflict check.
- **Live collaboration** - WebSocket events (`card_created`, `card_updated`, `card_moved`, `card_deleted`) update every connected client's state directly; no refetch.
- **Inline card editing** - click a card title to edit it in place (Enter/blur saves, Escape cancels, empty reverts).
- **Attribution & avatars** - each card tracks creator, last updater, and assignee. Small C/U/A initial badges show attribution; hovering a card shows a full summary of all three roles.
- **Assignee assignment** - pick a user from a dropdown (fetched once per board); assign or unassign a card.
- **Conflict detection** - PATCHes send `expected_updated_at`; a 409 means someone else changed the card first, and the UI adopts the server version with a "changed by someone else" indicator.
- **Optimistic UI** - title, move, and assignee changes apply locally first, then reconcile with the server response.

## Project Layout

```
backend/                 Django project + API
  collab_board/          project settings, URL routing, ASGI (Channels)
  boards/                app: models, serializers, views, consumers, auth
    models.py            Board, Card (with attribution fields)
    views.py             ViewSets + auth (register/login/users)
    consumers.py         BoardConsumer (WebSocket)
  requirements.txt
frontend/                Vite + React app
  src/                   components (App, BoardPage, HomePage, Login/Register), auth, CSS
```

## Getting Started

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver      # http://localhost:8000
```

Run the WebSocket/ASGI server with Daphne for realtime support:

```bash
daphne collab_board.asgi:application
```

Environment variables (all optional for local dev):

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | dev-insecure | Django secret key |
| `DEBUG` | `True` | Django debug mode |
| `DATABASE_URL` | `sqlite:///db.sqlite3` | DB connection string |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Allowed CORS origins |
| `AI_API_KEY` | `<groq_api_key>` | Integrate LLM |
| `AI_API_URL` | `<groq_api_url>` | Chat completion |
| `AI_MODEL` | `openai/gpt-oss-20b` | LLM |

### Frontend

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Environment variables (optional, defaults to localhost):

```bash
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

Create a `.env` file from `.env.example` if your API/WS URLs differ.

### Using the app

1. Open the frontend and **Register** an account (name + email + password), then log in.
2. On the home page, **Create new board**.
3. Open the board, add cards with the per-column **Add** input, drag cards between columns, click a title to edit it, and use **+** to assign cards to users.
4. Open the same board in a second browser to watch changes sync live.

## API Summary

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| POST | `/api/auth/register/` | Register (name, email, password) | Public |
| POST | `/api/auth/login/` | Login, returns access + refresh | Public |
| POST | `/api/auth/token/refresh/` | Refresh access token | Public |
| GET | `/api/auth/users/` | List users `{id, email, name}` | JWT |
| GET/POST | `/api/boards/` | List / create boards | JWT |
| GET/PUT/PATCH/DELETE | `/api/boards/{id}/` | Board detail | JWT |
| GET/POST | `/api/cards/` | List / create cards | JWT |
| GET/PUT/PATCH/DELETE | `/api/cards/{id}/` | Card detail | JWT |
| WS | `/ws/boards/{boardId}/?token=<jwt>` | Live board events | JWT |

Card PATCH accepts `expected_updated_at` for optimistic concurrency; a stale value returns `409` with the current card data.

## How Realtime Works

`BoardConsumer` authenticates the connection with a JWT passed as a `token`
query param (rejects with code `4401` otherwise), then joins a per-board group
(`board_<id>`). REST mutations in `CardViewSet` broadcast `card_created`,
`card_updated`, `card_moved`, and `card_deleted` events to that group. The
frontend's WebSocket handler applies them straight to local state via
`upsertCard`, so other clients see changes immediately.

## Future Scope

- **Board permissions / ownership** - boards are currently unauthenticated-by-URL and editable by any logged-in user. Adding board owners, member invites, and view/edit roles is the next natural step.
- **Redis channel layer** - switch from the in-memory layer to Redis so multiple backend instances can share realtime state.
- **Card comments & activity log** - an audit trail of who changed what and when.
- **Card details modal** - descriptions, due dates, labels, and checklists.
- **Rich assignee picker** - search-as-you-type, initials avatars, and multi-assignee support.
- **Persistence of the auth session** - refresh-token rotation and automatic access-token refresh on 401.
- **Tests** - comprehensive backend unit/API tests and frontend component tests.
- **Search & filtering** - search cards by title, filter by assignee or column.
- **Deployment** - Dockerfiles, a `docker-compose` stack (Django + Daphne + Redis + Postgres + Vite), and CI/CD.
