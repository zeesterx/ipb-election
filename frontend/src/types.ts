export type Office = 'elder' | 'deacon';

export interface Candidate {
  id: string;
  office: Office;
  name: string;
  displayOrder: number;
  elected: boolean;
  electedRound: number | null;
  declined: boolean;
  declinedRound: number | null;
}

export interface Scrutiny {
  id: string;
  office: Office;
  roundNumber: number;
  seatsOpen: number;
  maxMarks: number;
  majorityRequired: number;
  status: 'open' | 'closed' | 'published';
  ballotCount: number;
  digitalCount: number;
  paperCount: number;
  blankCount: number;
  openedAt: string;
  closedAt: string | null;
  publishedAt: string | null;
  results: Array<{ scrutinyId: string; candidateId: string; name: string; votes: number; elected: boolean; accepted: boolean | null }>;
}

export interface Election {
  id: string;
  churchName: string;
  electionDate: string;
  elderSeats: number;
  deaconSeats: number;
  presentMembers: number | null;
  status: 'draft' | 'open' | 'finished';
  currentOffice: Office | null;
  candidates: Candidate[];
  batches: Array<{ id: string; sequenceNumber: number; quantity: number; activeCount: number; createdAt: string }>;
  scrutinies: Scrutiny[];
}

export type PublicElection = Omit<Election, 'batches'>;

export interface NextScrutiny {
  available: boolean;
  reason?: string;
  office?: Office;
  roundNumber?: number;
  seatsOpen?: number;
  maxMarks?: number;
  majorityRequired?: number;
  finalistLimit?: number;
  tiedAtCutoff?: boolean;
  candidates?: Array<{ id: string; name: string; displayOrder: number; previousVotes: number }>;
  defaultCandidateIds?: string[];
}

export interface Tally {
  scrutiny: Scrutiny & { electionId: string };
  candidates: Array<{ id: string; name: string; votes: number; digitalVotes: number; paperVotes: number; qualified: boolean }>;
  totals: { ballotCount: number; digitalCount: number; paperCount: number; blankCount: number };
  paperBallots: Array<{ id: string; blankCount: number; candidateIds: string[] }>;
  suggestedWinnerIds: string[];
  requiresAdminSelection: boolean;
}
