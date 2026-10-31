import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Clock,
  Cloud,
  Download,
  ExternalLink,
  FileDiff,
  FileText,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequest,
  History,
  PanelLeft,
  RefreshCw,
  RotateCcw,
  Settings,
  SquareTerminal,
  Tags,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  buildRemoteBranchUrl,
  type Session,
} from '@gitastic/shared';
import { api } from '../api';
import appIcon from '../assets/app-icon.png';
import { useAction, useStartJob } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useStore, type View } from '../store';
import { BranchesView } from './BranchesView';
import { BlameView } from './BlameView';
import { ChangesView } from './ChangesView';
import { ConflictsView } from './ConflictsView';
import { FileHistoryView } from './FileHistoryView';
import { FilesView } from './FilesView';
import { HistoryView } from './HistoryView';
import { PullRequestsView } from './PullRequestsView';
import { ReflogView } from './ReflogView';
import { RemotesView } from './RemotesView';
import { SettingsView } from './SettingsView';
import { StashesView } from './StashesView';
import { TagsView } from './TagsView';
import { WorktreesView } from './WorktreesView';
import { HelpTip, type GlossaryTerm } from './HelpTip';
import { Modal, PathText, Spinner } from './ui';

const operations: Record<string, string> = {
  merge: 'Merge',
  rebase: 'Rebase',
  'cherry-pick': 'Cherry-pick',
  revert: 'Revert',
};

const viewHelp: Partial<Record<View, GlossaryTerm>> = {
  history: 'commit',
  changes: 'staging',
  files: 'file',
  branches: 'branch',
  stashes: 'stash',
  tags: 'tag',
  remotes: 'remote',
  pulls: 'pull-request',
  worktrees: 'worktree',
  conflicts: 'conflict',
  settings: 'theme',
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
  const settingsOpen = useStore((state) => state.settingsOpen);
  const setView = useStore((state) => state.setView);
  const isCurrent = view === 'settings' ? settingsOpen : !settingsOpen && active === view;
  return (
    <button
      type="button"
      className={cn('nav-item', isCurrent && 'nav-item-active')}
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
  const settingsOpen = useStore((state) => state.settingsOpen);
  const closeSettings = useStore((state) => state.closeSettings);
  const sidebarOpen = useStore((state) => state.sidebarOpen);
  const toggleSidebar = useStore((state) => state.toggleSidebar);
  const notify = useStore((state) => state.notify);
  const startJob = useStartJob();
  const { busy, run } = useAction();
  const [undoOpen, setUndoOpen] = useState(false);

  const repoQuery = useQuery({ queryKey: ['repo'], queryFn: api.repo });
  const providerQuery = useQuery({ queryKey: ['repo-provider'], queryFn: api.repoProvider });
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
  const remoteProvider = providerQuery.data?.remote ?? null;

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
    <div className="app-backdrop flex h-full min-h-0 bg-transparent">
      <aside
        className={cn(
          'flex shrink-0 flex-col border-r border-edge/80 bg-panel/80 backdrop-blur-2xl transition-[width] duration-200',
          sidebarOpen ? 'w-60' : 'w-0 overflow-hidden border-r-0',
        )}
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img
            src={appIcon}
            alt=""
            className="h-8 w-8 shrink-0 select-none rounded-lg"
            draggable={false}
          />
          <div className="min-w-0">
            <p className="brand-title text-sm font-semibold">Gitastic</p>
            <p className="truncate text-[11px] text-faint">local Git client</p>
          </div>
        </div>

        <div className="repo-card mx-2 mb-3 rounded-lg border p-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{repo.name}</p>
              <PathText text={repo.path} className="font-mono text-[10px] text-faint" />
            </div>
            <button
              type="button"
              className="btn-icon h-6 w-6"
              title="Close repository"
              onClick={() =>
                void run(
                  async () => {
                    await api.closeRepo();
                    await queryClient.invalidateQueries({ queryKey: ['session'] });
                  },
                  'Repository closed',
                  { refresh: false },
                )
              }
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
          <NavItem view="files" label="Files" icon={FileText} />
          <NavItem view="conflicts" label="Conflicts" icon={AlertTriangle} count={conflicts} danger />
          <NavItem view="branches" label="Branches" icon={GitBranch} />
          <NavItem view="stashes" label="Stashes" icon={Archive} />
          <NavItem view="tags" label="Tags" icon={Tags} />
          <div className="my-2 border-t border-edge" />
          <NavItem view="remotes" label="Remotes" icon={Cloud} />
          <NavItem
            view="pulls"
            label={remoteProvider?.provider === 'gitlab' ? 'Merge Requests' : 'Pull Requests'}
            icon={GitPullRequest}
          />
          <div className="my-2 border-t border-edge" />
          <NavItem view="worktrees" label="Worktrees" icon={FolderGit2} />
          <NavItem view="reflog" label="Reflog" icon={Clock} />
        </nav>

        <div className="space-y-0.5 border-t border-edge p-2">
          <NavItem view="settings" label="Settings" icon={Settings} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-edge/80 bg-panel/75 px-3 backdrop-blur-2xl">
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
            {viewHelp[view] ? <HelpTip term={viewHelp[view]!} label="What is this view?" /> : null}
          </div>

          <div className="ml-auto flex items-center gap-1">
            {remoteProvider ? (
              <>
                <a
                  href={
                    repo.branch
                      ? buildRemoteBranchUrl(remoteProvider, repo.branch)
                      : remoteProvider.webUrl
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost"
                  title={`Open on ${remoteProvider.host}`}
                >
                  <ExternalLink className="h-4 w-4" />
                  <span className="hidden 2xl:inline">
                    {remoteProvider.provider === 'gitlab' ? 'GitLab' : 'GitHub'}
                  </span>
                </a>
                <div className="mx-1 h-5 w-px bg-edge" />
              </>
            ) : null}
            <button
              type="button"
              className="btn-icon"
              title="Open repository in Editor"
              onClick={() => void api.openInEditor()}
            >
              <SquareTerminal className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="btn-icon"
              title="Reveal repository in Finder"
              onClick={() => void api.revealInFinder()}
            >
              <FolderOpen className="h-4 w-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-edge" />
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

        <main key={view} className="view-enter relative min-h-0 flex-1 overflow-hidden">
          {view === 'history' ? <HistoryView /> : null}
          {view === 'changes' ? <ChangesView /> : null}
          {view === 'files' ? <FilesView /> : null}
          {view === 'branches' ? <BranchesView /> : null}
          {view === 'pulls' ? <PullRequestsView /> : null}
          {view === 'worktrees' ? <WorktreesView /> : null}
          {view === 'tags' ? <TagsView /> : null}
          {view === 'remotes' ? <RemotesView /> : null}
          {view === 'stashes' ? <StashesView /> : null}
          {view === 'reflog' ? <ReflogView /> : null}
          {view === 'conflicts' ? <ConflictsView /> : null}
          {view === 'blame' ? <BlameView /> : null}
          {view === 'file-history' ? <FileHistoryView /> : null}
          {settingsOpen ? (
            <div className=" bounds-overlay absolute inset-0 z-30 bg-canvas">
              <SettingsView session={session} onClose={closeSettings} />
            </div>
          ) : null}
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
