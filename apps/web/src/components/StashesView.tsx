import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArrowDownToLine, Plus, Trash2 } from 'lucide-react';
import type { Stash } from '@gitastic/shared';
import { formatRelativeDate } from '@gitastic/shared';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, Spinner } from './ui';

export function StashesView() {
  const stashes = useQuery({ queryKey: ['stashes'], queryFn: api.stashes });
  const { busy, run } = useAction();
  const [createOpen, setCreateOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [dropTarget, setDropTarget] = useState<Stash | null>(null);

  if (stashes.isLoading) return <LoadingState label="Loading stashes..." />;
  if (stashes.isError) return <ErrorState error={stashes.error} retry={() => void stashes.refetch()} />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-sm font-medium">Stashes</span>
        <span className="text-xs text-faint">{stashes.data?.length ?? 0}</span>
        <button
          type="button"
          className="btn btn-primary ml-auto h-8 text-xs"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Stash changes
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {!stashes.data || stashes.data.length === 0 ? (
          <EmptyState
            icon={<Archive className="h-8 w-8" />}
            title="No stashes"
            description="Stash working tree changes to switch context without committing."
            action={
              <button type="button" className="btn" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Stash changes
              </button>
            }
          />
        ) : (
          stashes.data.map((stash) => (
            <div
              key={stash.ref}
              className="group flex items-center gap-3 border-b border-edge/60 px-3 py-2.5 last:border-0 hover:bg-raised/50"
            >
              <Archive className="h-4 w-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{stash.message || stash.ref}</p>
                <p className="text-[11px] text-faint">
                  {stash.ref} · {formatRelativeDate(stash.date)}
                </p>
              </div>
              <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  className="btn-icon"
                  title="Apply stash (keep it)"
                  disabled={busy}
                  onClick={() => void run(() => api.stashApply(stash.ref), 'Stash applied.')}
                >
                  <ArrowDownToLine className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  title="Pop stash (apply and remove)"
                  disabled={busy}
                  onClick={() => void run(() => api.stashPop(stash.ref), 'Stash popped.')}
                >
                  <ArrowDownToLine className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  className="btn-icon hover:text-danger"
                  title="Drop stash"
                  onClick={() => setDropTarget(stash)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Stash changes"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                const result = await run(
                  () =>
                    api.stashPush({
                      message: message.trim() || undefined,
                      includeUntracked,
                    }),
                  'Changes stashed.',
                );
                if (result) {
                  setCreateOpen(false);
                  setMessage('');
                }
              }}
            >
              {busy ? <Spinner /> : null}
              Stash
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <input
            className="input"
            autoFocus
            placeholder="Optional stash message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              className="accent-accent"
              checked={includeUntracked}
              onChange={(event) => setIncludeUntracked(event.target.checked)}
            />
            Include untracked files
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={dropTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDropTarget(null);
        }}
        title={`Drop stash ${dropTarget?.ref ?? ''}?`}
        description="The stash entry is removed. This cannot be undone."
        confirmLabel="Drop stash"
        danger
        busy={busy}
        onConfirm={async () => {
          if (!dropTarget) return;
          const result = await run(() => api.stashDrop(dropTarget.ref), 'Stash dropped.');
          if (result !== undefined) setDropTarget(null);
        }}
      />
    </div>
  );
}
