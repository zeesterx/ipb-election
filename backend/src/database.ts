import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.NODE_ENV === 'production' ? 10 : 5,
    ssl: config.DATABASE_URL.includes('localhost') || config.DATABASE_URL.includes('127.0.0.1')
      ? undefined
      : { rejectUnauthorized: false }
  });

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
