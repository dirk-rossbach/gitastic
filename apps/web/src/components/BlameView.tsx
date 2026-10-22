import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, GitCompare, History } from 'lucide-react';
import { api } from '../api';
import { cn, formatDate } from '../lib/utils';
import { useStore } from '../store';
import { EmptyState, ErrorState, LoadingState, Spinner } from './ui';

export function BlameView() {
  const storedPath = useStore((state) => state.blamePath);
  const openFileHistory = useStore((state) => state.openFileHistory);
  const [path, setPath] = useState(storedPath ?? '');
  const [submitted, setSubmitted] = useState(storedPath ?? '');

  useEffect(() => {
    if (storedPath) {
      setPath(storedPath);
      setSubmitted(storedPath);
    }
  }, [storedPath]);

  const blame = useQuery({
    queryKey: ['blame', submitted],
    queryFn: () => api.blame(submitted),
    enabled: Boolean(submitted),
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <GitCompare className="h-4 w-4 text-muted" />
        <span className="text-sm font-medium">Blame</span>
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
            {blame.isFetching ? <Spinner /> : null}
            Open
          </button>
        </form>
        {submitted ? (
          <button
            type="button"
            className="btn h-8 text-xs"
            onClick={() => openFileHistory(submitted)}
          >
            <History className="h-3.5 w-3.5" />
            File history
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {!submitted ? (
          <EmptyState
            icon={<FileSearch className="h-8 w-8" />}
            title="Blame a file"
            description="Enter a repository-relative path or use the Blame action from a changed file."
          />
        ) : blame.isLoading ? (
          <LoadingState label="Loading blame..." />
        ) : blame.isError ? (
          <ErrorState error={blame.error} retry={() => void blame.refetch()} />
        ) : !blame.data || blame.data.lines.length === 0 ? (
          <EmptyState
            icon={<FileSearch className="h-8 w-8" />}
            title="No blame data"
            description="The file may be untracked or empty."
          />
        ) : (
          <div className="scrollbar-thin h-full overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur">
                <tr className="border-b border-edge text-[10px] uppercase tracking-wide text-faint">
                  <th className="w-12 px-2 py-1.5 text-right font-medium">Line</th>
                  <th className="w-20 px-2 py-1.5 font-medium">Commit</th>
                  <th className="w-36 px-2 py-1.5 font-medium">Author</th>
                  <th className="w-40 px-2 py-1.5 font-medium">Date</th>
                  <th className="px-2 py-1.5 font-medium">Content</th>
                </tr>
              </thead>
              <tbody>
                {blame.data.lines.map((line, index) => {
                  const previous = blame.data.lines[index - 1];
                  const same = previous?.hash === line.hash;
                  return (
                    <tr
                      key={`${line.line}-${line.hash}`}
                      className="border-b border-edge/30 align-top hover:bg-raised/40"
                    >
                      <td className="px-2 py-0.5 text-right font-mono text-[11px] text-faint">
                        {line.line}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-0.5 font-mono text-[11px]',
                          same ? 'text-transparent' : 'text-accent',
                        )}
                        title={line.hash}
                      >
                        {line.shortHash}
                      </td>
                      <td
                        className={cn(
                          'truncate px-2 py-0.5 text-[11px]',
                          same ? 'text-transparent' : 'text-muted',
                        )}
                      >
                        {line.author}
                      </td>
                      <td
                        className={cn(
                          'truncate px-2 py-0.5 text-[11px]',
                          same ? 'text-transparent' : 'text-faint',
                        )}
                      >
                        {formatDate(line.date)}
                      </td>
                      <td className="whitespace-pre-wrap break-all px-2 py-0.5 font-mono text-[11px] text-ink">
                        {line.content || ' '}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {blame.data.total > blame.data.lines.length ? (
              <p className="p-3 text-xs text-muted">
                Showing {blame.data.lines.length} of {blame.data.total} lines.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
