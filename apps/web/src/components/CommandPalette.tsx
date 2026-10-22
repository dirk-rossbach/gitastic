import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  Cloud,
  CornerDownLeft,
  Download,
  ExternalLink,
  Eye,
  FileDiff,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Heart,
  History,
  Minus,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SquareTerminal,
  Sun,
  Tags,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  buildCreatePullUrl,
  buildRemoteBranchUrl,
  type Session,
  type UiStyle,
} from '@gitastic/shared';
import { api } from '../api';
import { applyAppearance } from '../App';
import { useAction, useStartJob } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useStore } from '../store';

interface CommandItem {
  id: string;
  group: string;
  label: string;
  subtitle?: string;
  keywords?: string;
  shortcut?: string;
  icon: typeof History;
  action: () => void | Promise<void>;
}

export function CommandPalette({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const open = useStore((state) => state.commandPaletteOpen);
  const close = useStore((state) => state.closeCommandPalette);
  const setView = useStore((state) => state.setView);
  const openSettings = useStore((state) => state.openSettings);
  const notify = useStore((state) => state.notify);
  const { run } = useAction();
  const startJob = useStartJob();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const repo = session.repo;
  const branches = useQuery({
    queryKey: ['branches'],
    queryFn: api.branches,
    enabled: open && Boolean(repo),
  });
  const providerQuery = useQuery({
    queryKey: ['repo-provider'],
    queryFn: api.repoProvider,
    enabled: open && Boolean(repo),
  });
  const remoteProvider = providerQuery.data?.remote ?? null;

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];
    const currentTheme = session.config.theme;
    const currentStyle: UiStyle = session.config.uiStyle ?? 'gorgeous';

    if (repo) {
      items.push(
        {
          id: 'nav-history',
          group: 'Navigation',
          label: 'Go to Timeline',
          subtitle: 'Commit history & branch graph',
          keywords: 'timeline history log commits graph',
          icon: History,
          action: () => setView('history'),
        },
        {
          id: 'nav-changes',
          group: 'Navigation',
          label: 'Go to Changes',
          subtitle: 'Working tree, staging & commit',
          keywords: 'changes status diff stage commit working tree',
          icon: FileDiff,
          action: () => setView('changes'),
        },
        {
          id: 'nav-branches',
          group: 'Navigation',
          label: 'Go to Branches',
          subtitle: 'Local & remote branches',
          keywords: 'branches checkout merge rebase',
          icon: GitBranch,
          action: () => setView('branches'),
        },
        {
          id: 'nav-pulls',
          group: 'Navigation',
          label:
            remoteProvider?.provider === 'gitlab'
              ? 'Go to Merge Requests'
              : 'Go to Pull Requests',
          subtitle: 'Open PRs / MRs from GitHub or GitLab',
          keywords: 'pull requests merge requests pr mr github gitlab',
          icon: GitPullRequest,
          action: () => setView('pulls'),
        },
        {
          id: 'nav-worktrees',
          group: 'Navigation',
          label: 'Go to Worktrees',
          subtitle: 'Manage parallel Git worktrees',
          keywords: 'worktrees parallel branches folders',
          icon: FolderGit2,
          action: () => setView('worktrees'),
        },
        {
          id: 'nav-tags',
          group: 'Navigation',
          label: 'Go to Tags',
          keywords: 'tags release version',
          icon: Tags,
          action: () => setView('tags'),
        },
        {
          id: 'nav-remotes',
          group: 'Navigation',
          label: 'Go to Remotes',
          keywords: 'remotes origin upstream url',
          icon: Cloud,
          action: () => setView('remotes'),
        },
        {
          id: 'nav-stashes',
          group: 'Navigation',
          label: 'Go to Stashes',
          keywords: 'stash pop apply save',
          icon: Archive,
          action: () => setView('stashes'),
        },
        {
          id: 'nav-conflicts',
          group: 'Navigation',
          label: 'Go to Conflicts',
          keywords: 'conflicts merge rebase resolve',
          icon: AlertTriangle,
          action: () => setView('conflicts'),
        },
        {
          id: 'nav-blame',
          group: 'Navigation',
          label: 'Go to Blame',
          keywords: 'blame annotate lines author',
          icon: FileDiff,
          action: () => setView('blame'),
        },
        {
          id: 'nav-file-history',
          group: 'Navigation',
          label: 'Go to File History',
          keywords: 'file history log',
          icon: History,
          action: () => setView('file-history'),
        },
      );

      items.push(
        {
          id: 'git-fetch',
          group: 'Git Actions',
          label: 'Fetch all remotes',
          subtitle: 'Download objects and refs from all remotes',
          keywords: 'fetch remote sync',
          icon: Download,
          action: () => startJob(api.fetch()),
        },
        {
          id: 'git-pull',
          group: 'Git Actions',
          label: 'Pull current branch',
          subtitle: `Strategy: ${session.config.pullStrategy}`,
          keywords: 'pull update sync',
          icon: GitMerge,
          action: () => startJob(api.pull()),
        },
        {
          id: 'git-push',
          group: 'Git Actions',
          label: 'Push current branch',
          subtitle: repo.branch ?? 'detached HEAD',
          keywords: 'push upload publish',
          icon: Upload,
          action: () => {
            if (!repo.branch) {
              notify('error', 'Detached HEAD: checkout a branch before pushing.');
              return;
            }
            void startJob(
              api.push({
                branch: repo.branch,
                setUpstream: !repo.upstream,
              }),
            );
          },
        },
        {
          id: 'git-stage-all',
          group: 'Git Actions',
          label: 'Stage all changes',
          keywords: 'stage add all',
          icon: Plus,
          action: async () => {
            await run(() => api.stage([]), 'Staged all changes.');
            setView('changes');
          },
        },
        {
          id: 'git-unstage-all',
          group: 'Git Actions',
          label: 'Unstage all changes',
          keywords: 'unstage reset staged',
          icon: Minus,
          action: async () => {
            await run(() => api.unstage([]), 'Unstaged all changes.');
            setView('changes');
          },
        },
        {
          id: 'git-stash',
          group: 'Git Actions',
          label: 'Stash working tree changes',
          subtitle: 'Includes untracked files',
          keywords: 'stash push save wip',
          icon: Archive,
          action: async () => {
            await run(() => api.stashPush({ includeUntracked: true }), 'Changes stashed.');
          },
        },
        {
          id: 'git-refresh',
          group: 'Git Actions',
          label: 'Refresh repository status & timeline',
          keywords: 'refresh reload status',
          icon: RefreshCw,
          action: async () => {
            await queryClient.invalidateQueries();
            notify('info', 'Repository refreshed.');
          },
        },
        {
          id: 'sys-editor',
          group: 'Git Actions',
          label: 'Open repository in Editor',
          subtitle: 'Cursor / Zed / VS Code',
          keywords: 'open editor cursor zed vscode code',
          icon: SquareTerminal,
          action: async () => {
            await api.openInEditor();
          },
        },
        {
          id: 'sys-terminal',
          group: 'Git Actions',
          label: 'Open repository in Terminal',
          keywords: 'open terminal shell console',
          icon: SquareTerminal,
          action: async () => {
            await api.openTerminal();
          },
        },
        {
          id: 'sys-finder',
          group: 'Git Actions',
          label: 'Reveal repository in Finder',
          keywords: 'reveal finder folder mac',
          icon: FolderOpen,
          action: async () => {
            await api.revealInFinder();
          },
        },
        {
          id: 'repo-close',
          group: 'Git Actions',
          label: 'Close current repository',
          subtitle: 'Return to Welcome screen',
          keywords: 'close repository welcome switch project',
          icon: X,
          action: async () => {
            await run(
              async () => {
                await api.closeRepo();
                await queryClient.invalidateQueries({ queryKey: ['session'] });
              },
              'Repository closed',
              { refresh: false },
            );
          },
        },
      );

      if (remoteProvider) {
        items.push({
          id: 'remote-open-web',
          group: 'Git Actions',
          label: `Open repository on ${remoteProvider.host}`,
          subtitle: remoteProvider.fullName,
          keywords: 'open browser github gitlab remote web',
          icon: ExternalLink,
          action: () => {
            const url = repo.branch
              ? buildRemoteBranchUrl(remoteProvider, repo.branch)
              : remoteProvider.webUrl;
            void api.openExternal(url);
          },
        });
        if (repo.branch) {
          items.push({
            id: 'remote-create-pr',
            group: 'Git Actions',
            label: `Create ${remoteProvider.provider === 'gitlab' ? 'Merge Request' : 'Pull Request'} for ${repo.branch}`,
            subtitle: remoteProvider.fullName,
            keywords: 'create pull request merge request pr mr',
            icon: GitPullRequest,
            action: () => {
              void api.openExternal(buildCreatePullUrl(remoteProvider, repo.branch!));
            },
          });
        }
      }

      for (const branch of (branches.data ?? []).slice(0, 30)) {
        if (branch.current) continue;
        items.push({
          id: `branch-checkout-${branch.ref}`,
          group: 'Switch Branch',
          label: `Checkout ${branch.name}`,
          subtitle: branch.remote ? 'Remote branch (auto-tracks)' : branch.subject || 'Local branch',
          keywords: `checkout switch branch ${branch.name}`,
          icon: GitBranch,
          action: async () => {
            await run(() => api.checkout(branch.name), `Checked out ${branch.name}.`);
          },
        });
      }
    }

    for (const recent of session.config.recentRepos) {
      if (repo?.path === recent.path) continue;
      items.push({
        id: `recent-open-${recent.id}`,
        group: 'Recent Repositories',
        label: `Open ${recent.name}`,
        subtitle: recent.path,
        keywords: `open repo project recent ${recent.name} ${recent.path}`,
        icon: FolderOpen,
        action: async () => {
          await run(
            async () => {
              const opened = await api.openRepo(recent.path);
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['session'] }),
                queryClient.invalidateQueries({ queryKey: ['repo'] }),
                queryClient.invalidateQueries({ queryKey: ['recent-repos'] }),
              ]);
              return opened;
            },
            `Opened ${recent.name}`,
            { refresh: false },
          );
        },
      });
    }

    const saveAppearance = async (
      nextTheme: 'dark' | 'light' | 'system',
      nextStyle: UiStyle,
    ) => {
      applyAppearance(nextTheme, nextStyle);
      await api.updateSettings({ theme: nextTheme, uiStyle: nextStyle });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    };

    items.push(
      {
        id: 'app-settings',
        group: 'Appearance & System',
        label: 'Open Settings',
        subtitle: 'Styles, modes, GitHub/GitLab tokens, SSH keys & cache',
        keywords: 'settings preferences tokens ssh keys appearance',
        shortcut: '⌘,',
        icon: Settings,
        action: () => openSettings(),
      },
      {
        id: 'style-gorgeous',
        group: 'Appearance & System',
        label: 'Style: Switch to Gorgeous',
        subtitle: 'Vibrant gradients, neon glows & animations',
        keywords: 'style gorgeous neon gradients animations',
        icon: Sparkles,
        action: () => saveAppearance(currentTheme, 'gorgeous'),
      },
      {
        id: 'style-synthwave',
        group: 'Appearance & System',
        label: 'Style: Switch to Synthwave / Cyberpunk',
        subtitle: 'Hot-magenta, cyber-cyan & outrun neon grid',
        keywords: 'style synthwave cyberpunk outrun retro neon pink cyan',
        icon: Zap,
        action: () => saveAppearance(currentTheme, 'synthwave'),
      },
      {
        id: 'style-focus',
        group: 'Appearance & System',
        label: 'Style: Switch to Focus',
        subtitle: 'Minimal palette, flat surfaces & no animations',
        keywords: 'style focus minimal flat calm',
        icon: Eye,
        action: () => saveAppearance(currentTheme, 'focus'),
      },
      {
        id: 'theme-dark',
        group: 'Appearance & System',
        label: 'Mode: Switch to Dark Mode',
        keywords: 'theme mode dark',
        icon: Moon,
        action: () => saveAppearance('dark', currentStyle),
      },
      {
        id: 'theme-light',
        group: 'Appearance & System',
        label: 'Mode: Switch to Light Mode',
        keywords: 'theme mode light',
        icon: Sun,
        action: () => saveAppearance('light', currentStyle),
      },
      {
        id: 'theme-system',
        group: 'Appearance & System',
        label: 'Mode: Switch to System Mode',
        keywords: 'theme mode system auto',
        icon: Monitor,
        action: () => saveAppearance('system', currentStyle),
      },
      {
        id: 'cache-clear',
        group: 'Appearance & System',
        label: 'Clear History Cache',
        subtitle: 'Purge memory and disk timeline cache',
        keywords: 'clear cache history purge reset',
        icon: Trash2,
        action: async () => {
          await run(async () => {
            await api.clearCache();
            queryClient.removeQueries({ queryKey: ['history'] });
            queryClient.removeQueries({ queryKey: ['commit'] });
            await queryClient.invalidateQueries({ queryKey: ['history'] });
          }, 'History cache cleared.');
        },
      },
      {
        id: 'app-sponsor',
        group: 'Appearance & System',
        label: 'Sponsor Gitastic on GitHub',
        subtitle: 'github.com/sponsors/dirk-rossbach',
        keywords: 'sponsor support donate github heart',
        icon: Heart,
        action: () => {
          void api.openExternal('https://github.com/sponsors/dirk-rossbach');
        },
      },
    );

    return items;
  }, [
    branches.data,
    notify,
    openSettings,
    queryClient,
    remoteProvider,
    repo,
    run,
    session.config.pullStrategy,
    session.config.recentRepos,
    session.config.theme,
    session.config.uiStyle,
    setView,
    startJob,
  ]);

  const filtered = useMemo(() => {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (terms.length === 0) return commands;
    return commands.filter((item) => {
      const haystack = `${item.group} ${item.label} ${item.subtitle ?? ''} ${item.keywords ?? ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [commands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(`[data-cmd-index="${selectedIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  const triggerItem = (item: CommandItem | undefined) => {
    if (!item) return;
    close();
    void item.action();
  };

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-label="Command Palette"
        className="modal-card flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge/80"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedIndex((prev) =>
              filtered.length === 0 ? 0 : (prev + 1) % filtered.length,
            );
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedIndex((prev) =>
              filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length,
            );
          } else if (event.key === 'Enter') {
            event.preventDefault();
            triggerItem(filtered[selectedIndex]);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-edge px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-accent" />
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
            placeholder="Type a command, branch, view, or repository..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="badge font-mono text-[10px]">ESC</span>
        </div>

        <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted">No matching commands.</p>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const isSelected = index === selectedIndex;
              const prevGroup = index > 0 ? filtered[index - 1]?.group : null;
              return (
                <div key={item.id}>
                  {item.group !== prevGroup ? (
                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
                      {item.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    data-cmd-index={index}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => triggerItem(item)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition',
                      isSelected ? 'bg-accent/15 text-ink' : 'text-muted hover:bg-raised/60',
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        isSelected ? 'text-accent' : 'text-muted',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{item.label}</p>
                      {item.subtitle ? (
                        <p className="truncate text-xs text-faint">{item.subtitle}</p>
                      ) : null}
                    </div>
                    {item.shortcut ? (
                      <span className="badge font-mono text-[10px]">{item.shortcut}</span>
                    ) : null}
                    {isSelected ? (
                      <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-accent" />
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-edge bg-raised/30 px-4 py-2 text-[11px] text-faint">
          <span>↑↓ to navigate · ↵ to execute · esc to dismiss</span>
          <span className="font-mono">Ctrl+P / ⌘P / ⌘K</span>
        </div>
      </div>
    </div>
  );
}
