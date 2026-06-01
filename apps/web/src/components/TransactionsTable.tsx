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
