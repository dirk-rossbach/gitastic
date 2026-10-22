import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Cloud,
  Download,
  FileDiff,
  GitBranch,
  GitMerge,
  History,
  PanelLeft,
  RefreshCw,
  RotateCcw,
  Settings,
  Tags,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type { Session } from '@gitastic/shared';
import { api } from '../api';
import { useAction, useStartJob } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useStore, type View } from '../store';
import { BranchesView } from './BranchesView';
import { BlameView } from './BlameView';
import { ChangesView } from './ChangesView';
import { ConflictsView } from './ConflictsView';
import { FileHistoryView } from './FileHistoryView';
import { HistoryView } from './HistoryView';
import { RemotesView } from './RemotesView';
import { SettingsView } from './SettingsView';
import { StashesView } from './StashesView';
import { TagsView } from './TagsView';
import { Modal, Spinner } from './ui';

const operations: Record<string, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
};

function NavItem({
  view,
  label,
  icon: Icon,
  count,
  danger,
}: {
  view: View;
  label: string;
  icon: typeof History;
  count?: number;
  danger?: boolean;
}) {
  const active = useStore((state) => state.view);
  const setView = useStore((state) => state.setView);
  return (
    <button
      type="button"
      className={cn('nav-item', active === view && 'nav-item-active')}
      onClick={() => setView(view)}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1 text-left">{label}</span>
      {count !== undefined && count > 0 ? (
        <span className={cn('badge px-1.5', danger && 'badge-danger')}>{count}</span>
      ) : null}
    </button>
  );
}

