import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  Circle,
  Folder,
  GitBranch,
  Github,
  HardDrive,
  Info,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import type { OnboardingCheck, Session } from '@gitastic/shared';
import { api } from '../api';
import { useAction, useStartJob } from '../lib/hooks';
import { cn, formatDate, errorMessage } from '../lib/utils';
import { Spinner } from './ui';

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
  const [mode, setMode] = useState<'open' | 'clone'>('open');
  const [path, setPath] = useState(session.onboarding.home);
  const [browserPath, setBrowserPath] = useState(session.onboarding.home);
  const [cloneUrl, setCloneUrl] = useState('');
  const [clonePath, setClonePath] = useState(`${session.onboarding.home}/repo`);
  const { busy, run } = useAction();
  const startJob = useStartJob();

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
    void run(() => api.openRepo(target), 'Repository opened');
  };

  return (
    <div className="scrollbar-thin h-full overflow-auto bg-canvas">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
              <GitBranch className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Gitastic</h1>
              <p className="text-sm text-muted">
                A fast, local Git client. Your repositories never leave this machine.
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-faint sm:flex">
            <Terminal className="h-3.5 w-3.5" />
            {session.onboarding.gitVersion ?? 'Git not found'}
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

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <section className="card overflow-hidden">
            <div className="flex items-center gap-1 border-b border-edge p-2">
              <button
                type="button"
                className={cn('btn-ghost btn', mode === 'open' && 'bg-raised text-ink')}
                onClick={() => setMode('open')}
              >
                <Folder className="h-4 w-4" />
                Open repository
              </button>
              <button
                type="button"
                className={cn('btn-ghost btn', mode === 'clone' && 'bg-raised text-ink')}
                onClick={() => setMode('clone')}
              >
                <Github className="h-4 w-4" />
                Clone
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
                      <p className="truncate font-mono text-xs text-muted">
                        {listing.data?.path ?? browserPath}
                      </p>
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

                  <div className="scrollbar-thin max-h-72 overflow-auto">
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
                <p className="text-xs text-faint">
                  Uses your system Git credentials and SSH agent. Gitastic never stores tokens.
                </p>
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  disabled={!cloneUrl.trim() || !clonePath.trim()}
                  onClick={() => void startJob(api.clone(cloneUrl.trim(), clonePath.trim()))}
                >
                  <Github className="h-4 w-4" />
                  Clone repository
                </button>
              </div>
            )}
          </section>

          <section className="space-y-4">
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
                        <span className="block truncate font-mono text-[11px] text-faint">
                          {repo.path}
                        </span>
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

            <div className="card p-4">
              <h2 className="panel-title mb-3">Environment</h2>
              <div className="space-y-2">
                {session.onboarding.checks.map((check) => (
                  <CheckRow key={check.id} check={check} />
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
