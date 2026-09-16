import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  config: { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' }
}));

import { ElectionsService } from './elections.service';

describe('voter access', () => {
  const query = vi.fn();
  const sign = vi.fn();
  const service = new ElectionsService(
    { query } as never,
    { sign } as never
  );

  beforeEach(() => {
    query.mockReset();
    sign.mockReset();
  });

  it('valida a senha antes de procurar uma votação aberta', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.voterAccess('ZZZZZZ')).rejects.toEqual(
      new BadRequestException('Senha inválida.')
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('from voting_codes');
  });

  it('informa indisponibilidade somente quando a senha existe', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'code-1', election_id: 'election-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(service.voterAccess('ABC123')).resolves.toEqual({ status: 'unavailable' });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('from scrutinies');
    expect(query.mock.calls[1][1]).toEqual(['election-1']);
  });
});
