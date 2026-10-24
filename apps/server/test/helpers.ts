import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from '../src/config';

let sequence = 0;

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

export function createRepo(prefix = 'repo'): string {
  const repoPath = path.join(homeDir, `${prefix}-${process.pid}-${sequence++}`);
  fs.mkdirSync(repoPath, { recursive: true });
  git(repoPath, 'init', '-q', '-b', 'main');
  git(repoPath, 'config', 'user.name', 'Test User');
  git(repoPath, 'config', 'user.email', 'test@example.com');
  git(repoPath, 'config', 'core.autocrlf', 'false');
  return repoPath;
}

export function writeFile(repoPath: string, name: string, content: string): void {
  fs.writeFileSync(path.join(repoPath, name), content);
}

export function readFile(repoPath: string, name: string): string {
  return fs.readFileSync(path.join(repoPath, name), 'utf8');
}

export function commitAll(repoPath: string, message: string): string {
  git(repoPath, 'add', '-A');
  git(repoPath, 'commit', '-q', '-m', message);
  return git(repoPath, 'rev-parse', 'HEAD');
}

export function hasRef(cwd: string, ref: string): boolean {
  return spawnSync('git', ['show-ref', '--verify', ref], { cwd, stdio: 'ignore' }).status === 0;
}
