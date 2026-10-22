import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  Branch,
  CommitBase,
  CommitDetail,
  DiffFile,
  DiffResponse,
  FileStatus,
  OperationKind,
  Remote,
  RepoSummary,
  Stash,
  Status,
  Tag,
} from '@gitastic/shared';
import { COMMIT_LOG_FORMAT } from './parse';
import { parseStatusV2, combineDiffFiles } from './parse';
import type { GitRunner } from './runner';

const MAX_PATCH_BYTES = 2_000_000;

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveGitDir(repoPath: string): Promise<string> {
  const dotGit = path.join(repoPath, '.git');
  const stat = await fs.stat(dotGit).catch(() => null);
  if (!stat) return dotGit;
  if (stat.isDirectory()) return dotGit;
  const content = await fs.readFile(dotGit, 'utf8').catch(() => '');
  const match = content.match(/^gitdir:\s*(.+)$/m);
  return match ? path.resolve(repoPath, match[1].trim()) : dotGit;
}

export async function detectOperation(repoPath: string): Promise<OperationKind | null> {
  const gitDir = await resolveGitDir(repoPath);
  if (await exists(path.join(gitDir, 'MERGE_HEAD'))) return 'merge';
  if (
    (await exists(path.join(gitDir, 'rebase-merge'))) ||
    (await exists(path.join(gitDir, 'rebase-apply')))
  ) {
    return 'rebase';
  }
  if (await exists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
  if (await exists(path.join(gitDir, 'REVERT_HEAD'))) return 'revert';
  return null;
}

export async function getStatus(runner: GitRunner, repoPath: string): Promise<Status> {
  const result = await runner.run(repoPath, ['status', '--porcelain=v2', '-z', '--branch'], {
    allowFail: true,
  });
  const status = parseStatusV2(result.stdout);
  status.operation = await detectOperation(repoPath);
  return status;
}

export async function getRepoSummary(
  runner: GitRunner,
  repoPath: string,
  id: string,
): Promise<RepoSummary> {
  const status = await getStatus(runner, repoPath);
  const headResult = await runner.run(repoPath, ['rev-parse', '--verify', 'HEAD'], {
    allowFail: true,
  });
  const head = headResult.exitCode === 0 ? headResult.stdout.trim() : status.head;
  const last = await runner.run(repoPath, ['log', '-1', '--format=%h %s'], { allowFail: true });
  const files = status.files;
  return {
    id,
    name: path.basename(repoPath),
    path: repoPath,
    root: repoPath,
    head: head || null,
    branch: status.branch,
    detached: Boolean(head) && !status.branch,
    upstream: status.upstream,
    ahead: status.ahead,
    behind: status.behind,
    operation: status.operation,
    dirty: files.length,
    staged: files.filter((file) => file.staged).length,
    untracked: files.filter((file) => file.untracked).length,
    conflicts: files.filter((file) => file.conflicted).length,
    lastCommit: last.exitCode === 0 ? last.stdout.trim() || null : null,
  };
}

export async function listBranches(runner: GitRunner, repoPath: string): Promise<Branch[]> {
  const out = await runner.run(repoPath, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%00%(refname)%00%(objectname)%00%(upstream:short)%00%(HEAD)%00%(committerdate:iso-strict)%00%(subject)',
    'refs/heads',
    'refs/remotes',
  ]);
  return (await import('./parse')).parseBranches(out.stdout);
}

export async function listTags(runner: GitRunner, repoPath: string): Promise<Tag[]> {
  const out = await runner.run(repoPath, [
    'for-each-ref',
    '--sort=-creatordate',
    '--format=%(refname:short)%00%(refname)%00%(objectname)%00%(objecttype)%00%(taggername)%00%(creatordate:iso-strict)%00%(subject)',
    'refs/tags',
  ]);
  return (await import('./parse')).parseTags(out.stdout);
}

export async function listRemotes(runner: GitRunner, repoPath: string): Promise<Remote[]> {
  const out = await runner.run(repoPath, ['remote', '-v'], { allowFail: true });
  return (await import('./parse')).parseRemotes(out.stdout);
}

export async function listStashes(runner: GitRunner, repoPath: string): Promise<Stash[]> {
  const out = await runner.run(
    repoPath,
    ['stash', 'list', '--format=%gd%x00%H%x00%gs%x00%cI'],
    { allowFail: true },
  );
  return (await import('./parse')).parseStashes(out.stdout);
}

