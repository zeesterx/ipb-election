import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { Database } from './database';
import { generateCode, normalizeCode } from './code-utils';
import { blankVotes, finalistLimit, majorityRequired } from './election-rules';
import { createPasswordPdf } from './password-pdf';
import { createMinutesPdf } from './minutes-pdf';
import { config } from './config';
import { VoterTokenService } from './voter-token';

export type Office = 'elder' | 'deacon';

interface ElectionRow extends QueryResultRow {
  id: string;
  church_name: string;
  election_date: string;
  elder_seats: number;
  deacon_seats: number;
  present_members: number | null;
  status: 'draft' | 'open' | 'finished';
  current_office: Office | null;
  created_at: string;
}

interface CandidateTally extends QueryResultRow {
  id: string;
  name: string;
  display_order: number;
  votes: number;
  digital_votes: number;
  paper_votes: number;
}

interface ScrutinyRow extends QueryResultRow {
  id: string;
  election_id: string;
  office: Office;
  round_number: number;
  seats_open: number;
  max_marks: number;
  majority_required: number;
  status: 'open' | 'closed' | 'published';
}

interface QueryConnection {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: any[]): Promise<QueryResult<T>>;
}

interface CandidateInput {
  name: string;
}

function isLocalTestDatabase() {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(config.DATABASE_URL).hostname);
  } catch {
    return false;
  }
}

function cleanCandidates(values: unknown): CandidateInput[] {
  if (!Array.isArray(values)) return [];
  const candidates = values.map((value) => {
    const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
    const name = String(record?.name ?? value ?? '').trim();
    return { name };
  }).filter((candidate) => candidate.name);
  return [...new Map(candidates.map((candidate) => [candidate.name.toLocaleLowerCase('pt-BR'), candidate])).values()];
}

function integer(value: unknown, field: string, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new BadRequestException(`${field} deve ser um número inteiro maior ou igual a ${minimum}.`);
  }
  return parsed;
}

