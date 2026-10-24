import { z } from 'zod';

export const API_REQUEST_HEADER = 'x-gitastic-request';
export const MIN_GIT_VERSION = '2.38.0';

export const OperationKindSchema = z.enum(['merge', 'rebase', 'cherry-pick', 'revert']);
export type OperationKind = z.infer<typeof OperationKindSchema>;

export const RepoRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

export const RecentRepoSchema = RepoRefSchema.extend({
  lastOpened: z.string(),
});
export type RecentRepo = z.infer<typeof RecentRepoSchema>;

export const RepoSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  root: z.string(),
  head: z.string().nullable(),
  branch: z.string().nullable(),
  detached: z.boolean(),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  operation: OperationKindSchema.nullable(),
  dirty: z.number().int().nonnegative(),
  staged: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  lastCommit: z.string().nullable(),
});
export type RepoSummary = z.infer<typeof RepoSummarySchema>;

export const FileKindSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
  'untracked',
  'conflicted',
  'unknown',
]);
export type FileKind = z.infer<typeof FileKindSchema>;

export const FileStatusSchema = z.object({
  path: z.string(),
  origPath: z.string().nullable(),
  index: z.string(),
  worktree: z.string(),
  staged: z.boolean(),
  unstaged: z.boolean(),
  untracked: z.boolean(),
  conflicted: z.boolean(),
  kind: FileKindSchema,
});
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const StatusSchema = z.object({
  branch: z.string().nullable(),
  head: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  operation: OperationKindSchema.nullable(),
  files: z.array(FileStatusSchema),
});
export type Status = z.infer<typeof StatusSchema>;

export const CommitBaseSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  parents: z.array(z.string()),
  authorName: z.string(),
  authorEmail: z.string(),
  authorDate: z.string(),
  committerName: z.string(),
  committerEmail: z.string(),
  committerDate: z.string(),
  subject: z.string(),
  body: z.string(),
  refs: z.array(z.string()),
});
export type CommitBase = z.infer<typeof CommitBaseSchema>;

export const CommitSummarySchema = CommitBaseSchema.extend({
  lane: z.number().int().nonnegative(),
  activeLanes: z.array(z.number().int().nonnegative()),
  nextActiveLanes: z.array(z.number().int().nonnegative()),
  parentLanes: z.array(z.number().int().nonnegative()),
  laneBranches: z.array(
    z.object({
      lane: z.number().int().nonnegative(),
      labels: z.array(z.string()),
    }),
  ),
  maxLanes: z.number().int().positive(),
});
export type CommitSummary = z.infer<typeof CommitSummarySchema>;

export const HistoryPageSchema = z.object({
  commits: z.array(CommitSummarySchema),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  maxLanes: z.number().int().positive(),
  ref: z.string().nullable(),
  query: z.string().nullable(),
});
export type HistoryPage = z.infer<typeof HistoryPageSchema>;

export const DiffFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: FileKindSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const DiffResponseSchema = z.object({
  path: z.string().nullable(),
  staged: z.boolean(),
  patch: z.string(),
  files: z.array(DiffFileSchema),
  binary: z.boolean(),
  tooLarge: z.boolean(),
});
export type DiffResponse = z.infer<typeof DiffResponseSchema>;

export const CommitDetailSchema = z.object({
  commit: CommitBaseSchema,
  files: z.array(DiffFileSchema),
  patch: z.string(),
  binary: z.boolean(),
  tooLarge: z.boolean(),
});
export type CommitDetail = z.infer<typeof CommitDetailSchema>;

