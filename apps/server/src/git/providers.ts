import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import type {
  CreatePullRequest,
  GitIdentity,
  ProviderAccountStatus,
  ProviderKind,
  ProviderRepo,
  ProvidersStatusResponse,
  PullRequestComment,
  PullRequestCommentCreate,
  PullRequestDetail,
  PullRequestDetailResponse,
  PullRequestFile,
  PullRequestFileStatus,
  PullRequestReview,
  PullRequestsResponse,
  Remote,
  RemoteProviderInfo,
  SshKeyEntry,
} from '@gitastic/shared';
import { homeDir } from '../config';
import { AppError } from '../errors';
import { listRemotes } from './repo';
import type { GitRunner } from './runner';
import { checkout } from './write';

function detectProviderKind(host: string, fullName: string): ProviderKind {
  const lower = host.toLowerCase();
  if (lower.includes('github')) return 'github';
  if (lower.includes('gitlab')) return 'gitlab';
  if (fullName.split('/').length > 2) return 'gitlab';
  return 'gitlab';
}

export function parseRemoteUrl(remoteName: string, remoteUrl: string): RemoteProviderInfo | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  let host = '';
  let rawPath = '';

  const scpMatch = trimmed.match(/^(?:[^@/\s]+@)?([a-zA-Z0-9.-]+):(.+)$/);
  if (scpMatch && !trimmed.includes('://')) {
    host = scpMatch[1] ?? '';
    rawPath = scpMatch[2] ?? '';
  } else {
    try {
      const parsed = new URL(trimmed);
      if (!['http:', 'https:', 'ssh:', 'git:'].includes(parsed.protocol)) {
        return null;
      }
      host = parsed.hostname;
      rawPath = parsed.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  const cleanedPath = rawPath.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const segments = cleanedPath.split('/').filter(Boolean);
  if (!host || segments.length < 2) return null;

  const repo = segments[segments.length - 1]!;
  const owner = segments.slice(0, -1).join('/');
  const fullName = `${owner}/${repo}`;
  const provider = detectProviderKind(host, fullName);
  const webUrl = `https://${host}/${fullName}`;

  if (provider === 'github') {
    return {
      remoteName,
      provider,
      host,
      owner,
      repo,
      fullName,
      webUrl,
      pullsUrl: `${webUrl}/pulls`,
      issuesUrl: `${webUrl}/issues`,
      branchUrlTemplate: `${webUrl}/tree/{branch}`,
      commitUrlTemplate: `${webUrl}/commit/{hash}`,
      createPullUrlTemplate: `${webUrl}/compare/{branch}?expand=1`,
    };
  }

  return {
    remoteName,
    provider,
    host,
    owner,
    repo,
    fullName,
    webUrl,
    pullsUrl: `${webUrl}/-/merge_requests`,
    issuesUrl: `${webUrl}/-/issues`,
    branchUrlTemplate: `${webUrl}/-/tree/{branch}`,
    commitUrlTemplate: `${webUrl}/-/commit/{hash}`,
    createPullUrlTemplate: `${webUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D={branch}`,
  };
}

export function selectPrimaryRemoteInfo(remotes: Remote[]): RemoteProviderInfo | null {
  const ordered = [...remotes].sort((a, b) => {
    if (a.name === 'origin') return -1;
    if (b.name === 'origin') return 1;
    return a.name.localeCompare(b.name);
  });
  for (const remote of ordered) {
    const info = parseRemoteUrl(remote.name, remote.url);
    if (info) return info;
  }
  return null;
}

async function hasCommand(binary: string): Promise<boolean> {
  const result = await execa(binary, ['--version'], { reject: false, timeout: 3000 });
  return result.exitCode === 0;
}

async function readGitCredential(
  runner: GitRunner,
  host: string,
): Promise<{ username: string; password: string } | null> {
  const helper = await runner.run(homeDir, ['config', '--get', 'credential.helper'], {
    allowFail: true,
  });
  if (helper.exitCode !== 0 || !helper.stdout.trim()) {
    return null;
  }

  try {
    const result = await execa(runner.gitPath, ['credential', 'fill'], {
      cwd: homeDir,
      input: `protocol=https\nhost=${host}\n\n`,
      reject: false,
      timeout: 2500,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    if (result.exitCode !== 0) return null;
    let username = '';
    let password = '';
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('username=')) username = line.slice('username='.length).trim();
      if (line.startsWith('password=')) password = line.slice('password='.length).trim();
    }
    return password ? { username, password } : null;
  } catch {
    return null;
  }
}

async function storeGitCredential(
  runner: GitRunner,
  host: string,
  username: string,
  token: string,
): Promise<void> {
  await execa(runner.gitPath, ['credential', 'approve'], {
    cwd: homeDir,
    input: `protocol=https\nhost=${host}\nusername=${username}\npassword=${token}\n\n`,
    reject: false,
    timeout: 4000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

async function eraseGitCredential(runner: GitRunner, host: string): Promise<void> {
  const credential = await readGitCredential(runner, host);
  const username = credential?.username ? `username=${credential.username}\n` : '';
  await execa(runner.gitPath, ['credential', 'reject'], {
    cwd: homeDir,
    input: `protocol=https\nhost=${host}\n${username}\n`,
    reject: false,
    timeout: 4000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

async function getGithubToken(
  runner: GitRunner,
  host = 'github.com',
): Promise<{ token: string; method: 'gh-cli' | 'git-credential'; username: string | null } | null> {
  if (await hasCommand('gh')) {
    const tokenRes = await execa('gh', ['auth', 'token', '--hostname', host], {
      reject: false,
      timeout: 3500,
    });
    const token = tokenRes.stdout.trim();
    if (tokenRes.exitCode === 0 && token) {
      const userRes = await execa('gh', ['api', '--hostname', host, 'user', '--jq', '.login'], {
        reject: false,
        timeout: 4000,
      });
      const username = userRes.exitCode === 0 ? userRes.stdout.trim() || null : null;
      return { token, method: 'gh-cli', username };
    }
  }

  const cred = await readGitCredential(runner, host);
  if (cred?.password) {
    return {
      token: cred.password,
      method: 'git-credential',
      username: cred.username || null,
    };
  }

  return null;
}

async function getGitlabToken(
  runner: GitRunner,
  host = 'gitlab.com',
): Promise<{
  token: string;
  method: 'glab-cli' | 'git-credential';
  username: string | null;
} | null> {
  const cred = await readGitCredential(runner, host);
  if (cred?.password) {
    return {
      token: cred.password,
      method: 'git-credential',
      username: cred.username || null,
    };
  }

  if (await hasCommand('glab')) {
    const status = await execa('glab', ['auth', 'status', '--hostname', host], {
      reject: false,
      timeout: 3500,
    });
    const combined = `${status.stdout}\n${status.stderr}`;
    if (status.exitCode === 0) {
      const userMatch = combined.match(/Logged in to [^\s]+ as ([^\s(]+)/i);
      return {
        token: '',
        method: 'glab-cli',
        username: userMatch?.[1] ?? null,
      };
    }
  }

  return null;
}

function githubApiBase(host: string): string {
  return host.toLowerCase() === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

function gitlabApiBase(host: string): string {
  return `https://${host}/api/v4`;
}

type ProviderRequestInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

async function readProviderError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    return text.slice(0, 300);
  }
  return text.slice(0, 300);
}

async function fetchGithubJson<T>(
  host: string,
  endpoint: string,
  token?: string | null,
  init: ProviderRequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Gitastic-Local-Client',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${githubApiBase(host)}${endpoint}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = await readProviderError(response);
    throw new AppError(
      response.status === 401 || response.status === 403 ? 401 : 422,
      'PROVIDER_API_FAILED',
      `GitHub API request failed (${response.status})${detail ? `: ${detail}` : ''}`,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function fetchGitlabJson<T>(
  host: string,
  endpoint: string,
  token?: string | null,
  init: ProviderRequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Gitastic-Local-Client',
  };
  if (token) headers['PRIVATE-TOKEN'] = token;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${gitlabApiBase(host)}${endpoint}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = await readProviderError(response);
    throw new AppError(
      response.status === 401 || response.status === 403 ? 401 : 422,
      'PROVIDER_API_FAILED',
      `GitLab API request failed (${response.status})${detail ? `: ${detail}` : ''}`,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function listSshKeys(): Promise<SshKeyEntry[]> {
  const sshDir = path.join(homeDir, '.ssh');
  let entries: string[] = [];
  try {
    entries = await fs.readdir(sshDir);
  } catch {
    return [];
  }

  let loadedOutput = '';
  try {
    const loaded = await execa('ssh-add', ['-L'], { reject: false, timeout: 2500 });
    if (loaded.exitCode === 0) loadedOutput = loaded.stdout;
  } catch {
    loadedOutput = '';
  }

  const pubFiles = entries.filter((name) => name.endsWith('.pub')).sort();
  const keys: SshKeyEntry[] = [];

  for (const pubName of pubFiles) {
    const baseName = pubName.slice(0, -4);
    const privatePath = path.join(sshDir, baseName);
    const publicPath = path.join(sshDir, pubName);
    let publicKey: string | null = null;
    try {
      publicKey = (await fs.readFile(publicPath, 'utf8')).trim();
    } catch {
      publicKey = null;
    }
    const keyBody = publicKey?.split(/\s+/)[1] ?? '';
    const isLoaded = Boolean(keyBody && loadedOutput.includes(keyBody));
    keys.push({
      name: baseName,
      path: privatePath,
      publicPath,
      publicKey,
      loaded: isLoaded,
    });
  }

  return keys;
}

export async function addSshKeyToAgent(
  keyPath: string,
  passphrase?: string,
): Promise<{ ok: boolean; detail: string }> {
  const sshDir = path.resolve(homeDir, '.ssh');
  const resolved = path.resolve(keyPath);
  if (!resolved.startsWith(`${sshDir}${path.sep}`)) {
    throw new AppError(400, 'INVALID_SSH_KEY_PATH', 'SSH key must be inside ~/.ssh');
  }

  if (!passphrase) {
    const noPromptEnv = {
      ...process.env,
      SSH_ASKPASS: '/usr/bin/false',
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: ':0',
    };
    const fromKeychain = await execa('ssh-add', ['--apple-load-keychain', resolved], {
      reject: false,
      timeout: 4000,
      env: noPromptEnv,
    });
    if (fromKeychain.exitCode === 0) {
      return { ok: true, detail: `Loaded ${path.basename(resolved)} from macOS Keychain` };
    }

    const unencrypted = await execa('ssh-add', ['--apple-use-keychain', resolved], {
      reject: false,
      timeout: 4000,
      env: noPromptEnv,
    });
    if (unencrypted.exitCode === 0) {
      return { ok: true, detail: `Added ${path.basename(resolved)} to ssh-agent` };
    }

    throw new AppError(
      422,
      'SSH_PASSPHRASE_REQUIRED',
      `Passphrase required for ${path.basename(resolved)}`,
    );
  }

  const askpassFile = path.join(os.tmpdir(), `gitastic-askpass-${process.pid}-${Date.now()}.sh`);
  await fs.writeFile(askpassFile, '#!/bin/sh\nprintf "%s\\n" "$GITASTIC_SSH_PASS"\n', {
    mode: 0o700,
  });

  try {
    const unlockEnv = {
      ...process.env,
      SSH_ASKPASS: askpassFile,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: ':0',
      GITASTIC_SSH_PASS: passphrase,
    };

    const apple = await execa('ssh-add', ['--apple-use-keychain', resolved], {
      reject: false,
      timeout: 6000,
      env: unlockEnv,
    });
    if (apple.exitCode === 0) {
      return { ok: true, detail: `Unlocked ${path.basename(resolved)} and saved to Keychain` };
    }

    const fallback = await execa('ssh-add', [resolved], {
      reject: false,
      timeout: 6000,
      env: unlockEnv,
    });
    if (fallback.exitCode === 0) {
      return { ok: true, detail: `Unlocked ${path.basename(resolved)} in ssh-agent` };
    }

    throw new AppError(422, 'SSH_ADD_FAILED', 'Invalid passphrase or could not unlock SSH key.');
  } finally {
    await fs.rm(askpassFile, { force: true }).catch(() => undefined);
  }
}

export async function generateSshKey(label?: string): Promise<SshKeyEntry> {
  const sshDir = path.join(homeDir, '.ssh');
  await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });

  const defaultPath = path.join(sshDir, 'id_ed25519');
  let targetPath = defaultPath;
  try {
    await fs.access(defaultPath);
    targetPath = path.join(sshDir, 'id_ed25519_gitastic');
  } catch {
    targetPath = defaultPath;
  }

  try {
    await fs.access(targetPath);
  } catch {
    const comment = label?.trim() || 'gitastic@local';
    const gen = await execa(
      'ssh-keygen',
      ['-t', 'ed25519', '-C', comment, '-f', targetPath, '-N', ''],
      { reject: false, timeout: 6000 },
    );
    if (gen.exitCode !== 0) {
      throw new AppError(422, 'SSH_KEYGEN_FAILED', gen.stderr.trim() || 'ssh-keygen failed');
    }
  }

  await addSshKeyToAgent(targetPath).catch(() => undefined);
  const keys = await listSshKeys();
  const created = keys.find((entry) => entry.path === targetPath);
  if (!created) {
    throw new AppError(500, 'SSH_KEY_NOT_FOUND', 'Generated SSH key could not be read');
  }
  return created;
}

export async function removeSshKey(
  keyPath: string,
  deleteFiles = false,
): Promise<{ ok: boolean; detail: string }> {
  const sshDir = path.resolve(homeDir, '.ssh');
  const resolved = path.resolve(keyPath);
  const base = path.basename(resolved);
  if (
    !resolved.startsWith(`${sshDir}${path.sep}`) ||
    ['config', 'known_hosts', 'authorized_keys'].includes(base)
  ) {
    throw new AppError(400, 'INVALID_SSH_KEY_PATH', 'Invalid SSH key path');
  }

  const pubPath = `${resolved}.pub`;
  await execa('ssh-add', ['-d', pubPath], { reject: false, timeout: 4000 });
  await execa('ssh-add', ['-d', resolved], { reject: false, timeout: 4000 });

  if (deleteFiles) {
    await fs.rm(resolved, { force: true }).catch(() => undefined);
    await fs.rm(pubPath, { force: true }).catch(() => undefined);
    return { ok: true, detail: `Deleted ${base} from ~/.ssh and unloaded from ssh-agent` };
  }

  return { ok: true, detail: `Unloaded ${base} from ssh-agent` };
}

export async function getGitIdentity(runner: GitRunner): Promise<GitIdentity> {
  const [nameRes, emailRes] = await Promise.all([
    runner.run(homeDir, ['config', '--get', 'user.name'], {
      allowFail: true,
      env: { HOME: homeDir },
    }),
    runner.run(homeDir, ['config', '--get', 'user.email'], {
      allowFail: true,
      env: { HOME: homeDir },
    }),
  ]);
  return {
    name: nameRes.exitCode === 0 ? nameRes.stdout.trim() : '',
    email: emailRes.exitCode === 0 ? emailRes.stdout.trim() : '',
  };
}

export async function setGitIdentity(
  runner: GitRunner,
  identity: GitIdentity,
): Promise<GitIdentity> {
  const name = identity.name.trim();
  const email = identity.email.trim();
  if (!name || !email) {
    throw new AppError(400, 'INVALID_IDENTITY', 'Both user.name and user.email are required.');
  }
  await runner.run(homeDir, ['config', '--global', 'user.name', name], {
    env: { HOME: homeDir },
  });
  await runner.run(homeDir, ['config', '--global', 'user.email', email], {
    env: { HOME: homeDir },
  });
  return { name, email };
}

export async function getProvidersStatus(
  runner: GitRunner,
  extraHosts: Array<{ provider: ProviderKind; host: string }> = [],
): Promise<ProvidersStatusResponse> {
  const [ghInstalled, glabInstalled, sshKeys, helperRes] = await Promise.all([
    hasCommand('gh'),
    hasCommand('glab'),
    listSshKeys(),
    runner.run(homeDir, ['config', '--get', 'credential.helper'], { allowFail: true }),
  ]);

  const credentialHelper =
    helperRes.exitCode === 0 && helperRes.stdout.trim() ? helperRes.stdout.trim() : null;

  const targets: Array<{ provider: ProviderKind; host: string }> = [
    { provider: 'github', host: 'github.com' },
    { provider: 'gitlab', host: 'gitlab.com' },
  ];
  for (const extra of extraHosts) {
    if (
      !targets.some(
        (item) =>
          item.provider === extra.provider && item.host.toLowerCase() === extra.host.toLowerCase(),
      )
    ) {
      targets.push(extra);
    }
  }

  const accounts: ProviderAccountStatus[] = [];

  for (const target of targets) {
    if (target.provider === 'github') {
      const auth = await getGithubToken(runner, target.host);
      if (auth) {
        let username = auth.username;
        if (!username) {
          try {
            const user = await fetchGithubJson<{ login: string }>(target.host, '/user', auth.token);
            username = user.login;
          } catch {
            username = null;
          }
        }
        accounts.push({
          provider: 'github',
          host: target.host,
          connected: true,
          username,
          method: auth.method,
          cliInstalled: ghInstalled,
          detail: username
            ? `Connected as @${username} (${auth.method === 'gh-cli' ? 'GitHub CLI' : 'Git Credential Helper'})`
            : `Connected via ${auth.method}`,
        });
      } else {
        accounts.push({
          provider: 'github',
          host: target.host,
          connected: false,
          username: null,
          method: 'none',
          cliInstalled: ghInstalled,
          detail: ghInstalled
            ? 'Not signed in. Connect with a token or `gh auth login`.'
            : 'Connect with a Personal Access Token (stored in system credential manager).',
        });
      }
    } else {
      const auth = await getGitlabToken(runner, target.host);
      if (auth) {
        let username = auth.username;
        if (!username && auth.token) {
          try {
            const user = await fetchGitlabJson<{ username: string }>(
              target.host,
              '/user',
              auth.token,
            );
            username = user.username;
          } catch {
            username = null;
          }
        }
        accounts.push({
          provider: 'gitlab',
          host: target.host,
          connected: true,
          username,
          method: auth.method,
          cliInstalled: glabInstalled,
          detail: username
            ? `Connected as @${username} (${auth.method === 'glab-cli' ? 'GitLab CLI' : 'Git Credential Helper'})`
            : `Connected via ${auth.method}`,
        });
      } else {
        accounts.push({
          provider: 'gitlab',
          host: target.host,
          connected: false,
          username: null,
          method: 'none',
          cliInstalled: glabInstalled,
          detail:
            'Connect with a Personal Access Token (`read_api`, `read_repository`, `write_repository`).',
        });
      }
    }
  }

  return {
    accounts,
    sshKeys,
    credentialHelper,
  };
}

export async function connectProviderAccount(
  runner: GitRunner,
  options: { provider: ProviderKind; host?: string; username?: string; token: string },
): Promise<ProviderAccountStatus> {
  const host = (
    options.host?.trim() || (options.provider === 'github' ? 'github.com' : 'gitlab.com')
  )
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const token = options.token.trim();

  if (options.provider === 'github') {
    const user = await fetchGithubJson<{ login: string }>(host, '/user', token);
    const username = options.username?.trim() || user.login || 'git';
    await storeGitCredential(runner, host, username, token);
    if (await hasCommand('gh')) {
      await execa('gh', ['auth', 'login', '--hostname', host, '--with-token'], {
        input: `${token}\n`,
        reject: false,
        timeout: 5000,
      });
      await execa('gh', ['auth', 'setup-git', '--hostname', host], {
        reject: false,
        timeout: 4000,
      });
    }
    return {
      provider: 'github',
      host,
      connected: true,
      username: user.login,
      method: (await hasCommand('gh')) ? 'gh-cli' : 'git-credential',
      cliInstalled: await hasCommand('gh'),
      detail: `Connected as @${user.login}`,
    };
  }

  const user = await fetchGitlabJson<{ username: string }>(host, '/user', token);
  const username = options.username?.trim() || user.username || 'oauth2';
  await storeGitCredential(runner, host, username, token);
  return {
    provider: 'gitlab',
    host,
    connected: true,
    username: user.username,
    method: 'git-credential',
    cliInstalled: await hasCommand('glab'),
    detail: `Connected as @${user.username}`,
  };
}

export async function disconnectProviderAccount(
  runner: GitRunner,
  options: { provider: ProviderKind; host: string },
): Promise<{ ok: boolean }> {
  const host = options.host.trim();
  await eraseGitCredential(runner, host);
  if (options.provider === 'github' && (await hasCommand('gh'))) {
    await execa('gh', ['auth', 'logout', '--hostname', host], {
      reject: false,
      timeout: 4000,
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: '1',
      },
    });
  }
  return { ok: true };
}

export async function listProviderRepos(
  runner: GitRunner,
  options: { provider: ProviderKind; host?: string; query?: string },
): Promise<ProviderRepo[]> {
  const host = (
    options.host?.trim() || (options.provider === 'github' ? 'github.com' : 'gitlab.com')
  )
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const query = options.query?.trim() ?? '';

  if (options.provider === 'github') {
    const auth = await getGithubToken(runner, host);
    if (!auth?.token) {
      throw new AppError(
        401,
        'GITHUB_NOT_CONNECTED',
        `Not connected to ${host}. Sign in via the Auth Assistant first.`,
      );
    }

    type GhRepoRaw = {
      id: number | string;
      name: string;
      full_name: string;
      description: string | null;
      private: boolean;
      default_branch: string | null;
      updated_at: string | null;
      html_url: string;
      clone_url: string;
      ssh_url: string;
    };

    const rawRepos = await fetchGithubJson<GhRepoRaw[]>(
      host,
      '/user/repos?per_page=80&sort=updated&affiliation=owner,collaborator,organization_member',
      auth.token,
    );

    const lower = query.toLowerCase();
    const filtered = lower
      ? rawRepos.filter(
          (repo) =>
            repo.full_name.toLowerCase().includes(lower) ||
            (repo.description ?? '').toLowerCase().includes(lower),
        )
      : rawRepos;

    return filtered.slice(0, 50).map((repo) => ({
      id: String(repo.id),
      provider: 'github',
      host,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description ?? null,
      private: Boolean(repo.private),
      defaultBranch: repo.default_branch ?? null,
      updatedAt: repo.updated_at ?? null,
      webUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      sshUrl: repo.ssh_url,
    }));
  }

  const auth = await getGitlabToken(runner, host);
  if (!auth?.token) {
    throw new AppError(
      401,
      'GITLAB_NOT_CONNECTED',
      `Not connected to ${host}. Connect with a GitLab Personal Access Token first.`,
    );
  }

  type GlProjectRaw = {
    id: number | string;
    name: string;
    path_with_namespace: string;
    description: string | null;
    visibility?: string;
    default_branch: string | null;
    last_activity_at: string | null;
    web_url: string;
    http_url_to_repo: string;
    ssh_url_to_repo: string;
  };

  const searchParam = query ? `&search=${encodeURIComponent(query)}` : '';
  const projects = await fetchGitlabJson<GlProjectRaw[]>(
    host,
    `/projects?membership=true&order_by=last_activity_at&per_page=50${searchParam}`,
    auth.token,
  );

  return projects.map((project) => ({
    id: String(project.id),
    provider: 'gitlab',
    host,
    name: project.name,
    fullName: project.path_with_namespace,
    description: project.description ?? null,
    private: project.visibility !== 'public',
    defaultBranch: project.default_branch ?? null,
    updatedAt: project.last_activity_at ?? null,
    webUrl: project.web_url,
    cloneUrl: project.http_url_to_repo,
    sshUrl: project.ssh_url_to_repo,
  }));
}

export async function listRepoPullRequests(
  runner: GitRunner,
  repoPath: string,
): Promise<PullRequestsResponse> {
  const remotes = await listRemotes(runner, repoPath);
  const remote = selectPrimaryRemoteInfo(remotes);
  if (!remote) {
    return {
      remote: null,
      items: [],
      authHint: null,
    };
  }

  if (remote.provider === 'github') {
    const auth = await getGithubToken(runner, remote.host);
    type GhPullRaw = {
      id: number | string;
      number: number;
      title: string;
      state: string;
      draft?: boolean;
      user?: { login?: string };
      head?: { ref?: string };
      base?: { ref?: string };
      updated_at: string;
      html_url: string;
    };

    try {
      const pulls = await fetchGithubJson<GhPullRaw[]>(
        remote.host,
        `/repos/${remote.owner}/${remote.repo}/pulls?state=open&per_page=40`,
        auth?.token,
      );
      return {
        remote,
        items: pulls.map((pr) => ({
          id: String(pr.id),
          number: pr.number,
          provider: 'github',
          title: pr.title,
          state: 'open',
          draft: Boolean(pr.draft),
          author: pr.user?.login ?? 'unknown',
          sourceBranch: pr.head?.ref ?? `pr-${pr.number}`,
          targetBranch: pr.base?.ref ?? 'main',
          updatedAt: pr.updated_at,
          webUrl: pr.html_url,
        })),
        authHint: null,
      };
    } catch (error) {
      return {
        remote,
        items: [],
        authHint:
          error instanceof AppError && error.status === 401
            ? `Connect ${remote.host} in the Auth Assistant to load private Pull Requests.`
            : error instanceof Error
              ? error.message
              : 'Could not load Pull Requests.',
      };
    }
  }

  const auth = await getGitlabToken(runner, remote.host);
  type GlMergeRequestRaw = {
    id: number | string;
    iid: number;
    title: string;
    state: string;
    draft?: boolean;
    work_in_progress?: boolean;
    author?: { username?: string };
    source_branch: string;
    target_branch: string;
    updated_at: string;
    web_url: string;
  };

  try {
    const mrs = await fetchGitlabJson<GlMergeRequestRaw[]>(
      remote.host,
      `/projects/${encodeURIComponent(remote.fullName)}/merge_requests?state=opened&per_page=40`,
      auth?.token,
    );
    return {
      remote,
      items: mrs.map((mr) => ({
        id: String(mr.id),
        number: mr.iid,
        provider: 'gitlab',
        title: mr.title,
        state: 'open',
        draft: Boolean(mr.draft || mr.work_in_progress),
        author: mr.author?.username ?? 'unknown',
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
        updatedAt: mr.updated_at,
        webUrl: mr.web_url,
      })),
      authHint: null,
    };
  } catch (error) {
    return {
      remote,
      items: [],
      authHint:
        error instanceof AppError && error.status === 401
          ? `Connect ${remote.host} in the Auth Assistant to load Merge Requests.`
          : error instanceof Error
            ? error.message
            : 'Could not load Merge Requests.',
    };
  }
}

type ProviderRepoRef = {
  remote: RemoteProviderInfo;
  auth: { token: string } | null;
};

async function resolveProviderRepo(runner: GitRunner, repoPath: string): Promise<ProviderRepoRef> {
  const remotes = await listRemotes(runner, repoPath);
  const remote = selectPrimaryRemoteInfo(remotes);
  if (!remote) {
    throw new AppError(400, 'NO_PROVIDER_REMOTE', 'No GitHub or GitLab remote is configured.');
  }
  const auth =
    remote.provider === 'github'
      ? await getGithubToken(runner, remote.host)
      : await getGitlabToken(runner, remote.host);
  return { remote, auth: auth?.token ? { token: auth.token } : null };
}

export async function currentBranch(runner: GitRunner, repoPath: string): Promise<string> {
  const result = await runner.run(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'], {
    allowFail: true,
  });
  const branch = result.stdout.trim();
  if (result.exitCode !== 0 || !branch || branch === 'HEAD') {
    throw new AppError(400, 'DETACHED_HEAD', 'Check out a branch before opening a pull request.');
  }
  return branch;
}

export async function createPullRequest(
  runner: GitRunner,
  repoPath: string,
  input: CreatePullRequest,
): Promise<{ number: number | null; url: string }> {
  const { remote, auth } = await resolveProviderRepo(runner, repoPath);
  if (!auth?.token) {
    throw new AppError(
      401,
      'NOT_CONNECTED',
      `Connect a ${remote.provider === 'github' ? 'GitHub' : 'GitLab'} account first.`,
    );
  }
  const head = input.head ?? (await currentBranch(runner, repoPath));

  if (remote.provider === 'github') {
    const pull = await fetchGithubJson<{ number?: number; html_url?: string }>(
      remote.host,
      `/repos/${remote.fullName}/pulls`,
      auth.token,
      {
        method: 'POST',
        body: {
          title: input.title,
          body: input.body ?? '',
          head,
          base: input.base,
          draft: input.draft ?? false,
        },
      },
    );
    return { number: pull.number ?? null, url: pull.html_url ?? remote.pullsUrl };
  }

  const project = encodeURIComponent(remote.fullName);
  const mr = await fetchGitlabJson<{ iid?: number; web_url?: string }>(
    remote.host,
    `/projects/${project}/merge_requests`,
    auth.token,
    {
      method: 'POST',
      body: {
        title: input.title,
        description: input.body ?? '',
        source_branch: head,
        target_branch: input.base,
      },
    },
  );
  return { number: mr.iid ?? null, url: mr.web_url ?? remote.pullsUrl };
}

function normalizePullFileStatus(status: string): PullRequestFileStatus {
  if (
    status === 'added' ||
    status === 'modified' ||
    status === 'removed' ||
    status === 'renamed' ||
    status === 'copied' ||
    status === 'changed' ||
    status === 'unchanged'
  ) {
    return status;
  }
  return 'modified';
}

function normalizeReviewState(state: string): PullRequestReview['state'] {
  const normalized = state.toUpperCase();
  if (
    normalized === 'APPROVED' ||
    normalized === 'CHANGES_REQUESTED' ||
    normalized === 'COMMENTED' ||
    normalized === 'DISMISSED' ||
    normalized === 'PENDING'
  ) {
    return normalized;
  }
  return 'COMMENTED';
}

function reviewSignals(
  reviews: PullRequestReview[],
  viewer: string | null,
): Pick<PullRequestDetail, 'approvedByViewer' | 'reviewDecision'> {
  const effective = new Map<string, PullRequestReview['state']>();
  const ordered = [...reviews].sort((left, right) => {
    const leftTime = left.submittedAt ? Date.parse(left.submittedAt) : 0;
    const rightTime = right.submittedAt ? Date.parse(right.submittedAt) : 0;
    return leftTime - rightTime;
  });

  for (const review of ordered) {
    if (review.state === 'COMMENTED' || review.state === 'PENDING') continue;
    if (review.state === 'DISMISSED') {
      effective.delete(review.author);
      continue;
    }
    effective.set(review.author, review.state);
  }

  const states = [...effective.values()];
  return {
    approvedByViewer: Boolean(viewer && effective.get(viewer) === 'APPROVED'),
    reviewDecision: states.includes('CHANGES_REQUESTED')
      ? 'CHANGES_REQUESTED'
      : states.includes('APPROVED')
        ? 'APPROVED'
        : 'REVIEW_REQUIRED',
  };
}

function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

export async function getPullRequestDetail(
  runner: GitRunner,
  repoPath: string,
  number: number,
): Promise<PullRequestDetailResponse> {
  const { remote, auth } = await resolveProviderRepo(runner, repoPath);

  if (remote.provider === 'github') {
    const token = auth?.token;
    type GhPullDetailRaw = {
      id: number | string;
      number: number;
      title: string;
      body?: string | null;
      state: string;
      merged?: boolean;
      draft?: boolean;
      user?: { login?: string };
      head?: { ref?: string; sha?: string };
      base?: { ref?: string; sha?: string };
      additions?: number;
      deletions?: number;
      changed_files?: number;
      mergeable?: boolean | null;
      html_url: string;
    };
    type GhPullFileRaw = {
      filename: string;
      previous_filename?: string;
      status: string;
      additions?: number;
      deletions?: number;
      patch?: string;
    };
    type GhReviewCommentRaw = {
      id: number | string;
      user?: { login?: string };
      body?: string;
      path?: string;
      line?: number | null;
      original_line?: number | null;
      side?: 'LEFT' | 'RIGHT' | null;
      created_at?: string;
      html_url?: string;
    };
    type GhReviewRaw = {
      id: number | string;
      user?: { login?: string };
      state: string;
      body?: string | null;
      submitted_at?: string | null;
      html_url?: string;
    };

    const repoEndpoint = `/repos/${remote.owner}/${remote.repo}/pulls/${number}`;
    try {
      const [pull, rawFiles, rawComments, rawIssueComments, rawReviews, viewer] = await Promise.all(
        [
          fetchGithubJson<GhPullDetailRaw>(remote.host, repoEndpoint, token),
          fetchGithubJson<GhPullFileRaw[]>(
            remote.host,
            `${repoEndpoint}/files?per_page=100`,
            token,
          ),
          fetchGithubJson<GhReviewCommentRaw[]>(
            remote.host,
            `${repoEndpoint}/comments?per_page=100`,
            token,
          ),
          fetchGithubJson<GhReviewCommentRaw[]>(
            remote.host,
            `/repos/${remote.owner}/${remote.repo}/issues/${number}/comments?per_page=100`,
            token,
          ),
          fetchGithubJson<GhReviewRaw[]>(
            remote.host,
            `${repoEndpoint}/reviews?per_page=100`,
            token,
          ),
          token
            ? fetchGithubJson<{ login: string }>(remote.host, '/user', token)
                .then((user) => user.login)
                .catch(() => null)
            : Promise.resolve(null),
        ],
      );

      const comments: PullRequestComment[] = [...rawComments, ...rawIssueComments]
        .map((comment) => ({
          id: String(comment.id),
          author: comment.user?.login ?? 'unknown',
          body: comment.body ?? '',
          path: comment.path ?? null,
          line: comment.line ?? comment.original_line ?? null,
          side: comment.side ?? null,
          createdAt: comment.created_at ?? '',
          webUrl: comment.html_url ?? null,
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const reviews: PullRequestReview[] = rawReviews.map((review) => ({
        id: String(review.id),
        author: review.user?.login ?? 'unknown',
        state: normalizeReviewState(review.state),
        body: review.body ?? '',
        submittedAt: review.submitted_at ?? null,
        webUrl: review.html_url ?? null,
      }));
      const files: PullRequestFile[] = rawFiles.map((file) => ({
        path: file.filename,
        oldPath: file.previous_filename ?? null,
        status: normalizePullFileStatus(file.status),
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        patch: file.patch ?? null,
        binary: !file.patch,
      }));
      const signals = reviewSignals(reviews, viewer);

      return {
        remote,
        pull: {
          number: pull.number,
          title: pull.title,
          body: pull.body ?? '',
          state: pull.merged ? 'merged' : pull.state === 'open' ? 'open' : 'closed',
          draft: Boolean(pull.draft),
          author: pull.user?.login ?? 'unknown',
          sourceBranch: pull.head?.ref ?? `pr-${pull.number}`,
          targetBranch: pull.base?.ref ?? 'main',
          headSha: pull.head?.sha ?? '',
          baseSha: pull.base?.sha ?? '',
          startSha: pull.base?.sha ?? '',
          additions: pull.additions ?? 0,
          deletions: pull.deletions ?? 0,
          changedFiles: pull.changed_files ?? files.length,
          mergeable: pull.mergeable ?? null,
          webUrl: pull.html_url,
          viewer,
          approvedByViewer: signals.approvedByViewer,
          reviewDecision: signals.reviewDecision,
        },
        files,
        comments,
        reviews,
        authHint: null,
      };
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        throw new AppError(
          401,
          'PROVIDER_AUTH_REQUIRED',
          `Connect ${remote.host} in Settings to review this pull request.`,
        );
      }
      throw error;
    }
  }

  const token = auth?.token;
  type GlMergeRequestRaw = {
    id: number | string;
    iid: number;
    title: string;
    description?: string | null;
    state: string;
    draft?: boolean;
    work_in_progress?: boolean;
    author?: { username?: string };
    source_branch: string;
    target_branch: string;
    sha?: string;
    diff_refs?: { base_sha?: string; head_sha?: string; start_sha?: string };
    web_url: string;
    detailed_merge_status?: string;
  };
  type GlDiffRaw = {
    old_path: string;
    new_path: string;
    new_file?: boolean;
    renamed_file?: boolean;
    deleted_file?: boolean;
    diff?: string;
    too_large?: boolean;
  };
  type GlNoteRaw = {
    id: number | string;
    body?: string;
    author?: { username?: string };
    created_at?: string;
    system?: boolean;
    position?: {
      new_path?: string;
      old_path?: string;
      new_line?: number | null;
      old_line?: number | null;
    } | null;
  };
  type GlDiscussionRaw = { notes?: GlNoteRaw[] };
  type GlApprovalsRaw = {
    approved_by?: Array<{ user?: { username?: string } }>;
  };

  const project = encodeURIComponent(remote.fullName);
  const mrEndpoint = `/projects/${project}/merge_requests/${number}`;
  const viewerPromise = token
    ? fetchGitlabJson<{ username: string }>(remote.host, '/user', token)
        .then((user) => user.username)
        .catch(() => null)
    : Promise.resolve(null);

  try {
    const [mr, diffs, discussions, approvals, viewer] = await Promise.all([
      fetchGitlabJson<GlMergeRequestRaw>(remote.host, mrEndpoint, token),
      fetchGitlabJson<GlDiffRaw[]>(remote.host, `${mrEndpoint}/diffs?per_page=100`, token).catch(
        () => [],
      ),
      fetchGitlabJson<GlDiscussionRaw[]>(
        remote.host,
        `${mrEndpoint}/discussions?per_page=100`,
        token,
      ).catch(() => []),
      token
        ? fetchGitlabJson<GlApprovalsRaw>(remote.host, `${mrEndpoint}/approvals`, token).catch(
            () => null,
          )
        : Promise.resolve(null),
      viewerPromise,
    ]);

    const files: PullRequestFile[] = diffs.map((diff) => {
      const counts = countPatchLines(diff.diff ?? '');
      const status: PullRequestFileStatus = diff.new_file
        ? 'added'
        : diff.deleted_file
          ? 'removed'
          : diff.renamed_file
            ? 'renamed'
            : 'modified';
      return {
        path: diff.new_path,
        oldPath: diff.old_path !== diff.new_path ? diff.old_path : null,
        status,
        additions: counts.additions,
        deletions: counts.deletions,
        patch: diff.diff ?? null,
        binary: !diff.diff,
      };
    });

    const comments: PullRequestComment[] = discussions.flatMap((discussion) =>
      (discussion.notes ?? [])
        .filter((note) => !note.system && note.body)
        .map((note) => ({
          id: String(note.id),
          author: note.author?.username ?? 'unknown',
          body: note.body ?? '',
          path: note.position?.new_path ?? note.position?.old_path ?? null,
          line: note.position?.new_line ?? note.position?.old_line ?? null,
          side: note.position?.new_line ? 'RIGHT' : note.position?.old_line ? 'LEFT' : null,
          createdAt: note.created_at ?? '',
          webUrl: mr.web_url,
        })),
    );

    const reviews: PullRequestReview[] = (approvals?.approved_by ?? []).map((entry, index) => ({
      id: `approval-${index}-${entry.user?.username ?? 'unknown'}`,
      author: entry.user?.username ?? 'unknown',
      state: 'APPROVED',
      body: '',
      submittedAt: null,
      webUrl: mr.web_url,
    }));
    const signals = reviewSignals(reviews, viewer);
    const headSha = mr.diff_refs?.head_sha ?? mr.sha ?? '';
    const baseSha = mr.diff_refs?.base_sha ?? '';
    const additions = files.reduce((total, file) => total + file.additions, 0);
    const deletions = files.reduce((total, file) => total + file.deletions, 0);

    return {
      remote,
      pull: {
        number: mr.iid,
        title: mr.title,
        body: mr.description ?? '',
        state: mr.state === 'opened' ? 'open' : mr.state === 'merged' ? 'merged' : 'closed',
        draft: Boolean(mr.draft || mr.work_in_progress),
        author: mr.author?.username ?? 'unknown',
        sourceBranch: mr.source_branch,
        targetBranch: mr.target_branch,
        headSha,
        baseSha,
        startSha: mr.diff_refs?.start_sha ?? baseSha,
        additions,
        deletions,
        changedFiles: files.length,
        mergeable:
          mr.detailed_merge_status === 'mergeable' ? true : mr.detailed_merge_status ? false : null,
        webUrl: mr.web_url,
        viewer,
        approvedByViewer: signals.approvedByViewer,
        reviewDecision: signals.reviewDecision,
      },
      files,
      comments,
      reviews,
      authHint: null,
    };
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      throw new AppError(
        401,
        'PROVIDER_AUTH_REQUIRED',
        `Connect ${remote.host} in Settings to review this merge request.`,
      );
    }
    throw error;
  }
}

export async function createPullRequestComment(
  runner: GitRunner,
  repoPath: string,
  number: number,
  input: PullRequestCommentCreate,
): Promise<{ ok: boolean }> {
  if ((input.path && !input.line) || (!input.path && input.line)) {
    throw new AppError(
      400,
      'INVALID_COMMENT_POSITION',
      'Both path and line are required for an inline comment.',
    );
  }
  const { remote, auth } = await resolveProviderRepo(runner, repoPath);
  if (!auth?.token) {
    throw new AppError(
      401,
      'PROVIDER_AUTH_REQUIRED',
      `Connect ${remote.host} in Settings to comment.`,
    );
  }

  if (remote.provider === 'github') {
    if (input.path && input.line) {
      let commitId = input.commitId;
      if (!commitId) {
        const pull = await fetchGithubJson<{ head?: { sha?: string } }>(
          remote.host,
          `/repos/${remote.owner}/${remote.repo}/pulls/${number}`,
          auth.token,
        );
        commitId = pull.head?.sha;
      }
      if (!commitId) {
        throw new AppError(
          422,
          'PULL_COMMIT_MISSING',
          'Could not determine the pull request commit.',
        );
      }
      await fetchGithubJson<unknown>(
        remote.host,
        `/repos/${remote.owner}/${remote.repo}/pulls/${number}/comments`,
        auth.token,
        {
          method: 'POST',
          body: {
            body: input.body,
            commit_id: commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
          },
        },
      );
    } else {
      await fetchGithubJson<unknown>(
        remote.host,
        `/repos/${remote.owner}/${remote.repo}/issues/${number}/comments`,
        auth.token,
        { method: 'POST', body: { body: input.body } },
      );
    }
    return { ok: true };
  }

  const project = encodeURIComponent(remote.fullName);
  if (input.path && input.line) {
    const mr = await fetchGitlabJson<{
      diff_refs?: { base_sha?: string; head_sha?: string; start_sha?: string };
    }>(remote.host, `/projects/${project}/merge_requests/${number}`, auth.token);
    const baseSha = mr.diff_refs?.base_sha ?? '';
    const headSha = mr.diff_refs?.head_sha ?? '';
    const startSha = mr.diff_refs?.start_sha ?? baseSha;
    const side = input.side ?? 'RIGHT';
    await fetchGitlabJson<unknown>(
      remote.host,
      `/projects/${project}/merge_requests/${number}/discussions`,
      auth.token,
      {
        method: 'POST',
        body: {
          body: input.body,
          position: {
            base_sha: baseSha,
            head_sha: headSha,
            start_sha: startSha,
            position_type: 'text',
            [side === 'LEFT' ? 'old_path' : 'new_path']: input.path,
            [side === 'LEFT' ? 'old_line' : 'new_line']: input.line,
          },
        },
      },
    );
  } else {
    await fetchGitlabJson<unknown>(
      remote.host,
      `/projects/${project}/merge_requests/${number}/notes`,
      auth.token,
      { method: 'POST', body: { body: input.body } },
    );
  }
  return { ok: true };
}

export async function approvePullRequest(
  runner: GitRunner,
  repoPath: string,
  number: number,
  body?: string,
): Promise<{ ok: boolean }> {
  const { remote, auth } = await resolveProviderRepo(runner, repoPath);
  if (!auth?.token) {
    throw new AppError(
      401,
      'PROVIDER_AUTH_REQUIRED',
      `Connect ${remote.host} in Settings to approve.`,
    );
  }

  if (remote.provider === 'github') {
    await fetchGithubJson<unknown>(
      remote.host,
      `/repos/${remote.owner}/${remote.repo}/pulls/${number}/reviews`,
      auth.token,
      {
        method: 'POST',
        body: { event: 'APPROVE', ...(body?.trim() ? { body: body.trim() } : {}) },
      },
    );
  } else {
    const project = encodeURIComponent(remote.fullName);
    await fetchGitlabJson<unknown>(
      remote.host,
      `/projects/${project}/merge_requests/${number}/approve`,
      auth.token,
      { method: 'POST' },
    );
    if (body?.trim()) {
      await fetchGitlabJson<unknown>(
        remote.host,
        `/projects/${project}/merge_requests/${number}/notes`,
        auth.token,
        { method: 'POST', body: { body: body.trim() } },
      );
    }
  }
  return { ok: true };
}

export async function checkoutPullRequest(
  runner: GitRunner,
  repoPath: string,
  options: { number: number; sourceBranch: string; remote?: string },
): Promise<void> {
  const remotes = await listRemotes(runner, repoPath);
  const remoteInfo = selectPrimaryRemoteInfo(remotes);
  const remoteName = options.remote || remoteInfo?.remoteName || 'origin';

  const branchFetch = await runner.run(repoPath, ['fetch', remoteName, options.sourceBranch], {
    allowFail: true,
  });
  if (branchFetch.exitCode === 0) {
    await checkout(runner, repoPath, `${remoteName}/${options.sourceBranch}`);
    return;
  }

  const refSpec =
    remoteInfo?.provider === 'gitlab'
      ? `merge-requests/${options.number}/head`
      : `pull/${options.number}/head`;
  const localBranch =
    remoteInfo?.provider === 'gitlab' ? `mr-${options.number}` : `pr-${options.number}`;

  await runner.run(repoPath, ['fetch', remoteName, `${refSpec}:${localBranch}`]);
  await checkout(runner, repoPath, localBranch);
}
