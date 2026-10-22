import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  BlameResponse,
  CommitBase,
  CommitSummary,
  FileHistoryResponse,
  HistoryPage,
} from '@gitastic/shared';
import { dataDir } from '../config';
import { repoIdForPath } from '../security/paths';
import type { GitRunner } from './runner';
import { parseBlamePorcelain, parseCommitLog, COMMIT_LOG_FORMAT } from './parse';

export interface LayoutRow {
  lane: number;
  activeLanes: number[];
  nextActiveLanes: number[];
  parentLanes: number[];
  laneBranches: Array<{ lane: number; labels: string[] }>;
}

function branchLabels(refs: string[]): string[] {
  const labels = refs
    .filter((ref) => !ref.startsWith('tag: '))
    .map((ref) => {
      const arrow = ref.lastIndexOf(' -> ');
      return arrow >= 0 ? ref.slice(arrow + 4) : ref;
    })
    .filter((ref) => ref && ref !== 'HEAD' && !ref.endsWith('/HEAD'));
  return [...new Set(labels)];
}

function mergeLabels(current: string[], incoming: string[]): string[] {
  return [...new Set([...current, ...incoming])];
}

export interface HistoryCache {
  loaded: boolean;
  fingerprint: string;
  commits: CommitBase[];
  layout: LayoutRow[];
  maxLanes: number;
  reachable: Map<string, Set<string>>;
}

export function createHistoryCache(): HistoryCache {
  return {
    loaded: false,
    fingerprint: '',
    commits: [],
    layout: [],
    maxLanes: 1,
    reachable: new Map(),
  };
}

async function historyFingerprint(runner: GitRunner, repoPath: string): Promise<string> {
  const refs = await runner.run(repoPath, ['show-ref', '--head'], { allowFail: true });
  return refs.stdout.trim();
}

export function computeLayout(commits: CommitBase[]): { rows: LayoutRow[]; maxLanes: number } {
  const lanes: Array<string | null> = [];
  const labels: string[][] = [];
  const rows: LayoutRow[] = [];
  let maxLanes = 1;

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      const free = lanes.indexOf(null);
      if (free === -1) {
        lane = lanes.length;
        lanes.push(commit.hash);
        labels.push([]);
      } else {
        lane = free;
        lanes[free] = commit.hash;
        labels[free] = [];
      }
    }

    labels[lane] = mergeLabels(labels[lane] ?? [], branchLabels(commit.refs));

    const activeLanes = lanes
      .map((value, index) => (value ? index : -1))
      .filter((index) => index >= 0);
    const laneBranches = activeLanes
      .map((activeLane) => ({ lane: activeLane, labels: [...(labels[activeLane] ?? [])] }))
      .filter((entry) => entry.labels.length > 0);

    lanes[lane] = null;
    const currentLabels = labels[lane] ?? [];
    labels[lane] = [];
    const parentLanes: number[] = [];

    for (let parentIndex = 0; parentIndex < commit.parents.length; parentIndex += 1) {
      const parent = commit.parents[parentIndex];
      let parentLane = lanes.indexOf(parent);
      if (parentLane === -1) {
        let target = -1;
        if (parentIndex === 0 && lanes[lane] === null) {
          target = lane;
        } else {
          target = lanes.indexOf(null);
        }
        if (target === -1) {
          target = lanes.length;
          lanes.push(parent);
          labels.push([]);
        } else {
          lanes[target] = parent;
        }
        parentLane = target;
      }
      if (parentIndex === 0) {
        labels[parentLane] = mergeLabels(labels[parentLane] ?? [], currentLabels);
      }
      parentLanes.push(parentLane);
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      labels.pop();
    }

    const nextActiveLanes = lanes
      .map((value, index) => (value ? index : -1))
      .filter((index) => index >= 0);

    maxLanes = Math.max(
      maxLanes,
      lane + 1,
      ...activeLanes.map((value) => value + 1),
      ...nextActiveLanes.map((value) => value + 1),
      ...parentLanes.map((value) => value + 1),
    );

    rows.push({ lane, activeLanes, nextActiveLanes, parentLanes, laneBranches });
  }

  return { rows, maxLanes };
}

