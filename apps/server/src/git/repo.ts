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
  ReflogEntry,
  Remote,
  RepoFileContent,
  RepoSummary,
  Stash,
  Status,
  Tag,
  Worktree,
} from '@gitastic/shared';
import { AppError } from '../errors';
import { assertRepoFile } from '../security/paths';
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

export async function listWorktrees(runner: GitRunner, repoPath: string): Promise<Worktree[]> {
  const out = await runner.run(repoPath, ['worktree', 'list', '--porcelain'], {
    allowFail: true,
  });
  if (out.exitCode !== 0) return [];
  const blocks = out.stdout.trim().split(/\n\n+/);
  const worktrees: Worktree[] = [];

  blocks.forEach((block, index) => {
    const lines = block.split('\n').map((line) => line.trim());
    let wtPath = '';
    let head = '';
    let branch: string | null = null;
    let bare = false;
    let detached = false;
    let locked = false;
    let prunable = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) wtPath = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length).trim();
      else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      } else if (line === 'bare') bare = true;
      else if (line === 'detached') detached = true;
      else if (line.startsWith('locked')) locked = true;
      else if (line.startsWith('prunable')) prunable = true;
    }

    if (wtPath) {
      worktrees.push({
        path: wtPath,
        head,
        branch,
        bare,
        detached,
        locked,
        prunable,
        isMain: index === 0,
      });
    }
  });

  return worktrees;
}

export async function listReflog(runner: GitRunner, repoPath: string): Promise<ReflogEntry[]> {
  const out = await runner.run(
    repoPath,
    ['log', '-g', '--format=%H%x00%gd%x00%gs%x00%cI', '-n', '200'],
    { allowFail: true },
  );
  return (await import('./parse')).parseReflog(out.stdout);
}

export async function checkoutReflog(
  runner: GitRunner,
  repoPath: string,
  selector: string,
): Promise<void> {
  await runner.run(repoPath, ['checkout', selector]);
}

export async function listRepoFiles(runner: GitRunner, repoPath: string): Promise<string[]> {
  const result = await runner.run(
    repoPath,
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { allowFail: true },
  );
  if (result.exitCode !== 0) {
    throw new AppError(
      400,
      'FILE_LIST_FAILED',
      result.stderr.trim() || 'Could not list repository files.',
    );
  }
  return [...new Set(result.stdout.split('\u0000').filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

const MAX_FILE_BYTES = 2_000_000;

export async function readRepoFile(repoPath: string, relative: string): Promise<RepoFileContent> {  const resolved = await assertRepoFile(repoPath, relative);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw new AppError(404, 'FILE_NOT_FOUND', `Not a file: ${relative}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    return { path: relative, content: null, binary: false, truncated: true, size: stat.size };
  }
  const buffer = await fs.readFile(resolved);
  const binary = buffer.includes(0);
  return {
    path: relative,
    content: binary ? null : buffer.toString('utf8'),
    binary,
    truncated: false,
    size: stat.size,
  };
}

export async function readFileAtRevision(
  runner: GitRunner,
  repoPath: string,
  rev: string,
  relative: string,
): Promise<RepoFileContent> {
  const result = await runner.run(repoPath, ['show', `${rev}:${relative}`], { allowFail: true });
  if (result.exitCode !== 0) {
    throw new AppError(
      404,
      'FILE_NOT_FOUND',
      result.stderr.trim() || `No "${relative}" at ${rev}`,
    );
  }
  const size = Buffer.byteLength(result.stdout);
  if (size > MAX_FILE_BYTES) {
    return { path: relative, content: null, binary: false, truncated: true, size };
  }
  const binary = result.stdout.includes('\u0000');
  return {
    path: relative,
    content: binary ? null : result.stdout,
    binary,
    truncated: false,
    size,
  };
}
