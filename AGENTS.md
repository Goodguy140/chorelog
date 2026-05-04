# Chorelog

Chorelog is a self-hosted household chore logging web app. Single Node.js process (Express), no external databases or services required. Data persists to `data/` directory (JSON or optional SQLite).

## Cursor Cloud specific instructions

### Running the application

```bash
npm run dev    # starts server with --watch on port 3000
```

Default login: household `default`, password `monkey` (dev fallback when `CHORELOG_PASSWORD` is unset).

### Testing

```bash
npm test       # runs node --test test/*.test.cjs + route-drift check
```

All tests use Node's built-in test runner; no extra test framework needed.

### Linting

There is no dedicated linter configured (no ESLint/Prettier in dependencies). Code quality is validated through the test suite and the API route-drift checker (`scripts/check-api-routes.cjs`).

### Key notes

- No build step: client code is native ES modules served directly by Express.
- The `data/` directory is created automatically on first server start; do not commit it.
- Node.js 22+ is required (uses `node:sqlite` built-in for optional SQLite mode and Node's built-in test runner).
- The API expects chore entries in batch format: `POST /api/entries` with `{ entries: [{ d, p, c|choreId }] }`.
