import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  Check,
  FileMinus2,
  FilePenLine,
  FilePlus2,
  FileQuestion,
  FolderOpen,
  GitCompare,
  History,
  Minus,
  Plus,
  RotateCcw,
  SquareTerminal,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { FileStatus } from '@gitastic/shared';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useStore } from '../store';
import { DiffViewer } from './DiffViewer';
import { StashDialog } from './StashDialog';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, PathText, Spinner } from './ui';

function fileIcon(file: FileStatus) {
  if (file.conflicted) return <AlertTriangle className="h-4 w-4 text-danger" />;
  if (file.untracked) return <FileQuestion className="h-4 w-4 text-success" />;
  if (file.kind === 'added') return <FilePlus2 className="h-4 w-4 text-success" />;
  if (file.kind === 'deleted') return <FileMinus2 className="h-4 w-4 text-danger" />;
  return <FilePenLine className="h-4 w-4 text-warning" />;
}

function FileRow({
  file,
  active,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  onBlame,
  onHistory,
  busy,
}: {
  file: FileStatus;
  active: boolean;
  onSelect: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onBlame: () => void;
  onHistory: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 border-b border-edge/50 px-2 py-1.5 hover:bg-raised/60',
        active && 'bg-raised',
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={onSelect}
      >
        {fileIcon(file)}
        <PathText text={file.path} className="min-w-0 flex-1 text-xs text-ink" />
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        {file.staged ? (
          <button
            type="button"
            className="btn-icon h-6 w-6"
            title="Unstage"
            disabled={busy}
            onClick={onUnstage}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className="btn-icon h-6 w-6"
            title="Stage"
            disabled={busy}
            onClick={onStage}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="btn-icon h-6 w-6"
          title="Blame"
          onClick={onBlame}
        >
          <GitCompare className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="btn-icon h-6 w-6"
          title="File history"
          onClick={onHistory}
        >
          <History className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="btn-icon h-6 w-6 hover:text-danger"
          title="Discard changes"
          disabled={busy}
          onClick={onDiscard}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Group({
  title,
  files,
  children,
}: {
  title: string;
  files: FileStatus[];
  children: (file: FileStatus) => React.ReactNode;
}) {
  if (files.length === 0) return null;
  return (
    <section>
      <div className="sticky top-0 z-10 flex items-center justify-between bg-panel/95 px-2.5 py-1.5 backdrop-blur">
        <span className="panel-title">{title}</span>
        <span className="text-[10px] text-faint">{files.length}</span>
      </div>
      {files.map(children)}
    </section>
  );
}

export function ChangesView() {
  const status = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 5_000,
  });
  const selectedFile = useStore((state) => state.selectedFile);
  const setSelectedFile = useStore((state) => state.setSelectedFile);
  const openBlame = useStore((state) => state.openBlame);
  const openFileHistory = useStore((state) => state.openFileHistory);
  const setView = useStore((state) => state.setView);
  const { busy, run } = useAction();

  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [signoff, setSignoff] = useState(false);
  const [stagedOverride, setStagedOverride] = useState<boolean | null>(null);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const [stashOpen, setStashOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [cleanPreview, setCleanPreview] = useState<string[]>([]);

  const files = useMemo(() => status.data?.files ?? [], [status.data]);
  const conflicts = files.filter((file) => file.conflicted);
  const staged = files.filter((file) => file.staged && !file.conflicted);
  const unstaged = files.filter((file) => file.unstaged && !file.staged && !file.conflicted);
  const both = files.filter((file) => file.staged && file.unstaged && !file.conflicted);
  const untracked = files.filter((file) => file.untracked);
  const file = files.find((entry) => entry.path === selectedFile) ?? null;

  const stagedView = stagedOverride ?? (file?.staged && !file.unstaged);

  useEffect(() => {
    if (!selectedFile && files[0]) setSelectedFile(files[0].path);
  }, [files, selectedFile, setSelectedFile]);

  useEffect(() => {
    setStagedOverride(null);
  }, [selectedFile]);

  const diff = useQuery({
    queryKey: ['diff', selectedFile, stagedView],
    queryFn: () => api.diff({ path: selectedFile ?? undefined, staged: stagedView }),
    enabled: Boolean(file) && !file?.conflicted,
  });

  const stage = (paths: string[]) => void run(() => api.stage(paths));
  const unstage = (paths: string[]) => void run(() => api.unstage(paths));

  const commit = async () => {
    if (!message.trim()) return;
    const result = await run(
      () =>
        api.createCommit({
          message: message.trim(),
          amend,
          signoff,
        }),
      'Commit created.',
    );
    if (result?.ok) {
      setMessage('');
      setAmend(false);
    }
  };

  const openClean = async () => {
    const result = await run(() => api.clean({}), undefined, { refresh: false });
    if (result) {
      setCleanPreview(result.preview ?? []);
      setCleanOpen(true);
    }
  };

  if (status.isLoading) return <LoadingState label="Loading changes..." />;
  if (status.isError) return <ErrorState error={status.error} retry={() => void status.refetch()} />;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[22rem] shrink-0 flex-col border-r border-edge bg-panel">
        <div className="flex shrink-0 items-center gap-1 border-b border-edge px-2 py-1.5">
          <button
            type="button"
            className="btn h-7 text-xs"
            disabled={busy || files.length === 0}
            onClick={() => stage([])}
          >
            <Plus className="h-3.5 w-3.5" />
            Stage all
          </button>
          <button
            type="button"
            className="btn h-7 text-xs"
            disabled={busy || staged.length === 0}
            onClick={() => unstage([])}
          >
            <Minus className="h-3.5 w-3.5" />
            Unstage all
          </button>
          <div className="ml-auto flex items-center">
            <button
              type="button"
              className="btn-icon"
              title="Stash changes"
              disabled={files.length === 0}
              onClick={() => setStashOpen(true)}
            >
              <Archive className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="btn-icon hover:text-danger"
              title="Clean untracked files"
              disabled={busy || untracked.length === 0}
              onClick={() => void openClean()}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          {files.length === 0 ? (
            <EmptyState
              icon={<Check className="h-8 w-8 text-success" />}
              title="Working tree clean"
              description="There are no staged, unstaged, or untracked changes."
            />
          ) : (
            <>
              <Group title="Conflicts" files={conflicts}>
                {(entry) => (
                  <FileRow
                    key={entry.path}
                    file={entry}
                    active={selectedFile === entry.path}
                    busy={busy}
                    onSelect={() => {
                      setSelectedFile(entry.path);
                      setView('conflicts');
                    }}
                    onStage={() => stage([entry.path])}
                    onUnstage={() => unstage([entry.path])}
                    onDiscard={() => setDiscardTarget(entry.path)}
                    onBlame={() => openBlame(entry.path)}
                    onHistory={() => openFileHistory(entry.path)}
                  />
                )}
              </Group>
              <Group title="Staged" files={staged}>
                {(entry) => (
                  <FileRow
                    key={entry.path}
                    file={entry}
                    active={selectedFile === entry.path}
                    busy={busy}
                    onSelect={() => setSelectedFile(entry.path)}
                    onStage={() => stage([entry.path])}
                    onUnstage={() => unstage([entry.path])}
                    onDiscard={() => setDiscardTarget(entry.path)}
                    onBlame={() => openBlame(entry.path)}
                    onHistory={() => openFileHistory(entry.path)}
                  />
                )}
              </Group>
              <Group title="Unstaged" files={unstaged}>
                {(entry) => (
                  <FileRow
                    key={entry.path}
                    file={entry}
                    active={selectedFile === entry.path}
                    busy={busy}
                    onSelect={() => setSelectedFile(entry.path)}
                    onStage={() => stage([entry.path])}
                    onUnstage={() => unstage([entry.path])}
                    onDiscard={() => setDiscardTarget(entry.path)}
                    onBlame={() => openBlame(entry.path)}
                    onHistory={() => openFileHistory(entry.path)}
                  />
                )}
              </Group>
              <Group title="Staged and unstaged" files={both}>
                {(entry) => (
                  <FileRow
                    key={entry.path}
                    file={entry}
                    active={selectedFile === entry.path}
                    busy={busy}
                    onSelect={() => setSelectedFile(entry.path)}
                    onStage={() => stage([entry.path])}
                    onUnstage={() => unstage([entry.path])}
                    onDiscard={() => setDiscardTarget(entry.path)}
                    onBlame={() => openBlame(entry.path)}
                    onHistory={() => openFileHistory(entry.path)}
                  />
                )}
              </Group>
              <Group title="Untracked" files={untracked}>
                {(entry) => (
                  <FileRow
                    key={entry.path}
                    file={entry}
                    active={selectedFile === entry.path}
                    busy={busy}
                    onSelect={() => setSelectedFile(entry.path)}
                    onStage={() => stage([entry.path])}
                    onUnstage={() => unstage([entry.path])}
                    onDiscard={() => setDiscardTarget(entry.path)}
                    onBlame={() => openBlame(entry.path)}
                    onHistory={() => openFileHistory(entry.path)}
                  />
                )}
              </Group>
            </>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-panel px-3 py-1.5">
          <PathText
            text={file?.path ?? 'Select a file'}
            className="min-w-0 flex-1 font-mono text-xs text-muted"
          />
          {file && file.staged && file.unstaged ? (
            <div className="flex rounded-md border border-edge p-0.5">
              <button
                type="button"
                className={cn('btn-ghost btn h-6 px-2 text-[11px]', !stagedView && 'bg-raised')}
                onClick={() => setStagedOverride(false)}
              >
                Working tree
              </button>
              <button
                type="button"
                className={cn('btn-ghost btn h-6 px-2 text-[11px]', stagedView && 'bg-raised')}
                onClick={() => setStagedOverride(true)}
              >
                Staged
              </button>
            </div>
          ) : null}
          {file ? (
            <>
              <button
                type="button"
                className="btn-icon"
                title="Open in Editor"
                onClick={() => void api.openInEditor(file.path)}
              >
                <SquareTerminal className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-icon"
                title="Reveal in Finder"
                onClick={() => void api.revealInFinder(file.path)}
              >
                <FolderOpen className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-icon"
                title="Blame"
                onClick={() => openBlame(file.path)}
              >
                <GitCompare className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-icon"
                title="File history"
                onClick={() => openFileHistory(file.path)}
              >
                <History className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-icon hover:text-danger"
                title="Discard changes"
                onClick={() => setDiscardTarget(file.path)}
              >
                <Undo2 className="h-4 w-4" />
              </button>
            </>
          ) : null}
        </div>

        <div className="min-h-0 flex-1">
          {!file ? (
            <EmptyState
              icon={<GitCompare className="h-8 w-8" />}
              title="No file selected"
              description="Choose a changed file to see its diff."
            />
          ) : file.conflicted ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-danger" />
              <p className="text-sm text-muted">This file has unresolved conflicts.</p>
              <button type="button" className="btn" onClick={() => setView('conflicts')}>
                Resolve conflicts
              </button>
            </div>
          ) : diff.isLoading ? (
            <LoadingState label="Loading diff..." />
          ) : diff.isError ? (
            <ErrorState error={diff.error} retry={() => void diff.refetch()} />
          ) : diff.data ? (
            <DiffViewer
              patch={diff.data.patch}
              binary={diff.data.binary}
              tooLarge={diff.data.tooLarge}
              files={diff.data.files}
              stageMode={file.untracked ? null : stagedView ? 'staged' : 'unstaged'}
              onApplyPatch={({ patch, cached, reverse, label }) => {
                void run(() => api.applyPatch({ patch, cached, reverse }), label);
              }}
              emptyLabel="No diff for this view."
            />
          ) : null}
        </div>

        <div className="shrink-0 border-t border-edge bg-panel p-3">
          <textarea
            className="input min-h-[4.5rem] resize-y font-mono text-xs"
            placeholder="Commit message (Cmd/Ctrl+Enter to commit)"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void commit();
              }
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                className="accent-accent"
                checked={amend}
                onChange={(event) => setAmend(event.target.checked)}
              />
              Amend
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                className="accent-accent"
                checked={signoff}
                onChange={(event) => setSignoff(event.target.checked)}
              />
              Sign off
            </label>
            <span className="text-xs text-faint">
              {staged.length} staged · {unstaged.length + untracked.length} not staged
            </span>
            <button
              type="button"
              className="btn btn-primary ml-auto"
              disabled={busy || !message.trim() || (staged.length === 0 && !amend)}
              onClick={() => void commit()}
            >
              {busy ? <Spinner /> : null}
              Commit
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={discardTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
        title="Discard changes?"
        description={`All changes to ${discardTarget ?? 'this file'} will be moved to the Gitastic trash and can be restored with Undo.`}
        confirmLabel="Discard"
        danger
        busy={busy}
        onConfirm={async () => {
          if (!discardTarget) return;
          await run(() => api.restore({ paths: [discardTarget], confirm: true }), 'Changes discarded.');
          setDiscardTarget(null);
        }}
      />

      <StashDialog open={stashOpen} onOpenChange={setStashOpen} />

      <ConfirmDialog
        open={cleanOpen}
        onOpenChange={setCleanOpen}
        title="Clean untracked files?"
        description={`${cleanPreview.length} untracked item${cleanPreview.length === 1 ? '' : 's'} will be moved to the Gitastic trash. You can restore them with Undo.`}
        confirmLabel="Move to trash"
        danger
        busy={busy}
        onConfirm={async () => {
          await run(() => api.clean({ confirm: true }), 'Untracked files cleaned.');
          setCleanOpen(false);
          setCleanPreview([]);
        }}
      >
        {cleanPreview.length > 0 ? (
          <ul className="scrollbar-thin max-h-64 space-y-1 overflow-auto font-mono text-xs text-muted">
            {cleanPreview.map((entry) => (
              <li key={entry} className="truncate rounded bg-raised px-2 py-1">
                {entry}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing to clean.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
