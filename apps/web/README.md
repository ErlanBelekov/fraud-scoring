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

## Mock vs. real backend

Data currently comes from a mock layer (`src/api/mock-data.ts`). To use the real
backend, replace the body of `fetchTransactions` in `src/api/transactions.ts`
with the `fetch('/transactions?...')` call documented in that file's comment.
Nothing else changes — the return type is identical.

## Pagination

Keyset pagination is forward-only (the backend returns only `nextCursor`).
`src/pagination.ts` keeps a client-side cursor stack so Prev and First work:
Next pushes the current cursor, Prev pops it, First clears the stack.
