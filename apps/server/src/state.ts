import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AppConfig,
  HistoryPage,
  OnboardingReport,
  RepoSummary,
  Session,
  SettingsPatch,
  UndoEntry,
} from '@gitastic/shared';
import { dataDir, homeDir, rootDir, saveConfig } from './config';
import { AppError } from './errors';
import { getOnboardingReport } from './git/onboarding';
import { getRepoSummary } from './git/repo';
import {
  createHistoryCache,
  getHistoryPage,
  type HistoryCache,
} from './git/history';
import { GitRunner } from './git/runner';
import { JobManager } from './jobs';
import { assertRepoPath, repoIdForPath } from './security/paths';

export interface OpenRepo {
  id: string;
  path: string;
}

export class AppState {
  config: AppConfig;
  readonly runner: GitRunner;
  readonly jobs = new JobManager();
  currentRepoId: string | null = null;
  private readonly repos = new Map<string, string>();
  private readonly historyCaches = new Map<string, HistoryCache>();
  private readonly undoEntries = new Map<string, UndoEntry[]>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(config: AppConfig) {
    this.config = config;
    this.runner = new GitRunner(config.gitPath);
  }

  async openRepo(input: string): Promise<RepoSummary> {
    const repoPath = await assertRepoPath(input, this.config.repoRoots, homeDir);
    const id = repoIdForPath(repoPath);
    this.repos.set(id, repoPath);
    this.currentRepoId = id;

    const recent = {
      id,
      name: path.basename(repoPath),
      path: repoPath,
      lastOpened: new Date().toISOString(),
    };
    this.config.recentRepos = [
      recent,
      ...this.config.recentRepos.filter((repo) => repo.path !== repoPath),
    ].slice(0, 20);
    await saveConfig(this.config);
    return getRepoSummary(this.runner, repoPath, id);
  }

  closeRepo(): void {
    this.currentRepoId = null;
  }

  getRepo(id?: string): OpenRepo {
    const repoId = id ?? this.currentRepoId;
    if (!repoId) {
      throw new AppError(400, 'NO_REPO', 'No repository is open.');
    }
    const repoPath = this.repos.get(repoId);
    if (!repoPath) {
      throw new AppError(404, 'REPO_NOT_OPEN', 'Repository is not open in this session.');
    }
    return { id: repoId, path: repoPath };
  }

  async summary(id?: string): Promise<RepoSummary> {
    const repo = this.getRepo(id);
    return getRepoSummary(this.runner, repo.path, repo.id);
  }

  history(id?: string): { repo: OpenRepo; cache: HistoryCache } {
    const repo = this.getRepo(id);
    let cache = this.historyCaches.get(repo.id);
    if (!cache) {
      cache = createHistoryCache();
      this.historyCaches.set(repo.id, cache);
    }
    return { repo, cache };
  }

  async historyPage(
    id: string | undefined,
    options: { offset: number; limit: number; ref?: string | null; query?: string | null },
  ): Promise<HistoryPage> {
    const { repo, cache } = this.history(id);
    return getHistoryPage(this.runner, repo.path, cache, options);
  }

  invalidate(id?: string): void {
    const repoId = id ?? this.currentRepoId;
    if (!repoId) return;
    this.historyCaches.delete(repoId);
    void fs.rm(path.join(dataDir, 'cache', `${repoId}.json`), { force: true }).catch(() => undefined);
  }

  async clearCache(): Promise<void> {
    this.historyCaches.clear();
    await fs.rm(path.join(dataDir, 'cache'), { recursive: true, force: true }).catch(() => undefined);
  }

  async updateSettings(patch: SettingsPatch): Promise<AppConfig> {
    this.config = { ...this.config, ...patch, repoRoots: [rootDir] };
    if (patch.gitPath) this.runner.gitPath = patch.gitPath;
    await saveConfig(this.config);
    return this.config;
  }

  async onboarding(): Promise<OnboardingReport> {
    return getOnboardingReport(this.runner);
  }

  async session(): Promise<Session> {
    let repo: RepoSummary | null = null;
    if (this.currentRepoId) {
      try {
        repo = await this.summary();
      } catch {
        repo = null;
      }
    }
    return {
      repo,
      config: this.config,
      onboarding: await this.onboarding(),
    };
  }

  listUndo(id?: string): UndoEntry[] {
    const repo = this.getRepo(id);
    return [...(this.undoEntries.get(repo.id) ?? [])].reverse();
  }

  pushUndo(entry: UndoEntry): void {
    const entries = this.undoEntries.get(entry.repoId) ?? [];
    entries.push(entry);
    if (entries.length > 20) entries.shift();
    this.undoEntries.set(entry.repoId, entries);
  }

  takeUndo(repoId: string, undoId: string): UndoEntry | undefined {
    const entries = this.undoEntries.get(repoId) ?? [];
    const index = entries.findIndex((entry) => entry.id === undoId);
    if (index === -1) return undefined;
    const [entry] = entries.splice(index, 1);
    this.undoEntries.set(repoId, entries);
    return entry;
  }

  async withRepoLock<T>(repoId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(repoId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      repoId,
      previous.then(() => current),
    );
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}
