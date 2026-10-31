import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  API_REQUEST_HEADER,
  MIN_GIT_VERSION,
  ApplyPatchSchema,
  BranchCreateSchema,
  BranchDeleteSchema,
  BranchRenameSchema,
  CheckoutSchema,
  CherryPickSchema,
  CleanSchema,
  CloneRepoSchema,
  CommitRequestSchema,
  ConflictBinarySchema,
  ConflictResolveSchema,
  FetchSchema,
  GitIdentitySchema,
  MergeSchema,
  OpenRepoSchema,
  OperationActionSchema,
  OperationKindSchema,
  ProviderConnectSchema,
  ProviderDisconnectSchema,
  ProviderKindSchema,
  ReflogCheckoutSchema,
  PullRequestApproveSchema,
  PullRequestCheckoutSchema,
  PullRequestCommentCreateSchema,
  PullSchema,
  PushSchema,
  RebaseSchema,
  RemoteAddSchema,
  RemoteRemoveSchema,
  RemoteUrlSchema,
  ResetSchema,
  RestoreSchema,
  SettingsPatchSchema,
  SshAddKeySchema,
  SshGenerateKeySchema,
  SshRemoveKeySchema,
  StageSchema,
  StashPushSchema,
  StashRefSchema,
  SystemPathActionSchema,
  TagCreateSchema,
  TagDeleteSchema,
  TagPushSchema,
  ThemeImportSchema,
  UpstreamSchema,
  WorktreeAddSchema,
  WorktreeRemoveSchema,
  type OperationKind,
  type ProviderKind,
  type UndoEntry,
} from '@gitastic/shared';
import { dataDir, homeDir } from './config';
import { AppError, errorMessage } from './errors';
import { getConflicts, resolveBinaryConflict, resolveConflictFile } from './git/conflict';
import { getBlame, getFileHistory } from './git/history';
import {
  addSshKeyToAgent,
  approvePullRequest,
  checkoutPullRequest,
  connectProviderAccount,
  createPullRequestComment,
  disconnectProviderAccount,
  generateSshKey,
  getGitIdentity,
  getProvidersStatus,
  getPullRequestDetail,
  listProviderRepos,
  listRepoPullRequests,
  removeSshKey,
  selectPrimaryRemoteInfo,
  setGitIdentity,
} from './git/providers';
import {
  getCommitDetail,
  getDiff,
  getStatus,
  listBranches,
  listRemotes,
  listStashes,
  listTags,
  listWorktrees,
  listReflog,
  checkoutReflog,
} from './git/repo';
import {
  backupWorkingTree,
  createBackupRef,
  restoreTrash,
  saveBranchToTrash,
} from './git/safety';
import * as write from './git/write';
import { assertRepoFile, assertInsideRoots, listDirectories, toPosix } from './security/paths';
import { installCommunityTheme, listCommunityThemes } from './community-themes';
import { deleteTheme, ensureThemesDir, importTheme, listThemes, readThemeCss } from './themes';
import type { AppState, OpenRepo } from './state';

export interface BuildAppOptions {
  state: AppState;
  webDist: string | null;
  dev: boolean;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request body', result.error.flatten());
  }
  return result.data;
}

function queryValue(request: FastifyRequest, key: string): string | undefined {
  const query = request.query as Record<string, unknown>;
  const value = query[key];
  return typeof value === 'string' ? value : undefined;
}