export async function ensureHistory(
  runner: GitRunner,
  repoPath: string,
  cache: HistoryCache,
): Promise<void> {
  const fingerprint = await historyFingerprint(runner, repoPath);
  if (cache.loaded && cache.fingerprint === fingerprint) return;

  const cacheFile = path.join(dataDir, 'cache', `${repoIdForPath(repoPath)}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as {
      fingerprint?: string;
      commits?: CommitBase[];
      layout?: LayoutRow[];
      maxLanes?: number;
    };
    if (raw.fingerprint === fingerprint && Array.isArray(raw.commits) && Array.isArray(raw.layout)) {
      cache.commits = raw.commits;
      cache.layout = raw.layout;
      cache.maxLanes = raw.maxLanes ?? 1;
      cache.reachable.clear();
      cache.fingerprint = fingerprint;
      cache.loaded = true;
      return;
    }
  } catch {
    // Disk cache miss
  }

  const result = await runner.run(
    repoPath,
    [
      'log',
      '--branches',
      '--remotes',
      '--tags',
      'HEAD',
      `--format=${COMMIT_LOG_FORMAT}`,
      '--topo-order',
    ],
    { allowFail: true },
  );

  cache.commits = result.exitCode === 0 ? parseCommitLog(result.stdout) : [];
  const layout = computeLayout(cache.commits);
  cache.layout = layout.rows;
  cache.maxLanes = layout.maxLanes;
  cache.reachable.clear();
  cache.fingerprint = fingerprint;
  cache.loaded = true;

  try {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(
      cacheFile,
      JSON.stringify({
        fingerprint,
        commits: cache.commits,
        layout: cache.layout,
        maxLanes: cache.maxLanes,
      }),
      'utf8',
    );
  } catch {
    // Ignore disk cache write errors
  }
}

export async function getHistoryPage(
  runner: GitRunner,
  repoPath: string,
  cache: HistoryCache,
  options: { offset: number; limit: number; ref?: string | null; query?: string | null },
): Promise<HistoryPage> {
  await ensureHistory(runner, repoPath, cache);

  let commits = cache.commits;
  let layout = cache.layout;
  let maxLanes = cache.maxLanes;

  if (options.ref) {
    let reachable = cache.reachable.get(options.ref);
    if (!reachable) {
      const result = await runner.run(repoPath, ['rev-list', options.ref], { allowFail: true });
      reachable = new Set(result.stdout.split('\n').filter(Boolean));
      cache.reachable.set(options.ref, reachable);
    }
    commits = commits.filter((commit) => reachable?.has(commit.hash));
  }

  if (options.query) {
    const query = options.query.toLowerCase();
    commits = commits.filter(
      (commit) =>
        commit.hash.startsWith(query) ||
        commit.subject.toLowerCase().includes(query) ||
        commit.authorName.toLowerCase().includes(query) ||
        commit.authorEmail.toLowerCase().includes(query) ||
        commit.refs.some((ref) => ref.toLowerCase().includes(query)),
    );
  }

  if (commits !== cache.commits) {
    const computed = computeLayout(commits);
    layout = computed.rows;
    maxLanes = computed.maxLanes;
  }

  const page = commits.slice(options.offset, options.offset + options.limit);
  const rows = layout.slice(options.offset, options.offset + options.limit);
  const commitsWithGraph: CommitSummary[] = page.map((commit, index) => {
    const row = rows[index] ?? {
      lane: 0,
      activeLanes: [0],
      nextActiveLanes: [],
      parentLanes: [],
      laneBranches: [],
    };
    return { ...commit, ...row, maxLanes };
  });

  return {
    commits: commitsWithGraph,
    offset: options.offset,
    limit: options.limit,
    total: commits.length,
    maxLanes,
    ref: options.ref ?? null,
    query: options.query ?? null,
  };
}

export async function getBlame(
  runner: GitRunner,
  repoPath: string,
  filePath: string,
  offset: number,
  limit: number,
): Promise<BlameResponse> {
  const result = await runner.run(repoPath, ['blame', '--line-porcelain', '--', filePath], {
    allowFail: true,
  });
  const lines = result.exitCode === 0 ? parseBlamePorcelain(result.stdout) : [];
  return {
    path: filePath,
    lines: lines.slice(offset, offset + limit),
    offset,
    limit,
    total: lines.length,
  };
}

export async function getFileHistory(
  runner: GitRunner,
  repoPath: string,
  filePath: string,
  offset: number,
  limit: number,
): Promise<FileHistoryResponse> {
  let result = await runner.run(
    repoPath,
    ['log', '--all', '--follow', `--format=${COMMIT_LOG_FORMAT}`, '--', filePath],
    { allowFail: true },
  );
  if (result.exitCode !== 0) {
    result = await runner.run(
      repoPath,
      ['log', '--follow', `--format=${COMMIT_LOG_FORMAT}`, '--', filePath],
      { allowFail: true },
    );
  }
  const commits = result.exitCode === 0 ? parseCommitLog(result.stdout) : [];
  return {
    path: filePath,
    commits: commits.slice(offset, offset + limit),
    offset,
    limit,
    total: commits.length,
  };
}
