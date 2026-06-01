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
