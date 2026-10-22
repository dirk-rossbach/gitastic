import path from 'node:path';
import type { OperationKind } from '@gitastic/shared';
import { AppError } from '../errors';
import { getStatus } from './repo';
import type { GitRunner, GitResult } from './runner';
import { trashPaths, type TrashResult } from './safety';

export interface ProgressOptions {
  signal?: AbortSignal;
  onProgress?: (chunk: string) => void;
}

function progressOptions(options: ProgressOptions) {
  return {
    signal: options.signal,
    onStderr: options.onProgress,
    onStdout: options.onProgress,
  };
}

export async function stage(
  runner: GitRunner,
  repoPath: string,
  paths: string[],
): Promise<GitResult> {
  return runner.run(
    repoPath,
    paths.length > 0 ? ['add', '--', ...paths] : ['add', '-A'],
  );
}

export async function unstage(
  runner: GitRunner,
  repoPath: string,
  paths: string[],
): Promise<GitResult> {
  if (paths.length > 0) {
    return runner.run(repoPath, ['restore', '--staged', '--', ...paths]);
  }
  const result = await runner.run(repoPath, ['reset'], { allowFail: true });
  if (result.exitCode === 0) return result;
  return runner.run(repoPath, ['rm', '--cached', '-r', '--ignore-unmatch', '.']);
}

export async function applyPatch(
  runner: GitRunner,
  repoPath: string,
  options: { patch: string; cached?: boolean; reverse?: boolean },
): Promise<GitResult> {
  const args = ['apply', '--unidiff-zero', '--recount', '--whitespace=nowarn'];
  if (options.cached) args.push('--cached');
  if (options.reverse) args.push('--reverse');
  const input = options.patch.endsWith('\n') ? options.patch : `${options.patch}\n`;
  return runner.run(repoPath, args, { input });
}

export async function addWorktree(
  runner: GitRunner,
  repoPath: string,
  options: { path: string; branch: string; createBranch?: boolean; startPoint?: string },
): Promise<GitResult> {
  const args = ['worktree', 'add'];
  if (options.createBranch) {
    args.push('-b', options.branch, options.path);
    if (options.startPoint) args.push(options.startPoint);
  } else {
    args.push(options.path, options.branch);
  }
  return runner.run(repoPath, args);
}

export async function removeWorktree(
  runner: GitRunner,
  repoPath: string,
  targetPath: string,
  force = false,
): Promise<GitResult> {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(targetPath);
  return runner.run(repoPath, args);
}

export async function commit(
  runner: GitRunner,
  repoPath: string,
  options: { message: string; amend?: boolean; signoff?: boolean },
): Promise<GitResult> {
  const args = ['commit', '-F', '-'];
  if (options.amend) args.push('--amend');
  if (options.signoff) args.push('--signoff');
  return runner.run(repoPath, args, { input: options.message });
}

export async function createBranch(
  runner: GitRunner,
  repoPath: string,
  name: string,
  startPoint?: string,
): Promise<GitResult> {
  const args = ['branch', name];
  if (startPoint) args.push(startPoint);
  return runner.run(repoPath, args);
}

export async function checkout(
  runner: GitRunner,
  repoPath: string,
  ref: string,
): Promise<GitResult> {
  const result = await runner.run(repoPath, ['switch', ref], { allowFail: true });
  if (result.exitCode === 0) return result;

  const remoteRef = ref.startsWith('refs/remotes/') ? ref : `refs/remotes/${ref}`;
  const remote = await runner.run(
    repoPath,
    ['rev-parse', '--verify', '--quiet', remoteRef],
    { allowFail: true },
  );
  if (remote.exitCode === 0) {
    const shortRef = ref.startsWith('refs/remotes/')
      ? ref.slice('refs/remotes/'.length)
      : ref;
    const localName = shortRef.slice(shortRef.indexOf('/') + 1);
    const existing = await runner.run(
      repoPath,
      ['rev-parse', '--verify', '--quiet', `refs/heads/${localName}`],
      { allowFail: true },
    );
    if (existing.exitCode === 0) {
      return runner.run(repoPath, ['switch', localName]);
    }
    return runner.run(repoPath, ['switch', '--track', shortRef]);
  }

  if (/^[0-9a-f]{4,40}$/i.test(ref)) {
    return runner.run(repoPath, ['switch', '--detach', ref]);
  }
  throw new AppError(422, 'CHECKOUT_FAILED', `Could not check out ${ref}`, {
    stderr: result.stderr,
  });
}

