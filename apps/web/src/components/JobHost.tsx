import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Square, X } from 'lucide-react';
import { api, subscribeJob } from '../api';
import { useStore } from '../store';
import { cn } from '../lib/utils';

export function JobHost() {
  const job = useStore((state) => state.job);
  const setJob = useStore((state) => state.setJob);
  const notify = useStore((state) => state.notify);
  const queryClient = useQueryClient();
  const jobId = job?.id;

  useEffect(() => {
    if (!jobId) return;
    const unsubscribe = subscribeJob(
      jobId,
      (updated) => setJob(updated),
      (final) => {
        setJob(final);
        void queryClient.invalidateQueries();
        if (final.status === 'error') {
          notify('error', `${final.type} failed`, final.error ?? undefined);
        } else if (final.status === 'cancelled') {
          notify('info', `${final.type} cancelled`);
        } else {
          notify('success', `${final.type} finished`);
        }
      },
    );
    return unsubscribe;
  }, [jobId, notify, queryClient, setJob]);

  if (!job) return null;
  const terminal = ['done', 'error', 'cancelled'].includes(job.status);

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-edge/80 bg-panel/90 shadow-panel backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-edge px-3 py-2">
        {terminal ? (
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              job.status === 'done'
                ? 'bg-success'
                : job.status === 'error'
                  ? 'bg-danger'
                  : 'bg-warning',
            )}
          />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium capitalize">{job.type}</p>
          <p className="truncate text-xs text-muted">
            {job.error ?? job.message}
          </p>
        </div>
        {!terminal ? (
          <button
            type="button"
            className="btn-icon"
            aria-label="Cancel job"
            onClick={() => void api.cancelJob(job.id).catch(() => undefined)}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            className="btn-icon"
            aria-label="Close job"
            onClick={() => setJob(null)}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {!terminal ? (
        <div className="h-1 bg-raised">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }}
          />
        </div>
      ) : null}
      {job.output.length > 0 ? (
        <pre className="scrollbar-thin max-h-32 overflow-auto bg-canvas px-3 py-2 font-mono text-[11px] leading-5 text-muted">
          {job.output.slice(-8).join('\n')}
        </pre>
      ) : null}
    </div>
  );
}
