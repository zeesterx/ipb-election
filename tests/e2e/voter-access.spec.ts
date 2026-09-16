import { expect, test } from '@playwright/test';

test('exibe senha inválida mesmo sem votação aberta', async ({ page }) => {
  await page.route('**/api/voter/access', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Senha inválida.', error: 'Bad Request', statusCode: 400 })
    });
  });

  await page.goto('/');
  await page.getByLabel('Senha').fill('zzzzzz');
  await page.getByRole('button', { name: 'Iniciar votação' }).click();

  await expect(page.getByRole('alert')).toHaveText('Senha inválida.');
  await expect(page.getByRole('heading', { name: 'Digite sua senha' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nenhuma votação disponível' })).not.toBeVisible();
});
