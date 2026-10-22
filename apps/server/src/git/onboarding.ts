import { execa } from 'execa';
import {
  MIN_GIT_VERSION,
  type OnboardingCheck,
  type OnboardingReport,
} from '@gitastic/shared';
import { homeDir } from '../config';
import type { GitRunner } from './runner';

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function gitConfigValue(runner: GitRunner, key: string): Promise<string | null> {
  const result = await runner.run(homeDir, ['config', '--get', key], { allowFail: true });
  const value = result.stdout.trim();
  return result.exitCode === 0 && value ? value : null;
}

async function sshAgentStatus(): Promise<{ ok: boolean; detail: string }> {
  try {
    const result = await execa('ssh-add', ['-l'], { reject: false });
    if (result.exitCode === 0 && result.stdout.trim()) {
      const count = result.stdout.trim().split('\n').length;
      return { ok: true, detail: `${count} key${count === 1 ? '' : 's'} loaded in ssh-agent` };
    }
    return { ok: false, detail: 'No keys loaded in ssh-agent' };
  } catch {
    return { ok: false, detail: 'ssh-add is not available on this system' };
  }
}

export async function getOnboardingReport(runner: GitRunner): Promise<OnboardingReport> {
  const checks: OnboardingCheck[] = [];
  const gitVersion = await runner.version();

  if (!gitVersion) {
    checks.push({
      id: 'git',
      label: 'Git',
      status: 'error',
      detail: 'Git was not found',
      hint: 'Install Git and make sure `git --version` works in your terminal.',
    });
  } else if (compareVersions(gitVersion, MIN_GIT_VERSION) < 0) {
    checks.push({
      id: 'git',
      label: 'Git',
      status: 'error',
      detail: `Git ${gitVersion} is too old`,
      hint: `Gitastic requires Git ${MIN_GIT_VERSION} or newer.`,
    });
  } else {
    checks.push({
      id: 'git',
      label: 'Git',
      status: 'ok',
      detail: gitVersion,
      hint: null,
    });
  }

  const userName = await gitConfigValue(runner, 'user.name');
  const userEmail = await gitConfigValue(runner, 'user.email');
  checks.push({
    id: 'identity',
    label: 'Commit identity',
    status: userName && userEmail ? 'ok' : 'error',
    detail: userName && userEmail ? `${userName} <${userEmail}>` : 'user.name or user.email is missing',
    hint:
      userName && userEmail
        ? null
        : 'Set `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`.',
  });

  const credentialHelper = await gitConfigValue(runner, 'credential.helper');
  checks.push({
    id: 'credential',
    label: 'Git credential helper',
    status: credentialHelper ? 'ok' : 'warn',
    detail: credentialHelper ?? 'No credential helper configured',
    hint: credentialHelper
      ? null
      : 'HTTPS remotes may still use the operating system credential manager. Sign in once in your terminal if a push fails.',
  });

  const lfs = await runner.run(homeDir, ['lfs', 'version'], { allowFail: true });
  checks.push({
    id: 'lfs',
    label: 'Git LFS',
    status: lfs.exitCode === 0 ? 'ok' : 'warn',
    detail: lfs.exitCode === 0 ? lfs.stdout.trim().split('\n')[0] : 'git-lfs is not installed',
    hint: lfs.exitCode === 0 ? null : 'LFS repositories need `git lfs` installed. You can install it later.',
  });

  const ssh = await sshAgentStatus();
  checks.push({
    id: 'ssh',
    label: 'SSH agent',
    status: ssh.ok ? 'ok' : 'warn',
    detail: ssh.detail,
    hint: ssh.ok
      ? null
      : 'Only needed for SSH remotes. Add a key with `ssh-add ~/.ssh/id_ed25519`.',
  });

  return {
    home: homeDir,
    gitVersion,
    minGitVersion: MIN_GIT_VERSION,
    checks,
  };
}
