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

const gorgeousLaneColors = [
  '#38bdf8',
  '#2dd4bf',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#a3e635',
];

const focusLaneColors = ['#6893b8', '#7d8a9a', '#86a397', '#9b8ca6'];

const synthwaveLaneColors = [
  '#ff2a85',
  '#00f0ff',
  '#ffe600',
  '#00ff9f',
  '#b829ff',
  '#ff6b00',
  '#ff0055',
  '#00ffcc',
];

function currentUiStyle(): string {
  return typeof document !== 'undefined'
    ? (document.documentElement.dataset.style ?? 'gorgeous')
    : 'gorgeous';
}

function isFocusStyle(): boolean {
  return currentUiStyle() === 'focus';
}

function laneColor(lane: number): string {
  const style = currentUiStyle();
  const palette =
    style === 'focus'
      ? focusLaneColors
      : style === 'synthwave'
        ? synthwaveLaneColors
        : gorgeousLaneColors;
  return palette[lane % palette.length] ?? palette[0];
}

function GraphCell({ commit, maxLanes }: { commit: CommitSummary; maxLanes: number }) {
  const spacing = 12;
  const width = Math.max(1, maxLanes) * spacing + 10;
  const x = (lane: number) => 8 + lane * spacing;
  const center = x(commit.lane);
  const color = laneColor(commit.lane);
  const active = commit.activeLanes.filter((lane) => lane !== commit.lane);
  const labelsByLane = new Map((commit.laneBranches ?? []).map((entry) => [entry.lane, entry.labels]));

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
        return (
          <div
            key={`lane-${lane}`}
            className="lane-hover absolute inset-y-0 z-10 cursor-help"
            style={{ left: x(lane) - spacing / 2, width: spacing }}
            title={labels.join(' · ')}
          >
            <span className="lane-label">
              {labels.slice(0, 3).join(' · ')}
              {labels.length > 3 ? ` +${labels.length - 3}` : ''}
            </span>
          </div>
        );
      })}
      <span
        className="pointer-events-none absolute rounded-full"
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

  const commits = useMemo(
    () => history.data?.pages.flatMap((page) => page.commits) ?? [],
    [history.data],
  );
  const total = history.data?.pages[0]?.total ?? 0;
  const maxLanes = history.data?.pages[0]?.maxLanes ?? 1;

  useEffect(() => {
    if (commits.length === 0) return;
    if (!selectedCommit || !commits.some((commit) => commit.hash === selectedCommit)) {
      setSelectedCommit(commits[0].hash);
    }
  }, [commits, selectedCommit, setSelectedCommit]);

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
                      'history-row relative flex h-12 w-full items-stretch gap-2 overflow-hidden pl-1 pr-0 text-left',
                      selectedCommit === commit.hash && 'history-row-selected',
                    )}
                    onClick={() => setSelectedCommit(commit.hash)}
                  >
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-edge/60" />
                    <GraphCell commit={commit} maxLanes={maxLanes} />
                    <div className="min-w-0 flex-1 py-1 pr-3">
                      <div className="flex items-center gap-1.5">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                          {commit.subject || '(no subject)'}
                        </p>
                        <div className="flex max-w-[45%] shrink-0 flex-nowrap justify-end gap-1 overflow-hidden">
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
                      <div className="mt-0.5 flex items-center gap-x-3 overflow-hidden whitespace-nowrap text-[11px] text-faint">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <User className="h-3 w-3 shrink-0" />
                          <span className="truncate">{commit.authorName}</span>
                        </span>
                        {(commit.laneBranches ?? [])
                          .find((entry) => entry.lane === commit.lane)
                          ?.labels.filter(
                            (label) => !commit.refs.some((ref) => refLabel(ref) === label),
                          )
                          .slice(0, 2)
                          .map((label) => (
                            <span
                              key={label}
                              className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded border border-accent/30 bg-accent/10 px-1.5 py-0 text-[10px] font-medium text-accent"
                              title={label}
                            >
                              <GitBranch className="h-3 w-3 shrink-0" />
                              <span className="max-w-[9rem] truncate">{label}</span>
                            </span>
                          ))}
                        <span className="hidden shrink-0 lg:inline">
                          {formatDate(commit.authorDate)}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 font-mono">
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

        <div className="hidden min-h-0 border-l border-edge/80 bg-panel/30 lg:block">
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
