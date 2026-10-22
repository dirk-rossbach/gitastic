import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { GitBranch, Hash, RefreshCw, Search, Tag, User } from 'lucide-react';
import type { CommitSummary } from '@gitastic/shared';
import { api } from '../api';
import { useDebouncedValue } from '../lib/hooks';
import { cn, errorMessage, formatDate } from '../lib/utils';
import { useStore } from '../store';
import { CommitDetail } from './CommitDetail';
import { EmptyState, Spinner } from './ui';

const laneColors = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c'];

function laneColor(lane: number): string {
  return laneColors[lane % laneColors.length] ?? laneColors[0];
}

function GraphCell({ commit, maxLanes }: { commit: CommitSummary; maxLanes: number }) {
  const spacing = 14;
  const width = Math.max(1, maxLanes) * spacing + 10;
  const height = 54;
  const x = (lane: number) => 8 + lane * spacing;
  const center = x(commit.lane);
  const mid = height / 2;

  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden>
      {commit.activeLanes.map((lane) => (
        <line
          key={`active-${lane}`}
          x1={x(lane)}
          y1={0}
          x2={x(lane)}
          y2={height}
          stroke={laneColor(lane)}
          strokeWidth={1.5}
          opacity={0.22}
        />
      ))}
      {commit.parentLanes.map((lane, index) => (
        <path
          key={`parent-${lane}-${index}`}
          d={`M ${center} ${mid} C ${center} ${mid + 12}, ${x(lane)} ${height - 12}, ${x(lane)} ${height}`}
          fill="none"
          stroke={laneColor(lane)}
          strokeWidth={1.6}
          opacity={0.8}
        />
      ))}
      <circle cx={center} cy={mid} r={4.5} fill={laneColor(commit.lane)} />
      {commit.parents.length > 1 ? (
        <circle cx={center} cy={mid} r={7.5} fill="none" stroke={laneColor(commit.lane)} opacity={0.5} />
      ) : null}
    </svg>
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

export function HistoryView() {
  const selectedCommit = useStore((state) => state.selectedCommit);
  const setSelectedCommit = useStore((state) => state.setSelectedCommit);
  const refFilter = useStore((state) => state.refFilter);
  const setRefFilter = useStore((state) => state.setRefFilter);
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search, 300);

  const history = useInfiniteQuery({
    queryKey: ['history', refFilter, query],
    queryFn: ({ pageParam }) =>
      api.history({ offset: pageParam, limit: 200, ref: refFilter, q: query || null }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.commits.length < last.total
        ? last.offset + last.commits.length
        : undefined,
  });

  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches });
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags });

  const commits = useMemo(
    () => history.data?.pages.flatMap((page) => page.commits) ?? [],
    [history.data],
  );
  const total = history.data?.pages[0]?.total ?? 0;
  const maxLanes = history.data?.pages[0]?.maxLanes ?? 1;

  useEffect(() => {
    if (!selectedCommit && commits[0]) setSelectedCommit(commits[0].hash);
  }, [commits, selectedCommit, setSelectedCommit]);

  const reload = () => {
    void history.refetch();
    void branches.refetch();
    void tags.refetch();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-panel px-3 py-2">
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
        <button type="button" className="btn-icon" title="Refresh history" onClick={reload}>
          <RefreshCw className={cn('h-4 w-4', history.isFetching && 'animate-spin')} />
        </button>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-h-0 overflow-hidden">
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
                      'flex w-full items-stretch gap-2 border-b border-edge/60 px-1 text-left transition hover:bg-raised/60',
                      selectedCommit === commit.hash && 'bg-raised',
                    )}
                    onClick={() => setSelectedCommit(commit.hash)}
                  >
                    <GraphCell commit={commit} maxLanes={maxLanes} />
                    <div className="min-w-0 flex-1 py-2 pr-3">
                      <div className="flex items-start gap-1.5">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                          {commit.subject || '(no subject)'}
                        </p>
                        <div className="flex max-w-[45%] shrink-0 flex-wrap justify-end gap-1">
                          {commit.refs.slice(0, 3).map((ref) => (
                            <span key={ref} className={refClass(ref)} title={ref}>
                              {ref.startsWith('HEAD ->') ? (
                                <GitBranch className="h-3 w-3" />
                              ) : ref.startsWith('tag: ') ? (
                                <Tag className="h-3 w-3" />
                              ) : null}
                              <span className="max-w-[9rem] truncate">{refLabel(ref)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {commit.authorName}
                        </span>
                        <span>{formatDate(commit.authorDate)}</span>
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Hash className="h-3 w-3" />
                          {commit.shortHash}
                        </span>
                        {commit.parents.length > 1 ? (
                          <span className="badge badge-accent px-1.5 py-0">merge</span>
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
        </div>

        <div className="hidden min-h-0 border-l border-edge lg:block">
          {selectedCommit ? (
            <CommitDetail hash={selectedCommit} />
          ) : (
            <EmptyState
              icon={<GitBranch className="h-8 w-8" />}
              title="Select a commit"
              description="Choose a commit from the timeline to inspect its changes."
            />
          )}
        </div>
      </div>
    </div>
  );
}
