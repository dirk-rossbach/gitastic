import { useMemo, useState } from 'react';
import { Check, Copy, FileDiff } from 'lucide-react';
import { cn } from '../lib/utils';

export function DiffViewer({
  patch,
  binary,
  tooLarge,
  emptyLabel = 'No changes to show.',
}: {
  patch: string;
  binary?: boolean;
  tooLarge?: boolean;
  emptyLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => patch.replace(/\r\n/g, '\n').split('\n'), [patch]);

  if (binary) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted">
        Binary file. Open it with your editor to inspect the changes.
      </div>
    );
  }

  if (!patch.trim()) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-muted">
        <FileDiff className="h-7 w-7 text-faint" />
        <p className="text-sm">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-edge bg-raised/40 px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{lines.length} lines</span>
          {tooLarge ? <span className="badge badge-danger">truncated</span> : null}
        </div>
        <button
          type="button"
          className="btn btn-ghost h-7 text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(patch).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy patch'}
        </button>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-canvas py-2">
        {lines.map((line, index) => {
          const className =
            line.startsWith('+++') || line.startsWith('---')
              ? 'text-faint'
              : line.startsWith('diff --git') || line.startsWith('index ')
                ? 'text-faint'
                : line.startsWith('@@')
                  ? 'diff-hunk'
                  : line.startsWith('+')
                    ? 'diff-add'
                    : line.startsWith('-')
                      ? 'diff-del'
                      : 'text-muted';
          return (
            <div key={`${index}-${line.slice(0, 12)}`} className={cn('diff-line', className)}>
              {line || ' '}
            </div>
          );
        })}
      </div>
    </div>
  );
}
