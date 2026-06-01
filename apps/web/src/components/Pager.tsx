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
