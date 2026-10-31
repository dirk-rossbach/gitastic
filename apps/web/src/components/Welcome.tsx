import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Circle,
  CloudDownload,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  HardDrive,
  Home,
  Info,
  RefreshCw,
  Settings,
} from 'lucide-react';
import type { OnboardingCheck, Session, UiStyle } from '@gitastic/shared';
import { api } from '../api';
import { applyAppearance } from '../App';
import { useAction, useStartJob } from '../lib/hooks';
import { cn, formatDate, errorMessage } from '../lib/utils';
import { useStore } from '../store';
import { resolvedThemeMode, styleForTheme, type StyleMode } from '../ui-styles';
import { ProviderRepoBrowser } from './ProvidersPanel';
import { StyleMenu } from './StyleMenu';
import { PathText, Spinner } from './ui';

function CheckRow({ check }: { check: OnboardingCheck }) {
  const Icon =
    check.status === 'ok' ? CheckCircle2 : check.status === 'warn' ? Info : AlertTriangle;
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-edge bg-raised/40 px-3 py-2">
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          check.status === 'ok'
            ? 'text-success'
            : check.status === 'warn'
              ? 'text-warning'
              : 'text-danger',
        )}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{check.label}</p>
        <p className="break-words text-xs text-muted">{check.detail}</p>
        {check.hint ? <p className="mt-1 text-xs text-faint">{check.hint}</p> : null}
      </div>
    </div>
  );
}

