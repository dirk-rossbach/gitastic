import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  Settings,
  User,
} from 'lucide-react';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { cn, formatDate } from '../lib/utils';
import { useStore } from '../store';
import { EmptyState, ErrorState, LoadingState, Modal, Spinner } from './ui';
import { PullRequestDetailView } from './PullRequestDetail';

export function PullRequestsView() {
  const queryClient = useQueryClient();
  const pulls = useQuery({ queryKey: ['repo-pulls'], queryFn: api.pulls });
  const repo = useQuery({ queryKey: ['repo'], queryFn: api.repo });
  const setView = useStore((state) => state.setView);
  const openSettings = useStore((state) => state.openSettings);
  const notify = useStore((state) => state.notify);
  const { busy, run } = useAction();
  const [search, setSearch] = useState('');
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [prBase, setPrBase] = useState('');
  const [prDraft, setPrDraft] = useState(false);

  const remote = pulls.data?.remote ?? null;
  const currentBranch = repo.data?.branch ?? null;

  const filtered = useMemo(() => {
    const items = pulls.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        String(item.number).includes(q) ||
        item.author.toLowerCase().includes(q) ||
        item.sourceBranch.toLowerCase().includes(q) ||
        item.targetBranch.toLowerCase().includes(q),
    );
  }, [pulls.data?.items, search]);

  if (pulls.isLoading) return <LoadingState label="Loading Pull / Merge Requests..." />;
  if (pulls.isError) {
    return <ErrorState error={pulls.error} retry={() => void pulls.refetch()} />;
  }

  if (!remote) {
    return (
      <EmptyState
        icon={<GitPullRequest className="h-8 w-8" />}
        title="No GitHub or GitLab remote configured"
        description="Add an origin remote pointing to GitHub or GitLab to view and check out Pull / Merge Requests."
        action={
          <button type="button" className="btn btn-primary" onClick={() => setView('remotes')}>
            Configure Remotes
          </button>
        }
      />
    );
  }

  const labelKind = remote.provider === 'gitlab' ? 'Merge Request' : 'Pull Request';
  const prefix = remote.provider === 'gitlab' ? '!' : '#';

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="history-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-edge/80 px-3 py-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="input h-8 pl-8 text-xs"
            placeholder={`Filter ${labelKind}s by title, number, author, branch...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <span className="badge badge-accent font-mono text-[11px]">
          {remote.host}/{remote.fullName}
        </span>

        {currentBranch ? (
          <button
            type="button"
            className="btn btn-primary h-8 text-xs"
            onClick={() => {
              setPrTitle('');
              setPrBody('');
              setPrBase(repo.data?.upstream?.split('/').slice(1).join('/') || 'main');
              setPrDraft(false);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Create {remote.provider === 'gitlab' ? 'MR' : 'PR'} ({currentBranch})
          </button>
        ) : null}

        <a href={remote.pullsUrl} target="_blank" rel="noreferrer" className="btn h-8 text-xs">
          Open {remote.provider === 'gitlab' ? 'GitLab' : 'GitHub'}
          <ExternalLink className="h-3.5 w-3.5" />
        </a>

        <button type="button" className="btn h-8 text-xs" onClick={openSettings}>
          <Settings className="h-3.5 w-3.5" />
          Tokens & SSH
        </button>

        <button
          type="button"
          className="btn-icon"
          title="Refresh"
          onClick={() => void pulls.refetch()}
        >
          <RefreshCw className={cn('h-4 w-4', pulls.isFetching && 'animate-spin')} />
        </button>
      </div>

      {pulls.data?.authHint ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
          <span>{pulls.data.authHint}</span>
          <button type="button" className="btn h-7 text-xs" onClick={openSettings}>
            <Settings className="h-3.5 w-3.5" />
            Configure in Settings
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            'min-h-0 flex-col border-edge/80',
            selectedNumber !== null
              ? 'hidden w-[19rem] shrink-0 border-r md:flex'
              : 'flex min-w-0 flex-1',
          )}
        >
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<GitPullRequest className="h-8 w-8" />}
                title={`No open ${labelKind}s`}
                description={
                  search
                    ? 'Try clearing the filter.'
                    : `There are currently no open ${labelKind}s on ${remote.fullName}.`
                }
              />
            ) : (
              filtered.map((item) => {
                const isCheckedOut = currentBranch === item.sourceBranch;
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    title={`Review ${prefix}${item.number}: ${item.title}`}
                    className={cn(
                      'group flex cursor-pointer items-start justify-between gap-2 border-b border-edge/60 px-3 py-3 transition hover:bg-raised/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                      isCheckedOut && 'bg-raised',
                      selectedNumber === item.number && 'bg-raised',
                    )}
                    onClick={() => setSelectedNumber(item.number)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedNumber(item.number);
                      }
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <GitPullRequest className="h-4 w-4 shrink-0 text-accent" />
                        <span className="font-mono text-xs font-semibold text-accent">
                          {prefix}
                          {item.number}
                        </span>
                        <span className="truncate text-sm font-medium text-ink">{item.title}</span>
                        {item.draft ? <span className="badge">draft</span> : null}
                        {isCheckedOut ? (
                          <span className="badge badge-accent">checked out</span>
                        ) : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
                          <GitBranch className="h-3 w-3 text-accent" />
                          {item.sourceBranch}
                          <ArrowRight className="h-3 w-3 text-faint" />
                          {item.targetBranch}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {item.author}
                        </span>
                        <span>{formatDate(item.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 pt-0.5">
                      {!isCheckedOut ? (
                        <button
                          type="button"
                          className="btn-icon h-7 w-7"
                          title={`Checkout ${item.sourceBranch}`}
                          aria-label={`Checkout ${item.sourceBranch}`}
                          disabled={busy}
                          onClick={(event) => {
                            event.stopPropagation();
                            void run(
                              () =>
                                api.checkoutPullRequest({
                                  number: item.number,
                                  sourceBranch: item.sourceBranch,
                                  remote: remote.remoteName,
                                }),
                              `Checked out ${prefix}${item.number} (${item.sourceBranch}).`,
                            );
                          }}
                        >
                          {busy ? <Spinner /> : <LogIn className="h-3.5 w-3.5" />}
                        </button>
                      ) : null}
                      <a
                        href={item.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-icon h-7 w-7"
                        title="Open in browser"
                        aria-label="Open in browser"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {selectedNumber !== null ? (
          <div className="min-w-0 flex-1">
            <PullRequestDetailView
              number={selectedNumber}
              onClose={() => setSelectedNumber(null)}
            />
          </div>
        ) : null}
      </div>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={`Create ${remote.provider === 'gitlab' ? 'merge request' : 'pull request'}`}
        description={`${currentBranch ?? 'current branch'} → ${prBase || 'base'}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !prTitle.trim() || !prBase.trim()}
              onClick={() =>
                void run(async () => {
                  const created = await api.createPullRequest({
                    title: prTitle.trim(),
                    body: prBody.trim() || undefined,
                    base: prBase.trim(),
                    draft: prDraft,
                  });
                  await queryClient.invalidateQueries({ queryKey: ['repo-pulls'] });
                  setCreateOpen(false);
                  notify('success', `Created ${prefix}${created.number ?? ''}`.trim(), created.url);
                }, 'Pull request created.')
              }
            >
              {busy ? <Spinner /> : <GitPullRequest className="h-4 w-4" />}
              Create
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">Title</span>
            <input
              className="input text-sm"
              value={prTitle}
              placeholder="Add my feature"
              onChange={(event) => setPrTitle(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              Base branch
            </span>
            <input
              className="input font-mono text-sm"
              value={prBase}
              onChange={(event) => setPrBase(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              Description
            </span>
            <textarea
              className="input min-h-28 text-sm"
              value={prBody}
              onChange={(event) => setPrBody(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="accent-accent"
              checked={prDraft}
              onChange={(event) => setPrDraft(event.target.checked)}
            />
            Create as draft
          </label>
          {remote.provider === 'gitlab' ? (
            <p className="text-[11px] text-faint">GitLab does not support draft merge requests.</p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