export function Shell({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const view = useStore((state) => state.view);
  const setView = useStore((state) => state.setView);
  const sidebarOpen = useStore((state) => state.sidebarOpen);
  const toggleSidebar = useStore((state) => state.toggleSidebar);
  const notify = useStore((state) => state.notify);
  const startJob = useStartJob();
  const { busy, run } = useAction();
  const [undoOpen, setUndoOpen] = useState(false);

  const repoQuery = useQuery({ queryKey: ['repo'], queryFn: api.repo });
  const status = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: 8_000,
  });
  const undo = useQuery({
    queryKey: ['undo'],
    queryFn: api.undoList,
    enabled: undoOpen,
  });

  const repo = repoQuery.data ?? session.repo;
  if (!repo) return null;

  const changes = status.data?.files.length ?? repo.dirty;
  const conflicts = status.data
    ? status.data.files.filter((file) => file.conflicted).length
    : repo.conflicts;
  const operation = status.data?.operation ?? repo.operation;

  const push = () => {
    if (!repo.branch) {
      notify('error', 'Detached HEAD: create or checkout a branch before pushing.');
      return;
    }
    void startJob(
      api.push({
        branch: repo.branch,
        setUpstream: !repo.upstream,
      }),
    );
  };

  const handleOperation = async (action: 'continue' | 'abort' | 'skip') => {
    if (!operation) return;
    const result = await run(() => api.operation(operation, action));
    if (result?.conflicted) {
      notify('info', `${operations[operation] ?? operation} still has conflicts.`);
      setView('conflicts');
    } else if (action === 'abort') {
      notify('success', `${operations[operation] ?? operation} aborted.`);
    }
  };

  const refresh = () => {
    void queryClient.invalidateQueries();
  };

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-edge bg-panel transition-[width] duration-200',
          sidebarOpen ? 'w-60' : 'w-0 overflow-hidden border-r-0',
        )}
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <GitBranch className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Gitastic</p>
            <p className="truncate text-[11px] text-faint">local Git client</p>
          </div>
        </div>

        <div className="mx-2 mb-3 rounded-lg border border-edge bg-raised/50 p-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{repo.name}</p>
              <p className="truncate font-mono text-[10px] text-faint" title={repo.path}>
                {repo.path}
              </p>
            </div>
            <button
              type="button"
              className="btn-icon h-6 w-6"
              title="Close repository"
              onClick={() => void run(() => api.closeRepo(), 'Repository closed')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="badge badge-accent max-w-full truncate">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{repo.branch ?? 'detached'}</span>
            </span>
            {repo.ahead > 0 ? (
              <span className="badge badge-success">
                <ArrowUp className="h-3 w-3" />
                {repo.ahead}
              </span>
            ) : null}
            {repo.behind > 0 ? (
              <span className="badge badge-danger">
                <ArrowDown className="h-3 w-3" />
                {repo.behind}
              </span>
            ) : null}
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-2">
          <NavItem view="history" label="Timeline" icon={History} />
          <NavItem view="changes" label="Changes" icon={FileDiff} count={changes} />
          <NavItem view="branches" label="Branches" icon={GitBranch} />
          <NavItem view="tags" label="Tags" icon={Tags} />
          <NavItem view="remotes" label="Remotes" icon={Cloud} />
          <NavItem view="stashes" label="Stashes" icon={Archive} />
          <NavItem view="conflicts" label="Conflicts" icon={AlertTriangle} count={conflicts} danger />
          <div className="my-2 border-t border-edge" />
          <NavItem view="blame" label="Blame" icon={FileDiff} />
          <NavItem view="file-history" label="File history" icon={History} />
        </nav>

        <div className="space-y-0.5 border-t border-edge p-2">
          <NavItem view="settings" label="Settings" icon={Settings} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-edge bg-panel px-3">
          <button
            type="button"
            className="btn-icon"
            aria-label="Toggle sidebar"
            onClick={toggleSidebar}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{repo.name}</span>
            <span className="text-faint">/</span>
            <span className="flex items-center gap-1 truncate text-sm text-muted">
              <GitBranch className="h-3.5 w-3.5" />
              {repo.branch ?? repo.head?.slice(0, 7) ?? 'unborn'}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="btn btn-ghost"
              title="Undo an action"
              onClick={() => setUndoOpen(true)}
            >
              <Undo2 className="h-4 w-4" />
              <span className="hidden lg:inline">Undo</span>
            </button>
            <div className="mx-1 h-5 w-px bg-edge" />
            <button
              type="button"
              className="btn btn-ghost"
              title="Fetch all remotes"
              onClick={() => void startJob(api.fetch())}
            >
              <Download className="h-4 w-4" />
              <span className="hidden xl:inline">Fetch</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              title="Pull"
              onClick={() => void startJob(api.pull())}
            >
              <GitMerge className="h-4 w-4" />
              <span className="hidden xl:inline">Pull</span>
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              title="Push"
              onClick={push}
            >
              <Upload className="h-4 w-4" />
              <span className="hidden xl:inline">Push</span>
            </button>
            <button type="button" className="btn-icon" title="Refresh" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        {operation ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="font-medium text-warning">
              {operations[operation] ?? operation} in progress
            </span>
            <span className="text-xs text-muted">
              Resolve conflicts, then continue or abort.
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className="btn h-7 text-xs"
                disabled={busy}
                onClick={() => void handleOperation('continue')}
              >
                Continue
              </button>
              {operation !== 'merge' ? (
                <button
                  type="button"
                  className="btn h-7 text-xs"
                  disabled={busy}
                  onClick={() => void handleOperation('skip')}
                >
                  Skip
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-danger h-7 text-xs"
                disabled={busy}
                onClick={() => void handleOperation('abort')}
              >
                Abort
              </button>
            </div>
          </div>
        ) : null}

        <main className="min-h-0 flex-1 overflow-hidden">
          {view === 'history' ? <HistoryView /> : null}
          {view === 'changes' ? <ChangesView /> : null}
          {view === 'branches' ? <BranchesView /> : null}
          {view === 'tags' ? <TagsView /> : null}
          {view === 'remotes' ? <RemotesView /> : null}
          {view === 'stashes' ? <StashesView /> : null}
          {view === 'conflicts' ? <ConflictsView /> : null}
          {view === 'blame' ? <BlameView /> : null}
          {view === 'file-history' ? <FileHistoryView /> : null}
          {view === 'settings' ? <SettingsView session={session} /> : null}
        </main>
      </div>

      <Modal
        open={undoOpen}
        onOpenChange={setUndoOpen}
        title="Undo history"
        description="Recent destructive actions from this session."
        footer={
          <button type="button" className="btn" onClick={() => setUndoOpen(false)}>
            Close
          </button>
        }
      >
        {undo.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading...
          </div>
        ) : undo.data && undo.data.length > 0 ? (
          <div className="space-y-2">
            {undo.data.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 rounded-md border border-edge bg-raised/40 p-2.5"
              >
                <RotateCcw className="h-4 w-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{entry.label}</p>
                  <p className="text-xs text-faint">
                    {entry.kind} · {new Date(entry.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn h-7 text-xs"
                  disabled={busy}
                  onClick={() => {
                    void run(() => api.applyUndo(entry.id), 'Action undone.').then(() =>
                      setUndoOpen(false),
                    );
                  }}
                >
                  Undo
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Nothing to undo in this session.</p>
        )}
      </Modal>
    </div>
  );
}
