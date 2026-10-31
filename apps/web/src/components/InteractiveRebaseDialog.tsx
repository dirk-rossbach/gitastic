import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GitCommitHorizontal, RefreshCw, WandSparkles } from 'lucide-react';
import type { RebaseAction, RebasePlanCommit } from '@gitastic/shared';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useStore } from '../store';
import { Modal, Spinner } from './ui';

type PlanEntry = { action: RebaseAction; message: string };

const ACTIONS: RebaseAction[] = ['pick', 'reword', 'squash', 'fixup', 'drop'];

export function InteractiveRebaseDialog({
  open,
  onOpenChange,
  defaultUpstream,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultUpstream: string;
}) {
  const queryClient = useQueryClient();
  const notify = useStore((state) => state.notify);
  const setView = useStore((state) => state.setView);
  const { busy, run } = useAction();
  const [upstream, setUpstream] = useState(defaultUpstream);
  const [commits, setCommits] = useState<RebasePlanCommit[]>([]);
  const [plan, setPlan] = useState<Record<string, PlanEntry>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!upstream.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.rebasePlan(upstream.trim());
      setCommits(response.commits);
      setPlan(
        Object.fromEntries(
          response.commits.map((commit) => [
            commit.hash,
            { action: 'pick' as RebaseAction, message: commit.subject },
          ]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }, [upstream]);

  useEffect(() => {
    if (!open) return;
    setUpstream(defaultUpstream);
    setCommits([]);
    setPlan({});
    setError(null);
  }, [open, defaultUpstream]);

  const move = (index: number, delta: number) => {
    setCommits((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const update = (hash: string, patch: Partial<PlanEntry>) =>
    setPlan((current) => ({ ...current, [hash]: { ...current[hash], ...patch } }));

  const submit = () =>
    run(async () => {
      const entries = commits.map((commit) => ({
        hash: commit.hash,
        action: plan[commit.hash]?.action ?? 'pick',
        message: plan[commit.hash]?.message,
      }));
      const result = await api.interactiveRebase(upstream.trim(), entries);
      await queryClient.invalidateQueries({ queryKey: ['history'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      await queryClient.invalidateQueries({ queryKey: ['repo'] });
      onOpenChange(false);
      if (result.conflicted) {
        notify('info', 'Rebase paused — resolve the conflicts and continue.');
        setView('conflicts');
      }
      return result;
    }, 'Interactive rebase finished.');

  const squashedWithoutPick =
    commits.length > 0 && (plan[commits[0].hash]?.action === 'squash' || plan[commits[0].hash]?.action === 'fixup');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Interactive rebase"
      description="Reorder commits and choose pick, reword, squash, fixup or drop."
      size="wide"
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || commits.length === 0 || squashedWithoutPick}
            onClick={() => void submit()}
          >
            {busy ? <Spinner /> : <WandSparkles className="h-4 w-4" />}
            Start rebase
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              Onto (upstream)
            </span>
            <input
              className="input font-mono text-xs"
              value={upstream}
              placeholder="origin/main"
              onChange={(event) => setUpstream(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void load();
              }}
            />
          </label>
          <button type="button" className="btn h-9 text-xs" onClick={() => void load()}>
            {loading ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
            Load commits
          </button>
        </div>

        {error ? (
          <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}

        {commits.length === 0 && !loading && !error ? (
          <p className="text-xs text-faint">
            Enter an upstream ref and load the commits between it and the current branch.
          </p>
        ) : null}

        {commits.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-faint">Oldest first · this is the new order.</p>
            {commits.map((commit, index) => {
              const entry = plan[commit.hash] ?? { action: 'pick', message: commit.subject };
              return (
                <div
                  key={commit.hash}
                  className="flex items-center gap-2 rounded-md border border-edge bg-raised/40 px-2.5 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      className="text-faint transition hover:text-ink disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="text-faint transition hover:text-ink disabled:opacity-30"
                      disabled={index === commits.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <GitCommitHorizontal className="h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">{commit.subject}</p>
                    <p className="font-mono text-[10px] text-faint">{commit.hash.slice(0, 8)}</p>
                  </div>
                  <select
                    className="select h-7 w-24 shrink-0 text-[11px]"
                    value={entry.action}
                    onChange={(event) =>
                      update(commit.hash, { action: event.target.value as RebaseAction })
                    }
                  >
                    {ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                  {entry.action === 'reword' ? (
                    <input
                      className={cn('input h-7 w-56 shrink-0 text-[11px]')}
                      value={entry.message}
                      onChange={(event) => update(commit.hash, { message: event.target.value })}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
