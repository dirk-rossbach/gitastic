import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { GitBranch, RefreshCw, Search, Tag, User, WandSparkles, X } from 'lucide-react';
import type { CommitSummary } from '@gitastic/shared';
import { api } from '../api';
import { useDebouncedValue } from '../lib/hooks';
import { cn, errorMessage, formatDateShort } from '../lib/utils';
import { useStore } from '../store';
import { laneColorFor } from '../ui-styles';
import { CommitDetail } from './CommitDetail';
import { InteractiveRebaseDialog } from './InteractiveRebaseDialog';
import { EmptyState, Spinner } from './ui';

function currentUiStyle(): string {
  return typeof document !== 'undefined'
    ? (document.documentElement.dataset.style ?? 'gorgeous')
    : 'gorgeous';
}

function isFocusStyle(): boolean {
  return currentUiStyle() === 'focus';
}

function laneColor(lane: number): string {
  return laneColorFor(currentUiStyle(), lane);
}

function GraphCell({
  commit,
  maxLanes,
  currentBranch,
  head,
}: {
  commit: CommitSummary;
  maxLanes: number;
  currentBranch: string | null;
  head: string | null;
}) {
  const spacing = 12;
  const width = Math.max(1, maxLanes) * spacing + 10;
  const x = (lane: number) => 8 + lane * spacing;
  const center = x(commit.lane);
  const color = laneColor(commit.lane);
  const active = commit.activeLanes.filter((lane) => lane !== commit.lane);
  const labelsByLane = new Map((commit.laneBranches ?? []).map((entry) => [entry.lane, entry.labels]));
  const isHead = Boolean(head) && commit.hash === head;

  return (
    <div className="relative shrink-0 self-stretch" style={{ width }} aria-hidden>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
      >
        {active.map((lane) => (
          <line
            key={`active-${lane}`}
            x1={x(lane)}
            y1={0}
            x2={x(lane)}
            y2={100}
            stroke={laneColor(lane)}
            strokeWidth={1.8}
            strokeOpacity={0.85}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={center}
          y1={0}
          x2={center}
          y2={50}
          stroke={color}
          strokeWidth={1.8}
          strokeOpacity={0.85}
          vectorEffect="non-scaling-stroke"
        />
        {commit.parentLanes.map((lane, index) => (
          <path
            key={`parent-${lane}-${index}`}
            d={`M ${center} 50 C ${center} 64, ${x(lane)} 86, ${x(lane)} 100`}
            fill="none"
            stroke={laneColor(lane)}
            strokeWidth={1.8}
            strokeOpacity={0.85}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <g
          className="graph-flow"
          strokeDasharray="3 22"
          strokeWidth={2.4}
          strokeOpacity={1}
          strokeLinecap="round"
        >
          {active.map((lane) => (
            <line
              key={`flow-active-${lane}`}
              x1={x(lane)}
              y1={0}
              x2={x(lane)}
              y2={100}
              stroke={laneColor(lane)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={center}
            y1={0}
            x2={center}
            y2={50}
            stroke={color}
            vectorEffect="non-scaling-stroke"
          />
          {commit.parentLanes.map((lane, index) => (
            <path
              key={`flow-parent-${lane}-${index}`}
              d={`M ${center} 50 C ${center} 64, ${x(lane)} 86, ${x(lane)} 100`}
              fill="none"
              stroke={laneColor(lane)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
      {commit.activeLanes.map((lane) => {
        const labels = labelsByLane.get(lane);
        if (!labels?.length) return null;
        const isCurrentLane = Boolean(currentBranch) && labels.includes(currentBranch as string);
        return (
          <div
            key={`lane-${lane}`}
            className="lane-hover absolute inset-y-0 z-10 cursor-help"
            style={{ left: x(lane) - spacing / 2, width: spacing }}
            title={labels.join(' · ')}
          >
            <span className={cn('lane-label', isCurrentLane && 'lane-label-current')}>
              {isCurrentLane ? (
                <span className="mr-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent align-middle" />
              ) : null}
              {labels.slice(0, 3).join(' · ')}
              {labels.length > 3 ? ` +${labels.length - 3}` : ''}
            </span>
          </div>
        );
      })}
      {isHead ? (
        <span
          className="pointer-events-none absolute rounded-full border-2"
          style={{
            left: center - 7,
            top: 'calc(50% - 7px)',
            width: 14,
            height: 14,
            borderColor: 'var(--accent)',
            boxShadow: isFocusStyle() ? 'none' : '0 0 10px var(--accent)',
          }}
          title="HEAD"
        />
      ) : null}
      <span
        className="pointer-events-none absolute rounded-full"
        title={isHead ? 'HEAD' : undefined}
        style={{
          left: center - 4,
          top: 'calc(50% - 4px)',
          width: 8,
          height: 8,
          background: color,
          boxShadow: isFocusStyle() ? 'none' : `0 0 12px ${color}`,
        }}
      />
      {commit.parents.length > 1 ? (
        <span
          className="pointer-events-none absolute rounded-full border"
          style={{
            left: center - 6.5,
            top: 'calc(50% - 6.5px)',
            width: 13,
            height: 13,
            borderColor: color,
            opacity: 0.55,
          }}
        />
      ) : null}
    </div>
  );
}

function refClass(ref: string): string {
  if (ref.startsWith('tag: ')) return 'badge border-warning/40 bg-warning/10 text-warning';
  if (ref.startsWith('HEAD ->')) return 'badge badge-accent';
  return 'badge';
}

function refLabel(ref: string): string {
  return ref.replace(/^HEAD -> /, '').replace(/^tag: /, '');
}

function isHeadRef(ref: string): boolean {
  return ref.startsWith('HEAD ->');
}

function sortRefs(refs: string[]): string[] {
  const rank = (ref: string) => (isHeadRef(ref) ? 0 : ref.startsWith('tag: ') ? 2 : 1);
  return [...refs].sort((a, b) => rank(a) - rank(b));
}

export function HistoryView() {
  const selectedCommit = useStore((state) => state.selectedCommit);
  const setSelectedCommit = useStore((state) => state.setSelectedCommit);
  const refFilter = useStore((state) => state.refFilter);
  const setRefFilter = useStore((state) => state.setRefFilter);
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search, 300);

  const session = useQuery({ queryKey: ['session'], queryFn: api.session });
  const repo = useQuery({ queryKey: ['repo'], queryFn: api.repo });
  const repoId = session.data?.repo?.id ?? repo.data?.id ?? null;

  const history = useInfiniteQuery({
    queryKey: ['history', repoId, refFilter, query],
    queryFn: ({ pageParam }) =>
      api.history({ offset: pageParam, limit: 200, ref: refFilter, q: query || null }),
    enabled: Boolean(repoId),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.commits.length < last.total
        ? last.offset + last.commits.length
        : undefined,
  });

  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches });
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags });
  const [rebaseOpen, setRebaseOpen] = useState(false);

  const commits = useMemo(
    () => history.data?.pages.flatMap((page) => page.commits) ?? [],
    [history.data],
  );
  const total = history.data?.pages[0]?.total ?? 0;
  const maxLanes = history.data?.pages[0]?.maxLanes ?? 1;
  const [closingDetail, setClosingDetail] = useState(false);

  const closeDetail = useCallback(() => {
    setClosingDetail(true);
  }, []);

  useEffect(() => {
    if (!closingDetail) return;
    const timeout = window.setTimeout(() => {
      setSelectedCommit(null);
      setClosingDetail(false);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [closingDetail, setSelectedCommit]);

  useEffect(() => {
    setClosingDetail(false);
  }, [selectedCommit]);

  useEffect(() => {
    if (!selectedCommit) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDetail();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCommit, closeDetail]);

  const selectCommit = (hash: string) => {
    if (selectedCommit === hash && !closingDetail) {
      closeDetail();
      return;
    }
    setClosingDetail(false);
    setSelectedCommit(hash);
  };

  const reload = () => {
    void history.refetch();
    void branches.refetch();
    void tags.refetch();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 history-toolbar border-b border-edge/80 px-3 py-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="input h-8 pl-8 text-xs"
            placeholder="Search commits, authors, hashes, refs..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          className="select h-8 max-w-[16rem] text-xs"
          value={refFilter ?? ''}
          onChange={(event) => setRefFilter(event.target.value || null)}
        >
          <option value="">All branches and tags</option>
          <optgroup label="Branches">
            {branches.data
              ?.filter((branch) => !branch.remote)
              .map((branch) => (
                <option key={branch.ref} value={branch.name}>
                  {branch.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Remote branches">
            {branches.data
              ?.filter((branch) => branch.remote)
              .map((branch) => (
                <option key={branch.ref} value={branch.name}>
                  {branch.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Tags">
            {tags.data?.map((tag) => (
              <option key={tag.ref} value={tag.name}>
                {tag.name}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="text-xs text-faint">{total.toLocaleString()} commits</span>
        <button
          type="button"
          className="btn h-8 text-xs"
          disabled={!repo.data?.branch}
          onClick={() => setRebaseOpen(true)}
        >
          <WandSparkles className="h-3.5 w-3.5" />
          Interactive rebase
        </button>
        <button type="button" className="btn-icon" title="Refresh history" onClick={reload}>
          <RefreshCw className={cn('h-4 w-4', history.isFetching && 'animate-spin')} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="scrollbar-thin h-full overflow-y-auto">
          {history.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
              <Spinner /> Loading history...
            </div>
          ) : history.isError ? (
            <p className="p-6 text-sm text-danger">{errorMessage(history.error)}</p>
          ) : commits.length === 0 ? (
            <EmptyState
              icon={<GitBranch className="h-8 w-8" />}
              title="No commits match"
              description="Try a different search or ref filter."
            />
          ) : (
            <>
              {commits.map((commit) => (
                <button
                  key={commit.hash}
                  type="button"
                  className={cn(
                    'history-row relative flex h-11 w-full items-stretch gap-2 overflow-hidden pl-1 pr-0 text-left',
                    selectedCommit === commit.hash && 'history-row-selected',
                  )}
                  onClick={() => selectCommit(commit.hash)}
                >
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-edge/60" />
                  <GraphCell
                    commit={commit}
                    maxLanes={maxLanes}
                    currentBranch={repo.data?.branch ?? null}
                    head={repo.data?.head ?? null}
                  />
                  <div className="min-w-0 flex-1 py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {commit.subject || '(no subject)'}
                      </p>
                      <div className="flex max-w-[48%] shrink-0 flex-nowrap items-center justify-end gap-1 overflow-hidden">
                        {sortRefs(commit.refs)
                          .slice(0, 3)
                          .map((ref) => (
                            <span
                              key={ref}
                              className={refClass(ref)}
                              title={isHeadRef(ref) ? `${refLabel(ref)} (HEAD, checked out)` : ref}
                            >
                              {isHeadRef(ref) ? (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                              ) : ref.startsWith('tag: ') ? (
                                <Tag className="h-3 w-3" />
                              ) : null}
                              <span
                                className={cn(
                                  'max-w-[12rem] truncate',
                                  isHeadRef(ref) && 'max-w-[14rem]',
                                )}
                              >
                                {refLabel(ref)}
                              </span>
                            </span>
                          ))}
                        {commit.refs.length > 3 ? (
                          <span
                            className="badge"
                            title={sortRefs(commit.refs)
                              .slice(3)
                              .map(refLabel)
                              .join(' · ')}
                          >
                            +{commit.refs.length - 3}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-faint">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <User className="h-3 w-3 shrink-0" />
                        <span className="truncate">{commit.authorName}</span>
                      </span>
                      <span className="shrink-0">{formatDateShort(commit.authorDate)}</span>
                      {commit.parents.length > 1 ? (
                        <span className="shrink-0 text-accent">merge</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))}
              {history.hasNextPage ? (
                <div className="p-3">
                  <button
                    type="button"
                    className="btn w-full text-xs"
                    disabled={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    {history.isFetchingNextPage ? <Spinner /> : null}
                    Load more commits
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        {selectedCommit ? (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close commit details"
              className={cn(
                'detail-backdrop absolute inset-0 z-20 cursor-default bg-canvas/55 backdrop-blur-[1px]',
                closingDetail && 'detail-backdrop-closing pointer-events-none',
              )}
              onClick={closeDetail}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="Commit details"
              className={cn(
                'detail-drawer absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-edge bg-panel md:w-[85%]',
                closingDetail && 'detail-drawer-closing pointer-events-none',
              )}
            >
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge/80 px-4">
                <span className="panel-title">Commit</span>
                <button
                  type="button"
                  className="btn-icon"
                  title="Close details (Esc)"
                  onClick={closeDetail}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <CommitDetail hash={selectedCommit} />
              </div>
            </aside>
          </>
        ) : null}
      </div>

      <InteractiveRebaseDialog
        open={rebaseOpen}
        onOpenChange={setRebaseOpen}
        defaultUpstream={
          repo.data?.upstream?.split('/').slice(1).join('/') ||
          (branches.data?.find((branch) => branch.remote)?.name ?? 'origin/main')
        }
      />
    </div>
  );
}
