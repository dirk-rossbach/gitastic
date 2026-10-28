import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { Modal, PathText, Spinner } from './ui';

export function StashDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    enabled: open,
  });
  const { busy, run } = useAction();
  const [message, setMessage] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [selected, setSelected] = useState<string[] | null>(null);

  const files = useMemo(
    () => (status.data?.files ?? []).filter((file) => !file.conflicted),
    [status.data],
  );

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setIncludeUntracked(true);
    setSelected(null);
  }, [open]);

  const chosen = selected ?? files.map((file) => file.path);
  const paths = chosen.filter((path) => {
    const entry = files.find((file) => file.path === path);
    return entry && (!entry.untracked || includeUntracked);
  });

  const toggle = (path: string) => {
    setSelected((current) => {
      const base = current ?? files.map((file) => file.path);
      return base.includes(path)
        ? base.filter((entry) => entry !== path)
        : [...base, path];
    });
  };

  const toggleUntracked = (checked: boolean) => {
    setIncludeUntracked(checked);
    if (!checked) {
      setSelected((current) =>
        (current ?? files.map((file) => file.path)).filter(
          (path) => !files.find((file) => file.path === path)?.untracked,
        ),
      );
    }
  };

  const stash = async () => {
    if (paths.length === 0) return;
    const result = await run(
      () =>
        api.stashPush({
          message: message.trim() || undefined,
          includeUntracked,
          paths,
        }),
      'Changes stashed.',
    );
    if (result) {
      onOpenChange(false);
      setMessage('');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Stash changes"
      description="Choose which changed files to save for later."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || paths.length === 0}
            onClick={() => void stash()}
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
            onChange={(event) => toggleUntracked(event.target.checked)}
          />
          Include untracked files
        </label>
        <div className="overflow-hidden rounded-md border border-edge">
          <div className="flex items-center justify-between border-b border-edge bg-raised/40 px-2.5 py-1.5">
            <span className="text-xs text-muted">
              {paths.length} of {files.length} files
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="btn-ghost btn h-6 px-2 text-[11px]"
                disabled={files.length === 0}
                onClick={() =>
                  setSelected(
                    files
                      .filter((file) => includeUntracked || !file.untracked)
                      .map((file) => file.path),
                  )
                }
              >
                Select all
              </button>
              <button
                type="button"
                className="btn-ghost btn h-6 px-2 text-[11px]"
                disabled={chosen.length === 0}
                onClick={() => setSelected([])}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="scrollbar-thin max-h-56 overflow-y-auto">
            {status.isLoading ? (
              <div className="flex items-center justify-center p-4">
                <Spinner />
              </div>
            ) : status.isError ? (
              <p className="p-3 text-xs text-danger">Could not load changed files.</p>
            ) : files.length === 0 ? (
              <p className="p-3 text-xs text-muted">There are no changes to stash.</p>
            ) : (
              files.map((file) => (
                <label
                  key={file.path}
                  className="flex cursor-pointer items-center gap-2 border-b border-edge/50 px-2.5 py-1.5 last:border-0 hover:bg-raised/50"
                >
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={chosen.includes(file.path)}
                    onChange={() => toggle(file.path)}
                  />
                  <PathText text={file.path} className="min-w-0 flex-1 text-xs text-ink" />
                </label>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
