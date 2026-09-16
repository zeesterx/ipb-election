import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, PoolConfig, QueryResultRow } from 'pg';
import { config } from './config';

export function databasePoolConfig(databaseUrl: string, nodeEnv: string): PoolConfig {
  const parsed = new URL(databaseUrl);
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);

  if (!local) {
    // `pg` lets sslmode from the URL override the explicit SSL object. Supabase's
    // pooler may present a certificate chain that is valid for encrypted traffic
    // but unavailable to the managed host's CA store, so SSL is configured here.
    parsed.searchParams.delete('sslmode');
  }

  return {
    connectionString: parsed.toString(),
    max: nodeEnv === 'production' ? 10 : 5,
    ssl: local ? undefined : { rejectUnauthorized: false }
  };
}

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool(databasePoolConfig(config.DATABASE_URL, config.NODE_ENV));

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: any[] = []) {
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
