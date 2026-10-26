import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Heart,
  Info,
  Save,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import type { Session, SettingsPatch, UiStyle } from '@gitastic/shared';
import { api } from '../api';
import { applyAppearance } from '../App';
import { useAction } from '../lib/hooks';
import { cn } from '../lib/utils';
import { useStore } from '../store';
import { resolvedThemeMode, styleForTheme, type StyleMode } from '../ui-styles';
import { ProviderAuthAssistant } from './ProvidersPanel';
import { StylePicker } from './StylePicker';
import { Spinner } from './ui';

export function SettingsView({
  session,
  onClose,
}: {
  session: Session;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const closeSettings = useStore((state) => state.closeSettings);
  const { busy, run } = useAction();
  const identityQuery = useQuery({
    queryKey: ['git-identity'],
    queryFn: api.gitIdentity,
  });
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');

  useEffect(() => {
    if (identityQuery.data) {
      setGitName(identityQuery.data.name);
      setGitEmail(identityQuery.data.email);
    }
  }, [identityQuery.data]);
  const [form, setForm] = useState<SettingsPatch>({
    theme: session.config.theme,
    uiStyle: session.config.uiStyle ?? 'gorgeous',
    gitPath: session.config.gitPath,
    editor: session.config.editor,
    pullStrategy: session.config.pullStrategy,
    diffContext: session.config.diffContext,
    confirmDestructive: session.config.confirmDestructive,
  });

  const update = <K extends keyof SettingsPatch>(key: K, value: SettingsPatch[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const applyAndSaveAppearance = async (nextMode: StyleMode, nextStyle: UiStyle) => {
    const effectiveStyle = styleForTheme(nextMode, nextStyle);
    update('theme', nextMode);
    update('uiStyle', effectiveStyle);
    applyAppearance(nextMode, effectiveStyle);
    const saved = await api.updateSettings({
      ...form,
      theme: nextMode,
      uiStyle: effectiveStyle,
    });
    await queryClient.invalidateQueries({ queryKey: ['session'] });
    return saved;
  };

  const save = async () => {
    const result = await run(
      async () => {
        if (gitName.trim() && gitEmail.trim()) {
          await api.updateGitIdentity({
            name: gitName.trim(),
            email: gitEmail.trim(),
          });
        }
        const mode = resolvedThemeMode(form.theme ?? 'dark');
        const saved = await api.updateSettings({
          ...form,
          theme: mode,
          uiStyle: styleForTheme(mode, form.uiStyle ?? 'gorgeous'),
        });
        await queryClient.invalidateQueries();
        applyAppearance(saved.theme, saved.uiStyle ?? 'gorgeous');
        return saved;
      },
      'Settings saved.',
    );
    if (result) {
      setForm({
        theme: result.theme,
        uiStyle: result.uiStyle ?? 'gorgeous',
        gitPath: result.gitPath,
        editor: result.editor,
        pullStrategy: result.pullStrategy,
        diffContext: result.diffContext,
        confirmDestructive: result.confirmDestructive,
      });
    }
  };

  const currentMode = resolvedThemeMode(form.theme ?? 'dark');
  const currentStyle = styleForTheme(currentMode, form.uiStyle ?? 'gorgeous');
  const gitVersion = session.onboarding.gitVersion;

  return (
    <div className="app-backdrop scrollbar-thin h-full overflow-y-auto bg-transparent">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="gradient-text text-xl font-semibold">Settings</h1>
            <p className="text-sm text-muted">
              Styles, GitHub/GitLab tokens, SSH keys, and Git preferences.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/sponsors/dirk-rossbach"
              target="_blank"
              rel="noreferrer"
              className="btn"
            >
              <Heart className="h-4 w-4 text-danger" />
              Sponsor
            </a>
            <button
              type="button"
              className="btn"
              onClick={() => (onClose ? onClose() : closeSettings())}
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </div>
        </div>

        <section className="card space-y-5 p-5">
          <div>
            <h2 className="panel-title">Appearance</h2>
            <p className="mt-1 text-xs text-muted">
              Pick from the dark and light style libraries. Hover a style to preview it; selecting
              one applies the look and its matching mode. Focus is available in both groups.
            </p>
          </div>

          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-faint">
              UI Style
            </span>
            <StylePicker
              current={currentStyle}
              currentMode={currentMode}
              onSelect={(style, mode) => void applyAndSaveAppearance(mode, style)}
            />
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="panel-title">Git User Identity</h2>
              <p className="mt-0.5 text-xs text-muted">
                Global Git commit author (`user.name` and `user.email`).
              </p>
            </div>
            <button
              type="button"
              className="btn h-8 text-xs"
              disabled={busy || !gitName.trim() || !gitEmail.trim()}
              onClick={() =>
                void run(async () => {
                  await api.updateGitIdentity({
                    name: gitName.trim(),
                    email: gitEmail.trim(),
                  });
                  await queryClient.invalidateQueries({ queryKey: ['git-identity'] });
                  await queryClient.invalidateQueries({ queryKey: ['session'] });
                }, 'Git user identity updated.')
              }
            >
              <UserCheck className="h-3.5 w-3.5 text-accent" />
              Save Git User
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                User Name (`user.name`)
              </span>
              <input
                className="input text-xs"
                value={gitName}
                placeholder="Your Name"
                onChange={(event) => setGitName(event.target.value)}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                User Email (`user.email`)
              </span>
              <input
                className="input font-mono text-xs"
                value={gitEmail}
                placeholder="you@example.com"
                onChange={(event) => setGitEmail(event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="panel-title mb-3">Tokens, Accounts & SSH Keys</h2>
          <ProviderAuthAssistant />
        </section>

        <section className="card p-5">
          <h2 className="panel-title mb-3">Git Preferences</h2>
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
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">
                Diff context lines
              </span>
              <input
                type="number"
                min={0}
                max={20}
                className="input h-9"
                value={form.diffContext ?? 3}
                onChange={(event) => update('diffContext', Number(event.target.value))}
              />
              <span className="text-[11px] text-faint">
                Unchanged lines around each change (0–20).
              </span>
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

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
            <div>
              <p className="text-sm font-medium text-ink">History cache</p>
              <p className="text-xs text-muted">
                Commit timelines and branch layouts are cached per repository fingerprint for instant loading.
              </p>
            </div>
            <button
              type="button"
              className="btn h-8 text-xs"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.clearCache();
                  queryClient.removeQueries({ queryKey: ['history'] });
                  queryClient.removeQueries({ queryKey: ['commit'] });
                  await queryClient.invalidateQueries({ queryKey: ['history'] });
                }, 'History cache cleared.')
              }
            >
              <Trash2 className="h-3.5 w-3.5 text-danger" />
              Clear history cache
            </button>
          </div>
        </section>

        <section className="card p-5">
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

        <div className="flex items-center justify-end gap-2 pb-4">
          <button
            type="button"
            className="btn"
            onClick={() =>
              setForm({
                theme: session.config.theme,
                uiStyle: session.config.uiStyle ?? 'gorgeous',
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
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? <Spinner /> : <Save className="h-4 w-4" />}
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
