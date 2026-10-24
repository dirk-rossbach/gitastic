import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Heart, ServerCrash } from 'lucide-react';
import type { UiStyle } from '@gitastic/shared';
import { api } from './api';
import { errorMessage } from './lib/utils';
import { rememberStyleForMode, resolvedThemeMode, styleForTheme } from './ui-styles';
import { JobHost } from './components/JobHost';
import { CommandPalette } from './components/CommandPalette';
import { SettingsView } from './components/SettingsView';
import { Shell } from './components/Shell';
import { ToastHost } from './components/ToastHost';
import { Welcome } from './components/Welcome';
import { Spinner } from './components/ui';
import { useStore } from './store';

export function applyAppearance(
  theme: 'dark' | 'light' | 'system',
  uiStyle: UiStyle = 'gorgeous',
) {
  const apply = () => {
    const mode = resolvedThemeMode(theme);
    const style = styleForTheme(theme, uiStyle);
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.style = style;
    rememberStyleForMode(mode, style);
  };
  apply();
  if (theme === 'system') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => apply();
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }
  return undefined;
}

export function App() {
  const queryClient = useQueryClient();
  const resetRepoState = useStore((state) => state.resetRepoState);
  const settingsOpen = useStore((state) => state.settingsOpen);
  const openSettings = useStore((state) => state.openSettings);
  const closeSettings = useStore((state) => state.closeSettings);
  const openCommandPalette = useStore((state) => state.openCommandPalette);
  const toggleCommandPalette = useStore((state) => state.toggleCommandPalette);
  const session = useQuery({ queryKey: ['session'], queryFn: api.session });
  const theme = session.data?.config.theme;
  const uiStyle = session.data?.config.uiStyle ?? 'gorgeous';
  const repoId = session.data?.repo?.id ?? null;
  const prevRepoId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!theme) return;
    return applyAppearance(theme, uiStyle);
  }, [theme, uiStyle]);

  useEffect(() => {
    const handleOpenSettings = () => openSettings();
    const handleOpenPalette = () => openCommandPalette();
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        openSettings();
      } else if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === 'p' || event.key.toLowerCase() === 'k')
      ) {
        event.preventDefault();
        toggleCommandPalette();
      }
    };
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (
        (href.startsWith('https://') || href.startsWith('http://')) &&
        '__TAURI_INTERNALS__' in window
      ) {
        event.preventDefault();
        void api.openExternal(href);
      }
    };
    window.addEventListener('gitastic:open-settings', handleOpenSettings);
    window.addEventListener('gitastic:command-palette', handleOpenPalette);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleDocumentClick);
    return () => {
      window.removeEventListener('gitastic:open-settings', handleOpenSettings);
      window.removeEventListener('gitastic:command-palette', handleOpenPalette);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [openCommandPalette, openSettings, toggleCommandPalette]);

  useEffect(() => {
    if (prevRepoId.current === undefined) {
      prevRepoId.current = repoId;
      return;
    }
    if (prevRepoId.current !== repoId) {
      prevRepoId.current = repoId;
      resetRepoState();
      queryClient.removeQueries({
        predicate: (query) => {
          const head = query.queryKey[0];
          return (
            head !== 'session' &&
            head !== 'recent-repos' &&
            head !== 'directories' &&
            head !== 'history' &&
            head !== 'commit'
          );
        },
      });
    }
  }, [queryClient, repoId, resetRepoState]);

  return (
    <>
      {session.isLoading ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-canvas">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <GitBranch className="h-6 w-6" />
          </div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner />
            Starting Gitastic...
          </div>
        </div>
      ) : session.isError ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
          <ServerCrash className="h-10 w-10 text-danger" />
          <h1 className="text-lg font-semibold">Cannot reach the Gitastic server</h1>
          <p className="max-w-md text-sm text-muted">{errorMessage(session.error)}</p>
          <button type="button" className="btn" onClick={() => void session.refetch()}>
            Retry
          </button>
        </div>
      ) : session.data ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {session.data.repo ? (
              <Shell session={session.data} />
            ) : (
              <div className="relative h-full w-full overflow-hidden">
                <Welcome session={session.data} />
                {settingsOpen ? (
                  <div className="absolute inset-0 z-30 bg-canvas">
                    <SettingsView session={session.data} onClose={closeSettings} />
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <footer className="flex h-6 shrink-0 items-center justify-between border-t border-edge/80 bg-panel/85 px-3 text-[11px] text-faint backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-2 truncate">
              {session.data.repo ? (
                <>
                  <span className="truncate font-medium text-muted">{session.data.repo.name}</span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 truncate font-mono">
                    <GitBranch className="h-3 w-3 text-accent" />
                    {session.data.repo.branch ?? 'detached'}
                  </span>
                </>
              ) : (
                <span>Gitastic</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <a
                href="https://github.com/sponsors/dirk-rossbach"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-muted transition hover:text-ink"
                title="Sponsor Gitastic on GitHub"
              >
                <Heart className="h-3 w-3 text-danger" />
                <span>Sponsor</span>
              </a>
              <span>·</span>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 transition hover:text-ink"
                onClick={openCommandPalette}
              >
                <kbd className="rounded border border-edge bg-raised px-1 py-0 font-mono text-[10px] text-muted">
                  Ctrl + P
                </kbd>
                <span>Command Palette</span>
              </button>
            </div>
          </footer>
          <CommandPalette session={session.data} />
        </div>
      ) : null}
      <ToastHost />
      <JobHost />
    </>
  );
}
