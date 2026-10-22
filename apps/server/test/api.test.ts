import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_REQUEST_HEADER } from '@gitastic/shared';
import { buildApp } from '../src/app';
import { homeDir, loadConfig } from '../src/config';
import { AppState } from '../src/state';
import { commitAll, createRepo, git, hasRef, readFile, writeFile } from './helpers';

let app: FastifyInstance;
let state: AppState;
let repoPath: string;

function request(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method,
    url,
    payload: payload as never,
    headers: { [API_REQUEST_HEADER]: '1', ...headers },
  });
}

async function json(response: Awaited<ReturnType<typeof request>>) {
  expect(response.statusCode, response.body).toBeLessThan(400);
  return response.json() as any;
}

async function waitForJob(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await json(await request('GET', `/api/jobs/${id}`));
    if (job.status === 'done') return job;
    if (job.status === 'error' || job.status === 'cancelled') {
      throw new Error(job.error ?? `Job ${job.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for job');
}

beforeAll(async () => {
  state = new AppState(await loadConfig());
  app = await buildApp({ state, webDist: null, dev: true });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

beforeEach(async () => {
  repoPath = createRepo();
  writeFile(repoPath, 'file.txt', 'base\n');
  commitAll(repoPath, 'Initial commit');
  await json(await request('POST', '/api/repos/open', { path: repoPath }));
});

describe('API security and health', () => {
  it('reports health and git version', async () => {
    const health = await json(await request('GET', '/api/health'));
    expect(health.ok).toBe(true);
    expect(health.gitVersion).toMatch(/^\d+\./);
  });

  it('rejects mutations without the request header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repo/stage',
      payload: { paths: [] },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('MISSING_REQUEST_HEADER');
  });

  it('rejects foreign origins', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repo/stage',
      payload: { paths: [] },
      headers: { [API_REQUEST_HEADER]: '1', origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('staging and commits', () => {
  it('stages, shows a diff, commits and lists the commit', async () => {
    writeFile(repoPath, 'file.txt', 'base\nchange\n');

    const status = await json(await request('GET', '/api/repo/status'));
    expect(status.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'file.txt', unstaged: true })]),
    );

    await json(await request('POST', '/api/repo/stage', {}));
    const diff = await json(await request('GET', '/api/repo/diff?staged=true'));
    expect(diff.patch).toContain('+change');

    await json(await request('POST', '/api/repo/commit', { message: 'Add change' }));
    const history = await json(await request('GET', '/api/repo/history?limit=5'));
    expect(history.commits[0].subject).toBe('Add change');
    expect(git(repoPath, 'log', '-1', '--pretty=%s')).toBe('Add change');
  });
});

describe('merge conflicts', () => {
  it('reports, resolves and continues a conflicted merge', async () => {
    git(repoPath, 'checkout', '-q', '-b', 'feature');
    writeFile(repoPath, 'file.txt', 'feature\n');
    commitAll(repoPath, 'Feature change');
    git(repoPath, 'checkout', '-q', 'main');
    writeFile(repoPath, 'file.txt', 'main\n');
    commitAll(repoPath, 'Main change');

    const merge = await json(await request('POST', '/api/repo/merge', { ref: 'feature' }));
    expect(merge.conflicted).toBe(true);
    expect(merge.operation).toBe('merge');

    const conflicts = await json(await request('GET', '/api/repo/conflicts'));
    expect(conflicts.files[0].path).toBe('file.txt');
    expect(conflicts.files[0].blocks).toHaveLength(1);
    expect(conflicts.files[0].blocks[0].ours).toBe('main');
    expect(conflicts.files[0].blocks[0].theirs).toBe('feature');

    await json(
      await request('POST', '/api/repo/conflicts/resolve', {
        path: 'file.txt',
        content: 'merged\n',
      }),
    );
    await json(await request('POST', '/api/repo/operation/merge', { action: 'continue' }));

    expect(readFile(repoPath, 'file.txt')).toBe('merged\n');
    expect(git(repoPath, 'log', '-1', '--pretty=%s')).toBe("Merge branch 'feature'");
  });
});

describe('undoable write operations', () => {
  it('cleans untracked files and restores them from the trash', async () => {
    writeFile(repoPath, 'junk.txt', 'junk\n');
    const clean = await json(
      await request('POST', '/api/repo/clean', {
        paths: [path.join(repoPath, 'junk.txt')],
        confirm: true,
      }),
    );
    expect(fs.existsSync(path.join(repoPath, 'junk.txt'))).toBe(false);

    await json(await request('POST', `/api/undo/${clean.undo.id}`, {}));
    expect(readFile(repoPath, 'junk.txt')).toBe('junk\n');
  });

  it('restores a tracked file and undoes the restore', async () => {
    writeFile(repoPath, 'file.txt', 'changed\n');
    const restore = await json(
      await request('POST', '/api/repo/restore', {
        paths: [path.join(repoPath, 'file.txt')],
        confirm: true,
      }),
    );
    expect(readFile(repoPath, 'file.txt')).toBe('base\n');

    await json(await request('POST', `/api/undo/${restore.undo.id}`, {}));
    expect(readFile(repoPath, 'file.txt')).toBe('changed\n');
  });

  it('creates a branch without switching and restores it after deletion', async () => {
    await json(await request('POST', '/api/repo/branch', { name: 'temp' }));
    expect(git(repoPath, 'branch', '--show-current')).toBe('main');

    const deleted = await json(
      await request('POST', '/api/repo/branch/delete', { name: 'temp' }),
    );
    expect(hasRef(repoPath, 'refs/heads/temp')).toBe(false);

    await json(await request('POST', `/api/undo/${deleted.undo.id}`, {}));
    expect(hasRef(repoPath, 'refs/heads/temp')).toBe(true);
  });

  it('hard resets a dirty tree and undoes the reset', async () => {
    writeFile(repoPath, 'file.txt', 'dirty\n');
    const reset = await json(
      await request('POST', '/api/repo/reset', {
        mode: 'hard',
        ref: 'HEAD',
        confirm: true,
      }),
    );
    expect(readFile(repoPath, 'file.txt')).toBe('base\n');

    await json(await request('POST', `/api/undo/${reset.undo.id}`, {}));
    expect(readFile(repoPath, 'file.txt')).toBe('dirty\n');
  });
});

describe('remotes and jobs', () => {
  it('pushes, fetches and pulls through a local bare remote', async () => {
    const origin = path.join(homeDir, `origin-${process.pid}-${Date.now()}.git`);
    execFileSync('git', ['init', '-q', '--bare', origin]);
    await json(
      await request('POST', '/api/repo/remote', { name: 'origin', url: origin }),
    );

    const push = await json(
      await request('POST', '/api/repo/push', {
        remote: 'origin',
        branch: 'main',
        setUpstream: true,
      }),
    );
    await waitForJob(push.job.id);
    expect(git(origin, 'rev-parse', 'refs/heads/main')).toBe(git(repoPath, 'rev-parse', 'HEAD'));

    const other = path.join(homeDir, `other-${process.pid}-${Date.now()}`);
    execFileSync('git', ['clone', '-q', origin, other]);
    git(other, 'config', 'user.name', 'Other User');
    git(other, 'config', 'user.email', 'other@example.com');
    writeFile(other, 'file.txt', 'from remote\n');
    commitAll(other, 'Remote change');
    git(other, 'push', '-q', 'origin', 'main');

    const fetch = await json(await request('POST', '/api/repo/fetch', {}));
    await waitForJob(fetch.job.id);
    const pull = await json(await request('POST', '/api/repo/pull', { strategy: 'ff-only' }));
    await waitForJob(pull.job.id);
    expect(readFile(repoPath, 'file.txt')).toBe('from remote\n');
  });
});

describe('branches, tags, stashes and rebase', () => {
  it('renames, checks out, tags and stashes', async () => {
    await json(await request('POST', '/api/repo/branch', { name: 'work' }));
    await json(await request('POST', '/api/repo/branch/rename', { from: 'work', to: 'renamed' }));
    await json(await request('POST', '/api/repo/checkout', { ref: 'renamed' }));
    expect(git(repoPath, 'branch', '--show-current')).toBe('renamed');

    await json(
      await request('POST', '/api/repo/tag', { name: 'v1', message: 'Version one' }),
    );
    expect((await json(await request('GET', '/api/repo/tags'))).map((tag: any) => tag.name)).toContain(
      'v1',
    );

    writeFile(repoPath, 'file.txt', 'stashed\n');
    await json(
      await request('POST', '/api/repo/stash', { message: 'work in progress', includeUntracked: true }),
    );
    expect(readFile(repoPath, 'file.txt')).toBe('base\n');
    const stashes = await json(await request('GET', '/api/repo/stashes'));
    expect(stashes).toHaveLength(1);

    await json(await request('POST', '/api/repo/stash/pop', { ref: stashes[0].ref }));
    expect(readFile(repoPath, 'file.txt')).toBe('stashed\n');
  });

  it('rebases a branch onto main', async () => {
    git(repoPath, 'checkout', '-q', '-b', 'topic');
    writeFile(repoPath, 'topic.txt', 'topic\n');
    commitAll(repoPath, 'Topic change');
    git(repoPath, 'checkout', '-q', 'main');
    writeFile(repoPath, 'main.txt', 'main\n');
    commitAll(repoPath, 'Main change');
    git(repoPath, 'checkout', '-q', 'topic');

    const rebase = await json(await request('POST', '/api/repo/rebase', { onto: 'main' }));
    expect(rebase.conflicted).toBe(false);
    expect(() => git(repoPath, 'merge-base', '--is-ancestor', 'main', 'topic')).not.toThrow();
  });
});

describe('clone jobs', () => {
  it('clones a repository and opens the clone', async () => {
    const target = path.join(homeDir, `clone-${process.pid}-${Date.now()}`);
    const clone = await json(
      await request('POST', '/api/repos/clone', { url: repoPath, path: target }),
    );

    const job = await waitForJob(clone.job.id);
    expect(job.status).toBe('done');
    expect(fs.existsSync(path.join(target, '.git'))).toBe(true);
    const session = await json(await request('GET', '/api/session'));
    expect(session.repo.path).toBe(fs.realpathSync(target));
  });
});