@Injectable()
export class ElectionsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(VoterTokenService) private readonly voterTokens: VoterTokenService
  ) {}

  private async audit(
    client: PoolClient,
    electionId: string | null,
    actorId: string,
    action: string,
    details: Record<string, unknown> = {}
  ) {
    await client.query(
      'insert into audit_events (election_id, actor_id, action, details) values ($1, $2, $3, $4)',
      [electionId, actorId, action, JSON.stringify(details)]
    );
  }

  async list() {
    const result = await this.db.query<ElectionRow>(
      `select e.*,
        (select count(*)::int from voting_codes vc where vc.election_id = e.id and vc.active) as code_count,
        (select count(*)::int from candidates c where c.election_id = e.id and c.elected) as elected_count
       from elections e order by e.created_at desc`
    );
    return result.rows.map((row) => ({
      id: row.id,
      churchName: row.church_name,
      electionDate: row.election_date,
      elderSeats: row.elder_seats,
      deaconSeats: row.deacon_seats,
      presentMembers: row.present_members,
      status: row.status,
      currentOffice: row.current_office,
      codeCount: Number((row as ElectionRow & { code_count: number }).code_count),
      electedCount: Number((row as ElectionRow & { elected_count: number }).elected_count)
    }));
  }

  async create(body: Record<string, unknown>, actorId: string) {
    const churchName = String(body.churchName ?? '').trim();
    const electionDate = String(body.electionDate ?? '').trim();
    const elderSeats = integer(body.elderSeats, 'Vagas de presbíteros');
    const deaconSeats = integer(body.deaconSeats, 'Vagas de diáconos');
    const elders = cleanCandidates(body.elderCandidates);
    const deacons = cleanCandidates(body.deaconCandidates);

    if (!churchName) throw new BadRequestException('Informe o nome da igreja.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(electionDate)) throw new BadRequestException('Informe uma data válida.');
    if (elderSeats === 0 && deaconSeats === 0) throw new BadRequestException('Informe pelo menos uma vaga.');
    if (elderSeats > 0 && elders.length < elderSeats) {
      throw new BadRequestException('Cadastre ao menos tantos indicados a presbítero quanto vagas.');
    }
    if (deaconSeats > 0 && deacons.length < deaconSeats) {
      throw new BadRequestException('Cadastre ao menos tantos indicados a diácono quanto vagas.');
    }

    return this.db.transaction(async (client) => {
      const election = await client.query<ElectionRow>(
        `insert into elections (church_name, election_date, elder_seats, deacon_seats)
         values ($1, $2, $3, $4) returning *`,
        [churchName, electionDate, elderSeats, deaconSeats]
      );
      for (const [office, names] of [
        ['elder', elders],
        ['deacon', deacons]
      ] as const) {
        for (const [index, candidate] of names.entries()) {
          await client.query(
            `insert into candidates (election_id, office, name, display_order)
             values ($1, $2, $3, $4)`,
            [election.rows[0].id, office, candidate.name, index + 1]
          );
        }
      }
      await this.audit(client, election.rows[0].id, actorId, 'election.created', {
        elderSeats,
        deaconSeats,
        elderCandidates: elders.length,
        deaconCandidates: deacons.length
      });
      return this.detail(election.rows[0].id, client);
    });
  }

  async deleteElection(id: string, actorId: string) {
    return this.db.transaction(async (client) => {
      const result = await client.query<Pick<ElectionRow, 'id' | 'church_name'>>(
        'select id, church_name from elections where id = $1 for update',
        [id]
      );
      const election = result.rows[0];
      if (!election) throw new NotFoundException('Eleição não encontrada.');

      await this.audit(client, null, actorId, 'election.deleted', {
        electionId: election.id,
        churchName: election.church_name
      });
      await client.query(
        'delete from ballots where scrutiny_id in (select id from scrutinies where election_id = $1)',
        [id]
      );
      await client.query(
        'delete from scrutiny_results where scrutiny_id in (select id from scrutinies where election_id = $1)',
        [id]
      );
      await client.query('delete from elections where id = $1', [id]);
      return { deleted: true };
    });
  }

  async updateCandidates(id: string, body: Record<string, unknown>, actorId: string) {
    const elders = cleanCandidates(body.elderCandidates);
    const deacons = cleanCandidates(body.deaconCandidates);

    return this.db.transaction(async (client) => {
      const electionResult = await client.query<ElectionRow>('select * from elections where id = $1 for update', [id]);
      const election = electionResult.rows[0];
      if (!election) throw new NotFoundException('Eleição não encontrada.');
      if (election.status === 'finished') throw new ConflictException('A eleição já foi encerrada.');

      const scrutinyCount = await client.query<{ count: number }>(
        'select count(*)::int as count from scrutinies where election_id = $1',
        [id]
      );
      if (scrutinyCount.rows[0].count > 0) {
        throw new ConflictException('Os indicados não podem mudar depois do início do primeiro escrutínio.');
      }
      if (election.elder_seats > 0 && elders.length < election.elder_seats) {
        throw new BadRequestException('Cadastre ao menos tantos indicados a presbítero quanto vagas.');
      }
      if (election.deacon_seats > 0 && deacons.length < election.deacon_seats) {
        throw new BadRequestException('Cadastre ao menos tantos indicados a diácono quanto vagas.');
      }

      await client.query('delete from candidates where election_id = $1', [id]);
      for (const [office, candidates] of [
        ['elder', election.elder_seats > 0 ? elders : []],
        ['deacon', election.deacon_seats > 0 ? deacons : []]
      ] as const) {
        for (const [index, candidate] of candidates.entries()) {
          await client.query(
            `insert into candidates (election_id, office, name, display_order)
             values ($1, $2, $3, $4)`,
            [id, office, candidate.name, index + 1]
          );
        }
      }
      await this.audit(client, id, actorId, 'candidates.updated', {
        elderCandidates: elders.length,
        deaconCandidates: deacons.length
      });
      return this.detail(id, client);
    });
  }

  async detail(id: string, connection: QueryConnection = this.db) {
    const electionResult = await connection.query<ElectionRow>('select * from elections where id = $1', [id]);
    const election = electionResult.rows[0];
    if (!election) throw new NotFoundException('Eleição não encontrada.');

    const candidates = await connection.query(
        `select id, office, name, display_order as "displayOrder", elected,
                elected_round as "electedRound"
         from candidates where election_id = $1 order by office desc, display_order`,
        [id]
      );
    const batches = await connection.query(
        `select cb.id, cb.sequence_number as "sequenceNumber", cb.quantity, cb.created_at as "createdAt",
                count(vc.id) filter (where vc.active)::int as "activeCount"
         from credential_batches cb left join voting_codes vc on vc.batch_id = cb.id
         where cb.election_id = $1 group by cb.id order by cb.sequence_number`,
        [id]
      );
    const scrutinies = await connection.query(
        `select s.id, s.office, s.round_number as "roundNumber", s.seats_open as "seatsOpen",
                s.max_marks as "maxMarks", s.majority_required as "majorityRequired", s.status,
                s.opened_at as "openedAt", s.closed_at as "closedAt", s.published_at as "publishedAt",
                count(b.id)::int as "ballotCount",
                count(b.id) filter (where b.source = 'digital')::int as "digitalCount",
                count(b.id) filter (where b.source = 'paper')::int as "paperCount",
                coalesce(sum(b.blank_count), 0)::int as "blankCount"
         from scrutinies s left join ballots b on b.scrutiny_id = s.id
         where s.election_id = $1 group by s.id order by s.office desc, s.round_number`,
        [id]
      );
    const publishedResults = await connection.query<{
      scrutinyId: string;
      candidateId: string;
      name: string;
      votes: number;
      elected: boolean;
    }>(
      `select sr.scrutiny_id as "scrutinyId", sr.candidate_id as "candidateId", c.name,
              sr.votes::int as votes, sr.elected
       from scrutiny_results sr
       join candidates c on c.id = sr.candidate_id
       join scrutinies s on s.id = sr.scrutiny_id
       where s.election_id = $1
       order by s.office desc, s.round_number, sr.votes desc, c.display_order`,
      [id]
    );
    const resultsByScrutiny = new Map<string, typeof publishedResults.rows>();
    for (const result of publishedResults.rows) {
      const current = resultsByScrutiny.get(result.scrutinyId) ?? [];
      current.push(result);
      resultsByScrutiny.set(result.scrutinyId, current);
    }

    return {
      id: election.id,
      churchName: election.church_name,
      electionDate: election.election_date,
      elderSeats: election.elder_seats,
      deaconSeats: election.deacon_seats,
      presentMembers: election.present_members,
      status: election.status,
      currentOffice: election.current_office,
      candidates: candidates.rows,
      batches: batches.rows,
      scrutinies: scrutinies.rows.map((scrutiny) => ({
        ...scrutiny,
        results: resultsByScrutiny.get(String(scrutiny.id)) ?? []
      }))
    };
  }

  async publicResults(id: string) {
    const detail = await this.detail(id);
    const { batches: _batches, ...safeDetail } = detail;
    return safeDetail;
  }

  async generateBatch(id: string, rawQuantity: unknown, actorId: string) {
    const quantity = integer(rawQuantity, 'Quantidade de senhas', 1);
    if (quantity > 1000) throw new BadRequestException('Gere no máximo 1.000 senhas por lote.');

    const created = await this.db.transaction(async (client) => {
      const electionResult = await client.query<ElectionRow>('select * from elections where id = $1 for update', [id]);
      const election = electionResult.rows[0];
      if (!election) throw new NotFoundException('Eleição não encontrada.');
      if (election.status === 'finished') throw new ConflictException('A eleição já foi encerrada.');

      const sequenceResult = await client.query<{ next: number }>(
        'select coalesce(max(sequence_number), 0)::int + 1 as next from credential_batches where election_id = $1',
        [id]
      );
      const sequenceNumber = sequenceResult.rows[0].next;
      const batch = await client.query<{ id: string }>(
        `insert into credential_batches (election_id, sequence_number, quantity)
         values ($1, $2, $3) returning id`,
        [id, sequenceNumber, quantity]
      );

      const codes: string[] = [];
      while (codes.length < quantity) {
        const code = generateCode();
        if (codes.includes(code)) continue;
        const inserted = await client.query(
          `insert into voting_codes (election_id, batch_id, code) values ($1, $2, $3)
           on conflict (code) do nothing returning id`,
          [id, batch.rows[0].id, code]
        );
        if (inserted.rowCount === 1) codes.push(code);
      }
      await this.audit(client, id, actorId, 'credentials.generated', { sequenceNumber, quantity });
      return { election, sequenceNumber, codes };
    });

    const pdf = await createPasswordPdf({
      churchName: created.election.church_name,
      electionDate: created.election.election_date,
      batchNumber: created.sequenceNumber,
      voterUrl: config.PUBLIC_VOTER_URL,
      codes: created.codes
    });
    return { pdf, sequenceNumber: created.sequenceNumber };
  }

  async downloadBatch(electionId: string, batchId: string) {
    const batchResult = await this.db.query<ElectionRow & { sequence_number: number }>(
      `select e.*, cb.sequence_number
       from credential_batches cb join elections e on e.id = cb.election_id
       where cb.id = $1 and cb.election_id = $2`,
      [batchId, electionId]
    );
    const batch = batchResult.rows[0];
    if (!batch) throw new NotFoundException('Lote de senhas não encontrado.');
    const codes = await this.db.query<{ code: string }>(
      'select code from voting_codes where batch_id = $1 order by created_at, code',
      [batchId]
    );
    const pdf = await createPasswordPdf({
      churchName: batch.church_name,
      electionDate: batch.election_date,
      batchNumber: batch.sequence_number,
      voterUrl: config.PUBLIC_VOTER_URL,
      codes: codes.rows.map((row) => row.code)
    });
    return { pdf, sequenceNumber: batch.sequence_number };
  }

  async minutesReport(electionId: string) {
    const election = await this.detail(electionId);
    if (election.status !== 'finished') throw new ConflictException('Finalize a eleição antes de gerar o resultado para a ata.');
    const scrutinies = election.scrutinies as unknown as Array<{
      office: Office;
      roundNumber: number;
      status: 'open' | 'closed' | 'published';
      results: Array<{ candidateId: string; votes: number }>;
    }>;

    const winners = (office: Office) => election.candidates
      .filter((candidate) => candidate.office === office && candidate.elected && candidate.electedRound)
      .map((candidate) => {
        const scrutiny = scrutinies.find((item) => item.office === office && item.roundNumber === candidate.electedRound && item.status === 'published');
        const result = scrutiny?.results.find((item) => item.candidateId === candidate.id);
        if (!scrutiny || !result) throw new ConflictException(`Não foi possível localizar o resultado de ${candidate.name}.`);
        return { name: candidate.name, roundNumber: candidate.electedRound as number, votes: result.votes };
      })
      .sort((a, b) => a.roundNumber - b.roundNumber || a.name.localeCompare(b.name, 'pt-BR'));

    return createMinutesPdf({
      churchName: election.churchName,
      electionDate: election.electionDate,
      presentMembers: election.presentMembers,
      elders: winners('elder'),
      deacons: winners('deacon')
    });
  }

  async deleteBatch(electionId: string, batchId: string, actorId: string) {
    return this.db.transaction(async (client) => {
      const electionResult = await client.query<ElectionRow>('select * from elections where id = $1 for update', [electionId]);
      const election = electionResult.rows[0];
      if (!election) throw new NotFoundException('Eleição não encontrada.');
      if (election.status === 'finished') throw new ConflictException('A eleição já foi encerrada.');
      const scrutinyCount = await client.query<{ count: number }>(
        'select count(*)::int as count from scrutinies where election_id = $1',
        [electionId]
      );
      if (scrutinyCount.rows[0].count > 0) {
        throw new ConflictException('Lotes inteiros só podem ser excluídos antes do primeiro escrutínio.');
      }
      const batch = await client.query<{ id: string; sequenceNumber: number; quantity: number }>(
        `select id, sequence_number as "sequenceNumber", quantity
         from credential_batches where id = $1 and election_id = $2 for update`,
        [batchId, electionId]
      );
      if (!batch.rows[0]) throw new NotFoundException('Lote de senhas não encontrado.');
      await client.query('delete from credential_batches where id = $1', [batchId]);
      await this.audit(client, electionId, actorId, 'credential_batch.deleted', {
        batchId,
        sequenceNumber: batch.rows[0].sequenceNumber,
        deletedCodes: batch.rows[0].quantity
      });
      return this.detail(electionId, client);
    });
  }

  async open(id: string, actorId: string) {
    return this.db.transaction(async (client) => {
      const election = await client.query<ElectionRow>('select * from elections where id = $1 for update', [id]);
      const row = election.rows[0];
      if (!row) throw new NotFoundException('Eleição não encontrada.');
      if (row.status !== 'draft') throw new ConflictException('A eleição não está em preparação.');
      const codeCount = await client.query<{ count: number }>(
        'select count(*)::int as count from voting_codes where election_id = $1 and active',
        [id]
      );
      if (codeCount.rows[0].count === 0) throw new BadRequestException('Gere as senhas antes de abrir a eleição.');
      const currentOffice: Office = row.elder_seats > 0 ? 'elder' : 'deacon';
      await client.query(
        `update elections set status = 'open', current_office = $2, updated_at = now() where id = $1`,
        [id, currentOffice]
      );
      await this.audit(client, id, actorId, 'election.opened', { currentOffice });
      return this.detail(id, client);
    });
  }

  async setPresence(id: string, rawPresentMembers: unknown, actorId: string) {
    const presentMembers = integer(rawPresentMembers, 'Membros presentes', 1);
    return this.db.transaction(async (client) => {
      const election = await client.query<ElectionRow>('select * from elections where id = $1 for update', [id]);
      if (!election.rows[0]) throw new NotFoundException('Eleição não encontrada.');
      if (election.rows[0].status === 'finished') throw new ConflictException('A eleição já foi encerrada.');
      const scrutinyCount = await client.query<{ count: number }>(
        'select count(*)::int as count from scrutinies where election_id = $1',
        [id]
      );
      if (scrutinyCount.rows[0].count > 0) {
        throw new ConflictException('O número de presentes não pode mudar depois do primeiro escrutínio.');
      }
      await client.query('update elections set present_members = $2, updated_at = now() where id = $1', [id, presentMembers]);
      await this.audit(client, id, actorId, 'presence.set', {
        presentMembers,
        majorityRequired: majorityRequired(presentMembers)
      });
      return this.detail(id, client);
    });
  }

  private async currentElection(id: string, client: QueryConnection = this.db) {
    const result = await client.query<ElectionRow>('select * from elections where id = $1', [id]);
    if (!result.rows[0]) throw new NotFoundException('Eleição não encontrada.');
    return result.rows[0];
  }

  async nextScrutiny(id: string, connection: QueryConnection = this.db) {
    const election = await this.currentElection(id, connection);
    if (election.status !== 'open' || !election.current_office) return { available: false, reason: 'finished' };
    if (!election.present_members) return { available: false, reason: 'presence_required' };

    const pending = await connection.query<{ count: number }>(
      `select count(*)::int as count from scrutinies where election_id = $1 and status <> 'published'`,
      [id]
    );
    if (pending.rows[0].count > 0) return { available: false, reason: 'scrutiny_in_progress' };

    const office = election.current_office;
    const seats = office === 'elder' ? election.elder_seats : election.deacon_seats;
    const electedResult = await connection.query<{ count: number }>(
      'select count(*)::int as count from candidates where election_id = $1 and office = $2 and elected',
      [id, office]
    );
    const seatsOpen = seats - electedResult.rows[0].count;
    const roundResult = await connection.query<{ round: number }>(
      'select coalesce(max(round_number), 0)::int + 1 as round from scrutinies where election_id = $1 and office = $2',
      [id, office]
    );
    const roundNumber = roundResult.rows[0].round;
    if (seatsOpen <= 0 || roundNumber > 3) return { available: false, reason: 'office_finished' };

    const candidates = await connection.query<{ id: string; name: string; displayOrder: number; previousVotes: number }>(
      `select c.id, c.name, c.display_order as "displayOrder",
              coalesce(sr.votes, 0)::int as "previousVotes"
       from candidates c
       left join scrutinies previous on previous.election_id = c.election_id
         and previous.office = c.office and previous.round_number = 2 and previous.status = 'published'
       left join scrutiny_results sr on sr.scrutiny_id = previous.id and sr.candidate_id = c.id
       where c.election_id = $1 and c.office = $2 and not c.elected
       order by coalesce(sr.votes, 0) desc, c.display_order`,
      [id, office]
    );
    const limit = roundNumber === 3 ? finalistLimit(seatsOpen, candidates.rows.length) : candidates.rows.length;
    const cutoffVotes = limit > 0 ? candidates.rows[limit - 1]?.previousVotes : undefined;
    const tiedAtCutoff = roundNumber === 3 && limit < candidates.rows.length &&
      candidates.rows[limit]?.previousVotes === cutoffVotes;

    return {
      available: true,
      office,
      roundNumber,
      seatsOpen,
      maxMarks: seatsOpen,
      majorityRequired: majorityRequired(election.present_members),
      finalistLimit: limit,
      tiedAtCutoff,
      candidates: candidates.rows,
      defaultCandidateIds: candidates.rows.slice(0, limit).map((candidate) => candidate.id)
    };
  }

  async startScrutiny(id: string, candidateIds: unknown, actorId: string) {
    return this.db.transaction(async (client) => {
      const electionResult = await client.query<ElectionRow>('select * from elections where id = $1 for update', [id]);
      const election = electionResult.rows[0];
      if (!election) throw new NotFoundException('Eleição não encontrada.');
      const next = await this.nextScrutiny(id, client);
      if (!next.available) throw new ConflictException('Não há escrutínio pronto para abrir.');

      let selectedIds = next.defaultCandidateIds ?? [];
      if (next.roundNumber === 3) {
        if (Array.isArray(candidateIds)) selectedIds = [...new Set(candidateIds.map(String))];
        if (selectedIds.length !== next.finalistLimit) {
          throw new BadRequestException(`Selecione exatamente ${next.finalistLimit} finalistas.`);
        }
        const allowed = new Set(next.candidates.map((candidate) => candidate.id));
        if (selectedIds.some((candidateId) => !allowed.has(candidateId))) {
          throw new BadRequestException('A lista contém candidato inválido.');
        }
      }

      const scrutiny = await client.query<ScrutinyRow>(
        `insert into scrutinies
          (election_id, office, round_number, seats_open, max_marks, majority_required)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [id, next.office, next.roundNumber, next.seatsOpen, next.maxMarks, next.majorityRequired]
      );
      for (const [index, candidateId] of selectedIds.entries()) {
        await client.query(
          'insert into scrutiny_candidates (scrutiny_id, candidate_id, position) values ($1, $2, $3)',
          [scrutiny.rows[0].id, candidateId, index + 1]
        );
      }
      await this.audit(client, id, actorId, 'scrutiny.opened', {
        scrutinyId: scrutiny.rows[0].id,
        office: next.office,
        roundNumber: next.roundNumber,
        seatsOpen: next.seatsOpen,
        candidateIds: selectedIds
      });
      return scrutiny.rows[0];
    });
  }

  async closeScrutiny(scrutinyId: string, actorId: string) {
    return this.db.transaction(async (client) => {
      const scrutiny = await client.query<ScrutinyRow>('select * from scrutinies where id = $1 for update', [scrutinyId]);
      if (!scrutiny.rows[0]) throw new NotFoundException('Escrutínio não encontrado.');
      if (scrutiny.rows[0].status !== 'open') throw new ConflictException('O escrutínio não está aberto.');
      await client.query(`update scrutinies set status = 'closed', closed_at = now() where id = $1`, [scrutinyId]);
      await this.audit(client, scrutiny.rows[0].election_id, actorId, 'scrutiny.closed', { scrutinyId });
      return this.tally(scrutinyId, client);
    });
  }

  async addPaperBallot(scrutinyId: string, rawCandidateIds: unknown, actorId: string) {
    const candidateIds = Array.isArray(rawCandidateIds) ? [...new Set(rawCandidateIds.map(String))] : [];
    return this.db.transaction(async (client) => {
      const scrutiny = await client.query<ScrutinyRow>('select * from scrutinies where id = $1 for update', [scrutinyId]);
      const row = scrutiny.rows[0];
      if (!row) throw new NotFoundException('Escrutínio não encontrado.');
      if (row.status !== 'closed') throw new ConflictException('O papel só pode ser lançado depois do encerramento.');
      if (candidateIds.length > row.max_marks) throw new BadRequestException('A cédula ultrapassa o limite de escolhas.');
      const allowed = await client.query<{ candidate_id: string }>(
        'select candidate_id from scrutiny_candidates where scrutiny_id = $1 and candidate_id = any($2::uuid[])',
        [scrutinyId, candidateIds]
      );
      if (allowed.rows.length !== candidateIds.length) throw new BadRequestException('A cédula contém candidato inválido.');

      const ballot = await client.query<{ id: string }>(
        `insert into ballots (scrutiny_id, source, blank_count) values ($1, 'paper', $2) returning id`,
        [scrutinyId, blankVotes(row.max_marks, candidateIds.length)]
      );
      for (const candidateId of candidateIds) {
        await client.query('insert into ballot_entries (ballot_id, candidate_id) values ($1, $2)', [ballot.rows[0].id, candidateId]);
      }
      await this.audit(client, row.election_id, actorId, 'paper_ballot.added', {
        scrutinyId,
        ballotId: ballot.rows[0].id,
        selectedCount: candidateIds.length
      });
      return { id: ballot.rows[0].id };
    });
  }

  async setPaperTotals(scrutinyId: string, body: Record<string, unknown>, actorId: string) {
    const ballotCount = integer(body.ballotCount, 'Cédulas em papel');
    const rawCandidateVotes = Array.isArray(body.candidateVotes) ? body.candidateVotes : [];
    const candidateVotes = rawCandidateVotes.map((value) => {
      const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
      return {
        candidateId: String(record.candidateId ?? ''),
        votes: integer(record.votes, 'Votos em papel')
      };
    }).filter((item) => item.candidateId && item.votes > 0);
    if (new Set(candidateVotes.map((item) => item.candidateId)).size !== candidateVotes.length) {
      throw new BadRequestException('Cada candidato deve aparecer apenas uma vez na apuração em papel.');
    }

    return this.db.transaction(async (client) => {
      const scrutinyResult = await client.query<ScrutinyRow & { present_members: number }>(
        `select s.*, e.present_members from scrutinies s
         join elections e on e.id = s.election_id where s.id = $1 for update`,
        [scrutinyId]
      );
      const scrutiny = scrutinyResult.rows[0];
      if (!scrutiny) throw new NotFoundException('Escrutínio não encontrado.');
      if (scrutiny.status !== 'closed') throw new ConflictException('Os votos em papel só podem ser informados depois do encerramento.');

      const digital = await client.query<{ count: number }>(
        `select count(*)::int as count from ballots where scrutiny_id = $1 and source = 'digital'`,
        [scrutinyId]
      );
      if (digital.rows[0].count + ballotCount > scrutiny.present_members) {
        throw new BadRequestException(`O total recebido não pode ultrapassar os ${scrutiny.present_members} membros presentes.`);
      }
      if (candidateVotes.some((item) => item.votes > ballotCount)) {
        throw new BadRequestException('Um candidato não pode receber mais votos em papel do que o total de cédulas.');
      }
      const totalMarks = candidateVotes.reduce((sum, item) => sum + item.votes, 0);
      if (totalMarks > ballotCount * scrutiny.max_marks) {
        throw new BadRequestException('A quantidade de votos nominais ultrapassa o limite das cédulas em papel.');
      }
      const allowed = candidateVotes.length === 0 ? { rows: [] } : await client.query<{ candidate_id: string }>(
        `select candidate_id from scrutiny_candidates where scrutiny_id = $1 and candidate_id = any($2::uuid[])`,
        [scrutinyId, candidateVotes.map((item) => item.candidateId)]
      );
      if (allowed.rows.length !== candidateVotes.length) throw new BadRequestException('A apuração contém candidato inválido.');

      await client.query(`delete from ballots where scrutiny_id = $1 and source = 'paper'`, [scrutinyId]);
      const ballots: Array<{ id: string; load: number }> = [];
      for (let index = 0; index < ballotCount; index += 1) {
        const inserted = await client.query<{ id: string }>(
          `insert into ballots (scrutiny_id, source, blank_count) values ($1, 'paper', $2) returning id`,
          [scrutinyId, scrutiny.max_marks]
        );
        ballots.push({ id: inserted.rows[0].id, load: 0 });
      }
      for (const candidate of [...candidateVotes].sort((a, b) => b.votes - a.votes)) {
        const available = ballots.filter((ballot) => ballot.load < scrutiny.max_marks).sort((a, b) => a.load - b.load);
        if (available.length < candidate.votes) throw new BadRequestException('Não foi possível distribuir os votos pelas cédulas informadas.');
        for (const ballot of available.slice(0, candidate.votes)) {
          await client.query('insert into ballot_entries (ballot_id, candidate_id) values ($1, $2)', [ballot.id, candidate.candidateId]);
          ballot.load += 1;
        }
      }
      for (const ballot of ballots) {
        await client.query('update ballots set blank_count = $2 where id = $1', [ballot.id, scrutiny.max_marks - ballot.load]);
      }
      await this.audit(client, scrutiny.election_id, actorId, 'paper_totals.updated', {
        scrutinyId,
        ballotCount,
        candidateVotes,
        blankVotes: ballotCount * scrutiny.max_marks - totalMarks
      });
      return this.tally(scrutinyId, client);
    });
  }

  async deletePaperBallot(scrutinyId: string, ballotId: string, actorId: string) {
    return this.db.transaction(async (client) => {
      const result = await client.query<{ election_id: string }>(
        `select s.election_id from ballots b join scrutinies s on s.id = b.scrutiny_id
         where b.id = $1 and b.scrutiny_id = $2 and b.source = 'paper' and s.status = 'closed'`,
        [ballotId, scrutinyId]
      );
      if (!result.rows[0]) throw new NotFoundException('Cédula de papel não encontrada ou já publicada.');
      await client.query('delete from ballots where id = $1', [ballotId]);
      await this.audit(client, result.rows[0].election_id, actorId, 'paper_ballot.deleted', { scrutinyId, ballotId });
      return { deleted: true };
    });
  }

  async tally(scrutinyId: string, connection: QueryConnection = this.db) {
    const scrutinyResult = await connection.query<ScrutinyRow>('select * from scrutinies where id = $1', [scrutinyId]);
    const scrutiny = scrutinyResult.rows[0];
    if (!scrutiny) throw new NotFoundException('Escrutínio não encontrado.');
    if (scrutiny.status === 'open') throw new ConflictException('Encerre o escrutínio antes de ver a apuração.');

    const candidateResult = await connection.query<CandidateTally>(
        `select c.id, c.name, c.display_order,
                count(b.id)::int as votes,
                count(b.id) filter (where b.source = 'digital')::int as digital_votes,
                count(b.id) filter (where b.source = 'paper')::int as paper_votes
         from scrutiny_candidates sc
         join candidates c on c.id = sc.candidate_id
         left join ballot_entries be on be.candidate_id = c.id
         left join ballots b on b.id = be.ballot_id and b.scrutiny_id = sc.scrutiny_id
         where sc.scrutiny_id = $1
         group by c.id, sc.position
         order by votes desc, sc.position`,
        [scrutinyId]
      );
    const totalsResult = await connection.query<{ ballot_count: number; digital_count: number; paper_count: number; blank_count: number }>(
        `select count(*)::int as ballot_count,
                count(*) filter (where source = 'digital')::int as digital_count,
                count(*) filter (where source = 'paper')::int as paper_count,
                coalesce(sum(blank_count), 0)::int as blank_count
         from ballots where scrutiny_id = $1`,
        [scrutinyId]
      );
    const paperResult = await connection.query<{ id: string; blank_count: number; candidate_ids: string[] }>(
        `select b.id, b.blank_count,
                coalesce(array_agg(be.candidate_id) filter (where be.candidate_id is not null), '{}') as candidate_ids
         from ballots b left join ballot_entries be on be.ballot_id = b.id
         where b.scrutiny_id = $1 and b.source = 'paper'
         group by b.id order by b.submitted_at`,
        [scrutinyId]
      );
    const candidates = candidateResult.rows.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      displayOrder: candidate.display_order,
      votes: Number(candidate.votes),
      digitalVotes: Number(candidate.digital_votes),
      paperVotes: Number(candidate.paper_votes),
      qualified: Number(candidate.votes) >= scrutiny.majority_required
    }));
    const qualified = candidates.filter((candidate) => candidate.qualified);
    return {
      scrutiny: {
        id: scrutiny.id,
        electionId: scrutiny.election_id,
        office: scrutiny.office,
        roundNumber: scrutiny.round_number,
        seatsOpen: scrutiny.seats_open,
        maxMarks: scrutiny.max_marks,
        majorityRequired: scrutiny.majority_required,
        status: scrutiny.status
      },
      candidates,
      totals: {
        ballotCount: totalsResult.rows[0].ballot_count,
        digitalCount: totalsResult.rows[0].digital_count,
        paperCount: totalsResult.rows[0].paper_count,
        blankCount: totalsResult.rows[0].blank_count
      },
      paperBallots: paperResult.rows.map((row) => ({
        id: row.id,
        blankCount: row.blank_count,
        candidateIds: row.candidate_ids
      })),
      suggestedWinnerIds: qualified.slice(0, scrutiny.seats_open).map((candidate) => candidate.id),
      requiresAdminSelection: qualified.length > scrutiny.seats_open
    };
  }

  async publish(scrutinyId: string, rawWinnerIds: unknown, actorId: string) {
    const requestedWinnerIds = Array.isArray(rawWinnerIds) ? [...new Set(rawWinnerIds.map(String))] : undefined;
    return this.db.transaction(async (client) => {
      const scrutinyResult = await client.query<ScrutinyRow>('select * from scrutinies where id = $1 for update', [scrutinyId]);
      const scrutiny = scrutinyResult.rows[0];
      if (!scrutiny) throw new NotFoundException('Escrutínio não encontrado.');
      if (scrutiny.status !== 'closed') throw new ConflictException('O escrutínio não está pronto para publicação.');
      const tally = await this.tally(scrutinyId, client);
      const qualifiedIds = tally.candidates.filter((candidate) => candidate.qualified).map((candidate) => candidate.id);
      let winnerIds = qualifiedIds;
      if (qualifiedIds.length > scrutiny.seats_open) {
        if (!requestedWinnerIds || requestedWinnerIds.length !== scrutiny.seats_open) {
          throw new BadRequestException(`A mesa deve selecionar exatamente ${scrutiny.seats_open} eleitos entre os que atingiram a maioria.`);
        }
        if (requestedWinnerIds.some((id) => !qualifiedIds.includes(id))) {
          throw new BadRequestException('Só pode ser eleito quem atingiu a maioria.');
        }
        winnerIds = requestedWinnerIds;
      } else if (requestedWinnerIds &&
        (requestedWinnerIds.length !== qualifiedIds.length || requestedWinnerIds.some((id) => !qualifiedIds.includes(id)))) {
        throw new BadRequestException('A seleção de eleitos não corresponde aos candidatos que atingiram a maioria.');
      }

      for (const candidate of tally.candidates) {
        const elected = winnerIds.includes(candidate.id);
        await client.query(
          `insert into scrutiny_results (scrutiny_id, candidate_id, votes, elected)
           values ($1, $2, $3, $4)`,
          [scrutinyId, candidate.id, candidate.votes, elected]
        );
        if (elected) {
          await client.query(
            'update candidates set elected = true, elected_round = $2 where id = $1',
            [candidate.id, scrutiny.round_number]
          );
        }
      }
      await client.query(`update scrutinies set status = 'published', published_at = now() where id = $1`, [scrutinyId]);

      const election = await this.currentElection(scrutiny.election_id, client);
      const seats = scrutiny.office === 'elder' ? election.elder_seats : election.deacon_seats;
      const electedCount = await client.query<{ count: number }>(
        'select count(*)::int as count from candidates where election_id = $1 and office = $2 and elected',
        [election.id, scrutiny.office]
      );
      const officeFinished = electedCount.rows[0].count >= seats || scrutiny.round_number >= 3;
      if (officeFinished) {
        const nextOffice: Office | null = scrutiny.office === 'elder' && election.deacon_seats > 0 ? 'deacon' : null;
        await client.query(
          `update elections set current_office = $2, status = $3, updated_at = now() where id = $1`,
          [election.id, nextOffice, nextOffice ? 'open' : 'finished']
        );
      }
      await this.audit(client, election.id, actorId, 'scrutiny.published', {
        scrutinyId,
        winnerIds,
        requiredManualSelection: tally.requiresAdminSelection
      });
      return this.detail(election.id, client);
    });
  }

  async invalidateCode(electionId: string, rawCode: unknown, actorId: string) {
    const code = normalizeCode(rawCode);
    if (!code) throw new BadRequestException('Informe a senha.');
    return this.db.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `select id from voting_codes where election_id = $1 and code = $2 and active for update`,
        [electionId, code]
      );
      if (!result.rows[0]) throw new NotFoundException('Senha ativa não encontrada nesta eleição.');
      const usedInCurrentRound = await client.query<{ count: number }>(
        `select count(*)::int as count from ballots b join scrutinies s on s.id = b.scrutiny_id
         where b.code_id = $1 and s.status <> 'published'`,
        [result.rows[0].id]
      );
      if (usedInCurrentRound.rows[0].count > 0) {
        throw new ConflictException('Essa senha já votou no escrutínio atual e não pode migrar para o papel nesta rodada.');
      }
      const previousVotes = await client.query<{ count: number }>(
        'select count(*)::int as count from ballots where code_id = $1',
        [result.rows[0].id]
      );
      await client.query('update voting_codes set active = false, invalidated_at = now() where id = $1', [result.rows[0].id]);
      await this.audit(client, electionId, actorId, 'credential.invalidated', {
        code,
        preservedPreviousVotes: previousVotes.rows[0].count
      });
      return { invalidated: true };
    });
  }

  async voterAccess(rawCode: unknown) {
    const code = normalizeCode(rawCode);
    if (code.length !== 6) throw new BadRequestException('Digite a senha de seis caracteres.');
    const codeResult = await this.db.query<{ id: string; election_id: string }>(
      `select id, election_id from voting_codes
       where code = $1 and active
       limit 1`,
      [code]
    );
    const votingCode = codeResult.rows[0];
    if (!votingCode) throw new BadRequestException('Senha inválida.');
    const open = await this.db.query<ScrutinyRow & { church_name: string }>(
      `select s.*, e.church_name from scrutinies s
       join elections e on e.id = s.election_id
       where e.id = $1 and e.status = 'open' and s.status = 'open'
       limit 1`,
      [votingCode.election_id]
    );
    const scrutiny = open.rows[0];
    if (!scrutiny) return { status: 'unavailable' as const };
    const existing = await this.db.query(
      'select id from ballots where scrutiny_id = $1 and code_id = $2',
      [scrutiny.id, votingCode.id]
    );
    if (existing.rows[0]) {
      return {
        status: 'already_voted' as const,
        office: scrutiny.office,
        roundNumber: scrutiny.round_number
      };
    }
    const candidates = await this.db.query<{ id: string; name: string }>(
      `select c.id, c.name from scrutiny_candidates sc join candidates c on c.id = sc.candidate_id
       where sc.scrutiny_id = $1 order by sc.position`,
      [scrutiny.id]
    );
    return {
      status: 'ready' as const,
      accessToken: this.voterTokens.sign({
        codeId: votingCode.id,
        scrutinyId: scrutiny.id,
        electionId: scrutiny.election_id
      }),
      churchName: scrutiny.church_name,
      office: scrutiny.office,
      roundNumber: scrutiny.round_number,
      maxMarks: scrutiny.max_marks,
      candidates: candidates.rows
    };
  }

  async submitVote(token: string, rawCandidateIds: unknown) {
    const payload = this.voterTokens.verify(token);
    const candidateIds = Array.isArray(rawCandidateIds) ? [...new Set(rawCandidateIds.map(String))] : [];
    return this.db.transaction(async (client) => {
      const scrutinyResult = await client.query<ScrutinyRow>(
        'select * from scrutinies where id = $1 for share',
        [payload.scrutinyId]
      );
      const scrutiny = scrutinyResult.rows[0];
      if (!scrutiny || scrutiny.election_id !== payload.electionId) throw new BadRequestException('Votação inválida.');
      const existing = await client.query(
        'select id from ballots where scrutiny_id = $1 and code_id = $2',
        [payload.scrutinyId, payload.codeId]
      );
      if (existing.rows[0]) return { computed: true, alreadyRecorded: true };
      if (scrutiny.status !== 'open') throw new ConflictException('Esta votação já foi encerrada.');
      if (candidateIds.length > scrutiny.max_marks) throw new BadRequestException('Você selecionou candidatos demais.');
      const allowed = await client.query<{ candidate_id: string }>(
        'select candidate_id from scrutiny_candidates where scrutiny_id = $1 and candidate_id = any($2::uuid[])',
        [payload.scrutinyId, candidateIds]
      );
      if (allowed.rows.length !== candidateIds.length) throw new BadRequestException('A seleção contém candidato inválido.');
      const activeCode = await client.query(
        'select id from voting_codes where id = $1 and election_id = $2 and active',
        [payload.codeId, payload.electionId]
      );
      if (!activeCode.rows[0]) throw new BadRequestException('Senha inválida.');

      const ballot = await client.query<{ id: string }>(
        `insert into ballots (scrutiny_id, code_id, source, blank_count)
         values ($1, $2, 'digital', $3)
         on conflict (scrutiny_id, code_id) where code_id is not null do nothing
         returning id`,
        [payload.scrutinyId, payload.codeId, blankVotes(scrutiny.max_marks, candidateIds.length)]
      );
      if (!ballot.rows[0]) return { computed: true, alreadyRecorded: true };
      for (const candidateId of candidateIds) {
        await client.query('insert into ballot_entries (ballot_id, candidate_id) values ($1, $2)', [ballot.rows[0].id, candidateId]);
      }
      return { computed: true, alreadyRecorded: false };
    });
  }

  async auditHistory(electionId: string) {
    await this.currentElection(electionId);
    const result = await this.db.query(
      `select id, action, actor_id as "actorId", details, created_at as "createdAt"
       from audit_events where election_id = $1 order by created_at desc, id desc`,
      [electionId]
    );
    return result.rows;
  }

  async testCodes(electionId: string) {
    if (config.NODE_ENV !== 'test' || !isLocalTestDatabase()) throw new NotFoundException();
    const result = await this.db.query<{ code: string }>(
      'select code from voting_codes where election_id = $1 order by created_at, code',
      [electionId]
    );
    return result.rows.map((row) => row.code);
  }

  async resetForTests() {
    if (config.NODE_ENV !== 'test' || !isLocalTestDatabase()) throw new NotFoundException();
    await this.db.query('truncate audit_events, scrutiny_results, ballot_entries, ballots, scrutiny_candidates, scrutinies, voting_codes, credential_batches, candidates, elections restart identity cascade');
    return { reset: true };
  }
}
