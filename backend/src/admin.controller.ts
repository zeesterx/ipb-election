import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Res,
  UseGuards
} from '@nestjs/common';
import { Response } from 'express';
import { AdminActor, AdminAuthGuard } from './admin-auth.guard';
import { ElectionsService } from './elections.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(@Inject(ElectionsService) private readonly elections: ElectionsService) {}

  @Get('session')
  session(@AdminActor() actorId: string) {
    return { authenticated: true, actorId };
  }

  @Get('elections')
  list() {
    return this.elections.list();
  }

  @Post('elections')
  create(@Body() body: Record<string, unknown>, @AdminActor() actorId: string) {
    return this.elections.create(body, actorId);
  }

  @Put('elections/:id/candidates')
  updateCandidates(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @AdminActor() actorId: string
  ) {
    return this.elections.updateCandidates(id, body, actorId);
  }

  @Get('elections/:id')
  detail(@Param('id') id: string) {
    return this.elections.detail(id);
  }

  @Get('elections/:id/minutes-report.pdf')
  async minutesReport(@Param('id') id: string, @Res() response: Response) {
    const pdf = await this.elections.minutesReport(id);
    response
      .status(200)
      .set({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="resultado-eleicao-oficiais.pdf"',
        'access-control-expose-headers': 'content-disposition'
      })
      .send(pdf);
  }

  @Post('elections/:id/codes')
  async codes(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @AdminActor() actorId: string,
    @Res() response: Response
  ) {
    const result = await this.elections.generateBatch(id, body.quantity, actorId);
    response
      .status(201)
      .set({
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="senhas-lote-${result.sequenceNumber}.pdf"`,
        'x-batch-number': String(result.sequenceNumber),
        'access-control-expose-headers': 'content-disposition,x-batch-number'
      })
      .send(result.pdf);
  }

  @Get('elections/:id/codes/batches/:batchId/pdf')
  async batchPdf(
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Res() response: Response
  ) {
    const result = await this.elections.downloadBatch(id, batchId);
    response
      .status(200)
      .set({
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="senhas-lote-${result.sequenceNumber}.pdf"`,
        'access-control-expose-headers': 'content-disposition'
      })
      .send(result.pdf);
  }

  @Delete('elections/:id/codes/batches/:batchId')
  deleteBatch(
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @AdminActor() actorId: string
  ) {
    return this.elections.deleteBatch(id, batchId, actorId);
  }

  @Post('elections/:id/open')
  open(@Param('id') id: string, @AdminActor() actorId: string) {
    return this.elections.open(id, actorId);
  }

  @Post('elections/:id/presence')
  presence(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @AdminActor() actorId: string
  ) {
    return this.elections.setPresence(id, body.presentMembers, actorId);
  }

  @Get('elections/:id/next-scrutiny')
  next(@Param('id') id: string) {
    return this.elections.nextScrutiny(id);
  }

  @Post('elections/:id/scrutinies')
  start(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @AdminActor() actorId: string
  ) {
    return this.elections.startScrutiny(id, body.candidateIds, actorId);
  }

  @Post('elections/:id/codes/invalidate')
  invalidate(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @AdminActor() actorId: string
  ) {
    return this.elections.invalidateCode(id, body.code, actorId);
  }

  @Post('scrutinies/:id/close')
  close(@Param('id') id: string, @AdminActor() actorId: string) {
    return this.elections.closeScrutiny(id, actorId);
  }

  @Get('scrutinies/:id/tally')
  tally(@Param('id') id: string) {
    return this.elections.tally(id);
  }

  @Post('scrutinies/:id/paper-ballots')
  paper(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @AdminActor() actorId: string
  ) {
    return this.elections.addPaperBallot(id, body.candidateIds, actorId);
  }

  @Put('scrutinies/:id/paper-totals')
  paperTotals(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @AdminActor() actorId: string
  ) {
    return this.elections.setPaperTotals(id, body, actorId);
  }

  @Delete('scrutinies/:id/paper-ballots/:ballotId')
  deletePaper(
    @Param('id') id: string,
    @Param('ballotId') ballotId: string,
    @AdminActor() actorId: string
  ) {
    return this.elections.deletePaperBallot(id, ballotId, actorId);
  }

  @Post('scrutinies/:id/publish')
  publish(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @AdminActor() actorId: string
  ) {
    return this.elections.publish(id, body.winnerIds, actorId);
  }

  @Get('elections/:id/audit')
  audit(@Param('id') id: string) {
    return this.elections.auditHistory(id);
  }

  @Get('test/elections/:id/codes')
  testCodes(@Param('id') id: string) {
    return this.elections.testCodes(id);
  }

  @Post('test/reset')
  reset() {
    return this.elections.resetForTests();
  }
}
