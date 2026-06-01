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
