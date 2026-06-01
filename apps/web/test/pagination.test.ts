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
