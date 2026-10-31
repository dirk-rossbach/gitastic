import type {
  AppConfig,
  BlameResponse,
  Branch,
  CherryPickSchema,
  CleanSchema,
  CommitDetail,
  CommunityThemesResponse,
  ConflictsResponse,
  DiffResponse,
  DirectoryListing,
  FileHistoryResponse,
  GitIdentity,
  HistoryPage,
  Job,
  OnboardingReport,
  ProviderAccountStatus,
  ProviderKind,
  ProviderRepo,
  ProvidersStatusResponse,
  PullRequestCommentCreate,
  PullRequestDetailResponse,
  PullRequestsResponse,
  RecentRepo,
  ReflogEntry,
  Remote,
  RemoteProviderInfo,
  RepoSummary,
  ResetSchema,
  RestoreSchema,
  Session,
  SettingsPatch,
  SshKeyEntry,
  Stash,
  Status,
  Tag,
  ThemeManifest,
  ThemesResponse,
  UndoEntry,
  Worktree,
} from '@gitastic/shared';
import { API_REQUEST_HEADER } from '@gitastic/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface TauriInternals {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

function getTauriInternals(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    __TAURI_INTERNALS__?: TauriInternals;
    __TAURI__?: { core?: TauriInternals };
  };
  return win.__TAURI_INTERNALS__ ?? win.__TAURI__?.core ?? null;
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  const tauri = getTauriInternals();
  if (tauri) {
    try {
      return await tauri.invoke<T>('gitastic_api', {
        method: options.method ?? 'GET',
        path,
        query: options.query ?? null,
        body: options.body ?? null,
      });
    } catch (err) {
      const payload = err as {
        status?: number;
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      throw new ApiError(
        payload?.status ?? 422,
        payload?.error?.code ?? 'TAURI_IPC_FAILED',
        payload?.error?.message ?? (err instanceof Error ? err.message : String(err)),
        payload?.error?.details,
      );
    }
  }

  const response = await fetch(withQuery(`/api${path}`, options.query), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      [API_REQUEST_HEADER]: '1',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const body = data as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'REQUEST_FAILED',
      body?.error?.message ?? `Request failed with status ${response.status}`,
      body?.error?.details,
    );
  }

  return data as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: body ?? {} });
}

export interface WriteResponse {
  ok: boolean;
  output?: string;
  undo?: UndoEntry;
  conflicted?: boolean;
  operation?: string | null;
  preview?: string[];
}

export interface JobResponse {
  job: Job;
}

