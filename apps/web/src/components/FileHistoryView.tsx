import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitCompare, History, User } from 'lucide-react';
import { shortHash } from '@gitastic/shared';
import { api } from '../api';
import { formatDate } from '../lib/utils';
import { useStore } from '../store';
import { EmptyState, ErrorState, LoadingState, Spinner } from './ui';

export function FileHistoryView() {
  const storedPath = useStore((state) => state.fileHistoryPath);
  const openBlame = useStore((state) => state.openBlame);
  const setSelectedCommit = useStore((state) => state.setSelectedCommit);
  const setView = useStore((state) => state.setView);
  const [path, setPath] = useState(storedPath ?? '');
  const [submitted, setSubmitted] = useState(storedPath ?? '');

  useEffect(() => {
    if (storedPath) {
      setPath(storedPath);
      setSubmitted(storedPath);
    }
  }, [storedPath]);

  const history = useQuery({
    queryKey: ['file-history', submitted],
    queryFn: () => api.fileHistory(submitted),
    enabled: Boolean(submitted),
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
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
                onClick={() => {
                  setSelectedCommit(commit.hash);
                  setView('history');
                }}
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
                    <span>{formatDate(commit.authorDate)}</span>
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
    </div>
  );
}
