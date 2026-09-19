export function majorityRequired(presentMembers: number) {
  return Math.floor(presentMembers / 2) + 1;
}

export function blankVotes(maxMarks: number, selectedCount: number) {
  if (selectedCount < 0 || selectedCount > maxMarks) throw new Error('Invalid selection count');
  return maxMarks - selectedCount;
}

export function finalistLimit(seatsOpen: number, candidatesRemaining: number) {
  return Math.min(seatsOpen * 2, candidatesRemaining);
}

export function resolveWinnersAtCutoff<T extends { id: string; votes: number }>(
  qualifiedCandidates: T[],
  seatsOpen: number
) {
  if (seatsOpen <= 0 || qualifiedCandidates.length === 0) {
    return { winnerIds: [] as string[], tiedCandidateIds: [] as string[], tiedSeatCount: 0 };
  }

  if (qualifiedCandidates.length <= seatsOpen) {
    return {
      winnerIds: qualifiedCandidates.map((candidate) => candidate.id),
      tiedCandidateIds: [] as string[],
      tiedSeatCount: 0
    };
  }

  const cutoffVotes = qualifiedCandidates[seatsOpen - 1].votes;
  const candidatesAboveCutoff = qualifiedCandidates.filter((candidate) => candidate.votes > cutoffVotes);
  const candidatesAtCutoff = qualifiedCandidates.filter((candidate) => candidate.votes === cutoffVotes);
  const seatsAtCutoff = seatsOpen - candidatesAboveCutoff.length;

  if (candidatesAtCutoff.length > seatsAtCutoff) {
    return {
      winnerIds: candidatesAboveCutoff.map((candidate) => candidate.id),
      tiedCandidateIds: candidatesAtCutoff.map((candidate) => candidate.id),
      tiedSeatCount: seatsAtCutoff
    };
  }

  return {
    winnerIds: qualifiedCandidates.slice(0, seatsOpen).map((candidate) => candidate.id),
    tiedCandidateIds: [] as string[],
    tiedSeatCount: 0
  };
}
