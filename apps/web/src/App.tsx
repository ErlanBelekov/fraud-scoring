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