export const BranchSchema = z.object({
  name: z.string(),
  ref: z.string(),
  hash: z.string(),
  upstream: z.string().nullable(),
  current: z.boolean(),
  remote: z.boolean(),
  date: z.string().nullable(),
  subject: z.string(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const TagSchema = z.object({
  name: z.string(),
  ref: z.string(),
  hash: z.string(),
  type: z.string(),
  tagger: z.string().nullable(),
  date: z.string().nullable(),
  subject: z.string(),
});
export type Tag = z.infer<typeof TagSchema>;

export const RemoteSchema = z.object({
  name: z.string(),
  url: z.string(),
  pushUrl: z.string(),
});
export type Remote = z.infer<typeof RemoteSchema>;

export const StashSchema = z.object({
  index: z.number().int().nonnegative(),
  ref: z.string(),
  hash: z.string(),
  message: z.string(),
  date: z.string(),
});
export type Stash = z.infer<typeof StashSchema>;

export const BlameLineSchema = z.object({
  line: z.number().int().positive(),
  hash: z.string(),
  shortHash: z.string(),
  author: z.string(),
  email: z.string(),
  date: z.string(),
  summary: z.string(),
  content: z.string(),
});
export type BlameLine = z.infer<typeof BlameLineSchema>;

export const BlameResponseSchema = z.object({
  path: z.string(),
  lines: z.array(BlameLineSchema),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type BlameResponse = z.infer<typeof BlameResponseSchema>;

export const FileHistoryResponseSchema = z.object({
  path: z.string(),
  commits: z.array(CommitBaseSchema),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type FileHistoryResponse = z.infer<typeof FileHistoryResponseSchema>;

export const ConflictBlockSchema = z.object({
  id: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  ours: z.string(),
  theirs: z.string(),
  base: z.string().nullable(),
});
export type ConflictBlock = z.infer<typeof ConflictBlockSchema>;

export const ConflictFileSchema = z.object({
  path: z.string(),
  kind: FileKindSchema,
  binary: z.boolean(),
  content: z.string().nullable(),
  blocks: z.array(ConflictBlockSchema),
});
export type ConflictFile = z.infer<typeof ConflictFileSchema>;

export const ConflictsResponseSchema = z.object({
  operation: OperationKindSchema.nullable(),
  files: z.array(ConflictFileSchema),
});
export type ConflictsResponse = z.infer<typeof ConflictsResponseSchema>;

export const UndoEntrySchema = z.object({
  id: z.string(),
  repoId: z.string(),
  kind: z.string(),
  label: z.string(),
  createdAt: z.string(),
  payload: z.unknown(),
});
export type UndoEntry = z.infer<typeof UndoEntrySchema>;

export const UI_STYLE_IDS = [
  'gorgeous',
  'focus',
  'synthwave',
  'transilvania',
  'ubernerd',
  'daybreak',
  'vellum',
  'blueprint',
  'lemon-baby',
  '8bit',
] as const;
export const UiStyleSchema = z.enum(UI_STYLE_IDS);
export type UiStyle = z.infer<typeof UiStyleSchema>;

export const SettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  uiStyle: UiStyleSchema.default('gorgeous'),
  gitPath: z.string().min(1),
  editor: z.string(),
  pullStrategy: z.enum(['ff-only', 'merge', 'rebase']),
  diffContext: z.number().int().min(0).max(20),
  confirmDestructive: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const AppConfigSchema = SettingsSchema.extend({
  repoRoots: z.array(z.string()),
  recentRepos: z.array(RecentRepoSchema),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const SettingsPatchSchema = SettingsSchema.partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const OnboardingCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['ok', 'warn', 'error']),
  detail: z.string(),
  hint: z.string().nullable(),
});
export type OnboardingCheck = z.infer<typeof OnboardingCheckSchema>;

export const OnboardingReportSchema = z.object({
  home: z.string(),
  root: z.string(),
  gitVersion: z.string().nullable(),
  minGitVersion: z.string(),
  checks: z.array(OnboardingCheckSchema),
});
export type OnboardingReport = z.infer<typeof OnboardingReportSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'done', 'error', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  id: z.string(),
  type: z.string(),
  repoId: z.string().nullable(),
  status: JobStatusSchema,
  progress: z.number().min(0).max(1).nullable(),
  message: z.string(),
  output: z.array(z.string()),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  result: z.unknown().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const SessionSchema = z.object({
  repo: RepoSummarySchema.nullable(),
  config: AppConfigSchema,
  onboarding: OnboardingReportSchema,
});
export type Session = z.infer<typeof SessionSchema>;

export const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isRepo: z.boolean(),
  isDirectory: z.boolean(),
});
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;

export const DirectoryListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(DirectoryEntrySchema),
});
export type DirectoryListing = z.infer<typeof DirectoryListingSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const OpenRepoSchema = z.object({ path: z.string().min(1) });
export const CloneRepoSchema = z.object({ url: z.string().min(1), path: z.string().min(1) });
export const StageSchema = z.object({ paths: z.array(z.string()).default([]) });
export const CommitRequestSchema = z.object({
  message: z.string().min(1),
  amend: z.boolean().optional(),
  signoff: z.boolean().optional(),
});
export const BranchCreateSchema = z.object({ name: z.string().min(1), startPoint: z.string().optional() });
export const BranchDeleteSchema = z.object({ name: z.string().min(1), force: z.boolean().optional() });
export const BranchRenameSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });
export const CheckoutSchema = z.object({ ref: z.string().min(1) });
export const UpstreamSchema = z.object({ branch: z.string().min(1), upstream: z.string().min(1) });
export const FetchSchema = z.object({ remote: z.string().optional() });
export const PullSchema = z.object({ strategy: z.enum(['ff-only', 'merge', 'rebase']).optional() });
export const PushSchema = z.object({
  remote: z.string().optional(),
  branch: z.string().optional(),
  force: z.boolean().optional(),
  setUpstream: z.boolean().optional(),
});
export const MergeSchema = z.object({ ref: z.string().min(1), noFf: z.boolean().optional() });
export const RebaseSchema = z.object({ onto: z.string().min(1) });
export const CherryPickSchema = z.object({ hashes: z.array(z.string().min(1)).min(1) });
export const OperationActionSchema = z.object({ action: z.enum(['continue', 'abort', 'skip']) });
export const StashPushSchema = z.object({
  message: z.string().optional(),
  includeUntracked: z.boolean().optional(),
});
export const StashRefSchema = z.object({ ref: z.string().min(1) });
export const TagCreateSchema = z.object({
  name: z.string().min(1),
  message: z.string().optional(),
  ref: z.string().optional(),
});
export const TagDeleteSchema = z.object({ name: z.string().min(1) });
export const TagPushSchema = z.object({ name: z.string().min(1), remote: z.string().optional() });
export const RemoteAddSchema = z.object({ name: z.string().min(1), url: z.string().min(1) });
export const RemoteRemoveSchema = z.object({ name: z.string().min(1) });
export const RemoteUrlSchema = z.object({ name: z.string().min(1), url: z.string().min(1) });
export const ResetSchema = z.object({
  mode: z.enum(['soft', 'mixed', 'hard']),
  ref: z.string().min(1),
  confirm: z.boolean().optional(),
});
export const CleanSchema = z.object({
  paths: z.array(z.string()).optional(),
  confirm: z.boolean().optional(),
});
export const RestoreSchema = z.object({
  paths: z.array(z.string()).min(1),
  confirm: z.boolean().optional(),
});
export const ConflictResolveSchema = z.object({ path: z.string().min(1), content: z.string() });
export const ConflictBinarySchema = z.object({
  path: z.string().min(1),
  side: z.enum(['ours', 'theirs']),
});

