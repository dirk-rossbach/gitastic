import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Tags, Trash2, Upload } from 'lucide-react';
import type { Tag } from '@gitastic/shared';
import { shortHash } from '@gitastic/shared';
import { formatDate } from '../lib/utils';
import { api } from '../api';
import { useAction, useStartJob } from '../lib/hooks';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, Spinner } from './ui';

export function TagsView() {
  const tags = useQuery({ queryKey: ['tags'], queryFn: api.tags });
  const remotes = useQuery({ queryKey: ['remotes'], queryFn: api.remotes });
  const { busy, run } = useAction();
  const startJob = useStartJob();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [ref, setRef] = useState('HEAD');
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);

  if (tags.isLoading) return <LoadingState label="Loading tags..." />;
  if (tags.isError) return <ErrorState error={tags.error} retry={() => void tags.refetch()} />;

  const remoteName = remotes.data?.[0]?.name ?? 'origin';

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-sm font-medium">Tags</span>
        <span className="text-xs text-faint">{tags.data?.length ?? 0}</span>
        <button type="button" className="btn btn-primary ml-auto h-8 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New tag
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {!tags.data || tags.data.length === 0 ? (
          <EmptyState
            icon={<Tags className="h-8 w-8" />}
            title="No tags"
            description="Create an annotated or lightweight tag on any commit."
            action={
              <button type="button" className="btn" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                New tag
              </button>
            }
          />
        ) : (
          tags.data.map((tag) => (
            <div
              key={tag.ref}
              className="group flex items-center gap-3 border-b border-edge/60 px-3 py-2 last:border-0 hover:bg-raised/50"
            >
              <Tags className="h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{tag.name}</span>
                  {tag.type === 'tag' ? <span className="badge">annotated</span> : null}
                </div>
                <p className="truncate text-[11px] text-faint">
                  {tag.subject || 'No message'}
                  {tag.tagger ? ` · ${tag.tagger}` : ''}
                  {tag.date ? ` · ${formatDate(tag.date)}` : ''}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-faint">{shortHash(tag.hash)}</span>
              <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  className="btn-icon"
                  title={`Push tag to ${remoteName}`}
                  disabled={busy}
                  onClick={() => void startJob(api.pushTag(tag.name, remoteName))}
                >
                  <Upload className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-icon hover:text-danger"
                  title="Delete tag"
                  onClick={() => setDeleteTarget(tag)}
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
        title="Create tag"
        description="Annotated tags include a message and tagger."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !name.trim()}
              onClick={async () => {
                const result = await run(
                  () =>
                    api.createTag({
                      name: name.trim(),
                      message: message.trim() || undefined,
                      ref: ref.trim() || undefined,
                    }),
                  `Tag ${name.trim()} created.`,
                );
                if (result) {
                  setCreateOpen(false);
                  setName('');
                  setMessage('');
                  setRef('HEAD');
                }
              }}
            >
              {busy ? <Spinner /> : null}
              Create tag
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">Name</span>
            <input className="input" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="v1.0.0" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              Message (optional)
            </span>
            <input className="input" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Release 1.0.0" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">Ref</span>
            <input className="input font-mono text-xs" value={ref} onChange={(event) => setRef(event.target.value)} placeholder="HEAD" />
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete tag ${deleteTarget?.name ?? ''}?`}
        description="The tag is removed locally. This does not delete the tag on the remote."
        confirmLabel="Delete tag"
        danger
        busy={busy}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const result = await run(() => api.deleteTag(deleteTarget.name), 'Tag deleted.');
          if (result !== undefined) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
