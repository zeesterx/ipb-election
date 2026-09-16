import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { Database } from './database';
import { ElectionsService } from './elections.service';
import { HealthController } from './health.controller';
import { VoterController } from './voter.controller';
import { VoterTokenService } from './voter-token';

@Module({
  controllers: [HealthController, AdminController, VoterController],
  providers: [Database, AdminAuthGuard, ElectionsService, VoterTokenService]
})
export class AppModule {}