export function Welcome({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const openSettings = useStore((state) => state.openSettings);
  const [mode, setMode] = useState<'open' | 'clone' | null>(null);
  const [path, setPath] = useState(session.onboarding.home);
  const [browserPath, setBrowserPath] = useState(session.onboarding.home);
  const [cloneUrl, setCloneUrl] = useState('');
  const [clonePath, setClonePath] = useState(`${session.onboarding.home}/repo`);
  const root = session.onboarding.root;
  const { busy, run } = useAction();
  const startJob = useStartJob();

  const currentTheme = session.config.theme;
  const currentMode = resolvedThemeMode(currentTheme);
  const currentStyle: UiStyle = styleForTheme(
    currentTheme,
    session.config.uiStyle ?? 'gorgeous',
  );

  const recents = useQuery({ queryKey: ['recent-repos'], queryFn: api.recentRepos });
  const listing = useQuery({
    queryKey: ['directories', browserPath],
    queryFn: () => api.listDirectories(browserPath),
    enabled: mode === 'open',
  });

  const blocking = useMemo(
    () => session.onboarding.checks.filter((check) => check.status === 'error'),
    [session.onboarding.checks],
  );

  const openPath = (target: string) => {
    setPath(target);
    void run(
      async () => {
        const opened = await api.openRepo(target);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['session'] }),
          queryClient.invalidateQueries({ queryKey: ['repo'] }),
          queryClient.invalidateQueries({ queryKey: ['recent-repos'] }),
        ]);
        return opened;
      },
      'Repository opened',
      { refresh: false },
    );
  };

  const quickAppearance = async (nextMode: StyleMode, nextStyle: UiStyle) => {
    const effectiveStyle = styleForTheme(nextMode, nextStyle);
    applyAppearance(nextMode, effectiveStyle);
    await api.updateSettings({ theme: nextMode, uiStyle: effectiveStyle });
    await queryClient.invalidateQueries({ queryKey: ['session'] });
  };

  return (
    <div className="app-backdrop scrollbar-thin h-full overflow-auto bg-transparent">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="brand-mark flex h-11 w-11 items-center justify-center rounded-xl border">
              <GitBranch className="h-6 w-6" />
            </div>
            <div>
              <h1 className="gradient-text text-2xl font-semibold tracking-tight">Gitastic</h1>
              <p className="text-sm text-muted">
                Cross-platform local Git client.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StyleMenu
              current={currentStyle}
              currentMode={currentMode}
              onSelect={(style, mode) => void quickAppearance(mode, style)}
            />
            <button
              type="button"
              className="btn h-8 text-xs"
              onClick={openSettings}
              title="Settings (Cmd+,)"
            >
              <Settings className="h-3.5 w-3.5 text-accent" />
              Settings
            </button>
          </div>
        </header>

        {blocking.length > 0 ? (
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-4">
            <p className="mb-2 text-sm font-medium text-danger">Gitastic cannot start yet</p>
            <div className="space-y-2">
              {blocking.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </div>
        ) : null}

        {mode === null ? (
          <div className="space-y-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('open')}
                className="repo-card group flex flex-col items-start gap-4 rounded-xl border p-6 text-left transition hover:border-accent"
              >
                <div className="brand-mark flex h-12 w-12 items-center justify-center rounded-xl border">
                  <FolderOpen className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-ink">Open from local</h2>
                  <p className="text-xs text-muted">
                    Browse folders on this machine or enter a path to an existing Git repository.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMode('clone')}
                className="repo-card group flex flex-col items-start gap-4 rounded-xl border p-6 text-left transition hover:border-accent"
              >
                <div className="brand-mark flex h-12 w-12 items-center justify-center rounded-xl border">
                  <CloudDownload className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-ink">Clone from remote</h2>
                  <p className="text-xs text-muted">
                    Browse your GitHub & GitLab repositories or clone from any remote URL.
                  </p>
                </div>
              </button>
            </div>

            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="panel-title">Recent repositories</h2>
                <span className="text-xs text-faint">{recents.data?.length ?? 0}</span>
              </div>
              {recents.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Spinner /> Loading...
                </div>
              ) : recents.data && recents.data.length > 0 ? (
                <div className="-mx-2 space-y-0.5">
                  {recents.data.map((repo) => (
                    <button
                      key={repo.path}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-raised"
                      onClick={() => openPath(repo.path)}
                    >
                      <GitBranch className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{repo.name}</span>
                        <PathText
                          text={repo.path}
                          className="font-mono text-[11px] text-faint"
                        />
                      </span>
                      <span className="shrink-0 text-[11px] text-faint">
                        {formatDate(repo.lastOpened)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted">
                  <Circle className="h-3 w-3" /> No repositories opened yet.
                </div>
              )}
            </div>
          </div>
        ) : (
          <section className="card overflow-hidden">
            <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
              <button
                type="button"
                className="btn h-8 px-2.5 text-xs"
                onClick={() => setMode(null)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium">
                  {mode === 'open' ? 'Open from local' : 'Clone from remote'}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost h-8 text-xs"
                onClick={() => setMode(mode === 'open' ? 'clone' : 'open')}
              >
                {mode === 'open' ? (
                  <>
                    <CloudDownload className="h-3.5 w-3.5" />
                    Clone from remote
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open from local
                  </>
                )}
              </button>
            </div>

            {mode === 'open' ? (
              <div className="space-y-4 p-4">
                <div className="flex gap-2">
                  <input
                    className="input font-mono text-xs"
                    value={path}
                    spellCheck={false}
                    placeholder="/Users/you/project"
                    onChange={(event) => setPath(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && path.trim()) openPath(path.trim());
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary shrink-0"
                    disabled={busy || !path.trim()}
                    onClick={() => openPath(path.trim())}
                  >
                    {busy ? <Spinner /> : null}
                    Open
                  </button>
                </div>

                <div className="overflow-hidden rounded-md border border-edge">
                  <div className="flex items-center gap-2 border-b border-edge bg-raised/50 px-2 py-1.5">
                    <button
                      type="button"
                      className="btn-icon h-7 w-7"
                      aria-label="Home directory"
                      title="Home directory"
                      disabled={browserPath === session.onboarding.home}
                      onClick={() => {
                        setBrowserPath(session.onboarding.home);
                        setPath(session.onboarding.home);
                      }}
                    >
                      <Home className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon h-7 w-7"
                      aria-label="Filesystem root"
                      title="Filesystem root"
                      disabled={browserPath === root}
                      onClick={() => {
                        setBrowserPath(root);
                        setPath(root);
                      }}
                    >
                      <HardDrive className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon h-7 w-7"
                      aria-label="Parent directory"
                      disabled={!listing.data?.parent}
                      onClick={() => {
                        if (listing.data?.parent) {
                          setBrowserPath(listing.data.parent);
                          setPath(listing.data.parent);
                        }
                      }}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <HardDrive className="h-3.5 w-3.5 shrink-0 text-faint" />
                      <PathText
                        text={listing.data?.path ?? browserPath}
                        className="min-w-0 flex-1 font-mono text-xs text-muted"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-icon h-7 w-7"
                      aria-label="Refresh"
                      onClick={() => void listing.refetch()}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', listing.isFetching && 'animate-spin')} />
                    </button>
                  </div>

                  <div className="scrollbar-thin max-h-80 overflow-auto">
                    {listing.isLoading ? (
                      <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted">
                        <Spinner /> Reading directory...
                      </div>
                    ) : listing.isError ? (
                      <p className="p-4 text-xs text-danger">{errorMessage(listing.error)}</p>
                    ) : listing.data?.entries.length === 0 ? (
                      <p className="p-4 text-xs text-muted">No subdirectories.</p>
                    ) : (
                      listing.data?.entries.map((entry) => (
                        <div
                          key={entry.path}
                          className="flex items-center gap-2 border-b border-edge/60 px-2 py-1.5 last:border-0 hover:bg-raised/60"
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => {
                              if (entry.isDirectory) {
                                setBrowserPath(entry.path);
                                setPath(entry.path);
                              }
                            }}
                          >
                            {entry.isRepo ? (
                              <GitBranch className="h-4 w-4 shrink-0 text-accent" />
                            ) : (
                              <Folder className="h-4 w-4 shrink-0 text-faint" />
                            )}
                            <span className="truncate text-sm text-ink">{entry.name}</span>
                            {entry.isRepo ? <span className="badge badge-accent">repo</span> : null}
                          </button>
                          {entry.isRepo ? (
                            <button
                              type="button"
                              className="btn h-7 px-2 text-xs"
                              disabled={busy}
                              onClick={() => openPath(entry.path)}
                            >
                              Open
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 p-4">
                <ProviderRepoBrowser
                  cloneBaseDir={
                    clonePath.includes('/')
                      ? clonePath.slice(0, clonePath.lastIndexOf('/')) || session.onboarding.home
                      : session.onboarding.home
                  }
                  onSelectRepo={(url, target) => {
                    setCloneUrl(url);
                    setClonePath(target);
                  }}
                />
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">
                    Remote URL
                  </span>
                  <input
                    className="input font-mono text-xs"
                    value={cloneUrl}
                    spellCheck={false}
                    placeholder="https://github.com/owner/repo.git"
                    onChange={(event) => setCloneUrl(event.target.value)}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-faint">
                    Clone into
                  </span>
                  <input
                    className="input font-mono text-xs"
                    value={clonePath}
                    spellCheck={false}
                    onChange={(event) => setClonePath(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  disabled={!cloneUrl.trim() || !clonePath.trim()}
                  onClick={() => void startJob(api.clone(cloneUrl.trim(), clonePath.trim()))}
                >
                  <GitFork className="h-4 w-4" />
                  Clone repository
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