export const api = {
  session: () => request<Session>('/session'),
  onboarding: () => request<OnboardingReport>('/onboarding'),
  settings: () => request<AppConfig>('/settings'),
  updateSettings: (patch: SettingsPatch) =>
    request<AppConfig>('/settings', { method: 'PUT', body: patch }),
  themes: () => request<ThemesResponse>('/themes'),
  importTheme: (css: string) => post<ThemeManifest>('/themes', { css }),
  themeCss: (id: string) => request<string>(`/themes/${encodeURIComponent(id)}/css`),
  deleteTheme: (id: string) =>
    request<{ ok: boolean }>(`/themes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  communityThemes: () => request<CommunityThemesResponse>('/themes/community'),
  installCommunityTheme: (id: string) =>
    post<ThemeManifest>(`/themes/community/${encodeURIComponent(id)}/install`),
  clearCache: () => post<{ ok: boolean }>('/cache/clear'),
  openExternal: (url: string) => {
    if (getTauriInternals()) {
      return post<{ ok: boolean }>('/system/open-url', { url });
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve({ ok: true });
  },

  listDirectories: (target?: string) =>
    request<DirectoryListing>('/fs/list', { query: { path: target } }),
  recentRepos: () => request<RecentRepo[]>('/repos/recent'),
  openRepo: (target: string) => post<RepoSummary>('/repos/open', { path: target }),
  closeRepo: () => post<{ ok: boolean }>('/repos/close'),
  clone: (url: string, target: string) => post<JobResponse>('/repos/clone', { url, path: target }),

  providersStatus: () => request<ProvidersStatusResponse>('/providers/status'),
  connectProvider: (body: {
    provider: ProviderKind;
    host?: string;
    username?: string;
    token: string;
  }) => post<ProviderAccountStatus>('/providers/connect', body),
  disconnectProvider: (body: { provider: ProviderKind; host: string }) =>
    post<{ ok: boolean }>('/providers/disconnect', body),
  providerRepos: (options: { provider: ProviderKind; host?: string; q?: string }) =>
    request<ProviderRepo[]>('/providers/repos', { query: options }),
  addSshKey: (keyPath: string, passphrase?: string) =>
    post<{ ok: boolean; detail: string }>('/providers/ssh/add', { path: keyPath, passphrase }),
  removeSshKey: (keyPath: string, deleteFiles?: boolean) =>
    post<{ ok: boolean; detail: string }>('/providers/ssh/remove', { path: keyPath, deleteFiles }),
  generateSshKey: (label?: string) =>
    post<SshKeyEntry>('/providers/ssh/generate', { label }),
  gitIdentity: () => request<GitIdentity>('/git-identity'),
  updateGitIdentity: (identity: GitIdentity) =>
    request<GitIdentity>('/git-identity', { method: 'PUT', body: identity }),

  repo: () => request<RepoSummary>('/repo'),
  repoProvider: () => request<{ remote: RemoteProviderInfo | null }>('/repo/provider'),
  pulls: () => request<PullRequestsResponse>('/repo/pulls'),
  pullRequest: (number: number) =>
    request<PullRequestDetailResponse>(`/repo/pulls/${number}`),
  commentOnPullRequest: (number: number, body: PullRequestCommentCreate) =>
    post<{ ok: boolean }>(`/repo/pulls/${number}/comments`, body),
  approvePullRequest: (number: number, body?: string) =>
    post<{ ok: boolean }>(`/repo/pulls/${number}/approve`, { body }),
  checkoutPullRequest: (body: { number: number; sourceBranch: string; remote?: string }) =>
    post<RepoSummary>('/repo/pulls/checkout', body),
  status: () => request<Status>('/repo/status'),
  history: (options: { offset: number; limit: number; ref?: string | null; q?: string | null }) =>
    request<HistoryPage>('/repo/history', { query: options }),
  commit: (hash: string) => request<CommitDetail>(`/repo/commit/${encodeURIComponent(hash)}`),
  diff: (options: { path?: string; staged?: boolean; context?: number }) =>
    request<DiffResponse>('/repo/diff', { query: options }),
  branches: () => request<Branch[]>('/repo/branches'),
  tags: () => request<Tag[]>('/repo/tags'),
  remotes: () => request<Remote[]>('/repo/remotes'),
  stashes: () => request<Stash[]>('/repo/stashes'),
  worktrees: () => request<Worktree[]>('/repo/worktrees'),
  addWorktree: (body: {
    path: string;
    branch: string;
    createBranch?: boolean;
    startPoint?: string;
  }) => post<{ ok: boolean }>('/repo/worktrees/add', body),
  removeWorktree: (body: { path: string; force?: boolean }) =>
    post<{ ok: boolean }>('/repo/worktrees/remove', body),
  applyPatch: (body: { patch: string; cached?: boolean; reverse?: boolean }) =>
    post<WriteResponse>('/repo/apply-patch', body),
  revealInFinder: (path?: string) => post<{ ok: boolean }>('/system/reveal', { path }),
  openTerminal: () => post<{ ok: boolean }>('/system/terminal', {}),
  openInEditor: (path?: string) => post<{ ok: boolean }>('/system/editor', { path }),
  blame: (path: string, offset = 0, limit = 2000) =>
    request<BlameResponse>('/repo/blame', { query: { path, offset, limit } }),
  fileHistory: (path: string, offset = 0, limit = 200) =>
    request<FileHistoryResponse>('/repo/file-history', { query: { path, offset, limit } }),
  conflicts: () => request<ConflictsResponse>('/repo/conflicts'),

  resolveConflict: (path: string, content: string) =>
    post<{ ok: boolean }>('/repo/conflicts/resolve', { path, content }),
  resolveBinaryConflict: (path: string, side: 'ours' | 'theirs') =>
    post<{ ok: boolean }>('/repo/conflicts/binary', { path, side }),

  stage: (paths: string[]) => post<WriteResponse>('/repo/stage', { paths }),
  unstage: (paths: string[]) => post<WriteResponse>('/repo/unstage', { paths }),
  createCommit: (body: { message: string; amend?: boolean; signoff?: boolean }) =>
    post<WriteResponse>('/repo/commit', body),
  createBranch: (name: string, startPoint?: string) =>
    post<RepoSummary>('/repo/branch', { name, startPoint }),
  deleteBranch: (name: string, force?: boolean) =>
    post<WriteResponse>('/repo/branch/delete', { name, force }),
  renameBranch: (from: string, to: string) =>
    post<{ ok: boolean }>('/repo/branch/rename', { from, to }),
  checkout: (ref: string) => post<RepoSummary>('/repo/checkout', { ref }),
  setUpstream: (branch: string, upstream: string) =>
    post<{ ok: boolean }>('/repo/upstream', { branch, upstream }),

  fetch: (remote?: string) => post<JobResponse>('/repo/fetch', { remote }),
  pull: (strategy?: 'ff-only' | 'merge' | 'rebase') =>
    post<JobResponse>('/repo/pull', { strategy }),
  push: (body: { remote?: string; branch?: string; force?: boolean; setUpstream?: boolean; confirm?: boolean }) =>
    post<JobResponse>('/repo/push', body),
  merge: (ref: string, noFf?: boolean) => post<WriteResponse>('/repo/merge', { ref, noFf }),
  rebase: (onto: string) => post<WriteResponse>('/repo/rebase', { onto }),
  cherryPick: (hashes: string[]) => post<WriteResponse>('/repo/cherry-pick', { hashes }),
  operation: (kind: string, action: 'continue' | 'abort' | 'skip') =>
    post<WriteResponse>(`/repo/operation/${kind}`, { action }),

  stashPush: (body: { message?: string; includeUntracked?: boolean; paths?: string[] }) =>
    post<WriteResponse>('/repo/stash', body),
  stashApply: (ref: string) => post<WriteResponse>('/repo/stash/apply', { ref }),
  stashPop: (ref: string) => post<WriteResponse>('/repo/stash/pop', { ref }),
  stashDrop: (ref: string) => post<WriteResponse>('/repo/stash/drop', { ref }),

  reflog: () => request<ReflogEntry[]>('/repo/reflog'),
  checkoutReflog: (selector: string) => post<RepoSummary>('/repo/reflog/checkout', { selector }),

  createTag: (body: { name: string; message?: string; ref?: string }) =>
    post<{ ok: boolean }>('/repo/tag', body),
  deleteTag: (name: string) => post<{ ok: boolean }>('/repo/tag/delete', { name }),
  pushTag: (name: string, remote?: string) => post<JobResponse>('/repo/tag/push', { name, remote }),

  addRemote: (name: string, url: string) => post<{ ok: boolean }>('/repo/remote', { name, url }),
  removeRemote: (name: string) => post<{ ok: boolean }>('/repo/remote/remove', { name }),
  setRemoteUrl: (name: string, url: string) =>
    post<{ ok: boolean }>('/repo/remote/url', { name, url }),

  reset: (body: { mode: 'soft' | 'mixed' | 'hard'; ref: string; confirm?: boolean }) =>
    post<WriteResponse>('/repo/reset', body),
  clean: (body: { paths?: string[]; confirm?: boolean }) => post<WriteResponse>('/repo/clean', body),
  restore: (body: { paths: string[]; confirm?: boolean }) => post<WriteResponse>('/repo/restore', body),

  undoList: () => request<UndoEntry[]>('/undo'),
  applyUndo: (id: string) => post<{ ok: boolean }>(`/undo/${encodeURIComponent(id)}`),

  job: (id: string) => request<Job>(`/jobs/${id}`),
  cancelJob: (id: string) => post<{ ok: boolean }>(`/jobs/${id}/cancel`),
};

export function subscribeJob(
  id: string,
  onJob: (job: Job) => void,
  onEnd: (job: Job) => void,
): () => void {
  if (getTauriInternals()) {
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        try {
          const updated = await api.job(id);
          if (stopped) return;
          onJob(updated);
          if (['done', 'error', 'cancelled'].includes(updated.status)) {
            stopped = true;
            onEnd(updated);
            return;
          }
        } catch {
          stopped = true;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }

  const source = new EventSource(`/api/jobs/${id}/events`);
  const handleJob = (event: MessageEvent<string>) => {
    try {
      onJob(JSON.parse(event.data) as Job);
    } catch {
      return;
    }
  };
  const handleEnd = (event: MessageEvent<string>) => {
    try {
      onEnd(JSON.parse(event.data) as Job);
    } finally {
      source.close();
    }
  };
  source.addEventListener('job', handleJob as EventListener);
  source.addEventListener('end', handleEnd as EventListener);
  source.onerror = () => source.close();
  return () => source.close();
}

export type {
  AppConfig,
  BlameResponse,
  Branch,
  CherryPickSchema,
  CleanSchema,
  CommitDetail,
  CommunityThemesResponse,
  ConflictsResponse,
  DiffResponse,
  DirectoryListing,
  FileHistoryResponse,
  HistoryPage,
  Job,
  OnboardingReport,
  RecentRepo,
  Remote,
  RepoSummary,
  ResetSchema,
  RestoreSchema,
  Session,
  SettingsPatch,
  Stash,
  Status,
  Tag,
  UndoEntry,
};
