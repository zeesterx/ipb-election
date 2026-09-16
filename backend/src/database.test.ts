import { describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  config: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    NODE_ENV: 'test'
  }
}));

import { databasePoolConfig } from './database';

describe('database pool configuration', () => {
  it('mantém SSL ativo sem deixar sslmode sobrescrever a validação do pooler', () => {
    const result = databasePoolConfig(
      'postgresql://user:password@pooler.example.com:5432/postgres?sslmode=require',
      'production'
    );

    expect(result.connectionString).toBe('postgresql://user:password@pooler.example.com:5432/postgres');
    expect(result.ssl).toEqual({ rejectUnauthorized: false });
    expect(result.max).toBe(10);
  });

  it('não força SSL nas conexões locais', () => {
    const result = databasePoolConfig('postgresql://user:password@localhost:5432/postgres', 'test');
    expect(result.ssl).toBeUndefined();
    expect(result.max).toBe(5);
  });
});