export async function deleteBranch(
  runner: GitRunner,
  repoPath: string,
  name: string,
  force = false,
): Promise<GitResult> {
  return runner.run(repoPath, ['branch', force ? '-D' : '-d', name]);
}

export async function renameBranch(
  runner: GitRunner,
  repoPath: string,
  from: string,
  to: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['branch', '-m', from, to]);
}

export async function setUpstream(
  runner: GitRunner,
  repoPath: string,
  branch: string,
  upstream: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['branch', `--set-upstream-to=${upstream}`, branch]);
}

export async function fetch(
  runner: GitRunner,
  repoPath: string,
  remote: string | undefined,
  options: ProgressOptions,
): Promise<GitResult> {
  const args = ['fetch', ...(remote ? [remote] : ['--all']), '--prune', '--progress'];
  return runner.run(repoPath, args, progressOptions(options));
}

export async function pull(
  runner: GitRunner,
  repoPath: string,
  strategy: 'ff-only' | 'merge' | 'rebase',
  options: ProgressOptions,
): Promise<GitResult> {
  const flag = strategy === 'merge' ? '--no-rebase' : strategy === 'rebase' ? '--rebase' : '--ff-only';
  return runner.run(repoPath, ['pull', flag, '--progress'], progressOptions(options));
}

export async function push(
  runner: GitRunner,
  repoPath: string,
  options: {
    remote?: string;
    branch?: string;
    force?: boolean;
    setUpstream?: boolean;
    signal?: AbortSignal;
    onProgress?: (chunk: string) => void;
  },
): Promise<GitResult> {
  const args = ['push'];
  if (options.setUpstream) args.push('--set-upstream');
  if (options.force) args.push('--force-with-lease');
  if (options.remote) args.push(options.remote);
  if (options.branch) args.push(options.branch);
  return runner.run(repoPath, args, progressOptions(options));
}

export async function merge(
  runner: GitRunner,
  repoPath: string,
  ref: string,
  noFf = false,
): Promise<GitResult> {
  return runner.run(repoPath, ['merge', ...(noFf ? ['--no-ff'] : []), ref], { allowFail: true });
}

export async function rebase(
  runner: GitRunner,
  repoPath: string,
  onto: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['rebase', onto], { allowFail: true });
}

export async function cherryPick(
  runner: GitRunner,
  repoPath: string,
  hashes: string[],
): Promise<GitResult> {
  return runner.run(repoPath, ['cherry-pick', ...hashes], { allowFail: true });
}

export async function operationAction(
  runner: GitRunner,
  repoPath: string,
  kind: OperationKind,
  action: 'continue' | 'abort' | 'skip',
): Promise<GitResult> {
  const command =
    kind === 'merge'
      ? 'merge'
      : kind === 'rebase'
        ? 'rebase'
        : kind === 'cherry-pick'
          ? 'cherry-pick'
          : 'revert';
  if (action === 'skip' && command === 'merge') {
    throw new AppError(400, 'UNSUPPORTED_ACTION', 'Merge does not support skip.');
  }
  return runner.run(repoPath, [command, `--${action}`], { allowFail: true });
}

