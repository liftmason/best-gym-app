/**
 * A coach's day on the web, end to end, against the demo gym (seed_demo): the board, a
 * template's preview, the library and settings. One browser session throughout: sign-in
 * codes are rate-limited and refresh tokens rotate, so the flows share a signed-in page.
 */
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('dana@ironridge.example');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel('Code').fill('123456'); // the demo users' fixed code in development
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/dashboard/);
});

test.afterAll(async () => {
  expect(errors).toEqual([]); // no uncaught errors anywhere along the way
  await page.close();
});

/** Waits for the API call a click makes, and checks it succeeded. */
async function answered(pattern: RegExp, method: string, action: () => Promise<unknown>) {
  const [response] = await Promise.all([page.waitForResponse((r) => pattern.test(r.url()) && r.request().method() === method), action()]);
  expect(response.status(), `${method} ${response.url()}`).toBeLessThan(300);
  return response;
}

async function openMayasBoard() {
  await page.goto('/athletes');
  await page.getByText('Maya Torres').first().click();
  await page.getByRole('tab', { name: 'Program', exact: true }).click();
  await expect(page.getByText('Exercise library')).toBeVisible();
}

test('today: the attention feed and the day', async () => {
  await expect(page.getByText('Needs your attention')).toBeVisible();
});

test('the board: add from the library, edit, undo', async () => {
  await openMayasBoard();
  const firstDay = page.getByRole('button', { name: /^(Mon|Sun) \d+/ }).first();
  await firstDay.click();
  // The library's "+" ("Add Snatch to Mon 21 Sep"), not the day's own "Add an exercise to Mon".
  const add = page.getByRole('button', { name: /^Add (?!an exercise).+ to \w{3} \d+ \w{3}$/ }).first();
  const name = ((await add.getAttribute('aria-label')) ?? '').replace(/^Add /, '').replace(/ to .*$/, '');
  await answered(/\/prescriptions$/, 'POST', () => add.click());
  await expect(page.getByText(new RegExp(`^${name} → `))).toBeVisible();

  await page.getByRole('button', { name: new RegExp(`^Edit ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},`) }).first().click();
  await page.getByLabel('RIR target').fill('1-2');
  await answered(/\/prescriptions\/[^/]+$/, 'PUT', () => page.getByRole('button', { name: 'Save', exact: true }).click());
  await expect(page.getByText(`${name} updated`)).toBeVisible();

  await answered(/\/undo$/, 'POST', () => page.getByRole('button', { name: /^Undo: / }).click());
  await expect(page.getByText(/^Undone: /)).toBeVisible();
});

test('the board: drag a card to another day', async () => {
  const card = page.getByRole('button', { name: /^Edit .+, / }).first();
  const days = page.getByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+/ });
  const from = await card.boundingBox();
  const to = await days.nth(3).boundingBox();
  if (!from || !to) throw new Error('the board has no card to drag');
  await answered(/\/move$/, 'POST', async () => {
    await page.mouse.move(from.x + 20, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
    await page.mouse.move(to.x + 40, to.y + 60, { steps: 12 });
    await page.mouse.up();
  });
});

test("a template's preview writes nothing until confirmed", async () => {
  await answered(/\/apply\/preview$/, 'POST', () => page.getByRole('button', { name: 'Add from template' }).click());
  await expect(page.getByText(/new weeks? \(Wk/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Apply cancelled. Nothing changed')).toBeVisible();
});

test('the library: a new exercise', async () => {
  await page.goto('/programming?tab=exercises');
  await page.getByRole('button', { name: '+ New exercise' }).click();
  await page.getByLabel('Name', { exact: true }).fill(`E2E Pull ${Date.now()}`);
  await page.getByRole('button', { name: /^Category:/ }).click();
  await page.getByRole('button', { name: 'Pull' }).last().click();
  await answered(/\/exercises$/, 'POST', () => page.getByRole('button', { name: 'Save exercise' }).click());
  await expect(page.getByText(/added to the library$/)).toBeVisible();
});

test('settings save', async () => {
  await page.goto('/settings');
  await answered(/\/settings$/, 'PUT', () => page.getByRole('button', { name: 'Save settings' }).click());
  await expect(page.getByText('Settings saved')).toBeVisible();
});