export const ProviderKindSchema = z.enum(['github', 'gitlab']);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const ProviderAccountStatusSchema = z.object({
  provider: ProviderKindSchema,
  host: z.string(),
  connected: z.boolean(),
  username: z.string().nullable(),
  method: z.enum(['gh-cli', 'glab-cli', 'git-credential', 'none']),
  cliInstalled: z.boolean(),
  detail: z.string(),
});
export type ProviderAccountStatus = z.infer<typeof ProviderAccountStatusSchema>;

export const SshKeyEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  publicPath: z.string().nullable(),
  publicKey: z.string().nullable(),
  loaded: z.boolean(),
});
export type SshKeyEntry = z.infer<typeof SshKeyEntrySchema>;

export const ProvidersStatusResponseSchema = z.object({
  accounts: z.array(ProviderAccountStatusSchema),
  sshKeys: z.array(SshKeyEntrySchema),
  credentialHelper: z.string().nullable(),
});
export type ProvidersStatusResponse = z.infer<typeof ProvidersStatusResponseSchema>;

export const ProviderRepoSchema = z.object({
  id: z.string(),
  provider: ProviderKindSchema,
  host: z.string(),
  name: z.string(),
  fullName: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  defaultBranch: z.string().nullable(),
  updatedAt: z.string().nullable(),
  webUrl: z.string(),
  cloneUrl: z.string(),
  sshUrl: z.string(),
});
export type ProviderRepo = z.infer<typeof ProviderRepoSchema>;

