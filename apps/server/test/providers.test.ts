import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approvePullRequest,
  createPullRequestComment,
  disconnectProviderAccount,
  getPullRequestDetail,
} from '../src/git/providers';
import type { GitRunner } from '../src/git/runner';

vi.mock('execa', () => ({ execa: vi.fn() }));

const execaMock = vi.mocked(execa);

function fakeRunner(remoteUrl = 'git@github.com:octocat/hello-world.git'): GitRunner {
  const run: GitRunner['run'] = async (_cwd, args) => ({
    stdout:
      args[0] === 'config'
        ? 'store\n'
        : args[0] === 'remote' && args[1] === '-v'
          ? `origin\t${remoteUrl} (fetch)\norigin\t${remoteUrl} (push)\n`
          : '',
    stderr: '',
    exitCode: 0,
  });
  return { gitPath: 'git', run, version: async () => null };
}

function githubResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data === undefined ? '' : JSON.stringify(data)),
  } as Response;
}

function githubExecaMock() {
  execaMock.mockImplementation((async (file: string | URL, args?: readonly string[]) => {
    if (file === 'gh' && args?.[0] === '--version') {
      return { stdout: 'gh version 2.0.0\n', stderr: '', exitCode: 0 };
    }
    if (file === 'gh' && args?.[0] === 'auth' && args[1] === 'token') {
      return { stdout: 'ghp_test\n', stderr: '', exitCode: 0 };
    }
    if (file === 'gh' && args?.[0] === 'api' && args.includes('user')) {
      return { stdout: 'octocat\n', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }) as never);
}

describe('disconnectProviderAccount', () => {
  beforeEach(() => {
    execaMock.mockReset();
    execaMock.mockImplementation((async (file: string | URL, args?: readonly string[]) => {
      if (file === 'git' && args?.[0] === 'credential' && args[1] === 'fill') {
        return { stdout: 'username=dirk\npassword=secret\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }) as never);
  });

  it('logs out GitHub CLI and erases the credential for the stored user', async () => {
    await disconnectProviderAccount(fakeRunner(), { provider: 'github', host: 'github.com' });

    const calls = execaMock.mock.calls as unknown as Array<[string, string[], { input?: string }]>;
    const logout = calls.find(
      ([file, args]) => file === 'gh' && args[0] === 'auth' && args[1] === 'logout',
    );
    const reject = calls.find(
      ([file, args]) => file === 'git' && args[0] === 'credential' && args[1] === 'reject',
    );

    expect(logout?.[1]).toEqual(['auth', 'logout', '--hostname', 'github.com']);
    expect(reject?.[2].input).toBe('protocol=https\nhost=github.com\nusername=dirk\n\n');
  });
});

describe('pull request reviews', () => {
  beforeEach(() => {
    execaMock.mockReset();
    githubExecaMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads pull request files, comments and reviews', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/repos/octocat/hello-world/pulls/7')) {
          return githubResponse({
            id: 7,
            number: 7,
            title: 'Review workspace',
            body: 'Adds review support.',
            state: 'open',
            draft: false,
            user: { login: 'alice' },
            head: { ref: 'feature/review', sha: 'headsha' },
            base: { ref: 'main', sha: 'basesha' },
            additions: 3,
            deletions: 1,
            changed_files: 1,
            mergeable: true,
            html_url: 'https://github.com/octocat/hello-world/pull/7',
          });
        }
        if (url.endsWith('/repos/octocat/hello-world/pulls/7/files?per_page=100')) {
          return githubResponse([
            {
              filename: 'src/review.ts',
              status: 'modified',
              additions: 3,
              deletions: 1,
              patch: '@@ -1,2 +1,3 @@\n-old\n+new\n+extra',
            },
          ]);
        }
        if (url.endsWith('/repos/octocat/hello-world/pulls/7/comments?per_page=100')) {
          return githubResponse([
            {
              id: 11,
              user: { login: 'bob' },
              body: 'Please move this.',
              path: 'src/review.ts',
              line: 2,
              side: 'RIGHT',
              created_at: '2026-10-26T10:00:00Z',
              html_url: 'https://github.com/octocat/hello-world/pull/7#discussion_r11',
            },
          ]);
        }
        if (url.endsWith('/repos/octocat/hello-world/issues/7/comments?per_page=100')) {
          return githubResponse([
            {
              id: 31,
              user: { login: 'carol' },
              body: 'General note.',
              created_at: '2026-10-26T10:03:00Z',
              html_url: 'https://github.com/octocat/hello-world/pull/7#issuecomment-31',
            },
          ]);
        }
        if (url.endsWith('/repos/octocat/hello-world/pulls/7/reviews?per_page=100')) {
          return githubResponse([
            {
              id: 21,
              user: { login: 'octocat' },
              state: 'APPROVED',
              body: 'Looks good',
              submitted_at: '2026-10-26T10:05:00Z',
              html_url: 'https://github.com/octocat/hello-world/pull/7#pullrequestreview-21',
            },
          ]);
        }
        if (url.endsWith('/user')) return githubResponse({ login: 'octocat' });
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const detail = await getPullRequestDetail(fakeRunner(), '/repo', 7);

    expect(detail.pull).toMatchObject({
      number: 7,
      title: 'Review workspace',
      sourceBranch: 'feature/review',
      targetBranch: 'main',
      headSha: 'headsha',
      viewer: 'octocat',
      approvedByViewer: true,
      reviewDecision: 'APPROVED',
    });
    expect(detail.files).toEqual([
      expect.objectContaining({
        path: 'src/review.ts',
        status: 'modified',
        additions: 3,
        deletions: 1,
      }),
    ]);
    expect(detail.comments).toEqual([
      expect.objectContaining({
        id: '11',
        author: 'bob',
        path: 'src/review.ts',
        line: 2,
        side: 'RIGHT',
      }),
      expect.objectContaining({
        id: '31',
        author: 'carol',
        body: 'General note.',
        path: null,
        line: null,
      }),
    ]);
    expect(detail.reviews[0]).toMatchObject({ author: 'octocat', state: 'APPROVED' });
  });

  it('posts inline comments and approvals to GitHub', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        calls.push({ url, method: init?.method ?? 'GET', body });
        return githubResponse({ id: 1 }, 201);
      }),
    );

    await createPullRequestComment(fakeRunner(), '/repo', 7, {
      body: 'Inline thought',
      path: 'src/review.ts',
      line: 4,
      side: 'RIGHT',
      commitId: 'headsha',
    });
    await approvePullRequest(fakeRunner(), '/repo', 7, 'Ship it');

    expect(calls[0]).toMatchObject({
      url: 'https://api.github.com/repos/octocat/hello-world/pulls/7/comments',
      method: 'POST',
      body: {
        body: 'Inline thought',
        commit_id: 'headsha',
        path: 'src/review.ts',
        line: 4,
        side: 'RIGHT',
      },
    });
    expect(calls[1]).toMatchObject({
      url: 'https://api.github.com/repos/octocat/hello-world/pulls/7/reviews',
      method: 'POST',
      body: { event: 'APPROVE', body: 'Ship it' },
    });
  });

  it('requires both path and line for an inline comment', async () => {
    await expect(
      createPullRequestComment(fakeRunner(), '/repo', 7, {
        body: 'Missing position',
        path: 'src/review.ts',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_COMMENT_POSITION' });
  });
});
