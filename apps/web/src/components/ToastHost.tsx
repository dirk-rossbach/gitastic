import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useStore } from '../store';
import { cn } from '../lib/utils';

export function ToastHost() {
  const toasts = useStore((state) => state.toasts);
  const dismiss = useStore((state) => state.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[70] flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon =
          toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertCircle : Info;
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border bg-panel p-3 shadow-panel',
              toast.kind === 'success'
                ? 'border-success/40'
                : toast.kind === 'error'
                  ? 'border-danger/40'
                  : 'border-edge',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                toast.kind === 'success'
                  ? 'text-success'
                  : toast.kind === 'error'
                    ? 'text-danger'
                    : 'text-accent',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{toast.message}</p>
              {toast.details ? (
                <pre className="scrollbar-thin mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-canvas p-2 text-[11px] text-muted">
                  {toast.details}
                </pre>
              ) : null}
            </div>
            <button
              type="button"
              className="btn-icon h-6 w-6"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
