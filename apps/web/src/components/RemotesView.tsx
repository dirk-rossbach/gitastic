import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cloud, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Remote } from '@gitastic/shared';
import { api } from '../api';
import { useAction, useStartJob } from '../lib/hooks';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, Spinner } from './ui';

export function RemotesView() {
  const remotes = useQuery({ queryKey: ['remotes'], queryFn: api.remotes });
  const { busy, run } = useAction();
  const startJob = useStartJob();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [editTarget, setEditTarget] = useState<Remote | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Remote | null>(null);

  if (remotes.isLoading) return <LoadingState label="Loading remotes..." />;
  if (remotes.isError) return <ErrorState error={remotes.error} retry={() => void remotes.refetch()} />;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-sm font-medium">Remotes</span>
        <span className="text-xs text-faint">{remotes.data?.length ?? 0}</span>
        <button
          type="button"
          className="btn btn-primary ml-auto h-8 text-xs"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add remote
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {!remotes.data || remotes.data.length === 0 ? (
          <EmptyState
            icon={<Cloud className="h-8 w-8" />}
            title="No remotes"
            description="Add an HTTPS or SSH remote to fetch and push."
            action={
              <button type="button" className="btn" onClick={() => setAddOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add remote
              </button>
            }
          />
        ) : (
          remotes.data.map((remote) => (
            <div
              key={remote.name}
              className="group flex items-start gap-3 border-b border-edge/60 px-3 py-3 last:border-0 hover:bg-raised/50"
            >
              <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{remote.name}</p>
                <p className="break-all font-mono text-[11px] text-muted">{remote.url}</p>
                {remote.pushUrl && remote.pushUrl !== remote.url ? (
                  <p className="mt-0.5 break-all font-mono text-[11px] text-faint">
                    push: {remote.pushUrl}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  className="btn-icon"
                  title={`Fetch ${remote.name}`}
                  onClick={() => void startJob(api.fetch(remote.name))}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  title="Edit URL"
                  onClick={() => {
                    setEditTarget(remote);
                    setEditUrl(remote.url);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-icon hover:text-danger"
                  title="Remove remote"
                  onClick={() => setDeleteTarget(remote)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add remote"
        description="Gitastic uses your system Git credentials and SSH agent."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !name.trim() || !url.trim()}
              onClick={async () => {
                const result = await run(
                  () => api.addRemote(name.trim(), url.trim()),
                  `Remote ${name.trim()} added.`,
                );
                if (result) {
                  setAddOpen(false);
                  setName('');
                  setUrl('');
                }
              }}
            >
              {busy ? <Spinner /> : null}
              Add remote
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">Name</span>
            <input className="input" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="origin" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">URL</span>
            <input className="input font-mono text-xs" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="git@github.com:owner/repo.git" />
          </label>
        </div>
      </Modal>

      <Modal
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={`Edit ${editTarget?.name ?? ''}`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setEditTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !editUrl.trim() || !editTarget}
              onClick={async () => {
                if (!editTarget) return;
                const result = await run(
                  () => api.setRemoteUrl(editTarget.name, editUrl.trim()),
                  'Remote URL updated.',
                );
                if (result) setEditTarget(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        <input className="input font-mono text-xs" value={editUrl} onChange={(event) => setEditUrl(event.target.value)} />
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Remove remote ${deleteTarget?.name ?? ''}?`}
        description="Remote-tracking branches for this remote are removed too. Local branches are not affected."
        confirmLabel="Remove remote"
        danger
        busy={busy}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const result = await run(
            () => api.removeRemote(deleteTarget.name),
            `Remote ${deleteTarget.name} removed.`,
          );
          if (result !== undefined) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
