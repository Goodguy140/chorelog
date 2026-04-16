# Chorelog

A small web app for logging household chores, viewing monthly stats, and comparing activity month over month. Data is stored on the server (not only in the browser) so everyone using the same instance sees the same log.

Practical deployment notes (environment variables, data paths) are described below; do not commit secrets or production credentials into your fork.

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

- **Server-side storage** — Per-household store under `data/households/<id>/` (JSON and/or SQLite; see **Project layout**). Seed data may appear on first run when a store is empty.
- **REST API** — `GET/POST /api/entries`, `PUT/DELETE /api/entries/:id` (update log row with `{ d, c, p }`), `PUT /api/settings` (people), scheduled-chore routes (`POST /api/scheduled-chores` with optional `createdAt`, `PUT/DELETE /api/scheduled-chores/:id`, `POST .../complete` with `{ person, completedDate }` for the user’s calendar day), `GET /api/export`, `POST /api/import`.
- **Scheduled chores** — Recurring items (e.g. weekly, every 2 weeks) with a dashboard showing next due and overdue state. The interval resets only when you **Mark done** (not from ordinary log entries).
- **Settings** — Theme (system / light / dark), manage people, export or import JSON backups, shortcut to manage scheduled chores.
- **PWA** — Web app manifest, icons, and a minimal service worker for installability on supported browsers (use HTTPS in production).

## Project layout

Single Node process: **Express** serves both the JSON API (`/api/*`) and static assets from the repo (including `index.html` and `/js/*`). The browser runs **native ES modules**—there is no bundler or compile step for the client.

### Entry points

| Path | Role |
|------|------|
| `server.js` | Wires routes, middleware, and `lib/*.cjs` helpers (store, auth, reminders, import/export, push, audit, …). |
| `js/chore-tracker.js` | Browser entry: initializes i18n, then loads `main.js`. |
| `js/main.js` | Most of the UI: calendar, settings, API calls, chore flows. |

### `js/` (client modules)

Other ES modules are loaded from `main.js` and peers: rendering (`render.js`, `render-registry.js`), presets (`presets.js`), scheduled UI (`scheduled-logic.js`, `scheduled-recurrence.js`), `administration.js`, `push-notifications.js`, `api-fetch.js`, `i18n.js`, `state.js`, and small `utils/*` helpers.

### `lib/` (server, CommonJS)

Reusable server logic—**not** imported by the browser—including:

- **Auth & tenants** — `auth-session.cjs`, `households-registry.cjs`, `login-throttle.cjs`
- **Persistence** — `store-access.cjs`, `sqlite-store.cjs`, `store-normalize.cjs`, `audit-log.cjs`, `backup-manager.cjs`, `entry-attachments.cjs`
- **Reminders & integrations** — `reminder-engine.cjs`, `reminder-payloads.cjs`, `webhook-channels.cjs`, `push-send.cjs`, `push-subscriptions.cjs`, `vapid-persist.cjs`
- **API docs** — `openapi-spec.cjs` (served at `GET /api/openapi.json`; snapshot in `docs/openapi.json` via `npm run docs:openapi`)
- **Other** — `csv-export.cjs`, `build-meta.cjs`, `server-dates.cjs`, `scheduled-recurrence.cjs`

### Static assets & i18n

| Path | Role |
|------|------|
| `index.html` | App shell (dialogs, settings panels, script `type="module"` entry). |
| `css/chore-tracker-*.css` | Layered styles (base, dashboard, scheduled, forms, auth, extras). |
| `locales/*.json` | UI strings consumed by `js/i18n.js` (e.g. English, German, Spanish). |
| `site.webmanifest`, `icons/`, `sw.js` | PWA manifest, icons, service worker. |

### `data/` (runtime; local to your install)

Household credentials and stores live under **`data/`** (create-on-first-run). Typical layout:

- Registry of households (SQLite `registry.db` after migration, or legacy JSON).
- Per household: **`data/households/<household-id>/`** with JSON store files and/or **`chores.db`** when `CHORELOG_SQLITE_PATH` is enabled, plus optional `backups/` snapshots.

Do not commit production databases or `.env`; treat `data/` as deployment-specific state.

### Tests & scripts

| Path | Role |
|------|------|
| `test/*.test.cjs` | `node --test` suites (store, CSV, registry, SQLite, …). |
| `scripts/write-openapi.cjs` | Regenerates `docs/openapi.json`. |
| `scripts/check-api-routes.cjs` | Fails CI if `server.js` routes drift from `lib/openapi-spec.cjs` (runs in `npm test`). |
| `Dockerfile`, `docker/` | Container and helper scripts for deployment. |

## Configuration

- **`PORT`** — Default `3000`. Example: `PORT=3001 npm start`.
- **Data directory** — `data/` under the project root; ensure the process can read and write here.

## Backup and restore

Use **Settings → Export JSON** to download a file, or **GET /api/export**. **Import** (or **POST /api/import**) can **replace** all data or **merge** with what is on the server; confirm the prompt carefully before importing.

## License

Chorelog is released under the [MIT License](LICENSE).

The `"private": true` field in `package.json` only prevents accidental publishing to the npm registry; it does not relate to Git hosting or visibility.
