import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { disconnectProviderAccount } from '../src/git/providers';
import type { GitRunner } from '../src/git/runner';

vi.mock('execa', () => ({ execa: vi.fn() }));

const execaMock = vi.mocked(execa);

function fakeRunner(): GitRunner {
  const run: GitRunner['run'] = async (_cwd, args) => ({
    stdout: args[0] === 'config' ? 'store\n' : '',
    stderr: '',
    exitCode: 0,
  });
  return { gitPath: 'git', run, version: async () => null };
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
