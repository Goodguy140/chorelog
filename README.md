# Chorelog

A small web app for logging household chores, viewing monthly stats, and comparing activity month over month. Data is stored on the server (not only in the browser) so everyone using the same instance sees the same log.

Do not commit secrets, production `.env` files, or live `data/` contents.

## Deploying (step by step)

You need a persistent **`data/`** directory (writable by the Node process) and strong **secrets** in production. The app listens on **`PORT`** (default **3000**).

### Option A — Docker Compose

Best for homelab, TrueNAS Scale, or any host with Docker.

1. **Clone** the repository and `cd` into the project root.
2. **Create an env file** — Copy `.env.example` to `.env` next to `docker-compose.yml`. Set at least:
   - **`CHORELOG_SECRET`** — Long random string used to sign session cookies (change the default; never use the dev placeholder in production).
   - **`CHORELOG_PASSWORD`** — Password for the initial **`default`** household when the registry is first created (you can change it later in Settings → Account).
3. **Optional Web Push** — Leave `CHORELOG_VAPID_PUBLIC_KEY` / `CHORELOG_VAPID_PRIVATE_KEY` unset: `docker/entrypoint.sh` generates keys once and writes `data/vapid-keys.env` on the volume. Or generate keys with `npm run vapid:keys` and set the variables yourself.
4. **Build and start**:
   ```bash
   docker compose up -d --build
   ```
5. **Publish a port** — The compose file maps **`3000`**. Adjust the host side (e.g. `8080:3000`) if needed.
6. **TLS** — For a public URL, terminate HTTPS at a reverse proxy (Caddy, nginx, Traefik, etc.). Web Push in browsers requires **HTTPS** or **localhost**.
7. **Behind a reverse proxy** — Set **`CHORELOG_TRUST_PROXY=1`** so Express trusts `X-Forwarded-*` (needed for correct client IPs and secure cookies).

The Docker image runs as user **`node`**; the compose file mounts a named volume at **`/app/data`**. Point it at a host path if you prefer (see comments in `docker-compose.yml`).

**Auto-pull from Git** — For images that rebuild when the repo updates, see `docker-compose.autopull.yml` and set `GIT_REPO`, `GIT_BRANCH`, and `SYNC_INTERVAL` as documented there.

### Option B — Node directly (VPS or bare metal)

