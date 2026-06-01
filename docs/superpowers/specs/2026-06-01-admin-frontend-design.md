# Admin Frontend (`apps/web`) — Design

**Date:** 2026-06-01
**Stack:** Vite + React + TypeScript. No router, no UI framework.
**Scope:** `apps/web` only. Does NOT create or modify `packages/shared` or `apps/api`.

---

## 1. Overview

A single-page admin UI that lists transactions from the backend's
`GET /transactions` keyset-paginated endpoint and lets an operator page
through the data: **First / Prev / Next**.

The backend does not exist yet (it is a separate plan, out of scope here).
The frontend ships with a **mock data layer** that mimics the real endpoint's
contract exactly, so swapping to the real backend later is a one-file change.

**Key constraint — keyset pagination is forward-only.** The endpoint returns a
`nextCursor` (the id of the last item). There is no native "prev" or "first".
The frontend reconstructs them with a **client-side cursor stack**.

---

## 2. Scope boundary

- **In scope:** everything under `apps/web/`.
- **Out of scope (do NOT touch):** `packages/shared`, `apps/api`, repo-root
  `package.json`/workspace config.
- The app is **self-contained**: its own `package.json`, its own deps,
  `npm install` runs inside `apps/web`. It runs standalone via `npm run dev`.
- The wire-contract types are copied locally into `src/types.ts` (mirroring the
  `@fraud/shared` contract from the backend plan). When `@fraud/shared` later
  exists, `src/types.ts` can be replaced with a re-export — a one-file swap.

---

## 3. File structure

```
apps/web/
  package.json          # react, react-dom, vite, @vitejs/plugin-react, typescript
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx            # React mount
    App.tsx             # owns cursor-stack state + fetch orchestration
    types.ts            # Decision, TransactionListItem, TransactionListPage (local copy)
    api/transactions.ts # fetchTransactions({limit,cursor}) — mock now, real later
    api/mock-data.ts    # ~200 canned rows + keyset slice logic
    components/
      TransactionsTable.tsx  # presentational, props = items
      Pager.tsx              # First / Prev / Next buttons
```

**Decomposition rationale:** `App` holds all pagination state. The table and
pager are presentational (props in, callbacks out) so they are trivial to read
and test. The data layer (`api/`) is the only place that knows whether data is
mock or real — isolating the future backend swap to one module.

---

## 4. Wire contract (`src/types.ts`)

Mirrors the backend `@fraud/shared` contract:

```ts
export type Decision = 'approve' | 'review' | 'decline';

export interface TransactionListItem {
  id: string;
  transactionId: string;
  cardToken: string;
  customerId: string;
  amount: number;
  currency: string;
  ip: string | null;
  country: string;
  deviceFingerprint: string | null;
  createdAt: string;        // ISO-8601
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string;      // ISO-8601
}

export interface TransactionListPage {
  items: TransactionListItem[];
  nextCursor: number | null;
}
```

Note: `id` is a numeric cursor on the wire but typed `string` in the shared
contract; the mock generates monotonic numeric-string ids and the cursor stack
works with `number`. The fetch layer parses/serializes the cursor as a number,
matching the backend's `?cursor=<id>` integer query param.

---

## 5. Data layer

`fetchTransactions({ limit, cursor })` returns a `Promise<TransactionListPage>`.

**Mock implementation** mimics the backend keyset query exactly:
1. Hold ~200 canned rows, each with a monotonic integer `id`.
2. Sort by `id` descending.
3. If `cursor` given, keep rows with `id < cursor`.
4. Take `limit` rows.
5. `nextCursor` = id of the last returned row **only if** more rows exist after
   it; otherwise `null` (matches the backend's "fetch limit+1 to detect next").
6. Small artificial delay (~150ms) so loading state is visible.

Swapping to the real backend = replace the mock body with
`fetch(\`/transactions?limit=\${limit}&cursor=\${cursor ?? ''}\`)`. Same return
type, no caller changes.

---

## 6. Pagination — cursor stack

`App` state:
- `cursorStack: number[]` — cursors of the pages visited before the current one.
- `items: TransactionListItem[]` — current page rows.
- `nextCursor: number | null` — cursor to fetch the next page.
- `loading: boolean`.

A page is identified by the cursor used to fetch it (`undefined` = first page).

- **First** → `cursorStack = []`, fetch with `cursor = undefined`.
- **Next** → push the **current page's cursor** onto `cursorStack`, fetch with
  `nextCursor`.
- **Prev** → pop `cursorStack`; fetch with the new top (or `undefined` if the
  stack is now empty).
- **Prev** disabled when `cursorStack` is empty (already on first page).
- **Next** disabled when `nextCursor === null` (last page).
- All buttons disabled while `loading`.

This keeps every page reachable backward/forward without any backend change,
honoring the design's keyset-only, no-OFFSET decision.

---

## 7. Table

`TransactionsTable` renders columns: id, transactionId (truncated), customerId,
amount + currency, country, decision (color-coded chip:
approve=green, review=amber, decline=red), score, triggeredRules (joined),
createdAt (formatted). Presentational only — no state.

Empty state: "No transactions." when `items` is empty and not loading.

---

## 8. Error handling

- Fetch rejects → `App` catches, stores an `error` string, table area shows the
  error with a Retry button (re-runs the last fetch with the same cursor).
- Mock never errors in normal operation; the error path exists for the real
  backend swap (e.g. 503 from a fail-closed backend).

---

## 9. Testing

Lightweight — this is a simple admin tool:
- Unit test the mock keyset slice (`api/mock-data.ts`): correct ordering,
  `id < cursor` filtering, `nextCursor` null on last page, idempotent paging.
- Unit test the cursor-stack transitions (push on Next, pop on Prev, clear on
  First; Prev disabled on first page; Next disabled on last page) — extract the
  reducer/logic so it is testable without the DOM.
- Vitest + React Testing Library (Vite-native). Keep it minimal.

---

## 10. Out of scope (YAGNI)

- Auth, the `POST /score` form, filtering/search, sorting by column.
- Real backend wiring (mock only; swap point documented in §5).
- `packages/shared`, `apps/api`, root workspace config — explicitly untouched.
- Routing, global state libraries, component libraries.
