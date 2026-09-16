import { expect, test, type Page } from '@playwright/test';

const api = process.env.E2E_API_URL || 'http://127.0.0.1:3000/api';
const adminHeaders = { 'x-dev-admin': 'true' };

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('todas as áreas se adaptam a celular, tablet e desktop', async ({ page, request }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Matriz responsiva executada uma vez');

  await request.post(`${api}/admin/test/reset`, { headers: adminHeaders });
  const response = await request.post(`${api}/admin/elections`, {
    headers: adminHeaders,
    data: {
      churchName: 'Igreja Presbiteriana de Lavras — Congregação Central',
      electionDate: '2026-09-15',
      elderSeats: 2,
      deaconSeats: 1,
      elderCandidates: [
        { name: 'Antônio da Silva com um nome completo extenso' },
        { name: 'Benedito Souza' }
      ],
      deaconCandidates: [{ name: 'Carlos Oliveira' }]
    }
  });
  expect(response.ok()).toBeTruthy();
  const election = await response.json();

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Digite sua senha' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto('/admin/login');
    await expect(page).toHaveURL(/\/admin$/);
    await expectNoHorizontalOverflow(page);

    await page.goto('/admin');
    await expect(page.getByText('Congregação Central')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto(`/admin/elections/${election.id}`);
    await expect(page.getByRole('heading', { name: /Igreja Presbiteriana de Lavras/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto(`/resultado/${election.id}`);
    await expect(page.getByRole('heading', { name: /Igreja Presbiteriana de Lavras/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/admin');
  await page.getByRole('button', { name: /Nova eleição/ }).click();
  await expectNoHorizontalOverflow(page);
  await page.getByLabel('Nome da igreja').fill('Igreja Presbiteriana de Lavras');
  await page.getByLabel('Vagas de presbíteros').fill('2');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Nome completo do indicado 1').fill('Nome completo do primeiro indicado');
  await expectNoHorizontalOverflow(page);
});