export async function stashPush(
  runner: GitRunner,
  repoPath: string,
  options: { message?: string; includeUntracked?: boolean },
): Promise<GitResult> {
  const args = ['stash', 'push'];
  if (options.includeUntracked) args.push('-u');
  if (options.message) args.push('-m', options.message);
  return runner.run(repoPath, args);
}

export async function stashApply(
  runner: GitRunner,
  repoPath: string,
  ref: string,
  pop = false,
): Promise<GitResult> {
  return runner.run(repoPath, ['stash', pop ? 'pop' : 'apply', ref], { allowFail: true });
}

export async function stashDrop(
  runner: GitRunner,
  repoPath: string,
  ref: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['stash', 'drop', ref]);
}

export async function createTag(
  runner: GitRunner,
  repoPath: string,
  name: string,
  message?: string,
  ref?: string,
): Promise<GitResult> {
  const args = ['tag'];
  if (message) args.push('-a', '-m', message);
  args.push(name);
  if (ref) args.push(ref);
  return runner.run(repoPath, args);
}

export async function deleteTag(
  runner: GitRunner,
  repoPath: string,
  name: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['tag', '-d', name]);
}

export async function pushTag(
  runner: GitRunner,
  repoPath: string,
  name: string,
  remote = 'origin',
  options: ProgressOptions = {},
): Promise<GitResult> {
  return runner.run(repoPath, ['push', remote, name], progressOptions(options));
}

export async function addRemote(
  runner: GitRunner,
  repoPath: string,
  name: string,
  url: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['remote', 'add', name, url]);
}

export async function removeRemote(
  runner: GitRunner,
  repoPath: string,
  name: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['remote', 'remove', name]);
}

export async function setRemoteUrl(
  runner: GitRunner,
  repoPath: string,
  name: string,
  url: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['remote', 'set-url', name, url]);
}

export async function reset(
  runner: GitRunner,
  repoPath: string,
  mode: 'soft' | 'mixed' | 'hard',
  ref: string,
): Promise<GitResult> {
  return runner.run(repoPath, ['reset', `--${mode}`, ref]);
}

export async function previewClean(
  runner: GitRunner,
  repoPath: string,
  paths?: string[],
): Promise<string[]> {
  const args = ['clean', '-nd', '-d'];
  if (paths && paths.length > 0) args.push('--', ...paths);
  const result = await runner.run(repoPath, args, { allowFail: true });
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Would remove '))
    .map((line) => line.slice('Would remove '.length).replace(/\/$/, ''));
}

export async function clean(
  runner: GitRunner,
  repoPath: string,
  dataDir: string,
  repoId: string,
  paths: string[] | undefined,
  confirm: boolean,
): Promise<{ preview: string[]; trash: TrashResult | null }> {
  const preview = await previewClean(runner, repoPath, paths);
  if (!confirm) return { preview, trash: null };
  const trash = await trashPaths(repoPath, dataDir, repoId, preview);
  return { preview, trash };
}

export async function restore(
  runner: GitRunner,
  repoPath: string,
  dataDir: string,
  repoId: string,
  paths: string[],
  confirm: boolean,
): Promise<{ trash: TrashResult | null; restored: string[] }> {
  const status = await getStatus(runner, repoPath);
  const untracked = new Set(status.files.filter((file) => file.untracked).map((file) => file.path));
  const trash = confirm ? await trashPaths(repoPath, dataDir, repoId, paths) : null;
  if (!confirm) return { trash: null, restored: [] };

  const tracked = paths.filter((filePath) => !untracked.has(filePath));
  if (tracked.length > 0) {
    await runner.run(repoPath, ['restore', '--', ...tracked], { allowFail: true });
  }
  return { trash, restored: paths };
}

export async function clone(
  runner: GitRunner,
  url: string,
  targetPath: string,
  options: ProgressOptions,
): Promise<GitResult> {
  return runner.run(path.dirname(targetPath), ['clone', '--progress', url, targetPath], {
    ...progressOptions(options),
    allowFail: true,
  });
}
