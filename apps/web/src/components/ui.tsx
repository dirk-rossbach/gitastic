import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { cn, errorMessage } from '../lib/utils';


function fitMiddle(text: string, maxWidth: number, measure: (value: string) => number): string {
  if (!text || maxWidth <= 0) return text;
  if (measure(text) <= maxWidth) return text;

  const ellipsis = '…';
  const budget = maxWidth - measure(ellipsis);
  if (budget <= 0) return ellipsis;

  const suffixBudget = budget * 0.72;
  let suffixStart = text.length;
  for (let index = 0; index < text.length; index += 1) {
    if (measure(text.slice(index)) <= suffixBudget) {
      suffixStart = index;
      break;
    }
  }
  if (suffixStart < text.length && suffixStart > 0) {
    const slash = text.lastIndexOf('/', suffixStart);
    if (slash >= 0) suffixStart = slash;
  }
  const suffix = text.slice(suffixStart) || text.slice(-1);
  const prefixBudget = Math.max(0, budget - measure(suffix));
  let prefix = '';
  for (let index = 1; index <= text.length - suffix.length; index += 1) {
    const candidate = text.slice(0, index);
    if (measure(candidate) > prefixBudget) break;
    prefix = candidate;
  }
  if (prefix && !prefix.endsWith('/')) {
    const slash = prefix.lastIndexOf('/');
    prefix = slash > 0 ? prefix.slice(0, slash + 1) : '';
  }
  return `${prefix}${ellipsis}${suffix}`;
}

export function PathText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(text);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;

    const fit = () => {
      const style = getComputedStyle(element);
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      setDisplay(fitMiddle(text, element.clientWidth, (value) => context.measureText(value).width));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    void document.fonts?.ready.then(fit);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span
      ref={ref}
      className={cn('block min-w-0 overflow-hidden whitespace-nowrap', className)}
      title={text}
    >
      {display}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} />;
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-3 text-sm text-muted">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle className="h-8 w-8 text-danger" />
      <p className="max-w-lg text-sm text-muted">{errorMessage(error)}</p>
      {retry ? (
        <button type="button" className="btn" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon ? <div className="text-faint">{icon}</div> : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay fixed inset-0 z-40" />
        <Dialog.Content
          className={cn(
            'modal-card fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-edge/80 focus:outline-none',
            wide ? 'max-w-3xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close className="btn-icon" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="scrollbar-thin max-h-[62vh] overflow-auto px-5 py-4">{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-edge bg-raised/40 px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  danger,
  busy,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={cn('btn', danger ? 'btn-danger' : 'btn-primary')}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3 rounded-lg border border-edge bg-raised/50 p-3 text-sm text-muted">
        <AlertTriangle className={cn('mt-0.5 h-5 w-5 shrink-0', danger ? 'text-danger' : 'text-warning')} />
        <p>{description}</p>
      </div>
      {children}
    </Modal>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-faint">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
    </label>
  );
}
