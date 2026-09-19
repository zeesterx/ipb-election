import { describe, expect, it } from 'vitest';
import { blankVotes, finalistLimit, majorityRequired, resolveWinnersAtCutoff } from './election-rules';

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

  it('keeps candidates tied at the vacancy cutoff for the next scrutiny', () => {
    const candidates = [
      ...Array.from({ length: 4 }, (_, index) => ({ id: `five-${index}`, votes: 5 })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `four-${index}`, votes: 4 })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: `three-${index}`, votes: 3 }))
    ];

    expect(resolveWinnersAtCutoff(candidates, 9)).toEqual({
      winnerIds: candidates.slice(0, 8).map((candidate) => candidate.id),
      tiedCandidateIds: candidates.slice(8).map((candidate) => candidate.id),
      tiedSeatCount: 1
    });
  });

  it('fills the vacancies normally when there is no tie at the cutoff', () => {
    expect(resolveWinnersAtCutoff([
      { id: 'a', votes: 5 }, { id: 'b', votes: 4 }, { id: 'c', votes: 3 }
    ], 2)).toEqual({ winnerIds: ['a', 'b'], tiedCandidateIds: [], tiedSeatCount: 0 });
  });
});
