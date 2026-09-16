import { describe, expect, it } from 'vitest';
import { blankVotes, finalistLimit, majorityRequired } from './election-rules';

describe('election rules', () => {
  it.each([
    [100, 51],
    [187, 94],
    [1, 1],
    [2, 2]
  ])('calculates strict majority for %i present members', (present, expected) => {
    expect(majorityRequired(present)).toBe(expected);
  });

  it('turns every unused mark into a blank vote', () => {
    expect(blankVotes(2, 2)).toBe(0);
    expect(blankVotes(2, 1)).toBe(1);
    expect(blankVotes(2, 0)).toBe(2);
  });

  it('limits the third scrutiny to two candidates per open seat', () => {
    expect(finalistLimit(1, 8)).toBe(2);
    expect(finalistLimit(2, 8)).toBe(4);
    expect(finalistLimit(2, 3)).toBe(3);
  });
});
