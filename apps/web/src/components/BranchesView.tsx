import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUp,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  LogIn,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  buildCreatePullUrl,
  buildRemoteBranchUrl,
  type Branch,
} from '@gitastic/shared';
import { api } from '../api';
import { useAction, useStartJob } from '../lib/hooks';
import { cn, formatDate } from '../lib/utils';
import { useStore } from '../store';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, Spinner } from './ui';

type FormMode = 'create' | 'rename' | null;

function BranchName({ branch }: { branch: Branch }) {
  const split = branch.name.lastIndexOf('/');
  const prefix = split > 0 ? branch.name.slice(0, split + 1) : '';
  const leaf = split > 0 ? branch.name.slice(split + 1) : branch.name;
  return (
    <span className="min-w-0 flex-1 break-all text-sm" title={branch.name}>
      {prefix ? <span className="text-faint">{prefix}</span> : null}
      <span className={cn('font-medium', branch.current ? 'text-accent' : 'text-ink')}>{leaf}</span>
    </span>
  );
}

export function BranchesView() {
  const branches = useQuery({ queryKey: ['branches'], queryFn: api.branches });
  const repo = useQuery({ queryKey: ['repo'], queryFn: api.repo });
  const providerQuery = useQuery({ queryKey: ['repo-provider'], queryFn: api.repoProvider });
  const setView = useStore((state) => state.setView);
  const notify = useStore((state) => state.notify);
  const { busy, run } = useAction();
  const startJob = useStartJob();

  const [search, setSearch] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [formName, setFormName] = useState('');
  const [formFrom, setFormFrom] = useState('');
  const [formStart, setFormStart] = useState('');
  const [upstreamBranch, setUpstreamBranch] = useState<Branch | null>(null);
  const [upstreamValue, setUpstreamValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);
  const [deleteForce, setDeleteForce] = useState(false);
  const [forcePushTarget, setForcePushTarget] = useState<Branch | null>(null);

  const current = repo.data?.branch ?? null;
  const remoteProvider = providerQuery.data?.remote ?? null;
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = branches.data ?? [];
    if (!query) return list;
    return list.filter(
      (branch) =>
        branch.name.toLowerCase().includes(query) ||
        branch.subject.toLowerCase().includes(query),
    );
  }, [branches.data, search]);

  const locals = filtered.filter((branch) => !branch.remote);
  const remotes = filtered.filter((branch) => branch.remote);

  const merge = async (branch: Branch) => {
    const result = await run(() => api.merge(branch.name), `Merged ${branch.name}.`);
    if (result?.conflicted) {
      notify('info', `Merge of ${branch.name} has conflicts.`);
      setView('conflicts');
    }
  };

  const rebase = async (branch: Branch) => {
    const result = await run(() => api.rebase(branch.name), `Rebased onto ${branch.name}.`);
    if (result?.conflicted) {
      notify('info', `Rebase onto ${branch.name} has conflicts.`);
      setView('conflicts');
    }
  };

  const closeForm = () => {
    setFormMode(null);
    setFormName('');
    setFormFrom('');
    setFormStart('');
  };

  if (branches.isLoading) return <LoadingState label="Loading branches..." />;
  if (branches.isError) {
    return <ErrorState error={branches.error} retry={() => void branches.refetch()} />;
  }

  const renderRow = (branch: Branch) => (
    <div
      key={branch.ref}
      className={cn(
        'group flex items-center gap-2 border-b border-edge/60 border-l-2 border-l-transparent px-3 py-2 last:border-0 hover:bg-raised/50',
        branch.current && 'border-l-accent bg-raised',
      )}
    >
      <GitBranch className={cn('h-4 w-4 shrink-0', branch.current ? 'text-accent' : 'text-muted')} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-1.5">
          {branch.current ? (
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
              title="Checked out (HEAD)"
            />
          ) : null}
          <BranchName branch={branch} />
          {branch.current ? (
            <span className="badge badge-accent shrink-0" title="Currently checked out (HEAD)">
              HEAD
            </span>
          ) : null}
          {branch.remote ? <span className="badge shrink-0">remote</span> : null}
        </div>
        <p className="truncate text-[11px] text-faint">
          {branch.upstream ? `${branch.upstream} · ` : ''}
          {branch.subject || 'No commits'}
          {branch.date ? ` · ${formatDate(branch.date)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        {!branch.current ? (
          <button
            type="button"
            className="btn-icon"
            title={`Checkout ${branch.name}`}
            disabled={busy}
            onClick={() => void run(() => api.checkout(branch.name), `Checked out ${branch.name}.`)}
          >
            <LogIn className="h-4 w-4" />
          </button>
        ) : null}
        {!branch.current ? (
          <button
            type="button"
            className="btn-icon"
            title={`Merge ${branch.name} into ${current ?? 'HEAD'}`}
            disabled={busy}
            onClick={() => void merge(branch)}
          >
            <GitMerge className="h-4 w-4" />
          </button>
        ) : null}
        {!branch.remote ? (
          <button
            type="button"
            className="btn-icon"
            title={`Rebase ${current ?? 'current branch'} onto ${branch.name}`}
            disabled={busy || branch.current}
            onClick={() => void rebase(branch)}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        ) : null}
        {!branch.remote ? (
          <button
            type="button"
            className="btn-icon"
            title={`Push ${branch.name}`}
            disabled={busy}
            onClick={() =>
              void startJob(api.push({ branch: branch.name, setUpstream: !branch.upstream }))
            }
          >
            <Upload className="h-4 w-4" />
          </button>
        ) : null}
        {branch.current ? (
          <button
            type="button"
            className="btn-icon"
            title="Set upstream"
            onClick={() => {
              setUpstreamBranch(branch);
              setUpstreamValue(branch.upstream ?? '');
            }}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        ) : null}
        {!branch.remote ? (
          <button
            type="button"
            className="btn-icon"
            title="Rename branch"
            onClick={() => {
              setFormMode('rename');
              setFormFrom(branch.name);
              setFormName(branch.name);
            }}
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : null}
        {!branch.remote && !branch.current ? (
          <button
            type="button"
            className="btn-icon hover:text-danger"
            title="Delete branch"
            onClick={() => {
              setDeleteTarget(branch);
              setDeleteForce(false);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
        {branch.current && !branch.remote ? (
          <button
            type="button"
            className="btn-icon hover:text-danger"
            title="Force push with lease"
            onClick={() => setForcePushTarget(branch)}
          >
            <Upload className="h-4 w-4" />
          </button>
        ) : null}
        {remoteProvider ? (
          <>
            <a
              href={buildCreatePullUrl(remoteProvider, branch.name)}
              target="_blank"
              rel="noreferrer"
              className="btn-icon"
              title={`Create ${remoteProvider.provider === 'gitlab' ? 'Merge Request' : 'Pull Request'} for ${branch.name}`}
            >
              <GitPullRequest className="h-4 w-4 text-accent" />
            </a>
            <a
              href={buildRemoteBranchUrl(remoteProvider, branch.name)}
              target="_blank"
              rel="noreferrer"
              className="btn-icon"
              title={`View ${branch.name} on ${remoteProvider.host}`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            className="input h-8 pl-8 text-xs"
            placeholder="Filter branches..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn h-8 text-xs"
          onClick={() => {
            setFormMode('create');
            setFormStart(current ?? 'HEAD');
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New branch
        </button>
        <button
          type="button"
          className="btn h-8 text-xs"
          onClick={() => void startJob(api.fetch())}
        >
          <Upload className="h-3.5 w-3.5" />
          Fetch
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<GitBranch className="h-8 w-8" />}
            title="No branches"
            description="Create a branch or clear the filter."
          />
        ) : (
          <>
            <div className="sticky top-0 z-10 flex items-center justify-between bg-panel/95 px-3 py-1.5 backdrop-blur">
              <span className="panel-title">Local</span>
              <span className="text-[10px] text-faint">{locals.length}</span>
            </div>
            {locals.map(renderRow)}
            <div className="sticky top-0 z-10 mt-1 flex items-center justify-between border-t border-edge bg-panel/95 px-3 py-1.5 backdrop-blur">
              <span className="panel-title">Remote</span>
              <span className="text-[10px] text-faint">{remotes.length}</span>
            </div>
            {remotes.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted">No remote branches. Fetch to update.</p>
            ) : (
              remotes.map(renderRow)
            )}
          </>
        )}
      </div>

      <Modal
        open={formMode !== null}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        title={formMode === 'rename' ? 'Rename branch' : 'Create branch'}
        description={
          formMode === 'rename'
            ? 'Rename a local branch.'
            : 'Create a new local branch at the current HEAD or another ref.'
        }
        footer={
          <>
            <button type="button" className="btn" onClick={closeForm}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !formName.trim()}
              onClick={async () => {
                if (formMode === 'create') {
                  const result = await run(
                    () => api.createBranch(formName.trim(), formStart.trim() || undefined),
                    `Branch ${formName.trim()} created.`,
                  );
                  if (result) closeForm();
                } else if (formMode === 'rename' && formFrom) {
                  const result = await run(
                    () => api.renameBranch(formFrom, formName.trim()),
                    'Branch renamed.',
                  );
                  if (result) closeForm();
                }
              }}
            >
              {busy ? <Spinner /> : null}
              {formMode === 'rename' ? 'Rename' : 'Create'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              Branch name
            </span>
            <input
              className="input"
              autoFocus
              value={formName}
              onChange={(event) => setFormName(event.target.value)}
              placeholder="feature/my-branch"
            />
          </label>
          {formMode === 'create' ? (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                Start point
              </span>
              <input
                className="input font-mono text-xs"
                value={formStart}
                onChange={(event) => setFormStart(event.target.value)}
                placeholder="HEAD"
              />
            </label>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={upstreamBranch !== null}
        onOpenChange={(open) => {
          if (!open) setUpstreamBranch(null);
        }}
        title="Set upstream"
        description={`Choose the remote branch tracked by ${upstreamBranch?.name ?? ''}.`}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setUpstreamBranch(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !upstreamValue.trim() || !upstreamBranch}
              onClick={async () => {
                if (!upstreamBranch) return;
                const result = await run(
                  () => api.setUpstream(upstreamBranch.name, upstreamValue.trim()),
                  'Upstream updated.',
                );
                if (result) setUpstreamBranch(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-faint">
            Remote branch
          </span>
          <select
            className="select w-full"
            value={upstreamValue}
            onChange={(event) => setUpstreamValue(event.target.value)}
          >
            <option value="">Select a remote branch</option>
            {remotes.map((branch) => (
              <option key={branch.ref} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete branch ${deleteTarget?.name ?? ''}?`}
        description={
          deleteTarget
            ? `The branch tip is saved to a trash ref and can be restored with Undo. ${
                deleteForce ? 'Force delete ignores unmerged commits.' : 'Unmerged branches require force delete.'
              }`
            : ''
        }
        confirmLabel="Delete branch"
        danger
        busy={busy}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const result = await run(
            () => api.deleteBranch(deleteTarget.name, deleteForce),
            `Branch ${deleteTarget.name} deleted.`,
          );
          if (result !== undefined) setDeleteTarget(null);
        }}
      >
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={deleteForce}
            onChange={(event) => setDeleteForce(event.target.checked)}
          />
          Force delete (discard unmerged commits from the branch pointer)
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={forcePushTarget !== null}
        onOpenChange={(open) => {
          if (!open) setForcePushTarget(null);
        }}
        title="Force push with lease?"
        description={`Push ${forcePushTarget?.name ?? ''} using --force-with-lease. This can overwrite remote history, but the lease protects against unexpected remote updates.`}
        confirmLabel="Force push"
        danger
        busy={busy}
        onConfirm={async () => {
          if (!forcePushTarget) return;
          await startJob(
            api.push({
              branch: forcePushTarget.name,
              force: true,
              confirm: true,
              setUpstream: !forcePushTarget.upstream,
            }),
          );
          setForcePushTarget(null);
        }}
      />
    </div>
  );
}
