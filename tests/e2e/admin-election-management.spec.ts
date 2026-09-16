import { expect, test } from '@playwright/test';

test('volta à lista sem conteúdo duplicado e exclui com confirmação', async ({ page }) => {
  const summary = {
    id: 'election-visual-1',
    churchName: 'Eleição visual',
    electionDate: '2040-06-20',
    elderSeats: 1,
    deaconSeats: 0,
    status: 'draft',
    currentOffice: null,
    codeCount: 0,
    electedCount: 0
  };
  const detail = {
    ...summary,
    presentMembers: null,
    candidates: [{
      id: 'candidate-1', office: 'elder', name: 'Candidato Teste', displayOrder: 1,
      elected: false, electedRound: null
    }],
    batches: [],
    scrutinies: []
  };
  let deleted = false;
  let delayNextDetail = false;
  let detailRequests = 0;

  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/admin/session') {
      await route.fulfill({ json: { authenticated: true, actorId: 'test-admin' } });
      return;
    }
    if (path === '/api/admin/elections' && request.method() === 'GET') {
      await route.fulfill({ json: deleted ? [] : [summary] });
      return;
    }
    if (path === `/api/admin/elections/${summary.id}` && request.method() === 'DELETE') {
      deleted = true;
      await route.fulfill({ json: { deleted: true } });
      return;
    }
    if (path === `/api/admin/elections/${summary.id}` && request.method() === 'GET') {
      detailRequests += 1;
      if (delayNextDetail) {
        delayNextDetail = false;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await route.fulfill({ json: detail });
      return;
    }
    await route.fulfill({ status: 404, json: { message: 'Rota de teste não configurada.' } });
  });

  await page.goto(`/admin/elections/${summary.id}`);
  await expect(page.getByRole('heading', { name: summary.churchName })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Etapas da eleição' })).toBeVisible();

  delayNextDetail = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => detailRequests).toBeGreaterThan(1);
  await page.getByRole('link', { name: 'Todas as eleições' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: 'Eleições', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Etapas da eleição' })).not.toBeVisible();
  await expect(page.getByRole('link', { name: /Abrir painel de projeção/ })).not.toBeVisible();

  await page.getByRole('link', { name: /Eleição visual/ }).click();
  await expect(page.getByRole('button', { name: 'Excluir eleição' })).toBeVisible();
  await page.getByRole('button', { name: 'Excluir eleição' }).click();
  await expect(page.getByRole('dialog', { name: 'Excluir esta eleição?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();

  await page.getByRole('button', { name: 'Excluir eleição' }).click();
  await page.getByRole('button', { name: 'Sim, excluir eleição' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Nenhuma eleição cadastrada' })).toBeVisible();
});

test('remove dos diáconos um candidato já eleito presbítero sem alterar o cargo iniciado', async ({ page }) => {
  const summary = {
    id: 'election-candidates-1', churchName: 'Eleição com dois cargos', electionDate: '2040-06-20',
    elderSeats: 1, deaconSeats: 1, status: 'open', currentOffice: 'deacon', codeCount: 10, electedCount: 1
  };
  let detail = {
    ...summary,
    presentMembers: 10,
    candidates: [
      { id: 'elder-john', office: 'elder', name: 'João da Silva', displayOrder: 1, elected: true, electedRound: 1 },
      { id: 'deacon-john', office: 'deacon', name: 'João da Silva', displayOrder: 1, elected: false, electedRound: null },
      { id: 'deacon-maria', office: 'deacon', name: 'Maria Souza', displayOrder: 2, elected: false, electedRound: null }
    ],
    batches: [{ id: 'batch-1', sequenceNumber: 1, quantity: 10, activeCount: 10, createdAt: '2040-06-20T10:00:00Z' }],
    scrutinies: [{
      id: 'elder-round-1', office: 'elder', roundNumber: 1, seatsOpen: 1, maxMarks: 1,
      majorityRequired: 6, status: 'published', ballotCount: 10, digitalCount: 10,
      paperCount: 0, blankCount: 4, openedAt: '2040-06-20T10:00:00Z',
      closedAt: '2040-06-20T10:10:00Z', publishedAt: '2040-06-20T10:15:00Z',
      results: [{ scrutinyId: 'elder-round-1', candidateId: 'elder-john', name: 'João da Silva', votes: 6, elected: true }]
    }]
  };
  let updateBody: { elderCandidates: Array<{ name: string }>; deaconCandidates: Array<{ name: string }> } | null = null;

  await page.route('**/api/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/admin/session') return route.fulfill({ json: { authenticated: true, actorId: 'test-admin' } });
    if (path === '/api/admin/elections' && request.method() === 'GET') return route.fulfill({ json: [summary] });
    if (path === `/api/admin/elections/${summary.id}/next-scrutiny`) {
      return route.fulfill({ json: { available: true, office: 'deacon', roundNumber: 1, seatsOpen: 1, maxMarks: 1, majorityRequired: 6, candidates: [], defaultCandidateIds: [] } });
    }
    if (path === `/api/admin/elections/${summary.id}/candidates` && request.method() === 'PUT') {
      updateBody = request.postDataJSON();
      detail = {
        ...detail,
        candidates: detail.candidates.filter((candidate) => candidate.id !== 'deacon-john')
      };
      return route.fulfill({ json: detail });
    }
    if (path === `/api/admin/elections/${summary.id}` && request.method() === 'GET') return route.fulfill({ json: detail });
    return route.fulfill({ status: 404, json: { message: 'Rota de teste não configurada.' } });
  });

  await page.goto(`/admin/elections/${summary.id}`);
  await page.getByRole('button', { name: /Preparação da eleição/ }).click();
  await page.getByRole('button', { name: 'Editar indicados' }).click();

  await expect(page.getByText('A votação deste cargo já começou. Esta lista está preservada.')).toBeVisible();
  await expect(page.getByLabel('Nome completo do indicado 1')).toHaveValue('João da Silva');
  await page.getByRole('button', { name: 'Remover indicado 1' }).click();
  await expect(page.getByLabel('Nome completo do indicado 1')).toHaveValue('Maria Souza');
  await page.getByRole('button', { name: 'Salvar indicados' }).click();

  await expect(page.getByText('Lista de indicados atualizada.')).toBeVisible();
  expect(updateBody).toEqual({
    elderCandidates: [{ name: 'João da Silva' }],
    deaconCandidates: [{ name: 'Maria Souza' }]
  });
});
