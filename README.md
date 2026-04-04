# Chorelog

A small web app for logging household chores, viewing monthly stats, and comparing activity month over month. Data is stored on the server (not only in the browser) so everyone using the same instance sees the same log.

## Requirements

- [Node.js](https://nodejs.org/) 18+ recommended (uses `fetch`-free server APIs and `crypto.randomUUID`).

## Quick start

```bash
npm install
npm start
```

Open **http://127.0.0.1:3000/** (or the URL printed in the terminal). The app must be served by this server so the browser can call the API; opening the HTML file directly (`file://`) will not load data.

Use **`npm run dev`** to run the server with **`node --watch`** so it restarts when `server.js` changes.

## Features

- **Server-side storage** — Chores, people, and scheduled recurring tasks live in `data/chores.json` (created on first run; includes optional seed data when empty).
- **REST API** — `GET/POST /api/entries`, `PUT/DELETE /api/entries/:id` (update log row with `{ d, c, p }`), `PUT /api/settings` (people), scheduled-chore routes (`POST /api/scheduled-chores` with optional `createdAt`, `PUT/DELETE /api/scheduled-chores/:id`, `POST .../complete` with `{ person, completedDate }` for the user’s calendar day), `GET /api/export`, `POST /api/import`.
- **Scheduled chores** — Recurring items (e.g. weekly, every 2 weeks) with a dashboard showing next due and overdue state. The interval resets only when you **Mark done** (not from ordinary log entries).
- **Settings** — Theme (system / light / dark), manage people, export or import JSON backups, shortcut to manage scheduled chores.
- **PWA** — Web app manifest, icons, and a minimal service worker for installability on supported browsers (use HTTPS in production).

## Project layout

| Path | Purpose |
|------|---------|
| `server.js` | Express app: API routes, static files, `GET /` → main HTML |
| `index.html` | App shell (links to CSS/JS) |
| `css/chore-tracker.css` | Styles |
| `js/chore-tracker.js` | Client UI and API calls |
| `data/chores.json` | Persisted `entries`, `people`, and `scheduledChores` (local / backup as needed) |
| `site.webmanifest`, `icons/`, `sw.js` | PWA assets |

## Configuration

- **`PORT`** — Default `3000`. Example: `PORT=3001 npm start`.
- **Data directory** — `data/` under the project root; ensure the process can read and write here.

## Backup and restore

Use **Settings → Export JSON** to download a file, or **GET /api/export**. **Import** (or **POST /api/import**) can **replace** all data or **merge** with what is on the server; confirm the prompt carefully before importing.

## License

Private project unless you add a license file.
