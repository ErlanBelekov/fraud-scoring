# Admin Frontend (`apps/web`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained Vite + React + TypeScript admin SPA at `apps/web` that lists transactions from the backend's `GET /transactions` keyset endpoint (mocked for now) with First / Prev / Next pagination.

**Architecture:** Single page. `App` owns all pagination state via a client-side cursor stack (keyset pagination is forward-only, so Prev/First are reconstructed client-side). Presentational `TransactionsTable` and `Pager` components take props only. A `fetchTransactions()` data layer mimics the real endpoint exactly so swapping mock → real backend is a one-file change.

**Tech Stack:** Vite 5, React 18, TypeScript 5, Vitest + React Testing Library. No router, no UI framework, no global state library.

**Scope boundary:** Everything lives under `apps/web/`. Do NOT create or modify `packages/shared`, `apps/api`, or the repo-root `package.json`. The app installs and runs standalone (`npm install` + `npm run dev` inside `apps/web`).

---

## File Structure

```
apps/web/
  package.json          # react, react-dom, vite, @vitejs/plugin-react, typescript, vitest, RTL
  tsconfig.json
  tsconfig.node.json    # for vite.config.ts
  vite.config.ts        # react plugin + vitest config
  index.html
  src/
    main.tsx            # React mount
    App.tsx             # owns cursor-stack state + fetch orchestration
    types.ts            # Decision, TransactionListItem, TransactionListPage (local contract copy)
    pagination.ts       # pure cursor-stack reducer + helpers (testable, no DOM)
    api/
      mock-data.ts      # ~200 canned rows + pure keyset slice fn `slicePage`
      transactions.ts   # fetchTransactions({limit,cursor}) -> Promise<TransactionListPage>
    components/
      TransactionsTable.tsx  # presentational table, props = { items, loading }
      Pager.tsx              # First / Prev / Next buttons, props = state + callbacks
    App.css             # minimal styling
  test/
    mock-data.test.ts       # slicePage keyset behavior
    pagination.test.ts      # cursor-stack reducer transitions
```

**Decomposition rationale:** `pagination.ts` and `api/mock-data.ts` hold the only non-trivial logic (cursor stack + keyset slice) as pure functions, so they are unit-testable without rendering. `App` wires them to React state. `api/transactions.ts` is the single swap point for the real backend. Components are presentational.

---

## Conventions

- Package manager: `npm`. All commands run from `apps/web/` unless noted.
- Cursor is a **number** in app state and query params; the wire `id` is a numeric string (parsed to number by the fetch layer).
- Decision colors: `approve` green, `review` amber, `decline` red.
- TDD where logic is non-trivial (pure functions). Components are wired by hand and verified by running the app.

---

