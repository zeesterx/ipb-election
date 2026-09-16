import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  config: { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' }
}));

import { ElectionsService } from './elections.service';

describe('candidate updates during an election', () => {
  const query = vi.fn();
  const transaction = vi.fn(async (operation: (client: { query: typeof query }) => Promise<unknown>) => operation({ query }));
  const service = new ElectionsService({ query, transaction } as never, { sign: vi.fn() } as never);
  const detail = vi.spyOn(service, 'detail').mockResolvedValue({ id: 'election-1' } as never);

  beforeEach(() => {
    query.mockReset();
    transaction.mockClear();
    detail.mockClear();
  });

  it('permite retirar um indicado a diácono enquanto somente a votação de presbíteros começou', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'election-1', status: 'open', elder_seats: 1, deacon_seats: 1 }] })
      .mockResolvedValueOnce({ rows: [{ office: 'elder', count: 1 }] })
      .mockResolvedValueOnce({ rows: [
        { office: 'deacon', name: 'João da Silva' },
        { office: 'deacon', name: 'Maria Souza' },
        { office: 'elder', name: 'João da Silva' }
      ] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(service.updateCandidates('election-1', {
      elderCandidates: [{ name: 'João da Silva' }],
      deaconCandidates: [{ name: 'Maria Souza' }]
    }, 'admin-1')).resolves.toEqual({ id: 'election-1' });

    expect(query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim())).toEqual([
      'select * from elections where id = $1 for update',
      'select office, count(*)::int as count from scrutinies where election_id = $1 group by office',
      'select office, name from candidates where election_id = $1 order by office, display_order',
      'delete from candidates where election_id = $1 and office = $2',
      'insert into candidates (election_id, office, name, display_order) values ($1, $2, $3, $4)',
      'insert into audit_events (election_id, actor_id, action, details) values ($1, $2, $3, $4)'
    ]);
    expect(query.mock.calls[3][1]).toEqual(['election-1', 'deacon']);
    expect(query.mock.calls[4][1]).toEqual(['election-1', 'deacon', 'Maria Souza', 1]);
  });

  it('protege a lista do cargo cuja votação já começou', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'election-1', status: 'open', elder_seats: 1, deacon_seats: 1 }] })
      .mockResolvedValueOnce({ rows: [{ office: 'elder', count: 1 }] })
      .mockResolvedValueOnce({ rows: [
        { office: 'deacon', name: 'Maria Souza' },
        { office: 'elder', name: 'João da Silva' }
      ] });

    await expect(service.updateCandidates('election-1', {
      elderCandidates: [{ name: 'Outro presbítero' }],
      deaconCandidates: [{ name: 'Maria Souza' }]
    }, 'admin-1')).rejects.toEqual(
      new ConflictException('A lista de indicados a presbítero não pode mudar depois do início da votação desse cargo.')
    );
    expect(query).toHaveBeenCalledTimes(3);
  });
});
