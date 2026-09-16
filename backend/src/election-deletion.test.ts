import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  config: { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' }
}));

import { ElectionsService } from './elections.service';

describe('election deletion', () => {
  const query = vi.fn();
  const transaction = vi.fn(async (operation: (client: { query: typeof query }) => Promise<unknown>) => operation({ query }));
  const service = new ElectionsService({ query, transaction } as never, { sign: vi.fn() } as never);

  beforeEach(() => {
    query.mockReset();
    transaction.mockClear();
  });

  it('exclui votos antes da eleição e preserva um evento de auditoria sem vínculo', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'election-1', church_name: 'IPB Teste' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(service.deleteElection('election-1', 'admin-1')).resolves.toEqual({ deleted: true });

    expect(query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim())).toEqual([
      'select id, church_name from elections where id = $1 for update',
      'insert into audit_events (election_id, actor_id, action, details) values ($1, $2, $3, $4)',
      'delete from ballots where scrutiny_id in (select id from scrutinies where election_id = $1)',
      'delete from scrutiny_results where scrutiny_id in (select id from scrutinies where election_id = $1)',
      'delete from elections where id = $1'
    ]);
    expect(query.mock.calls[1][1]).toEqual([
      null,
      'admin-1',
      'election.deleted',
      JSON.stringify({ electionId: 'election-1', churchName: 'IPB Teste' })
    ]);
  });

  it('não exclui quando a eleição não existe', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.deleteElection('missing', 'admin-1')).rejects.toEqual(
      new NotFoundException('Eleição não encontrada.')
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
