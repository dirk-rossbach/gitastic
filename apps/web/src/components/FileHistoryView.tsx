import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ChevronLeft, ChevronRight, GitCompare, History, User, X } from 'lucide-react';
import { shortHash } from '@gitastic/shared';
import { api } from '../api';
import { cn, formatDateTime } from '../lib/utils';
import { useStore } from '../store';
import { EmptyState, ErrorState, LoadingState, Spinner } from './ui';
import { FileContent } from './FileContent';

export function FileHistoryView() {
  const storedPath = useStore((state) => state.fileHistoryPath);
  const openBlame = useStore((state) => state.openBlame);
  const setSelectedCommit = useStore((state) => state.setSelectedCommit);
  const setView = useStore((state) => state.setView);
  const [path, setPath] = useState(storedPath ?? '');
  const [submitted, setSubmitted] = useState(storedPath ?? '');
  const [selected, setSelected] = useState<{
    hash: string;
    subject: string;
    authorDate: string;
  } | null>(null);
  const [closing, setClosing] = useState(false);

  const closeDrawer = () => setClosing(true);

  useEffect(() => {
    if (!closing) return;
    const timeout = window.setTimeout(() => {
      setSelected(null);
      setClosing(false);
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [closing]);

  useEffect(() => {
    setClosing(false);
  }, [selected]);

  const history = useQuery({
    queryKey: ['file-history', submitted],
    queryFn: () => api.fileHistory(submitted),
    enabled: Boolean(submitted),
  });

  const revision = useQuery({
    queryKey: ['file-at', submitted, selected?.hash],
    queryFn: () => api.fileAtRevision(submitted, selected!.hash),
    enabled: Boolean(submitted && selected),
  });

  const commits = useMemo(() => history.data?.commits ?? [], [history.data]);  const selectedIndex = selected ? commits.findIndex((c) => c.hash === selected.hash) : -1;
  const hasPrevious = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < commits.length - 1;

  const openAt = useCallback(
    (index: number) => {
      const commit = commits[index];
      if (!commit) return;
      setSelected({ hash: commit.hash, subject: commit.subject, authorDate: commit.authorDate });
    },
    [commits],
  );

  const previous = () => {
    if (hasPrevious) openAt(selectedIndex - 1);
  };
  const next = () => {
    if (hasNext) openAt(selectedIndex + 1);
  };

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDrawer();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (hasPrevious) openAt(selectedIndex - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (hasNext) openAt(selectedIndex + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, hasPrevious, hasNext, selectedIndex, openAt]);

  useEffect(() => {
    if (storedPath) {
      setPath(storedPath);
      setSubmitted(storedPath);
    }
  }, [storedPath]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <History className="h-4 w-4 text-muted" />
        <span className="text-sm font-medium">File history</span>
        <form
          className="ml-2 flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (path.trim()) setSubmitted(path.trim());
          }}
        >
          <input
            className="input h-8 font-mono text-xs"
            placeholder="path/to/file"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <button type="submit" className="btn h-8 text-xs" disabled={!path.trim()}>
            {history.isFetching ? <Spinner /> : null}
            Open
          </button>
        </form>
        {submitted ? (
          <button type="button" className="btn h-8 text-xs" onClick={() => openBlame(submitted)}>
            <GitCompare className="h-3.5 w-3.5" />
            Blame
          </button>
        ) : null}
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {!submitted ? (
          <EmptyState
            icon={<History className="h-8 w-8" />}
            title="Browse a file's history"
            description="Enter a repository-relative path or use File history from a changed file."
          />
        ) : history.isLoading ? (
          <LoadingState label="Loading file history..." />
        ) : history.isError ? (
          <ErrorState error={history.error} retry={() => void history.refetch()} />
        ) : !history.data || history.data.commits.length === 0 ? (
          <EmptyState
            icon={<History className="h-8 w-8" />}
            title="No history"
            description="This file has not been committed on any branch."
          />
        ) : (
          <>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-edge bg-panel/95 px-3 py-1.5 backdrop-blur">
              <span className="panel-title">{submitted}</span>
              <span className="text-[10px] text-faint">
                {history.data.total} commit{history.data.total === 1 ? '' : 's'}
              </span>
            </div>
            {history.data.commits.map((commit) => (
              <button
                key={commit.hash}
                type="button"
                className="flex w-full items-start gap-3 border-b border-edge/60 px-3 py-2 text-left hover:bg-raised/50"
                onClick={() =>
                  setSelected({
                    hash: commit.hash,
                    subject: commit.subject,
                    authorDate: commit.authorDate,
                  })
                }
              >
                <span className="mt-0.5 shrink-0 rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-accent">
                  {shortHash(commit.hash)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {commit.subject || '(no subject)'}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {commit.authorName}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Clock className="h-3 w-3" />
                      <time
                        dateTime={commit.authorDate}
                        title={
                          commit.authorDate
                            ? new Date(commit.authorDate).toLocaleString()
                            : undefined
                        }
                      >
                        {formatDateTime(commit.authorDate)}
                      </time>
                    </span>
                  </span>
                </span>
              </button>
            ))}
            {history.data.total > history.data.commits.length ? (
              <p className="p-3 text-xs text-muted">
                Showing {history.data.commits.length} of {history.data.total} commits.
              </p>
            ) : null}
          </>
        )}
      </div>

      {selected ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close file version"
            className={cn(
              'detail-backdrop absolute inset-0 z-20 cursor-default bg-canvas/55 backdrop-blur-[1px]',
              closing && 'detail-backdrop-closing pointer-events-none',
            )}
            onClick={closeDrawer}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`${submitted} at ${shortHash(selected.hash)}`}
            className={cn(
              'detail-drawer absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-edge bg-panel md:w-[70%]',
              closing && 'detail-drawer-closing pointer-events-none',
            )}
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-edge/80 px-4">
              <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-accent">
                {shortHash(selected.hash)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{selected.subject}</span>
              <span className="hidden shrink-0 items-center gap-1 font-mono text-[11px] text-faint sm:flex">
                <Clock className="h-3 w-3" />
                {formatDateTime(selected.authorDate)}
              </span>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  className="btn-icon h-7 w-7"
                  title="Previous version (←)"
                  aria-label="Previous version"
                  disabled={!hasPrevious}
                  onClick={previous}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="w-10 text-center font-mono text-[10px] text-faint">
                  {selectedIndex + 1} / {commits.length}
                </span>
                <button
                  type="button"
                  className="btn-icon h-7 w-7"
                  title="Next version (→)"
                  aria-label="Next version"
                  disabled={!hasNext}
                  onClick={next}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                className="btn h-7 shrink-0 text-xs"
                onClick={() => {
                  setSelectedCommit(selected.hash);
                  setView('history');
                }}
              >
                Open in timeline
              </button>
              <button type="button" className="btn-icon" onClick={closeDrawer}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
              {revision.isLoading ? (
                <LoadingState label="Loading file version..." />
              ) : revision.isError ? (
                <ErrorState error={revision.error} retry={() => void revision.refetch()} />
              ) : revision.data?.binary ? (
                <p className="p-6 text-sm text-muted">This looks like a binary file.</p>
              ) : revision.data?.truncated ? (
                <p className="p-6 text-sm text-muted">
                  This file is too large to display (
                  {Math.round((revision.data.size ?? 0) / 1024)} KB).
                </p>
              ) : (
                <FileContent content={revision.data?.content ?? ''} />
              )}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