export const RemoteProviderInfoSchema = z.object({
  remoteName: z.string(),
  provider: ProviderKindSchema,
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  fullName: z.string(),
  webUrl: z.string(),
  pullsUrl: z.string(),
  issuesUrl: z.string(),
  branchUrlTemplate: z.string(),
  commitUrlTemplate: z.string(),
  createPullUrlTemplate: z.string(),
});
export type RemoteProviderInfo = z.infer<typeof RemoteProviderInfoSchema>;

export const PullRequestItemSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  provider: ProviderKindSchema,
  title: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  draft: z.boolean(),
  author: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  updatedAt: z.string(),
  webUrl: z.string(),
});
export type PullRequestItem = z.infer<typeof PullRequestItemSchema>;

export const PullRequestsResponseSchema = z.object({
  remote: RemoteProviderInfoSchema.nullable(),
  items: z.array(PullRequestItemSchema),
  authHint: z.string().nullable(),
});
export type PullRequestsResponse = z.infer<typeof PullRequestsResponseSchema>;

export const ProviderConnectSchema = z.object({
  provider: ProviderKindSchema,
  host: z.string().min(1).optional(),
  username: z.string().optional(),
  token: z.string().min(1),
});
export const ProviderDisconnectSchema = z.object({
  provider: ProviderKindSchema,
  host: z.string().min(1),
});
export const SshAddKeySchema = z.object({
  path: z.string().min(1),
  passphrase: z.string().optional(),
});
export const SshRemoveKeySchema = z.object({
  path: z.string().min(1),
  deleteFiles: z.boolean().optional(),
});
export const GitIdentitySchema = z.object({
  name: z.string(),
  email: z.string(),
});
export type GitIdentity = z.infer<typeof GitIdentitySchema>;
export const SshGenerateKeySchema = z.object({ label: z.string().optional() });

export const ApplyPatchSchema = z.object({
  patch: z.string().min(1),
  cached: z.boolean().optional(),
  reverse: z.boolean().optional(),
});

export const WorktreeSchema = z.object({
  path: z.string(),
  head: z.string(),
  branch: z.string().nullable(),
  bare: z.boolean(),
  detached: z.boolean(),
  locked: z.boolean(),
  prunable: z.boolean(),
  isMain: z.boolean(),
});
export type Worktree = z.infer<typeof WorktreeSchema>;

export const WorktreeAddSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  createBranch: z.boolean().optional(),
  startPoint: z.string().optional(),
});
export const WorktreeRemoveSchema = z.object({
  path: z.string().min(1),
  force: z.boolean().optional(),
});
export const SystemPathActionSchema = z.object({
  path: z.string().optional(),
});
export const PullRequestCheckoutSchema = z.object({
  number: z.number().int().positive(),
  sourceBranch: z.string().min(1),
  remote: z.string().optional(),
});

export function buildRemoteBranchUrl(info: RemoteProviderInfo, branch: string): string {
  const clean = branch.replace(/^refs\/heads\//, '').replace(/^origin\//, '');
  return info.branchUrlTemplate.replace('{branch}', encodeURIComponent(clean).replace(/%2F/g, '/'));
}

export function buildRemoteCommitUrl(info: RemoteProviderInfo, hash: string): string {
  return info.commitUrlTemplate.replace('{hash}', encodeURIComponent(hash));
}

export function buildCreatePullUrl(info: RemoteProviderInfo, branch: string): string {
  const clean = branch.replace(/^refs\/heads\//, '').replace(/^origin\//, '');
  return info.createPullUrlTemplate.replace(
    '{branch}',
    encodeURIComponent(clean).replace(/%2F/g, '/'),
  );
}

export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

export function formatRelativeDate(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}
