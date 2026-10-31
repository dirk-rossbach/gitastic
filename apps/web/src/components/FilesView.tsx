import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, GitCompare, History, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import { cn } from '../lib/utils';
import { useStore } from '../store';
import { EmptyState, ErrorState, LoadingState, PathText, Spinner } from './ui';
import { HelpTip } from './HelpTip';

const MAX_RENDERED_LINES = 4000;

export function FilesView() {
  const openBlame = useStore((state) => state.openBlame);
  const openFileHistory = useStore((state) => state.openFileHistory);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const files = useQuery({ queryKey: ['repo-files'], queryFn: api.listFiles });
  const content = useQuery({
    queryKey: ['repo-file', selected],
    queryFn: () => api.fileContent(selected!),
    enabled: Boolean(selected),
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const items = files.data?.files ?? [];
    if (!query) return items;
    return items.filter((file) => file.toLowerCase().includes(query));
  }, [files.data?.files, search]);

  useEffect(() => {
    if (selected && files.data && !files.data.files.includes(selected)) {
      setSelected(null);
    }
  }, [files.data, selected]);

  return (
    <div className="flex h-full min-h-0 bg-panel">
      <div className="flex w-[22rem] shrink-0 flex-col border-r border-edge">
        <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
          <FileText className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">Files</span>
          <span className="text-xs text-faint">{files.data?.files.length ?? 0}</span>
          <HelpTip term="file" />
          <button
            type="button"
            className="btn-icon ml-auto"
            title="Refresh files"
            onClick={() => void files.refetch()}
          >
            <RefreshCw className={cn('h-4 w-4', files.isFetching && 'animate-spin')} />
          </button>
        </div>

        <div className="shrink-0 border-b border-edge px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              className="input h-8 pl-8 text-xs"
              placeholder="Filter files..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {files.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted">
              <Spinner /> Loading files...
            </div>
          ) : files.isError ? (
            <ErrorState error={files.error} retry={() => void files.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title="No files"
              description="No tracked or untracked files match this filter."
            />
          ) : (
            filtered.map((file) => (
              <button
                key={file}
                type="button"
                onClick={() => setSelected(file)}
                className={cn(
                  'flex w-full items-center gap-2 border-b border-edge/60 px-3 py-1.5 text-left transition hover:bg-raised/50',
                  selected === file && 'bg-raised',
                )}
              >
                <PathText text={file} className="min-w-0 flex-1 text-xs" />
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {!selected ? (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="Select a file"
            description="Pick a file to read its contents, follow its history or blame each line."
          />
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <PathText text={selected} className="min-w-0 flex-1 font-mono text-xs text-ink" />
              <button
                type="button"
                className="btn h-8 text-xs"
                onClick={() => openFileHistory(selected)}
              >
                <History className="h-3.5 w-3.5" />
                History
              </button>
              <button type="button" className="btn h-8 text-xs" onClick={() => openBlame(selected)}>
                <GitCompare className="h-3.5 w-3.5" />
                Blame
              </button>
            </div>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
              {content.isLoading ? (
                <LoadingState label="Loading file..." />
              ) : content.isError ? (
                <ErrorState error={content.error} retry={() => void content.refetch()} />
              ) : content.data?.binary ? (
                <p className="p-6 text-sm text-muted">This looks like a binary file.</p>
              ) : content.data?.truncated ? (
                <p className="p-6 text-sm text-muted">
                  This file is too large to display ({Math.round((content.data.size ?? 0) / 1024)} KB).
                </p>
              ) : (
                <FileContent content={content.data?.content ?? ''} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FileContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const shown = lines.slice(0, MAX_RENDERED_LINES);
  const clipped = lines.length > shown.length;
  return (
    <div className="min-w-max py-2 font-mono text-xs leading-5">
      {shown.map((line, index) => (
        <div key={index} className="flex hover:bg-raised/40">
          <span className="w-14 shrink-0 select-none border-r border-edge/60 px-2 text-right text-faint">
            {index + 1}
          </span>
          <span className="whitespace-pre px-3 text-ink">{line || ' '}</span>
        </div>
      ))}
      {clipped ? (
        <p className="px-3 py-2 text-faint">
          Showing the first {MAX_RENDERED_LINES.toLocaleString()} of {lines.length.toLocaleString()}{' '}
          lines.
        </p>
      ) : null}
    </div>
  );
}
