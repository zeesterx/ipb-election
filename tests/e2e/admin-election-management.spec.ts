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
