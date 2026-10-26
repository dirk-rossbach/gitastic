import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

test('opens a repo, commits staged changes and browses sections', async ({ page }) => {
  const home = path.join(os.tmpdir(), 'gitastic-e2e-home');
  const repo = path.join(home, 'repo');
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'E2E User');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Initial commit');
  fs.appendFileSync(path.join(repo, 'README.md'), 'world\n');

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await page.getByText('Open from local').first().click();
  const pathInput = page.locator('input[placeholder="/Users/you/project"]');
  await pathInput.fill(repo);
  await pathInput.press('Enter');

  await page.getByRole('button', { name: 'Timeline' }).waitFor();
  await page.getByText('Initial commit').first().waitFor();
  await page.getByText('Open from local').first().waitFor({ state: 'hidden' });

  await page.getByRole('button', { name: /Changes/ }).click();
  await page.getByText('README.md').first().waitFor();
  await page.getByRole('button', { name: 'Stage all', exact: true }).click();
  await page.locator('textarea[placeholder^="Commit message"]').fill('UI commit');
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await page.getByText('Working tree clean').waitFor();

  await page.getByRole('button', { name: 'Branches' }).click();
  await page.getByText('main').first().waitFor();

  const nav = page.locator('aside nav');

  await nav.getByRole('button', { name: 'Blame', exact: true }).click();
  const blameInput = page.locator('input[placeholder="path/to/file"]');
  await blameInput.fill('README.md');
  await blameInput.press('Enter');
  await page.getByText('E2E User').first().waitFor();

  await nav.getByRole('button', { name: 'File history', exact: true }).click();
  const fileHistoryInput = page.locator('input[placeholder="path/to/file"]');
  await fileHistoryInput.fill('README.md');
  await fileHistoryInput.press('Enter');
  await page.getByText('2 commits').waitFor();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('Appearance').waitFor();
  await page.getByRole('radio', { name: /Smelly Socks/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'smelly-socks');

  for (const name of ['Timeline', 'Tags', 'Remotes', 'Stashes', 'Conflicts', 'Blame', 'File history']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(250);
  }

  expect(errors).toEqual([]);
  expect(git(repo, 'log', '-1', '--pretty=%s')).toBe('UI commit');
});

test('resolves a merge conflict and continues the merge', async ({ page }) => {
  const home = path.join(os.tmpdir(), 'gitastic-e2e-home');
  const repo = path.join(home, 'conflict-repo');
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'E2E User');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Base');
  git(repo, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'from feature\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Feature');
  git(repo, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'from main\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Main');
  try {
    git(repo, 'merge', 'feature');
  } catch {
    // The conflict is expected.
  }

  await page.request.post('/api/repos/close', {
    headers: { 'x-gitastic-request': '1' },
  });
  await page.goto('/');
  await page.getByText('Open from local').first().click();
  const pathInput = page.locator('input[placeholder="/Users/you/project"]');
  await pathInput.fill(repo);
  await pathInput.press('Enter');
  await page.getByText('Merge in progress').waitFor();

  const nav = page.locator('aside nav');
  await nav.getByRole('button', { name: /^Conflicts/ }).click();
  await page.getByText('Conflicted files').waitFor();
  await expect(page.getByText('Result', { exact: true })).toBeVisible();
  await expect(page.getByText('Local Changes')).toBeVisible();
  await expect(page.getByText('Changes from Server')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept both chunk 1' })).toBeVisible();
  const serverLine = page.getByRole('button', { name: 'Accept server line 1' });
  await serverLine.click();
  await expect(serverLine).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('custom')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse conflicted files' }).click();
  await expect(page.getByText('Conflicted files')).toBeHidden();
  await page.getByRole('button', { name: 'Expand conflicted files' }).click();
  await page.getByText('Conflicted files').waitFor();
  await page.getByRole('button', { name: 'Save resolution' }).click();
  await page.getByText('Merge in progress').waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Merge in progress').waitFor({ state: 'hidden' });

  expect(fs.readFileSync(path.join(repo, 'file.txt'), 'utf8')).toBe('from feature\n');
  expect(git(repo, 'log', '-1', '--pretty=%s')).toBe("Merge branch 'feature'");
});

