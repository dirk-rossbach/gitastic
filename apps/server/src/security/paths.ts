import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DirectoryListing } from '@gitastic/shared';
import { AppError } from '../errors';

export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function toPosix(input: string): string {
  return input.split(path.sep).join('/');
}

export function repoIdForPath(repoPath: string): string {
  return createHash('sha1').update(repoPath).digest('hex').slice(0, 12);
}

export function resolveUserPath(input: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith(`~${path.sep}`)) {
    return path.resolve(home, input.slice(2));
  }
  return path.resolve(input);
}

export async function assertRepoPath(input: string, roots: string[], home: string): Promise<string> {
  const requested = resolveUserPath(input, home);
  let resolved: string;
  try {
    resolved = await fs.realpath(requested);
  } catch {
    throw new AppError(400, 'PATH_NOT_FOUND', `Path does not exist: ${requested}`);
  }

  const realRoots = await Promise.all(
    roots.map(async (root) => {
      try {
        return await fs.realpath(root);
      } catch {
        return path.resolve(root);
      }
    }),
  );

  if (!realRoots.some((root) => isPathInside(root, resolved))) {
    throw new AppError(
      403,
      'PATH_OUTSIDE_HOME',
      'Gitastic only opens repositories under your home directory.',
    );
  }

  const dotGit = path.join(resolved, '.git');
  const stat = await fs.stat(dotGit).catch(() => null);
  if (!stat || (!stat.isDirectory() && !stat.isFile())) {
    throw new AppError(400, 'NOT_A_REPO', `Not a Git repository: ${resolved}`);
  }

  return resolved;
}

async function realpathLoose(target: string): Promise<string> {
  let current = path.resolve(target);
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return suffix.length > 0 ? path.join(real, ...suffix.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

export async function assertInsideHome(input: string, roots: string[], home: string): Promise<string> {
  const requested = resolveUserPath(input, home);
  const resolved = await realpathLoose(requested);
  const realRoots = await Promise.all(
    roots.map(async (root) => {
      try {
        return await fs.realpath(root);
      } catch {
        return path.resolve(root);
      }
    }),
  );
  if (!realRoots.some((root) => isPathInside(root, resolved))) {
    throw new AppError(403, 'PATH_OUTSIDE_HOME', 'Path must be inside your home directory.');
  }
  return resolved;
}

export async function assertRepoFile(repoPath: string, relative: string): Promise<string> {
  const resolved = path.resolve(repoPath, relative);
  if (!isPathInside(repoPath, resolved)) {
    throw new AppError(400, 'PATH_OUTSIDE_REPO', 'Path must stay inside the repository.');
  }
  const rel = path.relative(repoPath, resolved);
  if (rel === '' || rel.split(path.sep)[0] === '.git') {
    throw new AppError(400, 'INVALID_REPO_FILE', 'Invalid repository file path.');
  }
  const real = await fs.realpath(resolved).catch(() => resolved);
  if (!isPathInside(repoPath, real)) {
    throw new AppError(403, 'SYMLINK_OUTSIDE_REPO', 'Symlink target is outside the repository.');
  }
  return resolved;
}

export async function listDirectories(
  input: string | undefined,
  roots: string[],
  home: string,
): Promise<DirectoryListing> {
  const current = await assertInsideHome(input ?? home, roots, home);
  const stat = await fs.stat(current).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new AppError(400, 'NOT_A_DIRECTORY', `Not a directory: ${current}`);
  }

  const dirents = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
  const entries = await Promise.all(
    dirents
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map(async (entry) => {
        const entryPath = path.join(current, entry.name);
        const repo = await fs
          .stat(path.join(entryPath, '.git'))
          .then((s) => s.isDirectory() || s.isFile())
          .catch(() => false);
        return {
          name: entry.name,
          path: entryPath,
          isRepo: repo,
          isDirectory: true,
        };
      }),
  );

  entries.sort((a, b) => Number(b.isRepo) - Number(a.isRepo) || a.name.localeCompare(b.name));

  const parent = isPathInside(home, current) && current !== home ? path.dirname(current) : null;
  return { path: current, parent, entries };
}
