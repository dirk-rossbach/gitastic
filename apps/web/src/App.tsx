import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, ServerCrash } from 'lucide-react';
import { api } from './api';
import { errorMessage } from './lib/utils';
import { JobHost } from './components/JobHost';
import { Shell } from './components/Shell';
import { ToastHost } from './components/ToastHost';
import { Welcome } from './components/Welcome';
import { Spinner } from './components/ui';

function applyTheme(theme: 'dark' | 'light' | 'system') {
  const resolve = () =>
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.dataset.theme = resolve();
  if (theme === 'system') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      document.documentElement.dataset.theme = resolve();
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }
  return undefined;
}

export function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: api.session });
  const theme = session.data?.config.theme;

  useEffect(() => {
    if (!theme) return;
    return applyTheme(theme);
  }, [theme]);

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
        session.data.repo ? (
          <Shell session={session.data} />
        ) : (
          <Welcome session={session.data} />
        )
      ) : null}
      <ToastHost />
      <JobHost />
    </>
  );
}