test('creates a branch, creates a tag and stashes changes', async ({ page }) => {
  const home = path.join(os.tmpdir(), 'gitastic-e2e-home');
  const repo = path.join(home, 'tools-repo');
  fs.rmSync(repo, { recursive: true, force: true });
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'E2E User');
  git(repo, 'config', 'user.email', 'e2e@example.com');
  fs.writeFileSync(path.join(repo, 'README.md'), 'hello\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Initial commit');

  await page.request.post('/api/repos/close', {
    headers: { 'x-gitastic-request': '1' },
  });
  await page.goto('/');
  await page.getByText('Open from local').first().click();
  const pathInput = page.locator('input[placeholder="/Users/you/project"]');
  await pathInput.fill(repo);
  await pathInput.press('Enter');

  const nav = page.locator('aside nav');

  await nav.getByRole('button', { name: /^Branches/ }).click();
  await page.getByRole('button', { name: 'New branch' }).first().click();
  await page.locator('input[placeholder="feature/my-branch"]').fill('ui-branch');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText('ui-branch').first().waitFor();

  await nav.getByRole('button', { name: /^Tags/ }).click();
  await page.getByRole('button', { name: 'New tag' }).first().click();
  await page.locator('input[placeholder="v1.0.0"]').fill('v1.0.0');
  await page.locator('input[placeholder="Release 1.0.0"]').fill('First release');
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await page.getByText('v1.0.0').first().waitFor();

  fs.appendFileSync(path.join(repo, 'README.md'), 'stashed\n');
  await nav.getByRole('button', { name: /^Stashes/ }).click();
  await page.getByRole('button', { name: 'Stash changes' }).first().click();
  await page.locator('input[placeholder="Optional stash message"]').fill('WIP changes');
  await page.getByRole('button', { name: 'Stash', exact: true }).click();
  const stashRow = page.getByText('WIP changes').first();
  await stashRow.waitFor();
  await stashRow.hover();
  await page.getByTitle('Pop stash (apply and remove)').click();
  await page.getByText('No stashes').waitFor();

  expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toBe('hello\nstashed\n');
  expect(git(repo, 'branch', '--list', 'ui-branch')).toContain('ui-branch');
  expect(git(repo, 'tag', '--list', 'v1.0.0')).toBe('v1.0.0');
});

test('clones a repository through the UI job', async ({ page }) => {
  const home = path.join(os.tmpdir(), 'gitastic-e2e-home');
  const source = path.join(home, 'clone-source');
  const target = path.join(home, 'cloned-repo');
  fs.rmSync(source, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(source, { recursive: true });
  git(source, 'init', '-q', '-b', 'main');
  git(source, 'config', 'user.name', 'E2E User');
  git(source, 'config', 'user.email', 'e2e@example.com');
  fs.writeFileSync(path.join(source, 'README.md'), 'clone me\n');
  git(source, 'add', '-A');
  git(source, 'commit', '-q', '-m', 'Clone source');

  await page.request.post('/api/repos/close', {
    headers: { 'x-gitastic-request': '1' },
  });
  await page.goto('/');
  await page.getByText('Clone from remote').first().click();
  await page.locator('input[placeholder="https://github.com/owner/repo.git"]').fill(source);
  const cloneInputs = page.locator('label').filter({ hasText: 'Clone into' }).locator('input');
  await cloneInputs.fill(target);
  await page.getByRole('button', { name: 'Clone repository', exact: true }).click();

  await page.locator('aside').getByText('cloned-repo', { exact: true }).waitFor();
  expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
  expect(fs.readFileSync(path.join(target, 'README.md'), 'utf8')).toBe('clone me\n');
});
