import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Info, Save } from 'lucide-react';
import type { Session, SettingsPatch } from '@gitastic/shared';
import { api } from '../api';
import { useAction } from '../lib/hooks';
import { cn } from '../lib/utils';
import { Spinner } from './ui';

function applyTheme(theme: 'dark' | 'light' | 'system') {
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.dataset.theme = resolved;
}

export function SettingsView({ session }: { session: Session }) {
  const queryClient = useQueryClient();
  const { busy, run } = useAction();
  const [form, setForm] = useState<SettingsPatch>({
    theme: session.config.theme,
    gitPath: session.config.gitPath,
    editor: session.config.editor,
    pullStrategy: session.config.pullStrategy,
    diffContext: session.config.diffContext,
    confirmDestructive: session.config.confirmDestructive,
  });

  const update = <K extends keyof SettingsPatch>(key: K, value: SettingsPatch[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    const result = await run(
      async () => {
        const saved = await api.updateSettings(form);
        await queryClient.invalidateQueries();
        applyTheme(saved.theme);
        return saved;
      },
      'Settings saved.',
    );
    if (result) {
      setForm({
        theme: result.theme,
        gitPath: result.gitPath,
        editor: result.editor,
        pullStrategy: result.pullStrategy,
        diffContext: result.diffContext,
        confirmDestructive: result.confirmDestructive,
      });
    }
  };

  const gitVersion = session.onboarding.gitVersion;

  return (
    <div className="scrollbar-thin h-full overflow-y-auto bg-panel">
      <div className="mx-auto max-w-3xl space-y-6 p-5">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-sm text-muted">
            Stored locally in your Gitastic config directory. No secrets are saved.
          </p>
        </div>

        <section className="card p-4">
          <h2 className="panel-title mb-3">Appearance</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">Theme</span>
              <select
                className="select w-full"
                value={form.theme ?? 'dark'}
                onChange={(event) => {
                  const theme = event.target.value as 'dark' | 'light' | 'system';
                  update('theme', theme);
                  applyTheme(theme);
                }}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                Diff context lines
              </span>
              <input
                type="number"
                min={0}
                max={20}
                className="input"
                value={form.diffContext ?? 3}
                onChange={(event) => update('diffContext', Number(event.target.value))}
              />
            </label>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="panel-title mb-3">Git</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                Git executable
              </span>
              <input
                className="input font-mono text-xs"
                value={form.gitPath ?? 'git'}
                onChange={(event) => update('gitPath', event.target.value)}
              />
              <span className="text-[11px] text-faint">
                Detected version: {gitVersion ?? 'unknown'}
              </span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                Editor command
              </span>
              <input
                className="input font-mono text-xs"
                value={form.editor ?? ''}
                onChange={(event) => update('editor', event.target.value)}
                placeholder="code --wait"
              />
              <span className="text-[11px] text-faint">
                Reserved for future external-editor actions.
              </span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                Default pull strategy
              </span>
              <select
                className="select w-full"
                value={form.pullStrategy ?? 'ff-only'}
                onChange={(event) =>
                  update('pullStrategy', event.target.value as 'ff-only' | 'merge' | 'rebase')
                }
              >
                <option value="ff-only">Fast-forward only</option>
                <option value="merge">Merge</option>
                <option value="rebase">Rebase</option>
              </select>
            </label>
            <label className="mt-6 flex items-start gap-2 text-sm text-muted">
              <input
                type="checkbox"
                className="mt-0.5 accent-accent"
                checked={form.confirmDestructive ?? true}
                onChange={(event) => update('confirmDestructive', event.target.checked)}
              />
              <span>
                Confirm destructive operations
                <span className="block text-[11px] text-faint">
                  Force push, hard reset, discard, and clean.
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="panel-title mb-3">Environment checks</h2>
          <div className="space-y-2">
            {session.onboarding.checks.map((check) => {
              const Icon =
                check.status === 'ok'
                  ? CheckCircle2
                  : check.status === 'warn'
                    ? Info
                    : AlertTriangle;
              return (
                <div
                  key={check.id}
                  className="flex items-start gap-2.5 rounded-md border border-edge bg-raised/40 px-3 py-2"
                >
                  <Icon
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      check.status === 'ok'
                        ? 'text-success'
                        : check.status === 'warn'
                          ? 'text-warning'
                          : 'text-danger',
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{check.label}</p>
                    <p className="break-words text-xs text-muted">{check.detail}</p>
                    {check.hint ? <p className="mt-0.5 text-xs text-faint">{check.hint}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card p-4">
          <h2 className="panel-title mb-3">Repository</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="text-muted">Name</dt>
            <dd>{session.repo?.name}</dd>
            <dt className="text-muted">Path</dt>
            <dd className="break-all font-mono text-xs">{session.repo?.path}</dd>
            <dt className="text-muted">Home root</dt>
            <dd className="break-all font-mono text-xs">{session.onboarding.home}</dd>
            <dt className="text-muted">Git version</dt>
            <dd className="font-mono text-xs">{session.onboarding.gitVersion ?? 'not found'}</dd>
          </dl>
        </section>

        <div className="flex items-center justify-end gap-2 pb-4">
          <button
            type="button"
            className="btn"
            onClick={() =>
              setForm({
                theme: session.config.theme,
                gitPath: session.config.gitPath,
                editor: session.config.editor,
                pullStrategy: session.config.pullStrategy,
                diffContext: session.config.diffContext,
                confirmDestructive: session.config.confirmDestructive,
              })
            }
          >
            Reset
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? <Spinner /> : <Save className="h-4 w-4" />}
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