1. **Install** [Node.js](https://nodejs.org/) **18+** on the server.
2. **Clone** the repo, then install production dependencies:
   ```bash
   npm ci --omit=dev
   ```
3. **Environment** — Export variables in the shell, or use **systemd** `Environment=` / `EnvironmentFile=` (recommended). Set **`CHORELOG_SECRET`**, **`CHORELOG_PASSWORD`**, and optionally **`PORT`**. See [Configuration](#configuration) for the full list.
4. **Working directory** — Run the process from the **repository root** so the relative **`data/`** path is correct.
5. **Start** — `node server.js` (or `npm start`). Use systemd, PM2, or another supervisor to restart on failure.
6. **Firewall** — If you use a reverse proxy on the same machine, bind Node to localhost or restrict the app port with a firewall; terminate TLS at the proxy.
7. **`CHORELOG_TRUST_PROXY=1`** — Set when the app sits behind a reverse proxy (same as Docker).

### First login

- Sign in with household id **`default`** and the password from **`CHORELOG_PASSWORD`**.  
- If **`CHORELOG_PASSWORD`** was never set, the first-time registry bootstrap may use the insecure dev default **`monkey`** — **set a real password via env before exposing the server**, or change it immediately under Settings.

Verify the server with **`GET /api/version`** or open **Settings → About**.

## Requirements

- [Node.js](https://nodejs.org/) **18+** (global `fetch`, `crypto.randomUUID`, and native `fetch` in the Docker healthcheck).

## Local development

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
| `Dockerfile`, `docker/` | Container, entrypoint, VAPID helper scripts. |

## Configuration

Environment variables are read by **`server.js`** and **`lib/*.cjs`**. There is no separate config file beyond optional **`data/vapid-keys.env`** (written by the app or Docker when VAPID keys are generated).

### Essential

| Variable | Description |
|----------|-------------|
| **`PORT`** | HTTP port (default **`3000`**). |
| **`CHORELOG_SECRET`** | HMAC secret for auth cookies and API token hashing. **Change** the default before any real deployment. |
| **`CHORELOG_PASSWORD`** | Used when **creating** the initial household registry: password for household **`default`**. If unset at first bootstrap, a dev-only default may apply—**always set explicitly in production**. |

### Storage & database

| Variable | Description |
|----------|-------------|
| **`CHORELOG_SQLITE_PATH`** | Set to any non-empty value to store each household in **`chores.db`** under `data/households/<id>/` instead of JSON only. |
| **`CHORELOG_IMPORT_BACKUP`** | Set to `0` or `false` to skip automatic JSON backup before an import **replace**. Default on. |
| **`CHORELOG_BACKUP_RETENTION`** | Max number of JSON backup files per household under `backups/` (default **25**, max **200**). |
| **`CHORELOG_SCHEDULED_BACKUP_MS`** | If set to an integer **≥ 60000**, runs periodic JSON backups on that interval (ms). **`0`** or unset disables. |

### Security & networking

| Variable | Description |
|----------|-------------|
| **`CHORELOG_TRUST_PROXY`** | Set to **`1`** when behind a reverse proxy so `req.ip` and secure cookies use `X-Forwarded-For` / `X-Forwarded-Proto`. |
| **`CHORELOG_LOGIN_MAX_FAILURES`** | Failed login attempts before lockout (default **8**). |
| **`CHORELOG_LOGIN_LOCKOUT_MS`** | Lockout duration in ms (default **15 minutes**). |
| **`CHORELOG_LOGIN_WINDOW_MS`** | Rolling window for counting failures (default **15 minutes**). |

### Registration & access control

| Variable | Description |
|----------|-------------|
| **`CHORELOG_OPEN_REGISTRATION`** | Set to **`1`** to allow `POST /api/households` without a master password (open sign-ups). |
| **`CHORELOG_MASTER_PASSWORD`** | If set, allows creating **additional** households via API when this value is supplied; also reflected in account UI. |
| **`CHORELOG_GUEST_PASSWORD`** | If set, enables guest read-only login mode (see server and login UI). |

### Web Push (VAPID)

| Variable | Description |
|----------|-------------|
| **`CHORELOG_VAPID_PUBLIC_KEY`**, **`CHORELOG_VAPID_PRIVATE_KEY`**, **`CHORELOG_VAPID_SUBJECT`** | Standard Web Push keys; subject is often `mailto:…`. If unset, keys may be loaded from **`data/vapid-keys.env`** after first generation (Docker entrypoint or Settings → Administration on the **default** household). |

### Attachments (log entry photos)

| Variable | Description |
|----------|-------------|
| **`CHORELOG_ATTACHMENT_MAX_BYTES`** | Max size per upload (default **2 MiB**). |
| **`CHORELOG_ATTACHMENT_QUOTA_BYTES`** | Max total bytes per household on disk (default **50 MiB**). |

### Build metadata (Settings → About)

Optional **`CHORELOG_GITHUB_*`** variables (or standard CI **`GITHUB_*`**) feed **About** with repo, commit, workflow run, etc. See `lib/build-meta.cjs`.

### Docker Compose only

Sample compose files may define **`CHORELOG_USER`** for operator notes; **the application does not read it**—only **`CHORELOG_SECRET`**, **`CHORELOG_PASSWORD`**, and related vars above affect the Node process.

## Backup and restore

Use **Settings → Export JSON** to download a file, or **GET /api/export**. **Import** (or **POST /api/import**) can **replace** all data or **merge** with what is on the server; choose merge or replace carefully in the import dialog on this site before importing.

## License

Chorelog is released under the [MIT License](LICENSE).

The `"private": true` field in `package.json` only prevents accidental publishing to the npm registry; it does not relate to Git hosting or visibility.
