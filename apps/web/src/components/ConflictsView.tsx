import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, FileWarning } from 'lucide-react';
import type { ConflictFile } from '@gitastic/shared';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useStore } from '../store';
import { EmptyState, ErrorState, LoadingState, Spinner } from './ui';

type Choice = 'ours' | 'theirs' | 'both' | 'base';

function resolveContent(file: ConflictFile, choices: Record<string, Choice>): string {
  const content = file.content ?? '';
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let cursor = 0;

  for (const block of file.blocks) {
    const start = block.startLine - 1;
    const end = block.endLine;
    output.push(...lines.slice(cursor, start));
    const choice = choices[`${file.path}:${block.id}`] ?? 'ours';
    const text =
      choice === 'ours'
        ? block.ours
        : choice === 'theirs'
          ? block.theirs
          : choice === 'both'
            ? [block.ours, block.theirs].filter(Boolean).join('\n')
            : (block.base ?? '');
    output.push(...text.replace(/\n$/, '').split('\n'));
    cursor = end;
  }

  output.push(...lines.slice(cursor));
  return output.join('\n');
}

export function ConflictsView() {
  const conflicts = useQuery({
    queryKey: ['conflicts'],
    queryFn: api.conflicts,
    refetchInterval: 6_000,
  });
  const { busy, run } = useAction();
  const setView = useStore((state) => state.setView);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [manualContent, setManualContent] = useState<Record<string, string>>({});

  const files = useMemo(() => conflicts.data?.files ?? [], [conflicts.data]);
  const file = files.find((entry) => entry.path === selectedPath) ?? files[0] ?? null;

  useEffect(() => {
    if (!selectedPath && files[0]) setSelectedPath(files[0].path);
  }, [files, selectedPath]);

  const resolved = useMemo(
    () => (file && !file.binary ? resolveContent(file, choices) : ''),
    [file, choices],
  );

  const chooseAll = (choice: Choice) => {
    if (!file) return;
    setChoices((current) => {
      const next = { ...current };
      for (const block of file.blocks) next[`${file.path}:${block.id}`] = choice;
      return next;
    });
  };

  const save = async () => {
    if (!file) return;
    const result = await run(
      () => api.resolveConflict(file.path, resolved),
      `Resolved ${file.path}.`,
    );
    if (result) {
      setSelectedPath(null);
      const remaining = files.filter((entry) => entry.path !== file.path);
      if (remaining.length === 0) setView('changes');
    }
  };

  if (conflicts.isLoading) return <LoadingState label="Loading conflicts..." />;
  if (conflicts.isError) {
    return <ErrorState error={conflicts.error} retry={() => void conflicts.refetch()} />;
  }

  if (files.length === 0) {
    return (
      <EmptyState
        icon={<Check className="h-8 w-8 text-success" />}
        title="No unresolved conflicts"
        description={
          conflicts.data?.operation
            ? 'All conflicts are resolved. Continue the operation from the banner above.'
            : 'There is no merge, rebase, or cherry-pick in progress.'
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-panel">
      <div className="flex w-[20rem] shrink-0 flex-col border-r border-edge">
        <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-danger" />
          <span className="text-sm font-medium">Conflicted files</span>
          <span className="badge badge-danger ml-auto">{files.length}</span>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {files.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 border-b border-edge/60 px-3 py-2 text-left hover:bg-raised/50',
                file?.path === entry.path && 'bg-raised',
              )}
              onClick={() => setSelectedPath(entry.path)}
            >
              <FileWarning className="h-4 w-4 shrink-0 text-danger" />
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{entry.path}</span>
              {entry.binary ? <span className="badge">binary</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {file ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{file.path}</span>
              {!file.binary && file.blocks.length > 0 ? (
                <>
                  <button type="button" className="btn h-7 text-xs" onClick={() => chooseAll('ours')}>
                    Ours all
                  </button>
                  <button type="button" className="btn h-7 text-xs" onClick={() => chooseAll('theirs')}>
                    Theirs all
                  </button>
                  <button type="button" className="btn h-7 text-xs" onClick={() => chooseAll('both')}>
                    Both all
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="btn btn-primary h-7 text-xs"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? <Spinner /> : null}
                Save resolution
              </button>
            </div>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
              {file.binary ? (
                <div className="mx-auto mt-10 max-w-lg space-y-4 rounded-lg border border-edge bg-canvas p-5 text-center">
                  <FileWarning className="mx-auto h-8 w-8 text-danger" />
                  <p className="text-sm text-muted">
                    This is a binary conflict. Choose which side should win.
                  </p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.resolveBinaryConflict(file.path, 'ours'),
                          'Binary conflict resolved with ours.',
                        )
                      }
                    >
                      Use ours
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.resolveBinaryConflict(file.path, 'theirs'),
                          'Binary conflict resolved with theirs.',
                        )
                      }
                    >
                      Use theirs
                    </button>
                  </div>
                </div>
              ) : file.blocks.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-warning">
                    No conflict markers were found. Edit the file manually and save.
                  </p>
                  <textarea
                    className="input min-h-[28rem] font-mono text-xs"
                    value={manualContent[file.path] ?? file.content ?? ''}
                    onChange={(event) =>
                      setManualContent((current) => ({
                        ...current,
                        [file.path]: event.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          api.resolveConflict(
                            file.path,
                            manualContent[file.path] ?? file.content ?? '',
                          ),
                        'File resolved.',
                      )
                    }
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {file.blocks.map((block, index) => {
                    const key = `${file.path}:${block.id}`;
                    const choice = choices[key] ?? 'ours';
                    return (
                      <div key={block.id} className="rounded-lg border border-edge bg-canvas">
                        <div className="flex flex-wrap items-center gap-1 border-b border-edge px-3 py-2">
                          <span className="text-xs font-medium text-ink">Conflict {index + 1}</span>
                          <span className="text-[11px] text-faint">
                            lines {block.startLine}-{block.endLine}
                          </span>
                          <div className="ml-auto flex rounded-md border border-edge p-0.5">
                            {(['ours', 'theirs', 'both'] as Choice[]).map((option) => (
                              <button
                                key={option}
                                type="button"
                                className={cn(
                                  'btn-ghost btn h-6 px-2 text-[11px] capitalize',
                                  choice === option && 'bg-raised text-ink',
                                )}
                                onClick={() =>
                                  setChoices((current) => ({ ...current, [key]: option }))
                                }
                              >
                                {option}
                              </button>
                            ))}
                            {block.base !== null ? (
                              <button
                                type="button"
                                className={cn(
                                  'btn-ghost btn h-6 px-2 text-[11px]',
                                  choice === 'base' && 'bg-raised text-ink',
                                )}
                                onClick={() =>
                                  setChoices((current) => ({ ...current, [key]: 'base' }))
                                }
                              >
                                Base
                              </button>
                            ) : null}
                          </div>
                        </div>
                        <div className="grid gap-0 md:grid-cols-2">
                          <div className="border-b border-edge md:border-b-0 md:border-r">
                            <div className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-accent">
                              Ours
                              {choice === 'ours' || choice === 'both' ? <Check className="h-3 w-3" /> : null}
                            </div>
                            <pre className="scrollbar-thin max-h-48 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-xs text-muted">
                              {block.ours || '(empty)'}
                            </pre>
                          </div>
                          <div>
                            <div className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-warning">
                              Theirs
                              {choice === 'theirs' || choice === 'both' ? <Check className="h-3 w-3" /> : null}
                            </div>
                            <pre className="scrollbar-thin max-h-48 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-xs text-muted">
                              {block.theirs || '(empty)'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="rounded-lg border border-edge">
                    <div className="border-b border-edge px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
                      Resolved preview
                    </div>
                    <pre className="scrollbar-thin max-h-64 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-success">
                      {resolved}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
