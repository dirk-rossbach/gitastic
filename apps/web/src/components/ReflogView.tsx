import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, LogIn, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { cn, formatDate } from '../lib/utils';
import { EmptyState, ErrorState, LoadingState, Spinner } from './ui';

export function ReflogView() {
  const reflog = useQuery({ queryKey: ['repo-reflog'], queryFn: api.reflog });
  const { busy, run } = useAction();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const items = reflog.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.selector.toLowerCase().includes(q) ||
        item.message.toLowerCase().includes(q) ||
        item.shortHash.toLowerCase().includes(q) ||
        item.hash.toLowerCase().includes(q),
    );
  }, [reflog.data, search]);

  if (reflog.isLoading) return <LoadingState label="Loading Reflog..." />;
  if (reflog.isError) {
    return <ErrorState error={reflog.error} retry={() => void reflog.refetch()} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="history-toolbar flex shrink-0 flex-wrap items-center gap-2 border-b border-edge/80 px-3 py-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="input h-8 pl-8 text-xs"
            placeholder="Filter reflog by selector, message, hash..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <span className="badge font-mono text-[11px]">
          {reflog.data?.length ?? 0} entries
        </span>

        <button
          type="button"
          className="btn-icon"
          title="Refresh"
          onClick={() => void reflog.refetch()}
        >
          <RefreshCw className={cn('h-4 w-4', reflog.isFetching && 'animate-spin')} />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Clock className="h-8 w-8" />}
            title="No reflog entries found"
            description={search ? 'Try clearing the filter.' : 'Reflog history is empty.'}
          />
        ) : (
          filtered.map((item) => (
            <div
              key={`${item.selector}-${item.hash}`}
              className="group flex items-center justify-between gap-3 border-b border-edge/60 px-4 py-3 transition hover:bg-raised/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-accent font-mono text-xs font-semibold">
                    {item.selector}
                  </span>
                  <span className="font-mono text-xs text-muted">{item.shortHash}</span>
                  <span className="truncate text-sm font-medium text-ink">{item.message}</span>
                </div>
                <div className="mt-1 text-xs text-faint">{formatDate(item.date)}</div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="btn h-8 text-xs"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api.checkoutReflog(item.selector),
                      `Checked out reflog entry ${item.selector} (${item.shortHash}).`,
                    )
                  }
                >
                  {busy ? <Spinner /> : <LogIn className="h-3.5 w-3.5" />}
                  Checkout
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
