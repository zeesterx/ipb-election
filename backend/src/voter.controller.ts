import { Body, Controller, Get, Headers, Inject, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ElectionsService } from './elections.service';

@Controller('voter')
export class VoterController {
  constructor(@Inject(ElectionsService) private readonly elections: ElectionsService) {}

  @Get('elections/:id/results')
  results(@Param('id') id: string) {
    return this.elections.publicResults(id);
  }

  @Post('access')
  access(@Body() body: Record<string, unknown>) {
    return this.elections.voterAccess(body.code);
  }

  @Post('votes')
  submit(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown>
  ) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Digite sua senha novamente.');
    }
    return this.elections.submitVote(authorization.slice(7), body.candidateIds);
  }
}
