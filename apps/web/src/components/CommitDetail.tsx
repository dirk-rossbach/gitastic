import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  LogOut,
  User,
} from 'lucide-react';
import { buildRemoteCommitUrl, shortHash } from '@gitastic/shared';
import { formatDate } from '../lib/utils';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { useStore } from '../store';
import { DiffViewer, type DiffReveal } from './DiffViewer';
import { ErrorState, LoadingState, Modal, PathText } from './ui';

export function CommitDetail({ hash }: { hash: string }) {
  const detail = useQuery({
    queryKey: ['commit', hash],
    queryFn: () => api.commit(hash),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
  const providerQuery = useQuery({
    queryKey: ['repo-provider'],
    queryFn: api.repoProvider,
  });
  const { busy, run } = useAction();
  const setView = useStore((state) => state.setView);
  const notify = useStore((state) => state.notify);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [copied, setCopied] = useState(false);
  const [diffReveal, setDiffReveal] = useState<DiffReveal | null>(null);

  if (detail.isLoading) return <LoadingState label="Loading commit..." />;
  if (detail.isError || !detail.data) {
    return <ErrorState error={detail.error} retry={() => void detail.refetch()} />;
  }

  const { commit, files, patch, binary, tooLarge } = detail.data;
  const remoteProvider = providerQuery.data?.remote ?? null;

  const cherryPick = async () => {
    const result = await run(() => api.cherryPick([commit.hash]), 'Commit cherry-picked.');
    if (result?.conflicted) {
      notify('info', 'Cherry-pick has conflicts.');
      setView('conflicts');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel/60 backdrop-blur-xl">
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
          {remoteProvider ? (
            <a
              href={buildRemoteCommitUrl(remoteProvider, commit.hash)}
              target="_blank"
              rel="noreferrer"
              className="btn h-7 text-xs"
              title={`Open commit on ${remoteProvider.host}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {remoteProvider.provider === 'gitlab' ? 'GitLab' : 'GitHub'}
            </a>
          ) : null}
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
              <button
                key={`${file.path}-${file.status}`}
                type="button"
                className="badge max-w-[20rem] cursor-pointer transition hover:border-accent/60 hover:bg-accent/10 hover:text-ink"
                title={`${file.status}: ${file.path}`}
                onClick={() => setDiffReveal({ path: file.path, nonce: Date.now() })}
              >
                <PathText text={file.path} className="min-w-0 flex-1 text-left" />
                {file.additions > 0 ? <span className="text-success">+{file.additions}</span> : null}
                {file.deletions > 0 ? <span className="text-danger">-{file.deletions}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <DiffViewer
          patch={patch}
          binary={binary}
          tooLarge={tooLarge}
          files={files}
          reveal={diffReveal}
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
