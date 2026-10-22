import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FolderGit2,
  FolderOpen,
  GitBranch,
  Hash,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { shortHash, type Worktree } from '@gitastic/shared';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { cn } from '../lib/utils';
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Modal, PathText, Spinner } from './ui';

export function WorktreesView() {
  const queryClient = useQueryClient();
  const worktrees = useQuery({ queryKey: ['worktrees'], queryFn: api.worktrees });
  const repo = useQuery({ queryKey: ['repo'], queryFn: api.repo });
  const { busy, run } = useAction();

  const [addOpen, setAddOpen] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [createBranch, setCreateBranch] = useState(true);
  const [removeTarget, setRemoveTarget] = useState<Worktree | null>(null);

  const openAddModal = () => {
    const basePath = repo.data?.path ?? '';
    const defaultBranch = 'feature/worktree';
    setBranchName(defaultBranch);
    setTargetPath(basePath ? `${basePath}-worktree` : '');
    setCreateBranch(true);
    setAddOpen(true);
  };

  if (worktrees.isLoading) return <LoadingState label="Loading worktrees..." />;
  if (worktrees.isError) {
    return <ErrorState error={worktrees.error} retry={() => void worktrees.refetch()} />;
  }

  const list = worktrees.data ?? [];
  const currentRepoPath = repo.data?.path ?? '';

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="history-toolbar flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-edge/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink">
            Git Worktrees
          </span>
          <span className="badge">{list.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className="btn btn-primary h-8 text-xs" onClick={openAddModal}>
            <Plus className="h-3.5 w-3.5" />
            New worktree
          </button>
          <button
            type="button"
            className="btn-icon"
            title="Refresh worktrees"
            onClick={() => void worktrees.refetch()}
          >
            <RefreshCw className={cn('h-4 w-4', worktrees.isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 ? (
          <EmptyState
            icon={<FolderGit2 className="h-8 w-8" />}
            title="No worktrees found"
            description="Create a linked worktree to work on multiple branches simultaneously."
          />
        ) : (
          list.map((wt) => {
            const isCurrent = wt.path === currentRepoPath;
            return (
              <div
                key={wt.path}
                className={cn(
                  'group flex items-center justify-between gap-3 border-b border-edge/60 px-4 py-3 hover:bg-raised/50',
                  isCurrent && 'bg-raised',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <GitBranch className="h-4 w-4 shrink-0 text-accent" />
                    <span className="text-sm font-semibold text-ink">
                      {wt.branch ?? 'detached HEAD'}
                    </span>
                    {wt.isMain ? <span className="badge">main worktree</span> : null}
                    {isCurrent ? <span className="badge badge-accent">active</span> : null}
                    {wt.locked ? <span className="badge badge-danger">locked</span> : null}
                  </div>
                  <PathText text={wt.path} className="mt-0.5 font-mono text-xs text-muted" />
                  {wt.head ? (
                    <span className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-faint">
                      <Hash className="h-3 w-3" />
                      {shortHash(wt.head)}
                    </span>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {!isCurrent ? (
                    <button
                      type="button"
                      className="btn h-8 text-xs"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          async () => {
                            const opened = await api.openRepo(wt.path);
                            await Promise.all([
                              queryClient.invalidateQueries({ queryKey: ['session'] }),
                              queryClient.invalidateQueries({ queryKey: ['repo'] }),
                              queryClient.invalidateQueries({ queryKey: ['recent-repos'] }),
                            ]);
                            return opened;
                          },
                          `Switched to worktree ${wt.branch ?? wt.path}`,
                          { refresh: false },
                        )
                      }
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Switch
                    </button>
                  ) : null}
                  {!wt.isMain && !isCurrent ? (
                    <button
                      type="button"
                      className="btn-icon hover:text-danger"
                      title="Remove worktree"
                      disabled={busy}
                      onClick={() => setRemoveTarget(wt)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Create Git Worktree"
        description="Check out another branch into a separate folder so you can work on multiple branches in parallel."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !branchName.trim() || !targetPath.trim()}
              onClick={() =>
                void run(async () => {
                  await api.addWorktree({
                    path: targetPath.trim(),
                    branch: branchName.trim(),
                    createBranch,
                  });
                  await queryClient.invalidateQueries({ queryKey: ['worktrees'] });
                  await queryClient.invalidateQueries({ queryKey: ['branches'] });
                  setAddOpen(false);
                }, `Worktree created at ${targetPath.trim()}.`)
              }
            >
              {busy ? <Spinner /> : <Plus className="h-4 w-4" />}
              Create worktree
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
              className="input text-xs"
              autoFocus
              value={branchName}
              placeholder="feature/parallel-task"
              onChange={(event) => setBranchName(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              Worktree directory path
            </span>
            <input
              className="input font-mono text-xs"
              value={targetPath}
              placeholder="/Users/you/project-worktree"
              onChange={(event) => setTargetPath(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="accent-accent"
              checked={createBranch}
              onChange={(event) => setCreateBranch(event.target.checked)}
            />
            Create as new branch (`-b`)
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title="Remove Worktree"
        description={
          removeTarget ? `Remove worktree at ${removeTarget.path}?` : ''
        }
        confirmLabel="Remove worktree"
        danger
        busy={busy}
        onConfirm={() => {
          if (!removeTarget) return;
          void run(async () => {
            await api.removeWorktree({ path: removeTarget.path, force: true });
            await queryClient.invalidateQueries({ queryKey: ['worktrees'] });
            setRemoveTarget(null);
          }, 'Worktree removed.');
        }}
      />
    </div>
  );
}
