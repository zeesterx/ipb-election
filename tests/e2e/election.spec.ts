import { expect, test, type APIRequestContext } from '@playwright/test';

const api = process.env.E2E_API_URL || 'http://127.0.0.1:3000/api';
const adminHeaders = { 'x-dev-admin': 'true' };

async function adminPost(request: APIRequestContext, path: string, data: unknown = {}) {
  const response = await request.post(`${api}${path}`, { headers: adminHeaders, data });
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
  return response;
}

async function createElection(request: APIRequestContext, input: Record<string, unknown> = {}) {
  const response = await adminPost(request, '/admin/elections', {
    churchName: 'IPB Central de Testes', electionDate: '2026-09-15',
    elderSeats: 1, deaconSeats: 0,
    elderCandidates: ['André', 'Bruno', 'Carlos', 'Daniel'], deaconCandidates: [], ...input
  });
  return response.json();
}

async function generateCodes(request: APIRequestContext, electionId: string, quantity: number) {
  const response = await adminPost(request, `/admin/elections/${electionId}/codes`, { quantity });
  expect(response.headers()['content-type']).toContain('application/pdf');
}

async function getCodes(request: APIRequestContext, electionId: string): Promise<string[]> {
  const response = await request.get(`${api}/admin/test/elections/${electionId}/codes`, { headers: adminHeaders });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function next(request: APIRequestContext, electionId: string) {
  const response = await request.get(`${api}/admin/elections/${electionId}/next-scrutiny`, { headers: adminHeaders });
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
  return response.json();
}

async function vote(request: APIRequestContext, code: string, candidateIds: string[]) {
  const accessResponse = await request.post(`${api}/voter/access`, { data: { code } });
  if (!accessResponse.ok()) throw new Error(`${accessResponse.status()} ${await accessResponse.text()}`);
  const access = await accessResponse.json();
  expect(access.status).toBe('ready');
  const response = await request.post(`${api}/voter/votes`, {
    headers: { authorization: `Bearer ${access.accessToken}` }, data: { candidateIds }
  });
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${api}/admin/test/reset`, { headers: adminHeaders });
  if (!response.ok()) throw new Error(`${response.status()} ${await response.text()}`);
});

test('fluxo móvel confirma nome, branco, sucesso e impede voto duplicado', async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Fluxo visual móvel');

  await page.goto('/admin');
  await page.getByRole('button', { name: /Nova eleição/ }).click();
  await page.getByLabel('Nome da igreja').fill('IPB Esperança');
  await page.getByLabel('Data da eleição').fill('2040-06-20');
  await page.getByLabel('Vagas de presbíteros').fill('2');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Nome completo do indicado 1').fill('Ana Teste');
  await page.getByRole('button', { name: 'Adicionar indicado' }).click();
  await page.getByLabel('Nome completo do indicado 2').fill('Beatriz Teste');
  await page.getByRole('button', { name: 'Adicionar indicado' }).click();
  await page.getByLabel('Nome completo do indicado 3').fill('Carla Teste');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await Promise.all([
    page.waitForURL(/\/admin\/elections\//),
    page.getByRole('button', { name: 'Criar eleição' }).click()
  ]);
  const electionId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'Editar indicados' }).click();
  await page.getByLabel('Nome completo do indicado 1').fill('Ana Revisada');
  await page.getByRole('button', { name: 'Salvar indicados' }).click();
  await expect(page.getByText('Lista de indicados atualizada.')).toBeVisible();
  await expect(page.getByText('Ana Revisada', { exact: true })).toBeVisible();

  await page.route('**/api/admin/elections/*/codes', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  }, { times: 1 });
  const download = page.waitForEvent('download');
  await page.getByLabel('Quantidade de senhas').fill('3');
  await page.getByRole('button', { name: 'Gerar e baixar PDF' }).click();
  await expect(page.getByRole('button', { name: 'Gerando senhas…' })).toBeVisible();
  expect((await download).suggestedFilename()).toBe('senhas-lote-1.pdf');
  await expect(page.getByText('senhas em 1 lote(s)', { exact: true })).toBeVisible();

  // A mesa pode gerir o quórum fora da data e antes de abrir a eleição.
  await page.getByLabel('Membros presentes').fill('3');
  await expect(page.getByRole('button', { name: 'Confirmar presentes' })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirmar presentes' }).click();
  await expect(page.getByText('3 presentes', { exact: true })).toBeVisible();

  // O quórum confirmado continua editável até o primeiro escrutínio.
  await page.getByLabel('Membros presentes').fill('4');
  await expect(page.getByRole('button', { name: 'Salvar alteração' })).toBeEnabled();
  await page.getByRole('button', { name: 'Salvar alteração' }).click();
  await expect(page.getByText('4 presentes', { exact: true })).toBeVisible();
  await page.getByLabel('Membros presentes').fill('3');
  await page.getByRole('button', { name: 'Salvar alteração' }).click();
  await expect(page.getByText('2 votos', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir eleição' }).click();
  await page.getByRole('button', { name: 'Abrir escrutínio' }).click();
  await expect(page.getByText('Votação aberta')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar indicados' })).not.toBeVisible();
  const rejectedCandidateEdit = await request.put(`${api}/admin/elections/${electionId}/candidates`, {
    headers: adminHeaders,
    data: { elderCandidates: ['Alteração tardia', 'Outro nome'], deaconCandidates: [] }
  });
  expect(rejectedCandidateEdit.status()).toBe(409);

  const [code] = await getCodes(request, electionId);
  const voter = await page.context().newPage();
  await voter.goto('/');
  await voter.getByLabel('Senha').fill(code.toLowerCase());
  await expect(voter.getByLabel('Senha')).toHaveValue(code);
  await voter.getByRole('button', { name: 'Iniciar votação' }).click();
  await voter.getByRole('button', { name: 'Ana Revisada' }).click();
  await voter.getByRole('button', { name: 'Continuar' }).click();
  await expect(voter.getByText('Ana Revisada')).toBeVisible();
  await expect(voter.getByText('Branco', { exact: true })).toBeVisible();
  await voter.getByRole('button', { name: 'Confirmar voto' }).click();
  await expect(voter.getByRole('heading', { name: 'Seu voto foi computado' })).toBeVisible();
  await voter.getByRole('button', { name: 'Voltar ao início' }).click();
  await expect(voter.getByLabel('Senha')).toHaveValue(code);
  await voter.getByRole('button', { name: 'Iniciar votação' }).click();
  await expect(voter.getByRole('heading', { name: 'Seu voto já foi computado nesta votação' })).toBeVisible();
});

test('lotes podem ser baixados novamente, excluídos e substituídos', async ({ request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Fluxo de API executado uma vez');
  const election = await createElection(request);
  await generateCodes(request, election.id, 2);
  const firstBatch = await getCodes(request, election.id);
  let detail = await (await request.get(`${api}/admin/elections/${election.id}`, { headers: adminHeaders })).json();
  const batchId = detail.batches[0].id;
  expect(detail.batches[0].activeCount).toBe(2);
  const repeatedPdf = await request.get(`${api}/admin/elections/${election.id}/codes/batches/${batchId}/pdf`, { headers: adminHeaders });
  expect(repeatedPdf.ok()).toBeTruthy();
  expect(repeatedPdf.headers()['content-type']).toContain('application/pdf');
  const deleted = await request.delete(`${api}/admin/elections/${election.id}/codes/batches/${batchId}`, { headers: adminHeaders });
  expect(deleted.ok()).toBeTruthy();
  detail = await (await request.get(`${api}/admin/elections/${election.id}`, { headers: adminHeaders })).json();
  expect(detail.batches).toHaveLength(0);

  await generateCodes(request, election.id, 2);
  const allCodes = await getCodes(request, election.id);
  expect(allCodes).toHaveLength(2);
  expect(allCodes).not.toEqual(expect.arrayContaining(firstBatch));

  await adminPost(request, `/admin/elections/${election.id}/open`);
  await adminPost(request, `/admin/elections/${election.id}/presence`, { presentMembers: 4 });
  await adminPost(request, `/admin/elections/${election.id}/scrutinies`);
  const invalidResponse = await request.post(`${api}/voter/access`, { data: { code: firstBatch[0] } });
  expect(invalidResponse.ok()).toBeFalsy();
  const activeResponse = await request.post(`${api}/voter/access`, { data: { code: allCodes[0] } });
  expect((await activeResponse.json()).status).toBe('ready');
});

test('acompanhamento atualiza votos, exibe lotes e publica resultados na projeção', async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Fluxo visual executado uma vez');
  const election = await createElection(request, { elderCandidates: ['André Silva', 'Bruno Souza'] });
  await generateCodes(request, election.id, 3);
  const [code] = await getCodes(request, election.id);
  await adminPost(request, `/admin/elections/${election.id}/presence`, { presentMembers: 3 });
  await adminPost(request, `/admin/elections/${election.id}/open`);
  await adminPost(request, `/admin/elections/${election.id}/scrutinies`);

  await page.goto(`/admin/elections/${election.id}`);
  await expect(page.getByRole('link', { name: /Abrir painel de projeção/ })).toBeVisible();
  await page.getByRole('button', { name: /Preparação da eleição Concluída/ }).click();
  await page.getByText('Ver lotes e gerenciar credenciais').click();
  await expect(page.getByText('Lote 1')).toBeVisible();
  await expect(page.getByLabel('0 de 3 votos recebidos')).toBeVisible();

  const projection = await page.context().newPage();
  await projection.goto(`/resultado/${election.id}`);
  await expect(projection.getByRole('heading', { name: '1º escrutínio de presbíteros' })).toBeVisible();
  await expect(projection.getByLabel('0 de 3 votos recebidos')).toBeVisible();
  const currentTimelineStep = projection.getByRole('button', { name: /1º escrutínio de presbíteros Etapa atual/ });
  await expect(currentTimelineStep).toHaveAttribute('aria-expanded', 'true');
  const nextTimelineStep = projection.getByRole('button', { name: /2º escrutínio de presbíteros Aguardando/ });
  await nextTimelineStep.click();
  await expect(nextTimelineStep).toHaveAttribute('aria-expanded', 'true');
  await expect(currentTimelineStep).toHaveAttribute('aria-expanded', 'false');

  const detail = await (await request.get(`${api}/admin/elections/${election.id}`, { headers: adminHeaders })).json();
  const candidate = detail.candidates.find((item: { name: string }) => item.name === 'André Silva');
  await vote(request, code, [candidate.id]);
  await expect(projection.getByLabel('1 de 3 votos recebidos')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByLabel('1 de 3 votos recebidos')).toBeVisible({ timeout: 8_000 });
  await expect(projection.getByText('voto recebido · 33,3%')).toBeVisible();

  await page.getByRole('button', { name: 'Encerrar votação' }).click();
  await expect(page.getByRole('dialog', { name: 'Encerrar o 1º escrutínio?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar recebendo votos' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Encerrar votação' }).click();
  await page.getByRole('button', { name: 'Sim, encerrar votação' }).click();
  await expect(page.getByRole('heading', { name: 'Apuração do 1º escrutínio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Apuração conjunta dos votos em papel' })).toBeVisible();
  await page.getByLabel('Total de cédulas em papel').fill('1');
  await page.getByLabel('Votos em papel para André Silva').fill('1');
  await page.getByRole('button', { name: 'Salvar todos os votos em papel' }).click();
  await expect(page.getByText('Apuração dos votos em papel salva em conjunto.')).toBeVisible();
  await expect(page.locator('.summary-metrics').getByText('2 de 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovar e publicar resultado' })).toBeDisabled();
  await page.getByLabel('Sim, aceitou').check();
  await page.getByRole('button', { name: 'Aprovar e publicar resultado' }).click();
  await expect(page.getByText('Resultado publicado.')).toBeVisible();
  const adminPublishedStep = page.getByRole('button', { name: /1º escrutínio de presbíteros Concluída/ });
  await adminPublishedStep.click();
  await expect(adminPublishedStep).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Eleito neste escrutínio')).toBeVisible();

  await expect(projection.getByRole('button', { name: /Eleição concluída Concluída/ })).toHaveAttribute('aria-expanded', 'true', { timeout: 8_000 });
  await expect(projection.locator('.published-results .section-heading').getByRole('heading', { name: 'presbíteros' })).toBeVisible();
  await expect(projection.getByText('Eleito no 1º escrutínio')).toBeVisible();
  await expect(projection.locator('.result-ranking > div').filter({ hasText: 'André Silva' })).toContainText('2 votos');
  await expect(projection.locator('.result-ranking > div').filter({ hasText: 'André Silva' })).toContainText('66,7%');
  const publicResponse = await request.get(`${api}/voter/elections/${election.id}/results`);
  expect(publicResponse.ok()).toBeTruthy();
  const publicResult = await publicResponse.json();
  expect(publicResult.batches).toBeUndefined();
  expect(publicResult.scrutinies[0].results[0]).toMatchObject({ name: 'André Silva', votes: 2, elected: true });
});

test('três escrutínios, escolha no empate de corte e sequência para diáconos', async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Fluxo de API executado uma vez');
  const election = await createElection(request, {
    deaconSeats: 1, deaconCandidates: ['Eduardo', 'Felipe']
  });
  await generateCodes(request, election.id, 3);
  const [code] = await getCodes(request, election.id);
  await adminPost(request, `/admin/elections/${election.id}/open`);
  await adminPost(request, `/admin/elections/${election.id}/presence`, { presentMembers: 3 });

  // Primeiro escrutínio sem maioria.
  let scrutiny = await (await adminPost(request, `/admin/elections/${election.id}/scrutinies`)).json();
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/close`);
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/publish`, { winnerIds: [] });

  // Segundo: empate triplo no corte das duas vagas de finalista.
  scrutiny = await (await adminPost(request, `/admin/elections/${election.id}/scrutinies`)).json();
  const detail = await (await request.get(`${api}/admin/elections/${election.id}`, { headers: adminHeaders })).json();
  const elders = detail.candidates.filter((candidate: { office: string }) => candidate.office === 'elder');
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/close`);
  for (const candidate of elders.slice(0, 3)) {
    await adminPost(request, `/admin/scrutinies/${scrutiny.id}/paper-ballots`, { candidateIds: [candidate.id] });
  }
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/publish`, { winnerIds: [] });

  const third = await next(request, election.id);
  expect(third.roundNumber).toBe(3);
  expect(third.finalistLimit).toBe(2);
  expect(third.tiedAtCutoff).toBe(true);
  scrutiny = await (await adminPost(request, `/admin/elections/${election.id}/scrutinies`, {
    candidateIds: [elders[0].id, elders[2].id]
  })).json();
  await vote(request, code, [elders[0].id]);
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/close`);
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/paper-ballots`, { candidateIds: [elders[0].id] });
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/publish`, {
    winnerIds: [elders[0].id],
    acceptances: [{ candidateId: elders[0].id, accepted: true }]
  });

  const projection = await page.context().newPage();
  await projection.goto(`/resultado/${election.id}`);
  const partialResults = projection.locator('.current-results-card');
  await expect(partialResults).toContainText('Eduardo');
  await expect(partialResults).toContainText('Felipe');
  await expect(partialResults).not.toContainText('André');

  const deaconNext = await next(request, election.id);
  expect(deaconNext.office).toBe('deacon');
  expect(deaconNext.roundNumber).toBe(1);
  scrutiny = await (await adminPost(request, `/admin/elections/${election.id}/scrutinies`)).json();
  await projection.reload();
  await expect(partialResults).toContainText('Eduardo');
  await expect(partialResults).toContainText('Felipe');
  await expect(partialResults).not.toContainText('André');
  const deaconId = deaconNext.candidates[0].id;
  await vote(request, code, [deaconId]);
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/close`);
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/paper-ballots`, { candidateIds: [deaconId] });
  const completed = await (await adminPost(request, `/admin/scrutinies/${scrutiny.id}/publish`, {
    winnerIds: [deaconId],
    acceptances: [{ candidateId: deaconId, accepted: true }]
  })).json();
  expect(completed.status).toBe('finished');
  expect(completed.scrutinies.filter((item: { office: string }) => item.office === 'elder')).toHaveLength(3);
  await page.goto(`/admin/elections/${election.id}`);
  await expect(page.getByRole('button', { name: 'Baixar PDF para a ata' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Carregar histórico' })).not.toBeVisible();
  const reportResponse = await request.get(`${api}/admin/elections/${election.id}/minutes-report.pdf`, { headers: adminHeaders });
  expect(reportResponse.ok()).toBeTruthy();
  expect(reportResponse.headers()['content-type']).toContain('application/pdf');
  expect((await reportResponse.body()).subarray(0, 4).toString()).toBe('%PDF');
});

test('mesa escolhe os eleitos quando aprovados excedem as vagas', async ({ request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Fluxo de API executado uma vez');
  const election = await createElection(request, { elderSeats: 2, elderCandidates: ['A', 'B', 'C'] });
  await generateCodes(request, election.id, 5);
  await adminPost(request, `/admin/elections/${election.id}/open`);
  await adminPost(request, `/admin/elections/${election.id}/presence`, { presentMembers: 5 });
  const scrutiny = await (await adminPost(request, `/admin/elections/${election.id}/scrutinies`)).json();
  const candidates = (await nextAfterStart(request, election.id)).candidates;
  const patterns = [[0, 1], [0, 1], [0, 2], [0, 2], [1, 2]];
  // Papel só é permitido após encerrar; adiciona a distribuição A4, B3, C3.
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/close`);
  for (const pattern of patterns) {
    await adminPost(request, `/admin/scrutinies/${scrutiny.id}/paper-ballots`, { candidateIds: pattern.map((index) => candidates[index].id) });
  }
  const tallyResponse = await request.get(`${api}/admin/scrutinies/${scrutiny.id}/tally`, { headers: adminHeaders });
  const tally = await tallyResponse.json();
  expect(tally.requiresAdminSelection).toBe(true);
  const rejected = await request.post(`${api}/admin/scrutinies/${scrutiny.id}/publish`, { headers: adminHeaders, data: {} });
  expect(rejected.status()).toBe(400);
  const result = await (await adminPost(request, `/admin/scrutinies/${scrutiny.id}/publish`, {
    winnerIds: [candidates[0].id, candidates[2].id],
    acceptances: [
      { candidateId: candidates[0].id, accepted: true },
      { candidateId: candidates[2].id, accepted: true }
    ]
  })).json();
  expect(result.candidates.filter((candidate: { elected: boolean }) => candidate.elected).map((candidate: { name: string }) => candidate.name)).toEqual(['A', 'C']);
});

test('candidato que não aceita sai dos próximos escrutínios sem preencher a vaga', async ({ request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Fluxo de API executado uma vez');
  const election = await createElection(request, { elderCandidates: ['Aceita depois', 'Recusa', 'Terceiro'] });
  await generateCodes(request, election.id, 3);
  await adminPost(request, `/admin/elections/${election.id}/open`);
  await adminPost(request, `/admin/elections/${election.id}/presence`, { presentMembers: 3 });

  const initial = await (await request.get(`${api}/admin/elections/${election.id}`, { headers: adminHeaders })).json();
  const refused = initial.candidates.find((candidate: { name: string }) => candidate.name === 'Recusa');
  const accepted = initial.candidates.find((candidate: { name: string }) => candidate.name === 'Aceita depois');

  let scrutiny = await (await adminPost(request, `/admin/elections/${election.id}/scrutinies`)).json();
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/close`);
  let paper = await request.put(`${api}/admin/scrutinies/${scrutiny.id}/paper-totals`, {
    headers: adminHeaders,
    data: { ballotCount: 2, candidateVotes: [{ candidateId: refused.id, votes: 2 }] }
  });
  expect(paper.ok()).toBeTruthy();
  const missingAcceptance = await request.post(`${api}/admin/scrutinies/${scrutiny.id}/publish`, {
    headers: adminHeaders,
    data: { winnerIds: [refused.id] }
  });
  expect(missingAcceptance.status()).toBe(400);
  let detail = await (await adminPost(request, `/admin/scrutinies/${scrutiny.id}/publish`, {
    winnerIds: [refused.id],
    acceptances: [{ candidateId: refused.id, accepted: false }]
  })).json();

  expect(detail.candidates.find((candidate: { id: string }) => candidate.id === refused.id)).toMatchObject({
    elected: false, declined: true, declinedRound: 1
  });
  expect(detail.scrutinies[0].results.find((result: { candidateId: string }) => result.candidateId === refused.id)).toMatchObject({
    votes: 2, elected: false, accepted: false
  });

  const second = await next(request, election.id);
  expect(second.roundNumber).toBe(2);
  expect(second.seatsOpen).toBe(1);
  expect(second.candidates.map((candidate: { name: string }) => candidate.name)).not.toContain('Recusa');

  scrutiny = await (await adminPost(request, `/admin/elections/${election.id}/scrutinies`)).json();
  await adminPost(request, `/admin/scrutinies/${scrutiny.id}/close`);
  paper = await request.put(`${api}/admin/scrutinies/${scrutiny.id}/paper-totals`, {
    headers: adminHeaders,
    data: { ballotCount: 2, candidateVotes: [{ candidateId: accepted.id, votes: 2 }] }
  });
  expect(paper.ok()).toBeTruthy();
  detail = await (await adminPost(request, `/admin/scrutinies/${scrutiny.id}/publish`, {
    winnerIds: [accepted.id],
    acceptances: [{ candidateId: accepted.id, accepted: true }]
  })).json();
  expect(detail.status).toBe('finished');
  expect(detail.candidates.find((candidate: { id: string }) => candidate.id === accepted.id)).toMatchObject({ elected: true, electedRound: 2 });
});

async function nextAfterStart(request: APIRequestContext, electionId: string) {
  const detailResponse = await request.get(`${api}/admin/elections/${electionId}`, { headers: adminHeaders });
  const detail = await detailResponse.json();
  const open = detail.scrutinies.find((item: { status: string }) => item.status === 'open');
  const candidateResponse = await request.post(`${api}/voter/access`, { data: { code: (await getCodes(request, electionId))[0] } });
  const ballot = await candidateResponse.json();
  return { ...open, candidates: ballot.candidates };
}
