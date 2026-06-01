# Fraud Admin Frontend (`apps/web`)

Vite + React + TypeScript admin UI that lists scored transactions with
First / Prev / Next pagination over the backend's keyset `GET /transactions`
endpoint.

## Develop

```bash
cd apps/web
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (mock data + pagination)
npm run build    # production build
```

## Run connected to the real backend

By default the frontend calls the **real backend**. Vite proxies `/transactions`
and `/score` to `http://localhost:3000` (see `vite.config.ts`), so the browser
hits one origin — no CORS config on the backend needed.

Full local stack:

```bash
# 1. Start the backend's datastores + API (separate terminal)
cd apps/api
docker compose up -d            # postgres + redis
npm install
npm run start:dev               # NestJS on http://localhost:3000

# 2. Seed some data (the DB is empty until you POST /score)
cd ../web
./scripts/seed.sh 40            # POSTs 40 sample transactions to :3000/score

# 3. Start the frontend
npm install
npm run dev                     # http://localhost:5173 — lists the seeded rows
```

### Mock mode (no backend)

To run standalone against the in-repo mock dataset (`src/api/mock-data.ts`):

```bash
VITE_USE_MOCK=true npm run dev
```

The data source is the only thing that changes — the return type
(`TransactionListPage`) is identical for mock and real. See
`src/api/transactions.ts`.

## Pagination

Keyset pagination is forward-only (the backend returns only `nextCursor`).
`src/pagination.ts` keeps a client-side cursor stack so Prev and First work:
Next pushes the current cursor, Prev pops it, First clears the stack.
