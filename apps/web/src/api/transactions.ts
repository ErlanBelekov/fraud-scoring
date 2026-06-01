import { ListParams, TransactionListPage } from '../types';
import { MOCK_ROWS, slicePage } from './mock-data';

// Toggle the data source. Defaults to the REAL backend (via the Vite proxy in
// vite.config.ts). Set VITE_USE_MOCK=true to run standalone against mock data.
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

async function fetchFromMock({ limit, cursor }: ListParams): Promise<TransactionListPage> {
  await new Promise((r) => setTimeout(r, 150)); // visible loading state
  return slicePage(MOCK_ROWS, limit, cursor);
}

async function fetchFromBackend({ limit, cursor }: ListParams): Promise<TransactionListPage> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor !== undefined) qs.set('cursor', String(cursor));
  const res = await fetch(`/transactions?${qs}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as TransactionListPage;
}

export async function fetchTransactions(params: ListParams): Promise<TransactionListPage> {
  return USE_MOCK ? fetchFromMock(params) : fetchFromBackend(params);
}
