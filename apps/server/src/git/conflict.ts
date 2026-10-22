import fs from 'node:fs/promises';
import type { ConflictFile, ConflictsResponse } from '@gitastic/shared';
import { assertRepoFile } from '../security/paths';
import { parseConflictMarkers } from './parse';
import { getStatus } from './repo';
import type { GitRunner } from './runner';

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

export async function getConflicts(
  runner: GitRunner,
  repoPath: string,
): Promise<ConflictsResponse> {
  const status = await getStatus(runner, repoPath);
  const conflicted = status.files.filter((file) => file.conflicted);
  const files: ConflictFile[] = [];

  for (const file of conflicted) {
    const absolute = await assertRepoFile(repoPath, file.path);
    const buffer = await fs.readFile(absolute).catch(() => Buffer.from(''));
    const binary = isBinary(buffer);
    const content = binary ? null : buffer.toString('utf8');
    files.push({
      path: file.path,
      kind: file.kind,
      binary,
      content,
      blocks: content ? parseConflictMarkers(content, file.path) : [],
    });
  }

  return { operation: status.operation, files };
}

export async function resolveConflictFile(
  runner: GitRunner,
  repoPath: string,
  filePath: string,
  content: string,
): Promise<void> {
  const absolute = await assertRepoFile(repoPath, filePath);
  await fs.writeFile(absolute, content, 'utf8');
  await runner.run(repoPath, ['add', '--', filePath]);
}

export async function resolveBinaryConflict(
  runner: GitRunner,
  repoPath: string,
  filePath: string,
  side: 'ours' | 'theirs',
): Promise<void> {
  await assertRepoFile(repoPath, filePath);
  await runner.run(repoPath, ['checkout', `--${side}`, '--', filePath]);
  await runner.run(repoPath, ['add', '--', filePath]);
}