export async function getCommitBase(
  runner: GitRunner,
  repoPath: string,
  hash: string,
): Promise<CommitBase> {
  const out = await runner.run(repoPath, ['show', '-s', `--format=${COMMIT_LOG_FORMAT}`, hash]);
  const commits = (await import('./parse')).parseCommitLog(out.stdout);
  const commit = commits[0];
  if (!commit) {
    throw new Error(`Commit not found: ${hash}`);
  }
  return commit;
}

function capPatch(patch: string): { patch: string; tooLarge: boolean } {
  if (Buffer.byteLength(patch, 'utf8') <= MAX_PATCH_BYTES) {
    return { patch, tooLarge: false };
  }
  return {
    patch: `${patch.slice(0, MAX_PATCH_BYTES)}\n\n--- patch truncated by Gitastic ---\n`,
    tooLarge: true,
  };
}

function withDiffOptions(args: string[], options: string[]): string[] {
  const separator = args.indexOf('--');
  if (separator === -1) return [...args, ...options];
  return [...args.slice(0, separator), ...options, ...args.slice(separator)];
}

async function diffFiles(
  runner: GitRunner,
  repoPath: string,
  args: string[],
): Promise<DiffFile[]> {
  const numstat = await runner.run(repoPath, withDiffOptions(args, ['--numstat', '-z']), {
    allowFail: true,
  });
  const nameStatus = await runner.run(repoPath, withDiffOptions(args, ['--name-status', '-z']), {
    allowFail: true,
  });
  return combineDiffFiles(numstat.stdout, nameStatus.stdout);
}

export async function getCommitDetail(
  runner: GitRunner,
  repoPath: string,
  hash: string,
  context: number,
): Promise<CommitDetail> {
  const commit = await getCommitBase(runner, repoPath, hash);
  const isMerge = commit.parents.length > 1;
  const firstParent = commit.parents[0];
  const diffArgs =
    isMerge && firstParent
      ? ['diff', `--unified=${context}`, firstParent, hash]
      : ['show', '--format=', `--unified=${context}`, hash];

  const patchResult = await runner.run(
    repoPath,
    diffArgs.concat(['--no-color', '--no-ext-diff']),
    { allowFail: true },
  );
  const files = await diffFiles(runner, repoPath, diffArgs);
  const { patch, tooLarge } = capPatch(patchResult.stdout);
  return {
    commit,
    files,
    patch,
    binary: files.some((file) => file.binary) || patch.includes('Binary files'),
    tooLarge,
  };
}

function filesFromPatch(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current);
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const oldPath = match?.[1] ?? null;
      const newPath = match?.[2] ?? oldPath ?? '';
      current = {
        path: newPath,
        oldPath,
        status: 'modified',
        additions: 0,
        deletions: 0,
        binary: false,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('Binary files')) current.binary = true;
    else if (line.startsWith('+') && !line.startsWith('+++')) current.additions += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) current.deletions += 1;
  }
  if (current) files.push(current);
  return files;
}

export async function getDiff(
  runner: GitRunner,
  repoPath: string,
  options: { staged: boolean; path?: string; context: number; untracked?: boolean },
): Promise<DiffResponse> {
  const base = ['diff', `--unified=${options.context}`];
  if (options.staged) base.push('--cached');
  base.push('--no-color', '--no-ext-diff');
  if (options.path) base.push('--', options.path);

  let patch = '';
  let files: DiffFile[] = [];

  if (options.untracked) {
    const result = await runner.run(
      repoPath,
      ['diff', '--no-index', '--no-color', '--no-ext-diff', '/dev/null', options.path ?? ''],
      { allowFail: true },
    );
    patch = result.stdout;
    files = filesFromPatch(patch);
  } else {
    const patchResult = await runner.run(repoPath, base, { allowFail: true });
    patch = patchResult.stdout;
    files = await diffFiles(runner, repoPath, base);
    if (files.length === 0 && patch) files = filesFromPatch(patch);
  }

  const capped = capPatch(patch);
  return {
    path: options.path ?? null,
    staged: options.staged,
    patch: capped.patch,
    files,
    binary: files.some((file) => file.binary) || patch.includes('Binary files'),
    tooLarge: capped.tooLarge,
  };
}

export function applyOperation(status: Status, operation: OperationKind | null): Status {
  return { ...status, operation };
}

export async function changedFiles(runner: GitRunner, repoPath: string): Promise<FileStatus[]> {
  return (await getStatus(runner, repoPath)).files;
}
