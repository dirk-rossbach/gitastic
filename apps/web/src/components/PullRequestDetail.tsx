import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitBranch,
  MessageSquare,
  MessageSquarePlus,
  RefreshCw,
  Send,
  ShieldCheck,
  ThumbsUp,
  User,
  XCircle,
} from 'lucide-react';
import type {
  PullRequestComment,
  PullRequestDetail,
  PullRequestFile,
  PullRequestReview,
} from '@gitastic/shared';
import { cn, formatDate } from '../lib/utils';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { ErrorState, LoadingState, Modal, PathText, Spinner } from './ui';

type CommentSide = 'LEFT' | 'RIGHT';
type CommentTarget = { path: string; line: number; side: CommentSide };

type DiffRow = {
  key: string;
  kind: 'add' | 'del' | 'context';
  text: string;
  oldLine: number | null;
  newLine: number | null;
  side: CommentSide;
};

type DiffHunk = {
  key: string;
  header: string;
  rows: DiffRow[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parsePatch(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let rowIndex = 0;

  for (const raw of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('@@')) {
      const match = raw.match(HUNK_HEADER);
      oldLine = Number(match?.[1] ?? 1);
      newLine = Number(match?.[2] ?? 1);
      current = { key: `hunk-${hunks.length}`, header: raw, rows: [] };
      hunks.push(current);
      rowIndex = 0;
      continue;
    }
    if (!current || !raw || raw.startsWith('\\')) continue;
    if (raw.startsWith('diff --git ') || raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      continue;
    }

    if (raw.startsWith('+')) {
      current.rows.push({
        key: `row-${rowIndex++}`,
        kind: 'add',
        text: raw.slice(1),
        oldLine: null,
        newLine,
        side: 'RIGHT',
      });
      newLine += 1;
    } else if (raw.startsWith('-')) {
      current.rows.push({
        key: `row-${rowIndex++}`,
        kind: 'del',
        text: raw.slice(1),
        oldLine,
        newLine: null,
        side: 'LEFT',
      });
      oldLine += 1;
    } else if (raw.startsWith(' ')) {
      current.rows.push({
        key: `row-${rowIndex++}`,
        kind: 'context',
        text: raw.slice(1),
        oldLine,
        newLine,
        side: 'RIGHT',
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  return hunks;
}

function fileStatusMeta(status: PullRequestFile['status']) {
  switch (status) {
    case 'added':
      return { label: 'added', className: 'badge badge-success' };
    case 'removed':
      return { label: 'deleted', className: 'badge badge-danger' };
    case 'renamed':
      return { label: 'renamed', className: 'badge badge-accent' };
    case 'copied':
      return { label: 'copied', className: 'badge badge-accent' };
    default:
      return { label: 'changed', className: 'badge' };
  }
}

function reviewMeta(state: PullRequestReview['state']) {
  switch (state) {
    case 'APPROVED':
      return {
        label: 'approved',
        className: 'text-success',
        icon: CheckCircle2,
      };
    case 'CHANGES_REQUESTED':
      return {
        label: 'changes requested',
        className: 'text-danger',
        icon: XCircle,
      };
    case 'DISMISSED':
      return { label: 'dismissed', className: 'text-faint', icon: CircleDot };
    case 'PENDING':
      return { label: 'pending', className: 'text-muted', icon: CircleDot };
    default:
      return { label: 'commented', className: 'text-muted', icon: MessageSquare };
  }
}

function CommentCard({ comment }: { comment: PullRequestComment }) {
  return (
    <div className="ml-14 border-l-2 border-accent/40 bg-raised/50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
        <span className="font-medium text-ink">@{comment.author}</span>
        <span>{formatDate(comment.createdAt)}</span>
        {comment.path && comment.line ? (
          <span className="font-mono text-accent">
            {comment.path}:{comment.line}
          </span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{comment.body}</p>
    </div>
  );
}

function ReviewDiff({
  file,
  comments,
  viewer,
  busy,
  onComment,
}: {
  file: PullRequestFile;
  comments: PullRequestComment[];
  viewer: string | null;
  busy: boolean;
  onComment: (target: CommentTarget, body: string) => Promise<boolean>;
}) {
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const hunks = useMemo(() => parsePatch(file.patch ?? ''), [file.patch]);
  const fileComments = comments.filter((comment) => comment.path === file.path);

  useEffect(() => {
    setTarget(null);
    setDraft('');
  }, [file.path]);

  const submit = async () => {
    if (!target || !draft.trim()) return;
    setSending(true);
    const ok = await onComment(target, draft.trim());
    setSending(false);
    if (ok) {
      setTarget(null);
      setDraft('');
    }
  };

  if (file.binary) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted">
        Binary file. Inline comments are not available.
      </div>
    );
  }

  if (hunks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted">
        No diff is available for this file.
      </div>
    );
  }

  return (
    <div className="min-w-0 font-mono text-xs">
      {hunks.map((hunk) => (
        <div key={hunk.key}>
          <div className="sticky top-0 z-10 border-y border-edge/70 bg-raised/90 px-3 py-1 text-[11px] text-faint">
            {hunk.header}
          </div>
          {hunk.rows.map((row) => {
            const line = row.kind === 'del' ? row.oldLine : row.newLine;
            const rowComments =
              line === null
                ? []
                : fileComments.filter(
                    (comment) =>
                      comment.line === line && (comment.side === null || comment.side === row.side),
                  );
            const isTarget =
              target !== null &&
              line !== null &&
              target.path === file.path &&
              target.line === line &&
              target.side === row.side;

            return (
              <div key={row.key} className="border-b border-edge/20">
                <div
                  className={cn(
                    'group grid grid-cols-[3.25rem_3.25rem_1fr_2.25rem] items-start',
                    row.kind === 'add' && 'bg-success/10',
                    row.kind === 'del' && 'bg-danger/10',
                  )}
                >
                  <span className="select-none border-r border-edge/30 px-2 py-0.5 text-right text-[10px] leading-5 text-faint">
                    {row.oldLine ?? ''}
                  </span>
                  <span className="select-none border-r border-edge/30 px-2 py-0.5 text-right text-[10px] leading-5 text-faint">
                    {row.newLine ?? ''}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 whitespace-pre-wrap px-2 py-0.5 leading-5 [overflow-wrap:anywhere]',
                      row.kind === 'add' && 'text-success',
                      row.kind === 'del' && 'text-danger',
                      row.kind === 'context' && 'text-muted',
                    )}
                  >
                    {row.text || ' '}
                  </span>
                  <span className="flex items-start justify-center pt-1">
                    {viewer && line !== null ? (
                      <button
                        type="button"
                        className={cn(
                          'rounded p-0.5 text-faint opacity-40 transition hover:bg-raised hover:text-accent group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                          isTarget && 'opacity-100 text-accent',
                        )}
                        title={`Comment on line ${line}`}
                        aria-label={`Comment on line ${line}`}
                        onClick={() =>
                          setTarget(isTarget ? null : { path: file.path, line, side: row.side })
                        }
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </span>
                </div>

                {rowComments.map((comment) => (
                  <CommentCard key={comment.id} comment={comment} />
                ))}

                {isTarget ? (
                  <div className="ml-14 border-l-2 border-accent/60 bg-panel p-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] text-faint">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Comment on {file.path}:{line} ({row.side === 'LEFT' ? 'old' : 'new'} line)
                    </div>
                    <textarea
                      className="input min-h-[5rem] w-full font-sans text-xs"
                      autoFocus
                      placeholder="Leave a review comment..."
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="btn h-7 text-xs"
                        onClick={() => {
                          setTarget(null);
                          setDraft('');
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary h-7 text-xs"
                        disabled={busy || sending || !draft.trim()}
                        onClick={() => void submit()}
                      >
                        {sending ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
                        Comment
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ConversationTab({
  pull,
  comments,
  reviews,
  viewer,
  busy,
  draft,
  setDraft,
  onSubmit,
}: {
  pull: PullRequestDetail;
  comments: PullRequestComment[];
  reviews: PullRequestReview[];
  viewer: string | null;
  busy: boolean;
  draft: string;
  setDraft: (value: string) => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
      {pull.body ? (
        <div className="mb-4 rounded-lg border border-edge bg-canvas p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-faint">
            <User className="h-3.5 w-3.5" />
            <span className="font-medium text-ink">@{pull.author}</span>
            <span>opened this pull request</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted">{pull.body}</p>
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <div className="mb-4 space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-faint">Reviews</h4>
          {reviews.map((review) => {
            const meta = reviewMeta(review.state);
            const Icon = meta.icon;
            return (
              <div
                key={review.id}
                className="flex items-start gap-2 rounded-lg border border-edge bg-raised/40 p-3"
              >
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', meta.className)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-ink">@{review.author}</span>
                    <span className={cn('uppercase tracking-wide', meta.className)}>
                      {meta.label}
                    </span>
                    {review.submittedAt ? (
                      <span className="text-faint">{formatDate(review.submittedAt)}</span>
                    ) : null}
                  </div>
                  {review.body ? (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{review.body}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-faint">
          Comments ({comments.length})
        </h4>
        {comments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge p-3 text-xs text-faint">
            No comments yet.
          </p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="rounded-lg border border-edge bg-raised/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
                <span className="font-medium text-ink">@{comment.author}</span>
                <span>{formatDate(comment.createdAt)}</span>
                {comment.path && comment.line ? (
                  <span className="font-mono text-accent">
                    {comment.path}:{comment.line}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{comment.body}</p>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 rounded-lg border border-edge bg-canvas p-3">
        {viewer ? (
          <>
            <textarea
              className="input min-h-[5rem] w-full text-xs"
              placeholder="Write a comment..."
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="btn btn-primary h-7 text-xs"
                disabled={busy || !draft.trim()}
                onClick={() => void onSubmit()}
              >
                {busy ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
                Comment
              </button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted">
            Connect your GitHub or GitLab account in Settings to comment and approve.
          </p>
        )}
      </div>
    </div>
  );
}

export function PullRequestDetailView({
  number,
  onClose,
}: {
  number: number;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ['repo-pull', number],
    queryFn: () => api.pullRequest(number),
    enabled: number > 0,
  });
  const { busy, run } = useAction();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveBody, setApproveBody] = useState('');
  const [generalDraft, setGeneralDraft] = useState('');

  const pull = detail.data?.pull ?? null;
  const files = useMemo(() => detail.data?.files ?? [], [detail.data?.files]);
  const comments = useMemo(() => detail.data?.comments ?? [], [detail.data?.comments]);
  const reviews = useMemo(() => detail.data?.reviews ?? [], [detail.data?.reviews]);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

  useEffect(() => {
    setApproveOpen(false);
    setApproveBody('');
    setGeneralDraft('');
  }, [number]);

  useEffect(() => {
    if (files.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !files.some((file) => file.path === selectedPath)) {
      setSelectedPath(files[0]?.path ?? null);
    }
  }, [files, selectedPath]);

  const submitComment = async (target: CommentTarget, body: string): Promise<boolean> => {
    if (!pull) return false;
    const result = await run(
      () =>
        api.commentOnPullRequest(pull.number, {
          body,
          path: target.path,
          line: target.line,
          side: target.side,
          commitId: pull.headSha || undefined,
        }),
      'Review comment added.',
    );
    if (result) {
      await detail.refetch();
      return true;
    }
    return false;
  };

  const submitGeneralComment = async () => {
    if (!pull || !generalDraft.trim()) return;
    const result = await run(
      () => api.commentOnPullRequest(pull.number, { body: generalDraft.trim() }),
      'Comment added.',
    );
    if (result) {
      setGeneralDraft('');
      await detail.refetch();
    }
  };

  const approve = async () => {
    if (!pull) return;
    const result = await run(
      () => api.approvePullRequest(pull.number, approveBody.trim() || undefined),
      `Approved ${pull.webUrl.includes('gitlab') ? 'merge' : 'pull'} request #${pull.number}.`,
    );
    if (result) {
      setApproveOpen(false);
      setApproveBody('');
      await detail.refetch();
    }
  };

  const isOwnPullRequest = Boolean(pull && pull.viewer && pull.author === pull.viewer);
  const canApprove = Boolean(
    pull && pull.state === 'open' && pull.viewer && !pull.approvedByViewer && !isOwnPullRequest,
  );
  const label = detail.data?.remote?.provider === 'gitlab' ? 'Merge Request' : 'Pull Request';
  const prefix = detail.data?.remote?.provider === 'gitlab' ? '!' : '#';

  return (
    <>
      <div className="flex h-full min-h-0 flex-col bg-panel">
        <div className="flex shrink-0 items-start gap-3 border-b border-edge px-4 py-3">
          <button
            type="button"
            className="btn-icon mt-0.5 shrink-0"
            title="Back to pull requests"
            aria-label="Back to pull requests"
            onClick={onClose}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-ink">
              {pull ? `${prefix}${pull.number} · ${pull.title}` : `${label} ${number}`}
            </h2>
            <p className="mt-0.5 truncate text-xs text-faint">
              {pull
                ? `${pull.sourceBranch} → ${pull.targetBranch} · by @${pull.author}`
                : 'Loading review context...'}
            </p>
          </div>
          {pull ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              {pull.approvedByViewer ? (
                <span className="badge badge-success inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approved by you
                </span>
              ) : null}
              <button
                type="button"
                className="btn h-8 text-xs"
                onClick={() => void detail.refetch()}
                disabled={detail.isFetching}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', detail.isFetching && 'animate-spin')} />
                Refresh
              </button>
              <a href={pull.webUrl} target="_blank" rel="noreferrer" className="btn h-8 text-xs">
                Open
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                className="btn btn-primary h-8 text-xs"
                disabled={!canApprove}
                title={
                  pull.approvedByViewer
                    ? 'You already approved this pull request.'
                    : !pull.viewer
                      ? 'Connect your provider account to approve.'
                      : isOwnPullRequest
                        ? 'You cannot approve your own pull request.'
                        : !canApprove
                          ? 'This pull request cannot be approved.'
                          : 'Approve this pull request'
                }
                onClick={() => setApproveOpen(true)}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
                Approve
              </button>
            </div>
          ) : null}
        </div>

        {detail.isLoading ? (
          <LoadingState label={`Loading ${label.toLowerCase()}...`} />
        ) : detail.isError || !detail.data || !pull ? (
          <ErrorState error={detail.error} retry={() => void detail.refetch()} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-4 py-2 text-xs">
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
                <GitBranch className="h-3.5 w-3.5 text-accent" />
                {pull.sourceBranch} <span className="text-faint">→</span> {pull.targetBranch}
              </span>
              <span className="font-mono text-success">+{pull.additions}</span>
              <span className="font-mono text-danger">-{pull.deletions}</span>
              <span className="text-faint">{pull.changedFiles} files</span>
              {pull.draft ? <span className="badge">draft</span> : null}
              {pull.mergeable === false ? (
                <span className="badge badge-danger">conflicts</span>
              ) : pull.mergeable === true ? (
                <span className="badge badge-success">mergeable</span>
              ) : null}
              {pull.reviewDecision ? (
                <span
                  className={cn(
                    'badge',
                    pull.reviewDecision === 'APPROVED' && 'badge-success',
                    pull.reviewDecision === 'CHANGES_REQUESTED' && 'badge-danger',
                  )}
                >
                  {pull.reviewDecision === 'REVIEW_REQUIRED'
                    ? 'review required'
                    : pull.reviewDecision === 'CHANGES_REQUESTED'
                      ? 'changes requested'
                      : 'approved'}
                </span>
              ) : null}
              {pull.viewer ? (
                <span className="ml-auto inline-flex items-center gap-1 text-faint">
                  <ShieldCheck className="h-3.5 w-3.5" />@{pull.viewer}
                </span>
              ) : null}
            </div>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto xl:overflow-hidden">
              <div className="flex min-h-0 flex-col xl:grid xl:h-full xl:grid-cols-[minmax(0,1fr)_20rem]">
                <section className="flex min-h-[32rem] min-w-0 flex-col xl:min-h-0">
                  <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-faint">
                      Changes
                    </span>
                    <span className="badge">{files.length}</span>
                    {files.length > 0 ? (
                      <select
                        className="input ml-auto h-7 max-w-[18rem] text-xs 2xl:hidden"
                        value={selectedFile?.path ?? ''}
                        onChange={(event) => setSelectedPath(event.target.value)}
                        aria-label="Select changed file"
                      >
                        {files.map((file) => (
                          <option key={file.path} value={file.path}>
                            {file.path}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {pull.viewer ? (
                      <span className="hidden text-[10px] text-faint 2xl:inline">
                        Hover a line to comment
                      </span>
                    ) : null}
                  </div>

                  <div className="flex min-h-0 flex-1">
                    <div className="scrollbar-thin hidden w-48 shrink-0 overflow-y-auto border-r border-edge 2xl:block">
                      {files.map((file) => {
                        const meta = fileStatusMeta(file.status);
                        return (
                          <button
                            key={file.path}
                            type="button"
                            className={cn(
                              'flex w-full flex-col gap-1 border-b border-edge/60 px-3 py-2 text-left transition hover:bg-raised/50',
                              selectedFile?.path === file.path && 'bg-raised',
                            )}
                            onClick={() => setSelectedPath(file.path)}
                          >
                            <div className="flex w-full items-center gap-2">
                              <span className={cn(meta.className, 'shrink-0')}>{meta.label}</span>
                              <PathText
                                text={file.path}
                                className="min-w-0 flex-1 font-mono text-[11px] text-ink"
                              />
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-faint">
                              <span className="text-success">+{file.additions}</span>
                              <span className="text-danger">-{file.deletions}</span>
                              {file.binary ? <span>binary</span> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="min-w-0 flex-1 overflow-auto">
                      {selectedFile ? (
                        <>
                          <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-edge bg-panel px-3 py-2">
                            <PathText
                              text={selectedFile.path}
                              className="min-w-0 flex-1 font-mono text-xs text-ink"
                            />
                            {selectedFile.oldPath ? (
                              <span className="text-[10px] text-faint">
                                from {selectedFile.oldPath}
                              </span>
                            ) : null}
                            <span className="text-[10px] text-success">
                              +{selectedFile.additions}
                            </span>
                            <span className="text-[10px] text-danger">
                              -{selectedFile.deletions}
                            </span>
                          </div>
                          <ReviewDiff
                            file={selectedFile}
                            comments={comments}
                            viewer={pull.viewer}
                            busy={busy}
                            onComment={submitComment}
                          />
                        </>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-muted">
                          This pull request has no changed files.
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <aside className="flex min-h-[28rem] flex-col border-t border-edge bg-canvas/40 xl:min-h-0 xl:border-l xl:border-t-0">
                  <div className="flex shrink-0 items-center justify-between border-b border-edge px-3 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-faint">
                      Conversation
                    </span>
                    <span className="badge">{comments.length + reviews.length}</span>
                  </div>
                  <ConversationTab
                    pull={pull}
                    comments={comments}
                    reviews={reviews}
                    viewer={pull.viewer}
                    busy={busy}
                    draft={generalDraft}
                    setDraft={setGeneralDraft}
                    onSubmit={submitGeneralComment}
                  />
                </aside>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve pull request"
        description={
          pull
            ? `Submit an approval for ${prefix}${pull.number} to ${detail.data?.remote?.fullName ?? 'the remote'}.`
            : 'Submit an approval.'
        }
        footer={
          <>
            <button type="button" className="btn" onClick={() => setApproveOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void approve()}
            >
              {busy ? <Spinner /> : <ThumbsUp className="h-4 w-4" />}
              Approve
            </button>
          </>
        }
      >
        <textarea
          className="input min-h-[6rem] w-full text-xs"
          placeholder="Optional approval comment..."
          value={approveBody}
          onChange={(event) => setApproveBody(event.target.value)}
        />
        <p className="mt-2 text-xs text-faint">
          The approval is sent to your Git provider and cannot be undone from Gitastic.
        </p>
      </Modal>
    </>
  );
}
