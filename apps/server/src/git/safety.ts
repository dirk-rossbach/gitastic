import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getStatus } from './repo';
import type { GitRunner } from './runner';
import { isPathInside, toPosix } from '../security/paths';

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40) || 'backup';
}

export async function createBackupRef(
  runner: GitRunner,
  repoPath: string,
  label: string,
): Promise<string | null> {
  const ref = `refs/gitastic/backup/${Date.now()}-${sanitize(label)}`;
  const result = await runner.run(repoPath, ['update-ref', ref, 'HEAD'], { allowFail: true });
  return result.exitCode === 0 ? ref : null;
}

export async function saveBranchToTrash(
  runner: GitRunner,
  repoPath: string,
  branch: string,
): Promise<string | null> {
  const sha = await runner.run(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}`], {
    allowFail: true,
  });
  if (sha.exitCode !== 0) return null;
  const ref = `refs/gitastic/trash/branches/${Date.now()}-${sanitize(branch)}`;
  const result = await runner.run(repoPath, ['update-ref', ref, sha.stdout.trim()], {
    allowFail: true,
  });
  return result.exitCode === 0 ? ref : null;
}

async function moveEntry(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.cp(source, destination, { recursive: true });
    await fs.rm(source, { recursive: true, force: true });
  }
}

export interface TrashResult {
  trashDir: string;
  entries: string[];
}

export async function trashPaths(
  repoPath: string,
  dataDir: string,
  repoId: string,
  paths: string[],
): Promise<TrashResult> {
  const trashDir = path.join(dataDir, 'trash', repoId, `${Date.now()}-${randomUUID().slice(0, 8)}`);
  const entries: string[] = [];
  await fs.mkdir(trashDir, { recursive: true });

  for (const relative of paths) {
    const normalized = toPosix(relative).replace(/^\/+/, '');
    if (!normalized || normalized.split('/')[0] === '.git') continue;
    const source = path.resolve(repoPath, normalized);
    if (!isPathInside(repoPath, source)) continue;
    const stat = await fs.lstat(source).catch(() => null);
    if (!stat) continue;
    const destination = path.join(trashDir, normalized);
    await moveEntry(source, destination);
    entries.push(normalized);
  }

  return { trashDir, entries };
}

export async function copyPathsToTrash(
  repoPath: string,
  dataDir: string,
  repoId: string,
  paths: string[],
  label: string,
): Promise<TrashResult> {
  const trashDir = path.join(
    dataDir,
    'trash',
    repoId,
    `${Date.now()}-${sanitize(label)}-${randomUUID().slice(0, 8)}`,
  );
  const entries: string[] = [];
  await fs.mkdir(trashDir, { recursive: true });

  for (const relative of paths) {
    const normalized = toPosix(relative).replace(/^\/+/, '');
    if (!normalized || normalized.split('/')[0] === '.git') continue;
    const source = path.resolve(repoPath, normalized);
    if (!isPathInside(repoPath, source)) continue;
    const stat = await fs.lstat(source).catch(() => null);
    if (!stat) continue;
    const destination = path.join(trashDir, normalized);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, { recursive: true });
    entries.push(normalized);
  }

  return { trashDir, entries };
}

async function walk(root: string, relative = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walk(root, child)));
    } else {
      files.push(child);
    }
  }
  return files;
}

export async function restoreTrash(trashDir: string, repoPath: string): Promise<void> {
  const files = await walk(trashDir);
  for (const relative of files) {
    const source = path.join(trashDir, relative);
    const destination = path.join(repoPath, relative);
    if (!isPathInside(repoPath, destination)) continue;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rm(destination, { force: true });
    await moveEntry(source, destination);
  }
  await fs.rm(trashDir, { recursive: true, force: true });
}

export async function backupWorkingTree(
  runner: GitRunner,
  repoPath: string,
  dataDir: string,
  repoId: string,
  label: string,
): Promise<TrashResult | null> {
  const status = await getStatus(runner, repoPath);
  const paths = status.files.map((file) => file.path);
  if (paths.length === 0) return null;
  return copyPathsToTrash(repoPath, dataDir, repoId, paths, label);
}