## Task 0: Scaffold the Vite app

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/tsconfig.node.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/App.css`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@fraud/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "useDefineForClassFields": true,
    "lib": ["ES2021", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `apps/web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: Create `apps/web/vite.config.ts`**

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test/setup.ts',
  },
});
```

- [ ] **Step 5: Create `apps/web/test/setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 6: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fraud Admin — Transactions</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `apps/web/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 8: Create a placeholder `apps/web/src/App.tsx`** (replaced in Task 4)

```tsx
export default function App() {
  return <h1>Fraud Admin</h1>;
}
```

- [ ] **Step 9: Create `apps/web/src/App.css`**

```css
:root {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #1a1a1a;
  background: #f7f7f8;
}
body { margin: 0; }
.app { max-width: 1100px; margin: 0 auto; padding: 24px; }
h1 { font-size: 20px; margin: 0 0 16px; }
table { width: 100%; border-collapse: collapse; background: #fff; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; white-space: nowrap; }
th { font-weight: 600; color: #555; background: #fafafa; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.chip { padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }
.chip-approve { background: #e6f4ea; color: #137333; }
.chip-review  { background: #fef7e0; color: #b06000; }
.chip-decline { background: #fce8e6; color: #c5221f; }
.pager { display: flex; gap: 8px; align-items: center; margin: 16px 0; }
.pager button { padding: 6px 14px; border: 1px solid #ccc; background: #fff; border-radius: 6px; cursor: pointer; }
.pager button:disabled { opacity: 0.4; cursor: not-allowed; }
.status { color: #888; font-size: 13px; }
.error { color: #c5221f; margin: 16px 0; }
.empty { color: #888; padding: 24px; text-align: center; }
```

- [ ] **Step 10: Install and verify the dev build boots**

Run: `cd apps/web && npm install && npm run build`
Expected: build succeeds, `dist/` produced, no type errors.

- [ ] **Step 11: Commit**

```bash
git add apps/web
git commit -m "chore: scaffold vite react admin frontend"
```

---

## Task 1: Wire-contract types

**Files:**
- Create: `apps/web/src/types.ts`

- [ ] **Step 1: Create `apps/web/src/types.ts`**

```ts
// Local copy of the @fraud/shared wire contract. When packages/shared exists,
// replace these with: export * from '@fraud/shared';
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
  createdAt: string; // ISO-8601
  decision: Decision;
  score: number;
  triggeredRules: string[];
  evaluatedAt: string; // ISO-8601
}

export interface TransactionListPage {
  items: TransactionListItem[];
  nextCursor: number | null;
}

export interface ListParams {
  limit: number;
  cursor?: number;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types.ts
git commit -m "feat: add wire-contract types"
```

---

## Task 2: Mock data + keyset slice (TDD)

**Files:**
- Create: `apps/web/src/api/mock-data.ts`, `apps/web/test/mock-data.test.ts`

- [ ] **Step 1: Write the failing test (`apps/web/test/mock-data.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { MOCK_ROWS, slicePage } from '../src/api/mock-data';

describe('mock-data', () => {
  it('generates a non-trivial dataset with monotonic ids', () => {
    expect(MOCK_ROWS.length).toBeGreaterThanOrEqual(100);
    const ids = MOCK_ROWS.map((r) => Number(r.id));
    const sorted = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sorted); // stored ascending
    expect(new Set(ids).size).toBe(ids.length); // unique
  });

  it('returns newest-first (id descending) on the first page', () => {
    const page = slicePage(MOCK_ROWS, 10, undefined);
    expect(page.items.length).toBe(10);
    const ids = page.items.map((r) => Number(r.id));
    expect(ids[0]).toBeGreaterThan(ids[1]);
    expect(Number(page.items[0].id)).toBe(Math.max(...MOCK_ROWS.map((r) => Number(r.id))));
  });

  it('sets nextCursor to the last returned id when more rows remain', () => {
    const page = slicePage(MOCK_ROWS, 10, undefined);
    expect(page.nextCursor).toBe(Number(page.items[9].id));
  });

  it('applies id < cursor and returns the following page', () => {
    const first = slicePage(MOCK_ROWS, 10, undefined);
    const second = slicePage(MOCK_ROWS, 10, first.nextCursor!);
    expect(Number(second.items[0].id)).toBeLessThan(first.nextCursor!);
    // no overlap
    const firstIds = new Set(first.items.map((r) => r.id));
    expect(second.items.every((r) => !firstIds.has(r.id))).toBe(true);
  });

  it('returns nextCursor null on the last page', () => {
    const total = MOCK_ROWS.length;
    const page = slicePage(MOCK_ROWS, total, undefined); // everything in one page
    expect(page.items.length).toBe(total);
    expect(page.nextCursor).toBeNull();
  });

  it('paging all the way through visits every row exactly once', () => {
    const seen: string[] = [];
    let cursor: number | undefined = undefined;
    // guard against infinite loop
    for (let guard = 0; guard < 1000; guard++) {
      const page = slicePage(MOCK_ROWS, 25, cursor);
      seen.push(...page.items.map((r) => r.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen.length).toBe(MOCK_ROWS.length);
    expect(new Set(seen).size).toBe(MOCK_ROWS.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/mock-data.test.ts`
Expected: FAIL ("Cannot find module '../src/api/mock-data'").

- [ ] **Step 3: Implement `apps/web/src/api/mock-data.ts`**

```ts
import { Decision, TransactionListItem, TransactionListPage } from '../types';

const DECISIONS: Decision[] = ['approve', 'approve', 'approve', 'review', 'decline'];
const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'BR', 'JP', 'NG', 'IN'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY'];
const RULES_BY_DECISION: Record<Decision, string[]> = {
  approve: [],
  review: ['new_geo'],
  decline: ['velocity_card_1m'],
};
const SCORE_BY_DECISION: Record<Decision, number> = { approve: 100, review: 50, decline: 0 };

// Deterministic pseudo-random so the dataset is stable across reloads.
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function pad(n: number): string {
  return String(n).padStart(12, '0');
}

function buildRows(count: number): TransactionListItem[] {
  const rand = rng(42);
  const rows: TransactionListItem[] = [];
  const base = Date.UTC(2026, 5, 1, 0, 0, 0); // 2026-06-01T00:00:00Z
  for (let i = 1; i <= count; i++) {
    const decision = DECISIONS[Math.floor(rand() * DECISIONS.length)];
    const createdAt = new Date(base + i * 37_000).toISOString();
    rows.push({
      id: String(i), // monotonic ascending
      transactionId: `${pad(i)}-1111-1111-1111-111111111111`,
      cardToken: `card_${pad(Math.floor(rand() * 50))}`,
      customerId: `cust_${pad(Math.floor(rand() * 80))}`,
      amount: Math.round(rand() * 200000) / 100,
      currency: CURRENCIES[Math.floor(rand() * CURRENCIES.length)],
      ip: `${Math.floor(rand() * 255)}.0.0.${Math.floor(rand() * 255)}`,
      country: COUNTRIES[Math.floor(rand() * COUNTRIES.length)],
      deviceFingerprint: `fp_${pad(Math.floor(rand() * 60))}`,
      createdAt,
      decision,
      score: SCORE_BY_DECISION[decision],
      triggeredRules: RULES_BY_DECISION[decision],
      evaluatedAt: createdAt,
    });
  }
  return rows;
}

export const MOCK_ROWS: TransactionListItem[] = buildRows(200);

// Pure keyset slice that mirrors the backend SQL:
//   WHERE id < cursor ORDER BY id DESC LIMIT limit (+1 to detect next).
export function slicePage(
  rows: TransactionListItem[],
  limit: number,
  cursor: number | undefined,
): TransactionListPage {
  const desc = [...rows].sort((a, b) => Number(b.id) - Number(a.id));
  const filtered = cursor === undefined ? desc : desc.filter((r) => Number(r.id) < cursor);
  const page = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const nextCursor = hasMore && page.length > 0 ? Number(page[page.length - 1].id) : null;
  return { items: page, nextCursor };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run test/mock-data.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/mock-data.ts apps/web/test/mock-data.test.ts
git commit -m "feat: add mock dataset with keyset slice"
```

---

## Task 3: fetchTransactions data layer

**Files:**
- Create: `apps/web/src/api/transactions.ts`

- [ ] **Step 1: Implement `apps/web/src/api/transactions.ts`**

```ts
import { ListParams, TransactionListPage } from '../types';
import { MOCK_ROWS, slicePage } from './mock-data';

// Mock implementation. To use the real backend, replace the body with:
//   const qs = new URLSearchParams({ limit: String(limit) });
//   if (cursor !== undefined) qs.set('cursor', String(cursor));
//   const res = await fetch(`/transactions?${qs}`);
//   if (!res.ok) throw new Error(`Request failed: ${res.status}`);
//   return (await res.json()) as TransactionListPage;
export async function fetchTransactions({ limit, cursor }: ListParams): Promise<TransactionListPage> {
  await new Promise((r) => setTimeout(r, 150)); // visible loading state
  return slicePage(MOCK_ROWS, limit, cursor);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/api/transactions.ts
git commit -m "feat: add fetchTransactions data layer (mock)"
```

---

## Task 4: Cursor-stack pagination logic (TDD)

**Files:**
- Create: `apps/web/src/pagination.ts`, `apps/web/test/pagination.test.ts`

- [ ] **Step 1: Write the failing test (`apps/web/test/pagination.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import {
  initialPager,
  pushNext,
  popPrev,
  reset,
  canPrev,
  canNext,
  currentCursor,
  PagerState,
} from '../src/pagination';

describe('pagination cursor stack', () => {
  it('starts on the first page with an empty stack', () => {
    const s = initialPager();
    expect(s.stack).toEqual([]);
    expect(currentCursor(s)).toBeUndefined();
    expect(canPrev(s)).toBe(false);
  });

  it('canNext reflects whether nextCursor is present', () => {
    const s = initialPager();
    expect(canNext({ ...s, nextCursor: 42 })).toBe(true);
    expect(canNext({ ...s, nextCursor: null })).toBe(false);
  });

  it('pushNext records the current cursor and moves to nextCursor', () => {
    // on first page (cursor undefined), nextCursor = 191
    const s0: PagerState = { stack: [], nextCursor: 191 };
    const s1 = pushNext(s0);
    expect(s1.stack).toEqual([undefined]);
    expect(currentCursor(s1)).toBe(191);
    expect(canPrev(s1)).toBe(true);
  });

  it('popPrev returns to the previous cursor', () => {
    const s0: PagerState = { stack: [], nextCursor: 191 };
    const s1 = pushNext(s0); // stack [undefined], cursor 191
    const s2 = pushNext({ ...s1, nextCursor: 181 }); // stack [undefined, 191], cursor 181
    expect(currentCursor(s2)).toBe(181);
    const back = popPrev(s2); // back to cursor 191
    expect(currentCursor(back)).toBe(191);
    expect(back.stack).toEqual([undefined]);
  });

  it('popPrev to the first page yields an undefined cursor and disables prev', () => {
    const s0: PagerState = { stack: [], nextCursor: 191 };
    const s1 = pushNext(s0); // stack [undefined], cursor 191
    const back = popPrev(s1);
    expect(currentCursor(back)).toBeUndefined();
    expect(canPrev(back)).toBe(false);
  });

  it('reset clears the stack back to the first page', () => {
    const s0: PagerState = { stack: [], nextCursor: 191 };
    const s2 = pushNext(pushNext(s0));
    const r = reset(s2);
    expect(r.stack).toEqual([]);
    expect(currentCursor(r)).toBeUndefined();
    expect(canPrev(r)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/pagination.test.ts`
Expected: FAIL ("Cannot find module '../src/pagination'").

- [ ] **Step 3: Implement `apps/web/src/pagination.ts`**

```ts
// Pure cursor-stack model. Keyset pagination is forward-only (the backend only
// returns nextCursor), so we keep the cursors of pages already visited to walk
// backward. `stack` holds the cursor used to reach each *prior* page; the cursor
// of the current page is the last pushed value, or undefined for the first page.
export interface PagerState {
  stack: (number | undefined)[]; // cursors of pages before the current one
  cursor?: number;               // cursor used to fetch the current page (undefined = first page)
  nextCursor: number | null;     // cursor to fetch the next page (null = last page)
}

export function initialPager(): PagerState {
  return { stack: [], cursor: undefined, nextCursor: null };
}

export function currentCursor(s: PagerState): number | undefined {
  return s.cursor;
}

export function canPrev(s: PagerState): boolean {
  return s.stack.length > 0;
}

export function canNext(s: PagerState): boolean {
  return s.nextCursor !== null;
}

// Move forward: remember the current cursor, advance to nextCursor.
export function pushNext(s: PagerState): PagerState {
  if (s.nextCursor === null) return s;
  return { stack: [...s.stack, s.cursor], cursor: s.nextCursor, nextCursor: null };
}

// Move backward: pop the previous cursor and make it current.
export function popPrev(s: PagerState): PagerState {
  if (s.stack.length === 0) return s;
  const stack = [...s.stack];
  const prev = stack.pop();
  return { stack, cursor: prev, nextCursor: null };
}

// Jump to the first page.
export function reset(s: PagerState): PagerState {
  return { stack: [], cursor: undefined, nextCursor: null };
}
```

Note: `nextCursor` is reset to `null` on navigation; `App` fills it in from the
fetch result after each page load. The tests that set `nextCursor` explicitly
exercise the transition functions in isolation.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run test/pagination.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pagination.ts apps/web/test/pagination.test.ts
git commit -m "feat: add cursor-stack pagination logic"
```

---

## Task 5: TransactionsTable component

**Files:**
- Create: `apps/web/src/components/TransactionsTable.tsx`

- [ ] **Step 1: Implement `apps/web/src/components/TransactionsTable.tsx`**

```tsx
import { Decision, TransactionListItem } from '../types';

function DecisionChip({ decision }: { decision: Decision }) {
  return <span className={`chip chip-${decision}`}>{decision}</span>;
}

function fmtAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function fmtDate(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 12)}…` : s;
}

export default function TransactionsTable({
  items,
  loading,
}: {
  items: TransactionListItem[];
  loading: boolean;
}) {
  if (!loading && items.length === 0) {
    return <div className="empty">No transactions.</div>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Transaction</th>
          <th>Customer</th>
          <th>Amount</th>
          <th>Country</th>
          <th>Decision</th>
          <th>Score</th>
          <th>Rules</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {items.map((t) => (
          <tr key={t.id}>
            <td className="mono">{t.id}</td>
            <td className="mono">{short(t.transactionId)}</td>
            <td>{t.customerId}</td>
            <td>{fmtAmount(t.amount, t.currency)}</td>
            <td>{t.country}</td>
            <td><DecisionChip decision={t.decision} /></td>
            <td>{t.score}</td>
            <td>{t.triggeredRules.join(', ') || '—'}</td>
            <td className="mono">{fmtDate(t.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/TransactionsTable.tsx
git commit -m "feat: add transactions table component"
```

---

## Task 6: Pager component

**Files:**
- Create: `apps/web/src/components/Pager.tsx`

- [ ] **Step 1: Implement `apps/web/src/components/Pager.tsx`**

```tsx
export default function Pager({
  canPrev,
  canNext,
  loading,
  pageLabel,
  onFirst,
  onPrev,
  onNext,
}: {
  canPrev: boolean;
  canNext: boolean;
  loading: boolean;
  pageLabel: string;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="pager">
      <button onClick={onFirst} disabled={loading || !canPrev}>« First</button>
      <button onClick={onPrev} disabled={loading || !canPrev}>‹ Prev</button>
      <button onClick={onNext} disabled={loading || !canNext}>Next ›</button>
      <span className="status">{loading ? 'Loading…' : pageLabel}</span>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Pager.tsx
git commit -m "feat: add pager component"
```

---

## Task 7: App — wire state, fetch, components

**Files:**
- Modify: `apps/web/src/App.tsx` (replace the Task 0 placeholder)

- [ ] **Step 1: Replace `apps/web/src/App.tsx` with the full implementation**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchTransactions } from './api/transactions';
import { TransactionListItem } from './types';
import {
  PagerState,
  initialPager,
  pushNext,
  popPrev,
  reset,
  canPrev,
  canNext,
  currentCursor,
} from './pagination';
import TransactionsTable from './components/TransactionsTable';
import Pager from './components/Pager';

const PAGE_SIZE = 25;

export default function App() {
  const [pager, setPager] = useState<PagerState>(initialPager);
  const [items, setItems] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState(1);
  // Track the cursor we are currently loading so the fetched nextCursor lands on
  // the right state even across rapid clicks.
  const reqId = useRef(0);

  const load = useCallback(async (next: PagerState, page: number) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTransactions({ limit: PAGE_SIZE, cursor: currentCursor(next) });
      if (id !== reqId.current) return; // a newer request superseded this one
      setItems(res.items);
      setPager({ ...next, nextCursor: res.nextCursor });
      setPageNum(page);
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load transactions');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void load(initialPager(), 1);
  }, [load]);

  const onFirst = () => void load(reset(pager), 1);
  const onPrev = () => void load(popPrev(pager), Math.max(1, pageNum - 1));
  const onNext = () => void load(pushNext(pager), pageNum + 1);
  const onRetry = () => void load(pager, pageNum);

  return (
    <div className="app">
      <h1>Fraud Admin — Transactions</h1>
      <Pager
        canPrev={canPrev(pager)}
        canNext={canNext(pager)}
        loading={loading}
        pageLabel={`Page ${pageNum}`}
        onFirst={onFirst}
        onPrev={onPrev}
        onNext={onNext}
      />
      {error ? (
        <div className="error">
          {error} <button onClick={onRetry}>Retry</button>
        </div>
      ) : (
        <TransactionsTable items={items} loading={loading} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the whole project type-checks and builds**

Run: `cd apps/web && npx tsc --noEmit && npm run build`
Expected: no type errors; build succeeds.

- [ ] **Step 3: Run the full test suite**

Run: `cd apps/web && npm test`
Expected: PASS (mock-data 6, pagination 6).

- [ ] **Step 4: Manually verify in the browser**

Run: `cd apps/web && npm run dev`
Open the printed URL. Confirm:
- Table shows 25 newest rows (highest ids first).
- "Next ›" loads the following 25; "‹ Prev" returns; "« First" jumps to page 1.
- Prev/First disabled on page 1; Next disabled on the last page (8 pages for 200 rows @ 25).
- Decision chips are color-coded; page label updates.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: wire app state, fetch, and pagination UI"
```

---

## Task 8: README + final verification

**Files:**
- Create: `apps/web/README.md`

- [ ] **Step 1: Create `apps/web/README.md`**

```markdown
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
```

- [ ] **Step 2: Run the full verification sweep**

Run: `cd apps/web && npm install && npx tsc --noEmit && npm test && npm run build`
Expected: install clean, no type errors, all tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/README.md
git commit -m "docs: add apps/web readme"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** §2 scope boundary → Task 0 (self-contained, no shared/backend
  touch). §3 file structure → Tasks 0–7. §4 types → Task 1. §5 data layer → Tasks
  2–3. §6 cursor stack → Task 4 + Task 7. §7 table → Task 5. §8 error handling →
  Task 7 (error state + Retry). §9 testing → Tasks 2 & 4 (pure-function unit tests).
- **Swap point:** the only place that knows about mock vs. real is
  `src/api/transactions.ts` (documented in code + README).
- **Type consistency:** `PagerState`, `currentCursor`, `pushNext`, `popPrev`,
  `reset`, `canPrev`, `canNext` are defined in Task 4 and used unchanged in Task 7.
  `fetchTransactions`, `slicePage`, `TransactionListItem`, `TransactionListPage`,
  `ListParams` are consistent across Tasks 1–3 and 7.
```
