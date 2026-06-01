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
export function reset(_s: PagerState): PagerState {
  return { stack: [], cursor: undefined, nextCursor: null };
}
