import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  LogOut,
  User,
} from 'lucide-react';
import { shortHash } from '@gitastic/shared';
import { formatDate } from '../lib/utils';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { useStore } from '../store';
import { DiffViewer } from './DiffViewer';
import { ErrorState, LoadingState, Modal } from './ui';

export function CommitDetail({ hash }: { hash: string }) {
  const detail = useQuery({
    queryKey: ['commit', hash],
    queryFn: () => api.commit(hash),
  });
  const { busy, run } = useAction();
  const setView = useStore((state) => state.setView);
  const notify = useStore((state) => state.notify);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [copied, setCopied] = useState(false);

  if (detail.isLoading) return <LoadingState label="Loading commit..." />;
  if (detail.isError || !detail.data) {
    return <ErrorState error={detail.error} retry={() => void detail.refetch()} />;
  }

  const { commit, files, patch, binary, tooLarge } = detail.data;

  const cherryPick = async () => {
    const result = await run(() => api.cherryPick([commit.hash]), 'Commit cherry-picked.');
    if (result?.conflicted) {
      notify('info', 'Cherry-pick has conflicts.');
      setView('conflicts');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="shrink-0 border-b border-edge p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-snug text-ink">{commit.subject}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {commit.authorName}
              </span>
              <span>{formatDate(commit.authorDate)}</span>
              <span className="inline-flex items-center gap-1 font-mono text-faint">
                <GitCommitHorizontal className="h-3.5 w-3.5" />
                {shortHash(commit.hash)}
              </span>
            </p>
          </div>
          <button
            type="button"
            className="btn-icon"
            title="Copy full hash"
            onClick={() => {
              void navigator.clipboard.writeText(commit.hash).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>

        {commit.body ? (
          <pre className="scrollbar-thin mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-edge bg-canvas p-2.5 font-mono text-xs text-muted">
            {commit.body}
          </pre>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="btn h-7 text-xs"
            disabled={busy}
            onClick={() => setBranchOpen(true)}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Branch here
          </button>
          <button
            type="button"
            className="btn h-7 text-xs"
            disabled={busy}
            onClick={() => void cherryPick()}
          >
            <GitMerge className="h-3.5 w-3.5" />
            Cherry-pick
          </button>
          <button
            type="button"
            className="btn h-7 text-xs"
            disabled={busy}
            onClick={() => void run(() => api.checkout(commit.hash), 'Checked out commit.')}
          >
            <LogOut className="h-3.5 w-3.5" />
            Checkout
          </button>
          <span className="ml-auto text-xs text-faint">
            {files.length} file{files.length === 1 ? '' : 's'} changed
          </span>
        </div>

        {commit.refs.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {commit.refs.map((ref) => (
              <span key={ref} className="badge badge-accent">
                {ref}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {files.length > 0 ? (
        <div className="shrink-0 border-b border-edge px-3 py-2">
          <div className="scrollbar-thin flex max-h-24 flex-wrap gap-1 overflow-auto">
            {files.map((file) => (
              <span
                key={`${file.path}-${file.status}`}
                className="badge"
                title={`${file.status}: ${file.path}`}
              >
                <span className="truncate">{file.path}</span>
                {file.additions > 0 ? <span className="text-success">+{file.additions}</span> : null}
                {file.deletions > 0 ? <span className="text-danger">-{file.deletions}</span> : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <DiffViewer
          patch={patch}
          binary={binary}
          tooLarge={tooLarge}
          emptyLabel="This commit has no textual changes."
        />
      </div>

      <Modal
        open={branchOpen}
        onOpenChange={setBranchOpen}
        title="Create branch"
        description={`Create a branch at ${shortHash(commit.hash)}.`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setBranchOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !branchName.trim()}
              onClick={async () => {
                const created = await run(
                  async () => {
                    await api.createBranch(branchName.trim(), commit.hash);
                    await api.checkout(branchName.trim());
                  },
                  `Branch ${branchName.trim()} created.`,
                );
                if (created !== undefined) {
                  setBranchOpen(false);
                  setBranchName('');
                }
              }}
            >
              Create branch
            </button>
          </>
        }
      >
        <input
          className="input"
          autoFocus
          placeholder="feature/my-branch"
          value={branchName}
          onChange={(event) => setBranchName(event.target.value)}
        />
      </Modal>
    </div>
  );
}