function queryNumber(
  request: FastifyRequest,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(queryValue(request, key) ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function repoFor(state: AppState, request: FastifyRequest): OpenRepo {
  return state.getRepo(queryValue(request, 'repo'));
}

async function relativePath(repoPath: string, input: string): Promise<string> {
  const absolute = await assertRepoFile(repoPath, input);
  return toPosix(path.relative(repoPath, absolute));
}

function outputOf(result: { stdout: string; stderr: string }): string {
  return (result.stderr || result.stdout).trim();
}

function createUndo(
  state: AppState,
  repo: OpenRepo,
  kind: string,
  label: string,
  payload: unknown,
): UndoEntry {
  const entry: UndoEntry = {
    id: randomUUID(),
    repoId: repo.id,
    kind,
    label,
    createdAt: new Date().toISOString(),
    payload,
  };
  state.pushUndo(entry);
  return entry;
}

async function finalizeConflictable(
  state: AppState,
  repo: OpenRepo,
  result: { exitCode: number; stdout: string; stderr: string },
  label: string,
  backupRef: string | null,
  trashDir?: string,
): Promise<{ ok: boolean; conflicted: boolean; operation: OperationKind | null; output: string; undo?: UndoEntry }> {
  const status = await getStatus(state.runner, repo.path);
  state.invalidate(repo.id);

  if (result.exitCode === 0) {
    const undo = backupRef
      ? createUndo(state, repo, 'reset', label, { type: 'reset', backupRef, trashDir })
      : undefined;
    return { ok: true, conflicted: false, operation: status.operation, output: outputOf(result), undo };
  }

  if (status.operation || status.files.some((file) => file.conflicted)) {
    return {
      ok: false,
      conflicted: true,
      operation: status.operation,
      output: outputOf(result),
    };
  }

  throw new AppError(422, 'GIT_FAILED', result.stderr.trim() || `${label} failed`, {
    exitCode: result.exitCode,
    stderr: result.stderr,
  });
}

async function applyUndo(state: AppState, repo: OpenRepo, entry: UndoEntry): Promise<void> {
  const payload = entry.payload as
    | { type: 'reset'; backupRef: string; trashDir?: string }
    | { type: 'branch-delete'; name: string; trashRef: string }
    | { type: 'clean'; trashDir: string }
    | { type: 'restore'; trashDir: string };

  if (payload.type === 'reset') {
    await state.runner.run(repo.path, ['reset', '--hard', payload.backupRef]);
    if (payload.trashDir) await restoreTrash(payload.trashDir, repo.path);
  } else if (payload.type === 'branch-delete') {
    await state.runner.run(repo.path, ['update-ref', `refs/heads/${payload.name}`, payload.trashRef]);
  } else if (payload.type === 'clean' || payload.type === 'restore') {
    await restoreTrash(payload.trashDir, repo.path);
  } else {
    throw new AppError(400, 'UNKNOWN_UNDO', 'This action cannot be undone.');
  }
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { state, webDist, dev } = options;
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  await ensureThemesDir();

  const allowedOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);
  if (process.env.GITASTIC_WEB_ORIGIN) allowedOrigins.add(process.env.GITASTIC_WEB_ORIGIN);

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api')) return;

    const remote = request.ip;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      throw new AppError(403, 'LOOPBACK_ONLY', 'Gitastic only accepts local connections.');
    }

    const origin = request.headers.origin;
    if (origin) {
      const host = request.headers.host;
      const sameOrigin = host ? origin === `http://${host}` || origin === `https://${host}` : false;
      const devOrigin = Boolean(dev) && isLoopbackOrigin(origin);
      if (!sameOrigin && !allowedOrigins.has(origin) && !devOrigin) {
        throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.');
      }
    }

    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers[API_REQUEST_HEADER] !== '1'
    ) {
      throw new AppError(403, 'MISSING_REQUEST_HEADER', 'Missing Gitastic request header.');
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.status).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: errorMessage(error) },
    });
  });

  app.get('/api/health', async () => ({
    ok: true,
    version: '1.0.0',
    gitVersion: await state.runner.version(),
    minGitVersion: MIN_GIT_VERSION,
  }));

  app.get('/api/session', async () => state.session());
  app.get('/api/onboarding', async () => state.onboarding());
  app.get('/api/settings', async () => state.config);
  app.put('/api/settings', async (request) => {
    const patch = parseBody(SettingsPatchSchema, request.body);
    return state.updateSettings(patch);
  });

  app.get('/api/themes', async () => ({ themes: await listThemes() }));

  app.get('/api/themes/community', async () => ({ themes: await listCommunityThemes() }));

  app.post('/api/themes/community/:id/install', async (request) => {
    const { id } = request.params as { id: string };
    return installCommunityTheme(id);
  });

  app.post('/api/themes', async (request) => {
    const body = parseBody(ThemeImportSchema, request.body);
    return importTheme(body.css);
  });

  app.get('/api/themes/:id/css', async (request, reply) => {
    const { id } = request.params as { id: string };
    const css = await readThemeCss(id);
    if (!css) throw new AppError(404, 'THEME_NOT_FOUND', `Unknown theme: ${id}`);
    reply.type('text/css; charset=utf-8');
    return css;
  });

  app.delete('/api/themes/:id', async (request) => {
    const { id } = request.params as { id: string };
    const removed = await deleteTheme(id);
    if (!removed) throw new AppError(404, 'THEME_NOT_FOUND', `Unknown theme: ${id}`);
    return { ok: true };
  });

  app.post('/api/cache/clear', async () => {
    await state.clearCache();
    return { ok: true };
  });

  app.get('/api/fs/list', async (request) =>
    listDirectories(queryValue(request, 'path'), state.config.repoRoots, homeDir),
  );

  app.get('/api/repos/recent', async () => state.config.recentRepos);

  app.get('/api/providers/status', async () => {
    const extraHosts: Array<{ provider: ProviderKind; host: string }> = [];
    try {
      const current = state.getRepo();
      const remotes = await listRemotes(state.runner, current.path);
      const info = selectPrimaryRemoteInfo(remotes);
      if (info) {
        extraHosts.push({ provider: info.provider, host: info.host });
      }
    } catch {
      // No open repo
    }
    return getProvidersStatus(state.runner, extraHosts);
  });

  app.post('/api/providers/connect', async (request) => {
    const body = parseBody(ProviderConnectSchema, request.body);
    return connectProviderAccount(state.runner, body);
  });

  app.post('/api/providers/disconnect', async (request) => {
    const body = parseBody(ProviderDisconnectSchema, request.body);
    return disconnectProviderAccount(state.runner, body);
  });

  app.get('/api/providers/repos', async (request) => {
    const providerRaw = queryValue(request, 'provider') ?? 'github';
    const parsedProvider = ProviderKindSchema.safeParse(providerRaw);
    if (!parsedProvider.success) {
      throw new AppError(400, 'INVALID_PROVIDER', 'Provider must be github or gitlab.');
    }
    return listProviderRepos(state.runner, {
      provider: parsedProvider.data,
      host: queryValue(request, 'host'),
      query: queryValue(request, 'q'),
    });
  });

  app.post('/api/providers/ssh/add', async (request) => {
    const body = parseBody(SshAddKeySchema, request.body);
    return addSshKeyToAgent(body.path, body.passphrase);
  });

  app.post('/api/providers/ssh/generate', async (request) => {
    const body = parseBody(SshGenerateKeySchema, request.body ?? {});
    return generateSshKey(body.label);
  });

  app.post('/api/providers/ssh/remove', async (request) => {
    const body = parseBody(SshRemoveKeySchema, request.body);
    return removeSshKey(body.path, body.deleteFiles);
  });

  app.get('/api/git-identity', async () => getGitIdentity(state.runner));

  app.put('/api/git-identity', async (request) => {
    const body = parseBody(GitIdentitySchema, request.body);
    return setGitIdentity(state.runner, body);
  });

  app.post('/api/repos/open', async (request) => {
    const body = parseBody(OpenRepoSchema, request.body);
    return state.openRepo(body.path);
  });

  app.post('/api/repos/close', async () => {
    state.closeRepo();
    return { ok: true };
  });

  app.post('/api/repos/clone', async (request, reply) => {
    const body = parseBody(CloneRepoSchema, request.body);
    const target = await assertInsideRoots(body.path, state.config.repoRoots, homeDir);
    const parent = path.dirname(target);
    const parentStat = await fsp.stat(parent).catch(() => null);
    if (!parentStat || !parentStat.isDirectory()) {
      throw new AppError(400, 'PARENT_NOT_FOUND', `Target parent directory does not exist: ${parent}`);
    }
    const targetStat = await fsp.stat(target).catch(() => null);
    if (targetStat) {
      throw new AppError(400, 'TARGET_EXISTS', `Target already exists: ${target}`);
    }

    const job = state.jobs.start('clone', null, async (context) => {
      const result = await write.clone(state.runner, body.url, target, {
        signal: context.signal,
        onProgress: context.output,
      });
      if (result.exitCode !== 0) {
        throw new AppError(422, 'CLONE_FAILED', result.stderr.trim() || 'Clone failed');
      }
      return state.openRepo(target);
    });

    return reply.code(202).send({ job });
  });

  app.get('/api/repo', async (request) => state.summary(queryValue(request, 'repo')));
  app.get('/api/repo/status', async (request) => {
    const repo = repoFor(state, request);
    return getStatus(state.runner, repo.path);
  });

  app.get('/api/repo/history', async (request) => {
    const repo = repoFor(state, request);
    return state.historyPage(repo.id, {
      offset: queryNumber(request, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
      limit: queryNumber(request, 'limit', 100, 1, 500),
      ref: queryValue(request, 'ref') ?? null,
      query: queryValue(request, 'q') ?? null,
    });
  });

  app.get('/api/repo/commit/:hash', async (request) => {
    const repo = repoFor(state, request);
    const hash = (request.params as { hash: string }).hash;
    return getCommitDetail(state.runner, repo.path, hash, state.config.diffContext);
  });

  app.get('/api/repo/diff', async (request) => {
    const repo = repoFor(state, request);
    const filePath = queryValue(request, 'path');
    const status = await getStatus(state.runner, repo.path);
    const file = filePath ? status.files.find((entry) => entry.path === filePath) : undefined;
    return getDiff(state.runner, repo.path, {
      staged: queryValue(request, 'staged') === 'true',
      path: filePath,
      context: queryNumber(request, 'context', state.config.diffContext, 0, 20),
      untracked: file?.untracked ?? false,
    });
  });

  app.get('/api/repo/branches', async (request) => {
    const repo = repoFor(state, request);
    return listBranches(state.runner, repo.path);
  });

  app.get('/api/repo/tags', async (request) => {
    const repo = repoFor(state, request);
    return listTags(state.runner, repo.path);
  });

  app.get('/api/repo/remotes', async (request) => {
    const repo = repoFor(state, request);
    return listRemotes(state.runner, repo.path);
  });

  app.get('/api/repo/provider', async (request) => {
    const repo = repoFor(state, request);
    const remotes = await listRemotes(state.runner, repo.path);
    return { remote: selectPrimaryRemoteInfo(remotes) };
  });

  app.get('/api/repo/pulls', async (request) => {
    const repo = repoFor(state, request);
    return listRepoPullRequests(state.runner, repo.path);
  });

  app.get('/api/repo/pulls/:number', async (request) => {
    const repo = repoFor(state, request);
    const number = Number((request.params as { number: string }).number);
    if (!Number.isInteger(number) || number <= 0) {
      throw new AppError(400, 'INVALID_PULL_REQUEST', 'Pull request number is invalid.');
    }
    return getPullRequestDetail(state.runner, repo.path, number);
  });

  app.post('/api/repo/pulls/:number/comments', async (request) => {
    const repo = repoFor(state, request);
    const number = Number((request.params as { number: string }).number);
    if (!Number.isInteger(number) || number <= 0) {
      throw new AppError(400, 'INVALID_PULL_REQUEST', 'Pull request number is invalid.');
    }
    const body = parseBody(PullRequestCommentCreateSchema, request.body);
    return createPullRequestComment(state.runner, repo.path, number, body);
  });

  app.post('/api/repo/pulls/:number/approve', async (request) => {
    const repo = repoFor(state, request);
    const number = Number((request.params as { number: string }).number);
    if (!Number.isInteger(number) || number <= 0) {
      throw new AppError(400, 'INVALID_PULL_REQUEST', 'Pull request number is invalid.');
    }
    const body = parseBody(PullRequestApproveSchema, request.body ?? {});
    return approvePullRequest(state.runner, repo.path, number, body.body);
  });

  app.post('/api/repo/pulls/checkout', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(PullRequestCheckoutSchema, request.body);
    await checkoutPullRequest(state.runner, repo.path, body);
    state.invalidate(repo.id);
    return state.summary(repo.id);
  });

  app.get('/api/repo/stashes', async (request) => {
    const repo = repoFor(state, request);
    return listStashes(state.runner, repo.path);
  });

  app.get('/api/repo/reflog', async (request) => {
    const repo = repoFor(state, request);
    return listReflog(state.runner, repo.path);
  });

  app.post('/api/repo/reflog/checkout', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(ReflogCheckoutSchema, request.body);
    await checkoutReflog(state.runner, repo.path, body.selector);
    state.invalidate(repo.id);
    return state.summary(repo.id);
  });

  app.get('/api/repo/worktrees', async (request) => {
    const repo = repoFor(state, request);
    return listWorktrees(state.runner, repo.path);
  });

  app.post('/api/repo/worktrees/add', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(WorktreeAddSchema, request.body);
    const target = await assertInsideRoots(body.path, state.config.repoRoots, homeDir);
    await write.addWorktree(state.runner, repo.path, {
      path: target,
      branch: body.branch,
      createBranch: body.createBranch,
      startPoint: body.startPoint,
    });
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.post('/api/repo/worktrees/remove', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(WorktreeRemoveSchema, request.body);
    await write.removeWorktree(state.runner, repo.path, body.path, body.force);
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.post('/api/repo/apply-patch', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(ApplyPatchSchema, request.body);
    const result = await write.applyPatch(state.runner, repo.path, body);
    state.invalidate(repo.id);
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/system/reveal', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(SystemPathActionSchema, request.body ?? {});
    const target = body.path ? await assertRepoFile(repo.path, body.path) : repo.path;
    const { execa } = await import('execa');
    await execa('open', ['-R', target], { reject: false });
    return { ok: true };
  });

  app.post('/api/system/terminal', async (request) => {
    const repo = repoFor(state, request);
    const { execa } = await import('execa');
    await execa('open', ['-a', 'Terminal', repo.path], { reject: false });
    return { ok: true };
  });

  app.post('/api/system/editor', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(SystemPathActionSchema, request.body ?? {});
    const target = body.path ? await assertRepoFile(repo.path, body.path) : repo.path;
    const { execa } = await import('execa');
    const candidates = ['cursor', 'zed', 'code'];
    let opened = false;
    for (const bin of candidates) {
      const res = await execa(bin, [target], { reject: false });
      if (res.exitCode === 0) {
        opened = true;
        break;
      }
    }
    if (!opened) {
      await execa('open', [target], { reject: false });
    }
    return { ok: true };
  });

  app.get('/api/repo/blame', async (request) => {
    const repo = repoFor(state, request);
    const input = queryValue(request, 'path');
    if (!input) throw new AppError(400, 'MISSING_PATH', 'A file path is required.');
    const filePath = await relativePath(repo.path, input);
    return getBlame(
      state.runner,
      repo.path,
      filePath,
      queryNumber(request, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
      queryNumber(request, 'limit', 1000, 1, 5000),
    );
  });

  app.get('/api/repo/file-history', async (request) => {
    const repo = repoFor(state, request);
    const input = queryValue(request, 'path');
    if (!input) throw new AppError(400, 'MISSING_PATH', 'A file path is required.');
    const filePath = await relativePath(repo.path, input);
    return getFileHistory(
      state.runner,
      repo.path,
      filePath,
      queryNumber(request, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
      queryNumber(request, 'limit', 100, 1, 500),
    );
  });

  app.get('/api/repo/conflicts', async (request) => {
    const repo = repoFor(state, request);
    return getConflicts(state.runner, repo.path);
  });

  app.post('/api/repo/conflicts/resolve', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(ConflictResolveSchema, request.body);
    const filePath = await relativePath(repo.path, body.path);
    await resolveConflictFile(state.runner, repo.path, filePath, body.content);
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.post('/api/repo/conflicts/binary', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(ConflictBinarySchema, request.body);
    const filePath = await relativePath(repo.path, body.path);
    await resolveBinaryConflict(state.runner, repo.path, filePath, body.side);
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.post('/api/repo/stage', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(StageSchema, request.body);
    const paths = body.paths
      ? await Promise.all(body.paths.map((entry) => relativePath(repo.path, entry)))
      : [];
    const result = await write.stage(state.runner, repo.path, paths);
    state.invalidate(repo.id);
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/repo/unstage', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(StageSchema, request.body);
    const paths = body.paths
      ? await Promise.all(body.paths.map((entry) => relativePath(repo.path, entry)))
      : [];
    const result = await write.unstage(state.runner, repo.path, paths);
    state.invalidate(repo.id);
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/repo/commit', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(CommitRequestSchema, request.body);
    const result = await write.commit(state.runner, repo.path, body);
    state.invalidate(repo.id);
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/repo/branch', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(BranchCreateSchema, request.body);
    await write.createBranch(state.runner, repo.path, body.name, body.startPoint);
    state.invalidate(repo.id);
    return state.summary(repo.id);
  });

  app.post('/api/repo/branch/delete', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(BranchDeleteSchema, request.body);
    const trashRef = await saveBranchToTrash(state.runner, repo.path, body.name);
    await write.deleteBranch(state.runner, repo.path, body.name, body.force);
    const undo = trashRef
      ? createUndo(state, repo, 'branch-delete', `Delete branch ${body.name}`, {
          type: 'branch-delete',
          name: body.name,
          trashRef,
        })
      : undefined;
    state.invalidate(repo.id);
    return { ok: true, undo };
  });

  app.post('/api/repo/branch/rename', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(BranchRenameSchema, request.body);
    await write.renameBranch(state.runner, repo.path, body.from, body.to);
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.post('/api/repo/checkout', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(CheckoutSchema, request.body);
    await write.checkout(state.runner, repo.path, body.ref);
    state.invalidate(repo.id);
    return state.summary(repo.id);
  });

  app.post('/api/repo/upstream', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(UpstreamSchema, request.body);
    await write.setUpstream(state.runner, repo.path, body.branch, body.upstream);
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.post('/api/repo/fetch', async (request, reply) => {
    const repo = repoFor(state, request);
    const body = parseBody(FetchSchema, request.body ?? {});
    const job = state.jobs.start('fetch', repo.id, async (context) =>
      state.withRepoLock(repo.id, async () => {
        const result = await write.fetch(state.runner, repo.path, body.remote, {
          signal: context.signal,
          onProgress: context.output,
        });
        state.invalidate(repo.id);
        return { output: outputOf(result) };
      }),
    );
    return reply.code(202).send({ job });
  });

  app.post('/api/repo/pull', async (request, reply) => {
    const repo = repoFor(state, request);
    const body = parseBody(PullSchema, request.body ?? {});
    const job = state.jobs.start('pull', repo.id, async (context) =>
      state.withRepoLock(repo.id, async () => {
        const backupRef = await createBackupRef(state.runner, repo.path, 'pull');
        const trash = await backupWorkingTree(state.runner, repo.path, dataDir, repo.id, 'pull');
        const result = await write.pull(
          state.runner,
          repo.path,
          body.strategy ?? state.config.pullStrategy,
          { signal: context.signal, onProgress: context.output },
        );
        if (result.exitCode === 0 && backupRef) {
          createUndo(state, repo, 'reset', 'Pull', {
            type: 'reset',
            backupRef,
            trashDir: trash?.trashDir,
          });
        }
        state.invalidate(repo.id);
        return { output: outputOf(result), exitCode: result.exitCode };
      }),
    );
    return reply.code(202).send({ job });
  });

  app.post('/api/repo/push', async (request, reply) => {
    const repo = repoFor(state, request);
    const body = parseBody(PushSchema.extend({ confirm: z.boolean().optional() }), request.body ?? {});
    if (body.force && state.config.confirmDestructive && body.confirm !== true) {
      throw new AppError(400, 'CONFIRM_REQUIRED', 'Force-push requires explicit confirmation.');
    }
    const job = state.jobs.start('push', repo.id, async (context) =>
      state.withRepoLock(repo.id, async () => {
        const result = await write.push(state.runner, repo.path, {
          remote: body.remote,
          branch: body.branch,
          force: body.force,
          setUpstream: body.setUpstream,
          signal: context.signal,
          onProgress: context.output,
        });
        state.invalidate(repo.id);
        return { output: outputOf(result) };
      }),
    );
    return reply.code(202).send({ job });
  });

  app.post('/api/repo/merge', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(MergeSchema, request.body);
    const backupRef = await createBackupRef(state.runner, repo.path, 'merge');
    const result = await write.merge(state.runner, repo.path, body.ref, body.noFf);
    return finalizeConflictable(state, repo, result, 'Merge', backupRef);
  });

  app.post('/api/repo/rebase', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(RebaseSchema, request.body);
    const backupRef = await createBackupRef(state.runner, repo.path, 'rebase');
    const result = await write.rebase(state.runner, repo.path, body.onto);
    return finalizeConflictable(state, repo, result, 'Rebase', backupRef);
  });

  app.post('/api/repo/cherry-pick', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(CherryPickSchema, request.body);
    const backupRef = await createBackupRef(state.runner, repo.path, 'cherry-pick');
    const result = await write.cherryPick(state.runner, repo.path, body.hashes);
    return finalizeConflictable(state, repo, result, 'Cherry-pick', backupRef);
  });

  app.post('/api/repo/operation/:kind', async (request) => {
    const repo = repoFor(state, request);
    const kindResult = OperationKindSchema.safeParse((request.params as { kind: string }).kind);
    if (!kindResult.success) {
      throw new AppError(400, 'INVALID_OPERATION', 'Unknown Git operation.');
    }
    const kind = kindResult.data;
    const body = parseBody(OperationActionSchema, request.body);
    const result = await write.operationAction(state.runner, repo.path, kind, body.action);
    state.invalidate(repo.id);
    if (result.exitCode !== 0) {
      throw new AppError(422, 'OPERATION_FAILED', result.stderr.trim() || 'Git operation failed', {
        stderr: result.stderr,
      });
    }
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/repo/stash', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(StashPushSchema, request.body ?? {});
    const paths = body.paths
      ? await Promise.all(body.paths.map((entry) => relativePath(repo.path, entry)))
      : undefined;
    const result = await write.stashPush(state.runner, repo.path, { ...body, paths });
    state.invalidate(repo.id);
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/repo/stash/apply', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(StashRefSchema, request.body);
    const result = await write.stashApply(state.runner, repo.path, body.ref);
    state.invalidate(repo.id);
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/repo/stash/pop', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(StashRefSchema, request.body);
    const result = await write.stashApply(state.runner, repo.path, body.ref, true);
    state.invalidate(repo.id);
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/repo/stash/drop', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(StashRefSchema, request.body);
    const result = await write.stashDrop(state.runner, repo.path, body.ref);
    state.invalidate(repo.id);
    return { ok: true, output: outputOf(result) };
  });

  app.post('/api/repo/tag', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(TagCreateSchema, request.body);
    await write.createTag(state.runner, repo.path, body.name, body.message, body.ref);
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.post('/api/repo/tag/delete', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(TagDeleteSchema, request.body);
    await write.deleteTag(state.runner, repo.path, body.name);
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.post('/api/repo/tag/push', async (request, reply) => {
    const repo = repoFor(state, request);
    const body = parseBody(TagPushSchema, request.body);
    const job = state.jobs.start('push-tag', repo.id, async (context) =>
      state.withRepoLock(repo.id, async () => {
        const result = await write.pushTag(state.runner, repo.path, body.name, body.remote, {
          signal: context.signal,
          onProgress: context.output,
        });
        state.invalidate(repo.id);
        return { output: outputOf(result) };
      }),
    );
    return reply.code(202).send({ job });
  });

  app.post('/api/repo/remote', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(RemoteAddSchema, request.body);
    await write.addRemote(state.runner, repo.path, body.name, body.url);
    return { ok: true };
  });

  app.post('/api/repo/remote/remove', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(RemoteRemoveSchema, request.body);
    await write.removeRemote(state.runner, repo.path, body.name);
    return { ok: true };
  });

  app.post('/api/repo/remote/url', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(RemoteUrlSchema, request.body);
    await write.setRemoteUrl(state.runner, repo.path, body.name, body.url);
    return { ok: true };
  });

  app.post('/api/repo/reset', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(ResetSchema, request.body);
    if (body.mode === 'hard' && state.config.confirmDestructive && body.confirm !== true) {
      throw new AppError(400, 'CONFIRM_REQUIRED', 'Hard reset requires explicit confirmation.');
    }
    const backupRef = await createBackupRef(state.runner, repo.path, 'reset');
    const trash =
      body.mode === 'hard'
        ? await backupWorkingTree(state.runner, repo.path, dataDir, repo.id, 'reset')
        : null;
    await write.reset(state.runner, repo.path, body.mode, body.ref);
    const undo = backupRef
      ? createUndo(state, repo, 'reset', `Reset --${body.mode} ${body.ref}`, {
          type: 'reset',
          backupRef,
          trashDir: trash?.trashDir,
        })
      : undefined;
    state.invalidate(repo.id);
    return { ok: true, undo };
  });

  app.post('/api/repo/clean', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(CleanSchema, request.body ?? {});
    const paths = body.paths
      ? await Promise.all(body.paths.map((entry) => relativePath(repo.path, entry)))
      : undefined;
    const result = await write.clean(
      state.runner,
      repo.path,
      dataDir,
      repo.id,
      paths,
      body.confirm === true,
    );
    if (!result.trash) {
      return { ok: false, preview: result.preview };
    }
    const undo = createUndo(state, repo, 'clean', 'Clean untracked files', {
      type: 'clean',
      trashDir: result.trash.trashDir,
    });
    state.invalidate(repo.id);
    return { ok: true, preview: result.preview, undo };
  });

  app.post('/api/repo/restore', async (request) => {
    const repo = repoFor(state, request);
    const body = parseBody(RestoreSchema, request.body);
    if (state.config.confirmDestructive && body.confirm !== true) {
      throw new AppError(400, 'CONFIRM_REQUIRED', 'Restoring files requires explicit confirmation.');
    }
    const paths = await Promise.all(
      body.paths.map((entry) => relativePath(repo.path, entry)),
    );
    const result = await write.restore(
      state.runner,
      repo.path,
      dataDir,
      repo.id,
      paths,
      true,
    );
    const undo = result.trash
      ? createUndo(state, repo, 'restore', 'Discard changes', {
          type: 'restore',
          trashDir: result.trash.trashDir,
        })
      : undefined;
    state.invalidate(repo.id);
    return { ok: true, undo };
  });

  app.get('/api/undo', async (request) => state.listUndo(queryValue(request, 'repo')));

  app.post('/api/undo/:id', async (request) => {
    const repo = repoFor(state, request);
    const id = (request.params as { id: string }).id;
    const entry = state.takeUndo(repo.id, id);
    if (!entry) throw new AppError(404, 'UNDO_NOT_FOUND', 'Undo entry not found.');
    await applyUndo(state, repo, entry);
    state.invalidate(repo.id);
    return { ok: true };
  });

  app.get('/api/jobs/:id', async (request) => {
    const id = (request.params as { id: string }).id;
    const job = state.jobs.get(id);
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found.');
    return job;
  });

  app.post('/api/jobs/:id/cancel', async (request) => {
    const id = (request.params as { id: string }).id;
    const cancelled = state.jobs.cancel(id);
    if (!cancelled) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found.');
    return { ok: true };
  });

  app.get('/api/jobs/:id/events', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const job = state.jobs.get(id);
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found.');

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let closed = false;
    const finish = (finalJob: typeof job) => {
      if (closed) return;
      closed = true;
      send('end', finalJob);
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    };

    const unsubscribe = state.jobs.subscribe(id, (updated) => {
      send('job', updated);
      if (['done', 'error', 'cancelled'].includes(updated.status)) finish(updated);
    });

    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(': ping\n\n');
    }, 15_000);

    send('job', job);
    if (['done', 'error', 'cancelled'].includes(job.status)) finish(job);

    request.raw.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
        return;
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
        return;
      }
      reply
        .status(404)
        .type('text/plain')
        .send('Gitastic API is running. Start the web dev server with `npm run dev`.');
    });
  }

  return app;
}
