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
