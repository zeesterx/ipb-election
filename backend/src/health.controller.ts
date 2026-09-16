import { Controller, Get, Inject } from '@nestjs/common';
import { Database } from './database';

@Controller('health')
export class HealthController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  async health() {
    await this.database.query('select 1');
    return { status: 'ok' };
  }
}
